import { databaseReadable } from "../db/readable";
import { Alerts } from "./alerts";
import { ingestErrors } from "./errors/ingest";
import { Telemetry, type RequestObservation } from "./telemetry";
import { detectCgroups } from "./cgroups";
import { createSessionLinks } from "../auth/session-links";
import { matchesPublicRoute } from "./public-routes";
import { buildInfo } from "../version";
import { updateCheckout } from "../self-update";
import { requireUpdateService, scheduleUpdateRestart } from "../service/update-restart";
import { createBackups } from "../backup";
import { dashboard, signOut } from "./dashboard";
import { TunnelSupervisor } from "../tunnel/supervisor";
import { tunnelTokenPath } from "../tunnel";
import { localTunnelFiles } from "../tunnel/local";
import { createCliLogin } from "../auth/cli-login";
import { join, resolve } from "node:path";
import { BedrockError, asBedrockError } from "../error";
import { atomicWrite, bedrockHome, openDataRoot, readConfig, validateConfig } from "./config";
import { localToken, openDaemonDatabase } from "./db";
import { createApi, daemonError } from "./api";
import { hostTarget, proxyHttp, proxyWebSocket, relayWebSocket, type Relay } from "./proxy";
import { Releases } from "./releases";
import { Supervisor } from "./supervisor";
import { createSessions } from "../auth/sessions";
import { createAuth, type AuthOptions } from "../auth/routes";
import { cookieToken, escapeHtml, noticePage, requireOrigin, wantsPage, wrongAccountPage } from "../auth/http";
import { deriveIdentitySecret, signIdentity } from "../auth/identity";
import { enforceAccess } from "../auth/policy";
import { sessionSockets } from "../auth/sockets";

export interface StartDaemonOptions { /** Internal test clock override; never read from configuration or the environment. */ idleTimeoutForTests?: number; hibernateTimeoutForTests?: number; telemetryForTests?: boolean; alertsClockForTests?: () => number; home?: string; port?: number; domain?: string; dev?: boolean; devPebble?: { name: string; dir: string; dataDir?: string; cron?: boolean }; auth?: AuthOptions; tunnelBinary?: () => string; maintenance?: { info: Awaited<ReturnType<typeof buildInfo>>; update: () => Promise<unknown> } }

