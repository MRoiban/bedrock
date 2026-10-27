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

export interface StartDaemonOptions { home?: string; port?: number; domain?: string; dev?: boolean; devPebble?: { name: string; dir: string }; auth?: AuthOptions; tunnelBinary?: () => string; maintenance?: { info: Awaited<ReturnType<typeof buildInfo>>; update: () => Promise<unknown> } }

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
  const supervisor = new Supervisor(home, db, master, config.creators, dev, data);
  const sessions = createSessions(db.db);
  const sockets = sessionSockets(sessions);
  const auth = createAuth(config, dev, sessions, hash => sockets.revoke(hash), options.auth);
  const cliLogin = createCliLogin(config, sessions, db, dev);
  const tunnelToken = dev ? "" : (await Bun.file(tunnelTokenPath(home)).text().catch(() => "")).trim();
  const tunnel = config.cloudflare && (config.cloudflare.mode === "local" || tunnelToken) ? new TunnelSupervisor(home, tunnelToken, options.tunnelBinary, config.cloudflare.mode === "local" ? localTunnelFiles(home, config.cloudflare).configFile : undefined) : undefined;
  const releases = new Releases(home, db, supervisor);
  const backups = createBackups(home, db, releases);
  let server: Bun.Server<Relay> | undefined;
  try {
    await localToken(home, db);
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
    const api = createApi(db, releases, supervisor, () => tunnel?.status() ?? { running: false, pid: null }, backups, config, maintenance);
    const notice = (request: Request, status: number, heading: string, hint: string) => wantsPage(request)
      ? noticePage(status, heading, hint)
      : new Response(`${heading}. ${hint.replace(/<\/?code>/g, "")}`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
    const notFound = (request: Request) => notice(request, 404, "Pebble not found", "Deploy it with <code>bedrock deploy</code>, or check its hostname.");
    server = Bun.serve<Relay>({
      hostname: "127.0.0.1", port: config.port, maxRequestBodySize: 1024 ** 4,
      websocket: relayWebSocket,
      async fetch(request, server) {
        try {
          const host = request.headers.get("host") ?? "";
          const target = hostTarget(host, config.domain);
          const url = new URL(request.url);
          const origin = `${dev || host.split(":")[0]!.endsWith(".localhost") ? "http" : "https"}://${host}`;
          if (target === "bedrock" || host.split(":")[0] === "127.0.0.1" && url.pathname.startsWith("/api/")) {
            if (request.method === "GET" && url.pathname === "/") return dashboard(request, origin, config, db, sessions, dev);
            if (request.method === "POST" && url.pathname === "/sign-out") return signOut(auth.logout(request, origin));
            if (dev && url.pathname === "/_bedrock/dev-login") return await auth.devLogin(request, origin);
            if (url.pathname === "/cli-login") return await cliLogin(request, origin);
            return await api(request);
          }
          if (target === "auth" && host.split(":")[0] === `auth.${config.domain}`) return await auth.handle(request, origin);
          if (!target || ["auth", "www"].includes(target)) return notFound(request);
          const child = supervisor.child(target);
          // A deployed but stopped pebble is a temporary condition, not a missing site.
          if (!child) {
            if (!db.get(target)) return notFound(request);
            const stopped = notice(request, 503, `${target} isn’t running`, `It is deployed but not running. Start it with <code>bedrock start ${escapeHtml(target)}</code>.`);
            stopped.headers.set("retry-after", "5");
            return stopped;
          }
          if (dev && url.pathname === "/_bedrock/dev-login") return await auth.devLogin(request, origin);
          const websocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
          if (!websocket && matchesPublicRoute(child.publicRoutes, request.method, url.pathname)) {
            request.headers.delete("cookie");
            request.headers.delete("authorization");
            for (const name of [...request.headers.keys()]) if (name.startsWith("x-bedrock-")) request.headers.delete(name);
            server.timeout(request, 0);
            child.requests++;
            return await proxyHttp(request, child.port, child.releaseId, () => { child.requests--; }, { "x-forwarded-proto": new URL(origin).protocol.slice(0, -1) });
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
            const response = await proxyWebSocket(request, server, child.port, identity, session ? relay => {
              const remove = sockets.register(relay, token!, session.hash);
              sockets.revalidate();
              return remove;
            } : undefined);
            return response;
          }
          server.timeout(request, 0);
          child.requests++;
          const response = await proxyHttp(request, child.port, child.releaseId, () => { child.requests--; }, identity);
          if (session?.refreshed) response.headers.append("set-cookie", auth.cookie(token!, session.expiresAt));
          return response;
        } catch (error) { return daemonError(error, request); }
      },
      error: error => daemonError(error),
    });
    supervisor.apiUrl = `http://127.0.0.1:${server.port}`;
    if (options.devPebble) {
      if (!dev) throw new BedrockError("INVALID_DEV_DOMAIN", "A dev pebble requires development mode.", "Use bedrock dev.");
      const child = await supervisor.launch(options.devPebble.name, options.devPebble.dir, true);
      supervisor.activate(options.devPebble.name, child);
    } else await supervisor.restore();
    await atomicWrite(join(home, "daemon.json"), JSON.stringify({ port: server.port, domain: config.domain }) + "\n");
    tunnel?.start();
    if (!dev) backups.start();
    let stopping: Promise<void> | undefined;
    return {
      server, home,
      stop() {
        return stopping ??= (async () => {
          sockets.stop();
          await backups.stop();
          await releases.shutdown();
          // Keep the relay alive until children send their restart close frames.
          await supervisor.shutdown();
          await server!.stop(true);
          await tunnel?.stop();
          db.close();
        })();
      },
    };
  } catch (error) {
    sockets.stop();
    await backups.stop();
    await server?.stop(true);
    await tunnel?.stop();
    await supervisor.shutdown();
    db.close();
    throw asBedrockError(error, "DAEMON_START_FAILED", "Check setup, the listen port, and daemon home permissions.");
  }
}
