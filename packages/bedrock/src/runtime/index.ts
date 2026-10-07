import { createJobs } from "../jobs";
import { verifyIdentity } from "../auth/identity";
import { createFileHandler } from "../storage/http";
import { resolve, join } from "node:path";
import type { PebbleConfig } from "../config";
import { definePebble } from "../config";
import { openDatabase, defaultDataDir, applyMigrations } from "../db";
import { BedrockError, asBedrockError } from "../error";
import { createSync, type SocketData } from "../sync";
import { requirePermission } from "./tokens";
import { checkAccess } from "./access";
import { createExecutor } from "./functions";
import { loadWeb } from "./web";
import { errorResponse, functionHandler } from "./http";
import { loadPebble } from "./load";

export type StartPebbleOptions = ({ dir: string; pebble?: never } | { pebble: PebbleConfig; dir?: string }) & {
  dataDir?: string;
  port?: number;
  dev?: boolean;
};

export async function startPebble(options: StartPebbleOptions) {
  const dir = resolve(options.dir ?? process.cwd());
  const pebble = options.pebble ? definePebble(options.pebble) : await loadPebble(dir);
  const database = openDatabase(options.dataDir ?? defaultDataDir(pebble.name), pebble.schema, pebble.tokens === true);
  try {
    await applyMigrations(database.sqlite, join(dir, "migrations"));
    database.refreshTracking();
    const execute = createExecutor(pebble, database);
    const jobs = createJobs(pebble.jobs ?? {}, (_name, _handler, definition) => definition.transaction === false
      ? execute.detached(new Request("http://localhost/_bedrock/jobs"), definition.run, { user: null })
      : execute.job(definition.run));
    const files = createFileHandler(pebble, execute, join(database.dataDir, "uploads"));
    await files.cleanup();
    const release = process.env.BEDROCK_RELEASE_ID || `local-${crypto.randomUUID().slice(0, 8)}`;
    const sync = pebble.sync === true ? createSync(execute, release) : undefined;
    const web = await loadWeb(dir, pebble.web);
    const routes: Record<string, any> = {};
    for (const [key, handler] of Object.entries(pebble.routes ?? {})) {
      const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/.*)$/.exec(key);
      if (!match || match[2] === "/_bedrock" || match[2]!.startsWith("/_bedrock/")) throw new BedrockError("INVALID_ROUTE", `Invalid or reserved route: ${key}`, "Use METHOD /path outside /_bedrock/.");
      const path = match[2]!;
      routes[path] ??= {};
      routes[path][match[1]!] = async (request: Request, server: Bun.Server<undefined>) => {
        try {
          return typeof handler === "function"
            ? (await execute.route(request, ctx => handler(request, server, ctx), `route:${key}`)).value as Response
            : await execute.detached(request, ctx => handler.run(request, server, ctx), undefined, `route:${key}`);
        } catch (error) { return errorResponse(error); }
      };
    }
    if (web.html && !Object.hasOwn(routes, "/*")) routes["/*"] = web.html;
    routes["/_bedrock/files/*"] = files.handle;
    routes["/_bedrock/jobs"] = async (request: Request) => {
      try {
        const secret = process.env.BEDROCK_IDENTITY_SECRET;
        const user = secret ? verifyIdentity(request, secret) : null;
        if (!secret || user?.id !== "bedrock-daemon") throw new BedrockError("FORBIDDEN", "Jobs require daemon authorization.", "Use bedrock jobs ls/run through the daemon.");
        const name = new URL(request.url).searchParams.get("name");
        return Response.json({ ok: true, value: request.method === "POST" && name ? await jobs.run(name) : jobs.list() });
      } catch (error) { return errorResponse(error); }
    };
    routes["/_bedrock/health"] = { GET: () => Response.json({ ok: true, name: pebble.name, access: pebble.access ?? "public" }) };
    routes["/_bedrock/q/:name"] = { POST: functionHandler(execute, "query") };
    routes["/_bedrock/m/:name"] = { POST: functionHandler(execute, "mutation") };
    routes["/_bedrock/*"] = () => Response.json({ ok: false, error: new BedrockError("NOT_FOUND", "Unknown Bedrock endpoint.", "Use POST /_bedrock/q/<name> or /_bedrock/m/<name>.").toJSON() }, { status: 404 });
    if (sync) routes["/_bedrock/ws"] = async (request: Request, server: Bun.Server<SocketData>) => {
      try {
        const { user, token } = await execute.identify(request);
        requirePermission(token, "*");
        checkAccess(pebble, user);
        if (server.upgrade(request, { data: { user, token, request } })) return;
        return Response.json({ ok: false, error: new BedrockError("WEBSOCKET_REQUIRED", "WebSocket upgrade required.", "Open this endpoint with a WebSocket client.").toJSON() }, { status: 426 });
      } catch (error) { return errorResponse(error); }
    };
    const server = Bun.serve<SocketData>({
      // Public HTML must not inherit Bun's development Host restrictions from the environment.
      development: options.dev === true ? { hmr: true } : false,
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
    const tokenCleanup = pebble.tokens ? setInterval(() => { void execute.flushTokens().catch(error => console.error("Token usage flush failed", error)); }, 60_000) : undefined;
    tokenCleanup?.unref();
    jobs.start();
    let stopped = false;
    return {
      server, pebble, db: database.db, execute, jobs,
      async stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(storageCleanup);
        clearInterval(tokenCleanup);
        sync?.close();
        await server.stop(true);
        await jobs.stop();
        await execute.close();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw asBedrockError(error, "START_FAILED", "Check the pebble configuration, web entry, migrations, and port.");
  }
}

export { fileResponse } from '../storage/http';