export async function startDaemon(options: StartDaemonOptions = {}) {
  const home = resolve(options.home ?? bedrockHome());
  if (options.dev && options.domain !== "localhost") throw new BedrockError("INVALID_DEV_DOMAIN", "Development auth requires the explicit localhost domain.", "Use bedrock dev; never enable development auth on a production domain.");
  const stored = options.dev && !await Bun.file(join(home, "config.json")).exists()
    ? { domain: "localhost", creators: [], port: 3000 } : await readConfig(home);
  if (options.dev && stored.domain !== "localhost") throw new BedrockError("INVALID_DEV_DOMAIN", "Development auth cannot use a production configuration.", "Use bedrock dev with its local .bedrock directory.");
  const config = validateConfig({ ...stored, port: options.port ?? stored.port, domain: options.domain ?? stored.domain });
  const data = await openDataRoot(home, config);
  const db = await openDaemonDatabase(home);
  const dev = options.dev === true;
  const master = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const cgroups = await detectCgroups({ dev });
  const telemetry: Telemetry = new Telemetry(home, () => supervisor.resourceGroups(), options.telemetryForTests !== false);
  const supervisor: Supervisor = new Supervisor(home, db, master, config.creators, dev, data, options.idleTimeoutForTests, undefined, cgroups, options.hibernateTimeoutForTests, telemetry);
  const alerts = new Alerts(home, options.alertsClockForTests, config);
  supervisor.alerts = alerts;
  const sessions = createSessions(db.db);
  const sockets = sessionSockets(sessions);
  const auth = createAuth(config, dev, sessions, hash => sockets.revoke(hash), options.auth);
  const links = createSessionLinks(db, sessions, config, dev);
  const cliLogin = createCliLogin(config, sessions, db, dev);
  const tunnelToken = dev ? "" : (await Bun.file(tunnelTokenPath(home)).text().catch(() => "")).trim();
  const tunnel = config.cloudflare && (config.cloudflare.mode === "local" || tunnelToken) ? new TunnelSupervisor(home, tunnelToken, options.tunnelBinary, config.cloudflare.mode === "local" ? localTunnelFiles(home, config.cloudflare).configFile : undefined) : undefined;
  const releases = new Releases(home, db, supervisor);
  const backups = createBackups(home, db, releases);
  let server: Bun.Server<Relay> | undefined;
  try {
    const adminToken = await localToken(home, db);
    let updating = false;
    const maintenance = options.maintenance ?? { info: await buildInfo(), async update() {
      if (updating) throw new BedrockError("UPDATE_BUSY", "A self-update is already in progress or awaiting restart.", "Wait for the daemon to restart before retrying.");
      updating = true;
      try {
        await requireUpdateService({ home });
        const result = await updateCheckout();
        await scheduleUpdateRestart({ home });
        return result;
      } catch (error) { updating = false; throw error; }
    } };
    const api = createApi(db, releases, supervisor, () => tunnel?.status() ?? { running: false, pid: null }, backups, config, maintenance, { adminToken, links, port: () => server!.port! });
    const notice = (request: Request, status: number, heading: string, hint: string) => wantsPage(request)
      ? noticePage(status, heading, hint)
      : new Response(`${heading}. ${hint.replace(/<\/?code>/g, "")}`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
    const notFound = (request: Request) => notice(request, 404, "Pebble not found", "Deploy it with <code>bedrock deploy</code>, or check its hostname.");
    server = Bun.serve<Relay>({
      hostname: "127.0.0.1", port: config.port, maxRequestBodySize: 1024 ** 4,
      websocket: relayWebSocket,
      async fetch(request, server) {
        let observation: RequestObservation | undefined;
        let proxied = false;
        const handle = async () => {
        try {
          const host = request.headers.get("host") ?? "";
          const target = hostTarget(host, config.domain);
          const url = new URL(request.url);
          const origin = `${dev || host.split(":")[0]!.endsWith(".localhost") ? "http" : "https"}://${host}`;
          if (target === "bedrock" && request.method === "GET" && url.pathname === "/healthz") {
            const viable = databaseReadable(db.db, "pebbles");
            return new Response(viable ? "bedrock-health-v1\n" : "bedrock-unavailable-v1\n", { status: viable ? 200 : 503, headers: { "cache-control": "no-store, max-age=0", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
          }
          if (target === "bedrock" || host.split(":")[0] === "127.0.0.1" && url.pathname.startsWith("/api/")) {
            if (request.method === "GET" && url.pathname === "/") return dashboard(request, origin, config, db, sessions, dev);
            if (request.method === "POST" && url.pathname === "/sign-out") return signOut(auth.logout(request, origin));
            if (dev && url.pathname === "/_bedrock/dev-login") return await auth.devLogin(request, origin);
            if (url.pathname === "/cli-login") return await cliLogin(request, origin);
            // Lifecycle calls wait for health gates (up to 15 s on a slow disk), deploys and logs follow longer;
            // Bun's 10 s idle default would reset the CLI's connection mid-operation.
            if (url.pathname.startsWith("/api/")) server.timeout(request, 0);
            return await api(request);
          }
          if (target === "auth" && host.split(":")[0] === `auth.${config.domain}`) return await auth.handle(request, origin);
          if (!target || ["auth", "www"].includes(target)) return notFound(request);
          if (url.pathname === "/_bedrock/session" && db.get(target)) return await links.handle(request, origin, target);
          if (url.pathname === "/_bedrock/errors") {
            const record = db.get(target);
            const attached = options.devPebble?.name === target;
            if (!record && !attached) return notFound(request);
            requireOrigin(request, origin);
            // Access is read from the retained release rather than asking a sleeping child.
            const access = supervisor.child(target)?.access ?? (record ? (await Bun.file(join(record.release, ".bedrock-idle.json")).json().catch(() => null))?.access ?? "creators" : "public");
            enforceAccess(access, sessions.resolve(cookieToken(request))?.user ?? null, config.creators);
            request.headers.delete("cookie"); request.headers.delete("authorization");
            return await ingestErrors(request, target, telemetry.errors);
          }
          if (telemetry.enabled && (supervisor.child(target) || db.get(target) || options.devPebble?.name === target)) observation = telemetry.begin(target, request.method, url.pathname, request.headers.get("upgrade")?.toLowerCase() === "websocket" ? "websocket" : url.pathname.startsWith("/_bedrock/") ? "control" : "ordinary");
          // Cold starts may exceed Bun's default request timeout on a slow disk.
          server.timeout(request, 0);
          let child;
          try { child = await supervisor.ensure(target); } catch { /* Normal crash supervision retries failed wakes. */ }
          // A deployed but stopped pebble is a temporary condition, not a missing site.
          if (!child) {
            if (!db.get(target)) return notFound(request);
            const stopped = notice(request, 503, `${target} isn’t running`, `It is deployed but not running. Start it with <code>bedrock start ${escapeHtml(target)}</code>.`);
            stopped.headers.set("retry-after", "5");
            return stopped;
          }
          observation?.route(child.publicRoutes);
          if (dev && url.pathname === "/_bedrock/dev-login") return await auth.devLogin(request, origin);
          const websocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
          if (!websocket && matchesPublicRoute(child.publicRoutes, request.method, url.pathname)) {
            request.headers.delete("cookie");
            request.headers.delete("authorization");
            for (const name of [...request.headers.keys()]) if (name.startsWith("x-bedrock-")) request.headers.delete(name);
            server.timeout(request, 0);
            const complete = supervisor.activity(child);
            proxied = true;
            return await proxyHttp(request, child.port, child.releaseId, complete, { "x-forwarded-proto": new URL(origin).protocol.slice(0, -1) }, observation);
          }
          const hasSessionCookie = (request.headers.get("cookie") ?? "").split(";").some(part => part.trim().split("=", 1)[0] === "bedrock_session");
          const bearer = !hasSessionCookie && request.headers.get("authorization")?.startsWith("Bearer brk_") === true;
          const token = cookieToken(request);
          const session = sessions.resolve(token, !websocket);
          if (url.pathname === "/_bedrock/logout" && request.method === "POST") return auth.logout(request, origin);
          if (url.pathname === "/_bedrock/sign-out" && request.method === "POST") return signOut(auth.logout(request, origin));
          if (url.pathname === "/_bedrock/me" && request.method === "GET") {
            const response = Response.json({ user: session?.user ?? null }, { headers: { "cache-control": "no-store" } });
            if (session?.refreshed) response.headers.append("set-cookie", auth.cookie(token!, session.expiresAt));
            return response;
          }
          // Without the ambient session cookie, a bearer must be supplied explicitly;
          // cross-site requests cannot borrow browser identity, so CSRF does not apply.
          if (!bearer && (websocket || !["GET", "HEAD"].includes(request.method))) requireOrigin(request, origin);
          try { if (!bearer) enforceAccess(child.access, session?.user ?? null, config.creators); }
          catch (error) {
            const page = !websocket && ["GET", "HEAD"].includes(request.method) && request.headers.get("accept")?.includes("text/html") && !url.pathname.startsWith("/_bedrock/") && !url.pathname.startsWith("/api/");
            if (page && error instanceof BedrockError && error.code === "UNAUTHENTICATED") {
              const returnTo = `${origin}${url.pathname}${url.search}`;
              const login = dev ? `${origin}/_bedrock/dev-login` : `https://auth.${config.domain}/login`;
              return Response.redirect(`${login}?return=${encodeURIComponent(returnTo)}`, 302);
            }
            if (page && session) return wrongAccountPage(session.user.email ?? "", target, "/_bedrock/sign-out");
            throw error;
          }
          if (hasSessionCookie) request.headers.delete("authorization");
          const identity = { ...(session ? signIdentity(session.user, deriveIdentitySecret(master, target)) : {}), "x-forwarded-proto": new URL(origin).protocol.slice(0, -1) };
          if (websocket) {
            const complete = supervisor.activity(child);
            try {
              const response = await proxyWebSocket(request, server, child.port, identity, relay => {
                const remove = session ? sockets.register(relay, token!, session.hash) : undefined;
                if (session) sockets.revalidate();
                return () => { remove?.(); complete(); };
              }, observation);
              if (!response) { proxied = true; observation?.headers(101); }
              return response;
            } catch (error) { complete(); observation?.finish(request.signal.aborted ? "abort" : "failure"); throw error; }
          }
          server.timeout(request, 0);
          const complete = supervisor.activity(child);
          proxied = true;
          const response = await proxyHttp(request, child.port, child.releaseId, complete, identity, observation);
          if (session?.refreshed) response.headers.append("set-cookie", auth.cookie(token!, session.expiresAt));
          return response;
        } catch (error) { return daemonError(error, request); }
        };
        const response = await handle();
        if (!proxied && response) { observation?.headers(response.status); observation?.finish(request.signal.aborted ? "abort" : undefined); }
        return response;
      },
      error: error => daemonError(error),
    });
    alerts.setProxyPort(server.port!);
    supervisor.apiUrl = `http://127.0.0.1:${server.port}`;
    if (options.devPebble) {
      if (!dev) throw new BedrockError("INVALID_DEV_DOMAIN", "A dev pebble requires development mode.", "Use bedrock dev.");
      supervisor.devOptions = options.devPebble;
      const child = await supervisor.launch(options.devPebble.name, options.devPebble.dir, true);
      supervisor.activate(options.devPebble.name, child);
      await supervisor.startExclusive(options.devPebble.name, child);
    } else {
      // Serve the public hostname as soon as the daemon listens: requests for pebbles still restoring
      // wait on their own health gates, while waiting for restore() would take every site offline
      // for as long as the slowest pebble needs to start (minutes on a busy disk).
      tunnel?.start();
      await supervisor.restore();
    }
    await atomicWrite(join(home, "daemon.json"), JSON.stringify({ port: server.port, domain: config.domain }) + "\n");
    if (options.devPebble) tunnel?.start();
    if (!dev) backups.start();
    if (!options.alertsClockForTests) alerts.start(db, supervisor, config, () => config.cloudflare ? tunnel?.status().running ?? false : null);
    let stopping: Promise<void> | undefined;
    return {
      server, home, telemetry, alerts,
      async runDevJob(name: string) {
        if (!options.devPebble) throw new BedrockError("DEV_ONLY", "Explicit dev jobs require an attached pebble.", "Use bedrock jobs run for deployed pebbles.");
        return supervisor.jobs(options.devPebble.name, name);
      },
      stop() {
        return stopping ??= (async () => {
          sockets.stop();
          await alerts.pause();
          await backups.stop();
          await releases.shutdown();
          // Keep the relay alive until children send their restart close frames.
          await supervisor.shutdown();
          await server!.stop(true);
          await tunnel?.stop();
          await alerts.close();
          await telemetry.close();
          db.close();
        })();
      },
    };
  } catch (error) {
    sockets.stop();
    await alerts.pause();
    await backups.stop();
    await server?.stop(true);
    await tunnel?.stop();
    await supervisor.shutdown();
    await alerts.close();
    await telemetry.close();
    db.close();
    throw asBedrockError(error, "DAEMON_START_FAILED", "Check setup, the listen port, and daemon home permissions.");
  }
}
