import { tokenHash } from "./db";
import { validateName } from "../config";
import { BedrockError, asBedrockError } from "../error";
import type { DaemonDatabase } from "./db";
import type { Releases } from "./releases";
import type { Supervisor } from "./supervisor";

export function daemonError(error: unknown) {
  const typed = asBedrockError(error, "DAEMON_FAILED", "Check the daemon and pebble logs, then retry.");
  const status = ["UNAUTHORIZED", "UNAUTHENTICATED"].includes(typed.code) ? 401
    : ["FORBIDDEN", "INVALID_IDENTITY"].includes(typed.code) ? 403
    : ["PEBBLE_NOT_FOUND", "NOT_FOUND"].includes(typed.code) ? 404
    : typed.code === "PEBBLE_BUSY" ? 409
    : ["INVALID_ARGS", "INVALID_RETURN_URL", "INVALID_OAUTH_STATE", "OAUTH_FAILED", "INVALID_PEBBLE_NAME", "CONFIRM_REQUIRED", "INVALID_ARCHIVE", "UNSAFE_ARCHIVE"].includes(typed.code) ? 400
    : typed.code === "UPSTREAM_UNAVAILABLE" ? 502 : 500;
  return Response.json({ ok: false, error: typed.toJSON() }, { status });
}
export function createApi(db: DaemonDatabase, releases: Releases, supervisor: Supervisor, tunnelStatus = () => ({ running: false, pid: null as number | null })) {
  return async (request: Request) => {
    const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token || !db.accepts(token)) throw new BedrockError("UNAUTHORIZED", "A valid deploy token is required.", "Run bedrock login for the remote server, pass a valid --token, or restart the local daemon to restore its admin token.");
    const url = new URL(request.url);
    let value: unknown;
    if (request.method === "GET" && url.pathname === "/api/pebbles") {
      value = db.list().map(record => ({ ...record, port: supervisor.child(record.name)?.port ?? null, pid: supervisor.child(record.name)?.process.pid ?? null }));
    } else if (request.method === "GET" && url.pathname === "/api/status") {
      value = { tunnel: tunnelStatus(), pebbles: await Promise.all(db.list().map(async record => {
        const child = supervisor.child(record.name);
        let healthy = false;
        if (child) try { healthy = (await fetch(`http://127.0.0.1:${child.port}/_bedrock/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch {}
        return { name: record.name, status: record.status, healthy };
      })) };
    } else if (request.method === "GET" && url.pathname === "/api/tokens") value = db.tokens();
    else if (request.method === "DELETE" && /^\/api\/tokens\/(current|[a-f0-9]{64})$/.test(url.pathname)) {
      const id = url.pathname.split("/").at(-1)!;
      value = { revoked: db.revokeToken(id === "current" ? tokenHash(token) : id) };
    } else if (request.method === "POST" && url.pathname === "/api/tokens") value = { token: db.createToken() };
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
        return supervisor.logs(name).response(url.searchParams.get("follow") === "true", request.signal);
      } else if (request.method === "POST" && action === "rollback") value = await releases.rollback(name);
      else if (request.method === "POST" && action && ["start", "stop", "restart"].includes(action)) value = await releases.control(name, action);
      else throw new BedrockError("NOT_FOUND", "Unknown daemon endpoint or method.", "Use GET logs, POST start/stop/restart/rollback, or DELETE with confirm=true.");
    }
    return Response.json({ ok: true, value });
  };
}
