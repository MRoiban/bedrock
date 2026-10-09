import { authorizeScope, matchesPebble } from "./token-scope";
import { createSecrets } from "./secrets";
import type { BuildInfo } from "../version";
import { daemonFeatures } from "../features";
import { tokenHash } from "./db";
import { validateName } from "../config";
import { BedrockError, asBedrockError } from "../error";
import type { DaemonDatabase } from "./db";
import type { Releases } from "./releases";
import type { Supervisor } from "./supervisor";

export function daemonError(error: unknown) {
  const typed = asBedrockError(error, "DAEMON_FAILED", "Check the daemon and pebble logs, then retry.");
  const status = ["UNAUTHORIZED", "UNAUTHENTICATED"].includes(typed.code) ? 401
    : ["FORBIDDEN", "INVALID_IDENTITY", "TOKEN_OWNER_REQUIRED"].includes(typed.code) ? 403
    : ["PEBBLE_NOT_FOUND", "NOT_FOUND"].includes(typed.code) ? 404
    : ["PEBBLE_BUSY", "PEBBLE_STOPPED", "TOKENS_DISABLED"].includes(typed.code) ? 409
    : ["INVALID_ARGS", "INVALID_TOKEN_PERMISSION", "INVALID_RETURN_URL", "INVALID_OAUTH_STATE", "OAUTH_FAILED", "INVALID_PEBBLE_NAME", "CONFIRM_REQUIRED", "INVALID_ARCHIVE", "UNSAFE_ARCHIVE"].includes(typed.code) ? 400
    : typed.code === "UPSTREAM_UNAVAILABLE" ? 502 : 500;
  return Response.json({ ok: false, error: typed.toJSON() }, { status });
}
export function createApi(db: DaemonDatabase, releases: Releases, supervisor: Supervisor, tunnelStatus = () => ({ running: false, pid: null as number | null }), backups?: ReturnType<typeof import("../backup").createBackups>, config?: import("./config").DaemonConfig, maintenance?: { info: BuildInfo; update: () => Promise<unknown> }) {
  const secrets = createSecrets(db.home);
  const instanceId = crypto.randomUUID();
  return async (request: Request) => {
    const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token || !db.accepts(token)) throw new BedrockError("UNAUTHORIZED", "A valid deploy token is required.", "Run bedrock login for the remote server, pass a valid --token, or restart the local daemon to restore its admin token.");
    const scope = db.tokenScope(token);
    authorizeScope(scope, request);
    const records = () => db.list().filter(record => !scope || matchesPebble(scope, record.name));
    const url = new URL(request.url);
    const secretMatch = /^\/api\/pebbles\/([^/]+)\/secrets$/.exec(url.pathname);
    const serviceMatch = /^\/api\/pebbles\/([^/]+)\/service-tokens(?:\/([^/]+))?$/.exec(url.pathname);
    if (secretMatch && ["GET", "PUT"].includes(request.method)) {
      const name = secretMatch[1]!; validateName(name);
      const value = request.method === "GET" ? await secrets.list(name) : await releases.exclusive(name, async () => {
        const body = await request.json().catch(() => { throw new BedrockError("INVALID_ARGS", "Invalid JSON body.", "Send a JSON secrets update."); });
        if (body?.restart === true) releases.record(name);
        const result = await secrets.update(name, body);
        supervisor.logs(name).protect(Object.values(await secrets.env(name)));
        if (body.restart) await releases.restart(name);
        return result;
      });
      return Response.json({ ok: true, value }, { headers: { "cache-control": "no-store" } });
    }
    if (serviceMatch && (request.method === "POST" && !serviceMatch[2] || request.method === "DELETE" && serviceMatch[2])) {
      const name = serviceMatch[1]!; validateName(name); releases.record(name);
      const user = db.tokenOwner(token);
      if (!user) throw new BedrockError("TOKEN_OWNER_REQUIRED", "This deploy token has no owning creator user.", "Run bedrock login as a creator, then create a deploy token from that login token.");
      const body = request.method === "POST" ? await request.json().catch(() => { throw new BedrockError("INVALID_ARGS", "Invalid JSON body.", "Send { name, permissions: string[] }."); }) : undefined;
      const value = await releases.exclusive(name, () => supervisor.serviceTokens(name, user, body, serviceMatch[2]));
      return Response.json({ ok: true, value }, { headers: { "cache-control": "no-store" } });
    }
    let value: unknown;
    const backup = /^\/api\/backup\/(run|ls|restore)$/.exec(url.pathname);
    const jobs = /^\/api\/jobs\/([^/]+)$/.exec(url.pathname);
    if (backup && backups) {
      const name = url.searchParams.get("name") ?? undefined;
      if (name) validateName(name);
      if (backup[1] === "run" && request.method === "POST") value = await backups.run(name);
      else if (backup[1] === "ls" && request.method === "GET" && name) value = await backups.list(name);
      else if (backup[1] === "restore" && request.method === "POST" && name) {
        if (url.searchParams.get("confirm") !== "true") throw new BedrockError("CONFIRM_REQUIRED", "Restore replaces the pebble data directory.", "Pass --yes to backup restore.");
        value = await backups.restore(name, url.searchParams.get("at") ?? undefined);
      } else throw new BedrockError("INVALID_ARGS", "Invalid backup operation.", "Use backup run [pebble], ls <pebble>, or restore <pebble> --yes.");
    } else if (jobs && ["GET", "POST"].includes(request.method)) {
      const name = jobs[1]!; validateName(name); releases.record(name);
      const job = url.searchParams.get("job") ?? undefined;
      if (request.method === "POST" && !job) throw new BedrockError("INVALID_ARGS", "A job name is required.", "Use jobs run <pebble> <job>.");
      value = await supervisor.jobs(name, request.method === "POST" ? job : undefined);
    } else if (request.method === "GET" && url.pathname === "/api/pebbles") {
      value = records().map(record => ({ ...record, port: supervisor.child(record.name)?.port ?? null, pid: supervisor.child(record.name)?.process.pid ?? null }));
    } else if (request.method === "GET" && url.pathname === "/api/status") {
      value = { ...maintenance?.info, instanceId, features: daemonFeatures, domain: config?.domain, user: db.tokenEmail(token) ?? "server creator token", creatorSignedIn: !scope && !!config?.creators.some(email => db.db.query("SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=? AND s.expires_at>? LIMIT 1").get(email, Date.now())), ...(!scope ? { tunnel: tunnelStatus() } : {}), pebbles: await Promise.all(records().map(async record => {
        const child = supervisor.child(record.name);
        let healthy = false;
        if (child) try { healthy = (await fetch(`http://127.0.0.1:${child.port}/_bedrock/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch {}
        return { name: record.name, status: record.status, healthy };
      })) };
    } else if (request.method === "POST" && url.pathname === "/api/self-update" && maintenance) {
      value = await maintenance.update();
    } else if (request.method === "GET" && url.pathname === "/api/tokens") value = db.tokens();
    else if (request.method === "DELETE" && /^\/api\/tokens\/(current|[a-f0-9]{64})$/.test(url.pathname)) {
      const id = url.pathname.split("/").at(-1)!;
      value = { revoked: db.revokeToken(id === "current" ? tokenHash(token) : id) };
    } else if (request.method === "POST" && url.pathname === "/api/tokens") {
      const body = await request.text();
      let input: { name?: string; scope?: unknown } = {};
      try { input = body ? JSON.parse(body) : {}; } catch { throw new BedrockError("INVALID_ARGS", "Invalid JSON body.", "Send { name?, scope?: { pebbles, actions } }."); }
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new BedrockError("INVALID_ARGS", "Invalid token options.", "Send { name?, scope?: { pebbles, actions } }.");
      value = { token: db.createToken(db.tokenEmail(token) ?? undefined, { ...(input.name !== undefined ? { name: input.name } : {}), scope: input.scope, ...(db.tokenOwner(token) ? { userId: db.tokenOwner(token)!.id } : {}) }) };
    }
    else if (request.method === "POST" && url.pathname === "/api/deploy") {
      const name = url.searchParams.get("name") ?? "";
      validateName(name);
      value = await releases.deploy(name, request);
    } else {
      const match = /^\/api\/pebbles\/([^/]+)(?:\/(logs|start|stop|restart|rollback))?$/.exec(url.pathname);
      if (!match) throw new BedrockError("NOT_FOUND", "Unknown daemon endpoint.", "Use /api/pebbles, /api/deploy, or /api/tokens.");
      const name = match[1]!;
      validateName(name);
      const action = match[2];
      if (request.method === "DELETE" && !action) {
        if (url.searchParams.get("confirm") !== "true") throw new BedrockError("CONFIRM_REQUIRED", "Deleting a pebble removes all code, data, and logs.", "Pass confirm=true, or use bedrock rm <name> --yes.");
        value = db.get(name) ? await releases.delete(name) : { name, deleted: false };
      } else if (request.method === "GET" && action === "logs") {
        releases.record(name);
        supervisor.logs(name).protect(Object.values(await secrets.env(name)));
        return supervisor.logs(name).response(url.searchParams.get("follow") === "true", request.signal);
      } else if (request.method === "POST" && action === "rollback") value = await releases.rollback(name, url.searchParams.get("force") === "true");
      else if (request.method === "POST" && action && ["start", "stop", "restart"].includes(action)) value = await releases.control(name, action);
      else throw new BedrockError("NOT_FOUND", "Unknown daemon endpoint or method.", "Use GET logs, POST start/stop/restart/rollback, or DELETE with confirm=true.");
    }
    return Response.json({ ok: true, value });
  };
}
