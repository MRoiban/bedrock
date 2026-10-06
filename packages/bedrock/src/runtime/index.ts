import { createFileHandler } from "../storage/http";
import { resolve, join } from "node:path";
import type { PebbleConfig } from "../config";
import { definePebble } from "../config";
import { openDatabase, defaultDataDir, applyMigrations } from "../db";
import { BedrockError, asBedrockError } from "../error";
import { createSync, type SocketData } from "../sync";
import { resolveUser } from "./identity";
import { checkAccess } from "./access";
import { createExecutor } from "./functions";
import { loadWeb } from "./web";
import { errorResponse, functionHandler } from "./http";
import { loadPebble } from "./load";

export type StartPebbleOptions = ({ dir: string; pebble?: never } | { pebble: PebbleConfig; dir?: string }) & {
  dataDir?: string;
  port?: number;
};

export async function startPebble(options: StartPebbleOptions) {
  const dir = resolve(options.dir ?? process.cwd());
  const pebble = options.pebble ? definePebble(options.pebble) : await loadPebble(dir);
  const database = openDatabase(options.dataDir ?? defaultDataDir(pebble.name), pebble.schema);
  try {
    await applyMigrations(database.sqlite, join(dir, "migrations"));
    database.refreshTracking();
    const execute = createExecutor(pebble, database);
    const files = createFileHandler(pebble, execute, join(database.dataDir, "uploads"));
    await files.cleanup();
    const sync = pebble.sync === true ? createSync(execute) : undefined;
    const web = await loadWeb(dir, pebble.web);
    const routes: Record<string, any> = {};
    for (const [key, handler] of Object.entries(pebble.routes ?? {})) {
      const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/.*)$/.exec(key);
      if (!match || match[2] === "/_bedrock" || match[2]!.startsWith("/_bedrock/")) throw new BedrockError("INVALID_ROUTE", `Invalid or reserved route: ${key}`, "Use METHOD /path outside /_bedrock/.");
      const path = match[2]!;
      routes[path] ??= {};
      routes[path][match[1]!] = async (request: Request, server: Bun.Server<undefined>) => {
        try { return await handler(request, server); } catch (error) { return errorResponse(error); }
      };
    }
    if (web.html && !Object.hasOwn(routes, "/*")) routes["/*"] = web.html;
    routes["/_bedrock/files/*"] = files.handle;
    routes["/_bedrock/health"] = { GET: () => Response.json({ ok: true, name: pebble.name }) };
    routes["/_bedrock/q/:name"] = { POST: functionHandler(execute, "query") };
    routes["/_bedrock/m/:name"] = { POST: functionHandler(execute, "mutation") };
    routes["/_bedrock/*"] = () => Response.json({ ok: false, error: new BedrockError("NOT_FOUND", "Unknown Bedrock endpoint.", "Use POST /_bedrock/q/<name> or /_bedrock/m/<name>.").toJSON() }, { status: 404 });
    if (sync) routes["/_bedrock/ws"] = (request: Request, server: Bun.Server<SocketData>) => {
      try {
        // Browsers cannot set WS headers; this bridge is strictly local dev only.
        let identityRequest = request;
        const devUser = new URL(request.url).searchParams.get("devUser");
        if (devUser && process.env.BEDROCK_INSECURE_DEV_USER === "1") {
          const headers = new Headers(request.headers);
          headers.set("x-bedrock-user", devUser);
          identityRequest = new Request(request, { headers });
        }
        const user = resolveUser(identityRequest);
        checkAccess(pebble, user);
        if (server.upgrade(request, { data: { user, request } })) return;
        return Response.json({ ok: false, error: new BedrockError("WEBSOCKET_REQUIRED", "WebSocket upgrade required.", "Open this endpoint with a WebSocket client.").toJSON() }, { status: 426 });
      } catch (error) { return errorResponse(error); }
    };
    const server = Bun.serve<SocketData>({
      ...(sync ? { websocket: sync.websocket } : {}),
      maxRequestBodySize: 90 * 1024 ** 2,
      hostname: "127.0.0.1", port: options.port ?? 3000, routes,
      async fetch(request) {
        if (web.staticResponse && ["GET", "HEAD"].includes(request.method)) return web.staticResponse(request);
        return new Response("Not found", { status: 404 });
      },
      error: errorResponse,
    });
    const storageCleanup = setInterval(() => { void files.cleanup().catch(error => console.error("Upload cleanup failed", error)); }, 60 * 60 * 1000);
    storageCleanup.unref();
    let stopped = false;
    return {
      server, pebble, db: database.db, execute,
      async stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(storageCleanup);
        sync?.close();
        await server.stop(true);
        await execute.close();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw asBedrockError(error, "START_FAILED", "Check the pebble configuration, web entry, migrations, and port.");
  }
}
