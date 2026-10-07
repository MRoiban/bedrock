import { getTableName } from "drizzle-orm";
import { join } from "node:path";
import { createStorage, type StorageEffects } from "../storage";
import type { DetachedContext, FunctionContext, PebbleConfig, User } from "../config";
import type { openDatabase } from "../db";
import { BedrockError, asBedrockError } from "../error";
import { checkAccess } from "./access";
import { createTokens, requirePermission, storagePermission, type RequestIdentity } from "./tokens";

export function createExecutor(pebble: PebbleConfig, database: ReturnType<typeof openDatabase>, services: Record<string, any> = {}) {
  const tokens = createTokens(pebble, database.sqlite, database.db);
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  const detachedRuns = new Set<Promise<unknown>>();
  const listeners = new Set<(writes: Set<string>) => void>();
  function execute(kind: "query" | "mutation", name: string, args: unknown, request: Request, identity?: { user: User | null; token?: RequestIdentity["token"]; validated?: boolean }, handler?: (ctx: FunctionContext) => unknown, permission?: string) {
    if (closed) return Promise.reject(new BedrockError("PEBBLE_STOPPED", "The pebble has stopped.", "Start a new pebble runtime before executing functions."));
    const run = tail.then(async () => {
      const definitions = kind === "query" ? pebble.queries : pebble.mutations;
      if (!handler && (!definitions || !Object.hasOwn(definitions, name))) {
        throw new BedrockError("FUNCTION_NOT_FOUND", `Unknown ${kind}: ${name}`, "Check the function name in pebble.ts.");
      }
      const definition = handler ? { run: handler, schema: undefined } : definitions![name]!;
      // Resolution is read-only and runs after the preceding slot finishes,
      // before BEGIN, so it cannot join or observe another slot's transaction.
      const resolved = identity ? { ...identity, token: identity.token ?? null } : tokens.identify(request);
      const { user, token } = resolved;
      if (token) checkAccess(pebble, user);
      if (!handler || name === "storage" || permission) requirePermission(token, permission ?? (name === "storage" ? storagePermission(request) : `${kind}:${name}`));
      if (!handler || name === "storage") checkAccess(pebble, user);
      if (definition.schema && !identity?.validated) {
        const result = await definition.schema["~standard"].validate(args);
        if (result.issues) throw new BedrockError("INVALID_ARGS", result.issues.map(issue => issue.message).join("; "), "Send JSON matching the function's Standard Schema.");
        args = result.value;
      }
      const invalidated = new Set<string>();
      const ctx: FunctionContext = { services, db: database.db, user, token, tokens: tokens.api(resolved, kind === "mutation"), pebble, storage: null!, request, invalidate(tables) {
        if (kind === "query") throw new BedrockError("READ_ONLY", "Queries cannot invalidate tables.", "Call invalidate inside a mutation, route, or job.");
        for (const table of tables) {
          const name = typeof table === "string" ? table : getTableName(table);
          if (!database.tableNames.has(name)) throw new BedrockError("UNKNOWN_TABLE", `Unknown table: ${name}`, "Pass a registered Drizzle table object or its SQL table name; register tables in schema or a plugin.");
          invalidated.add(name);
        }
      } };
      const effects: StorageEffects = { rollback: [], commit: [] };
      ctx.storage = createStorage(join(database.dataDir, "files"), pebble.storage ?? [], ctx, kind === "mutation", effects);
      const { sqlite, tracker } = database;
      let committed = false;
      try {
        if (kind === "query") sqlite.exec("PRAGMA query_only=ON");
        sqlite.exec(kind === "query" ? "BEGIN DEFERRED" : "BEGIN IMMEDIATE");
        let flushed = () => {};
        const middleware = handler ? [] : (pebble.plugins ?? []).map(plugin => kind === "query" ? plugin.onQuery : plugin.onMutation).filter(fn => fn !== undefined);
        const invoke = (index: number): Promise<any> => index < middleware.length
          ? Promise.resolve(middleware[index]!(ctx, name, args, () => invoke(index + 1)))
          : Promise.resolve(definition.run(ctx, args));
        const result = await tracker.capture(() => {
          if (kind === "mutation") flushed = tokens.flush();
          return invoke(0);
        });
        for (const table of invalidated) result.writes.add(table);
        // Detect unserializable results before committing any writes.
        JSON.stringify({ ok: true, value: result.value ?? null });
        sqlite.exec("COMMIT");
        committed = true;
        flushed();
        for (const cleanup of effects.commit) await cleanup().catch(error => console.error("Storage cleanup failed", error));
        return { ...result, args };
      } catch (error) {
        if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
        if (!committed) for (const cleanup of effects.rollback) await cleanup().catch(error => console.error("Storage rollback cleanup failed", error));
        throw asBedrockError(error, "FUNCTION_FAILED", kind === "query"
          ? "Queries must only read data. Check the query handler and database schema."
          : "Check the mutation handler, arguments, and database schema.");
      } finally {
        if (kind === "query") sqlite.exec("PRAGMA query_only=OFF");
      }
    });
    // Rejections must not poison the queue for later requests.
    tail = run.catch(() => {});
    // Observers run outside the queue slot, so they can safely enqueue queries.
    if (kind === "mutation") void run.then(result => {
      for (const listener of listeners) listener(new Set(result.writes));
    }, () => {});
    return run;
  }
  async function detached<R>(request: Request, handler: (ctx: DetachedContext) => R, identity?: { user: User | null; token?: RequestIdentity["token"] }, permission?: string): Promise<Awaited<R>> {
    const run = Promise.resolve().then(async () => {
      if (closed) throw new BedrockError("PEBBLE_STOPPED", "The pebble has stopped.", "Start a new pebble runtime before executing functions.");
      const resolved = identity ? { ...identity, token: identity.token ?? null } : await identify(request);
      const { user, token } = resolved;
      if (token) checkAccess(pebble, user);
      if (permission) requirePermission(token, permission);
      const slot = async <T>(kind: "query" | "mutation", fn: (ctx: FunctionContext) => T): Promise<Awaited<T>> => {
        const result = await execute(kind, "detached", null, request, token ? undefined : { user, token }, fn);
        return result.value;
      };
      const unavailable = () => { throw new BedrockError("DETACHED_CONTEXT", "Detached handlers cannot access db, storage, or invalidate directly.", "Use ctx.read(ctx => ...) or ctx.write(ctx => ...) for database and storage work."); };
      const ctx: DetachedContext = {
        services, user, token, pebble, request,
        read: fn => slot("query", fn),
        write: fn => slot("mutation", fn),
      };
      for (const key of ["db", "storage", "invalidate"]) Object.defineProperty(ctx, key, { get: unavailable });
      try { return await handler(ctx); }
      catch (error) { throw asBedrockError(error, "FUNCTION_FAILED", "Check the detached handler and its read/write callbacks."); }
    });
    detachedRuns.add(run);
    void run.then(() => detachedRuns.delete(run), () => detachedRuns.delete(run));
    return await run;
  }
  // Authentication reads are safe here because the queue has no open slot or
  // transaction; detached handlers and WS upgrades must use this path too.
  function identify(request: Request) {
    const run = tail.then(() => tokens.identify(request));
    tail = run.catch(() => {});
    return run;
  }
  return Object.assign(execute, {
    identify,
    flushTokens() { return execute("mutation", "tokens", null, new Request("http://localhost"), { user: null }, () => {}); },
    detached,
    storage(kind: "query" | "mutation", request: Request, handler: (ctx: FunctionContext) => unknown, identity?: RequestIdentity) {
      return execute(kind, "storage", null, request, identity, handler);
    },
    job(handler: (ctx: FunctionContext) => unknown) {
      return execute("mutation", "job", null, new Request("http://localhost/_bedrock/jobs"), { user: null }, handler);
    },
    route(request: Request, handler: (ctx: FunctionContext) => unknown, permission?: string) {
      return execute("mutation", "route", null, request, undefined, handler, permission);
    },
    onCommit(listener: (writes: Set<string>) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async close() { closed = true; await Promise.allSettled(detachedRuns); await tail; },
  });
}
