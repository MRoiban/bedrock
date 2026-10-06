import { join } from "node:path";
import { createStorage, type StorageEffects } from "../storage";
import type { FunctionContext, PebbleConfig, User } from "../config";
import type { openDatabase } from "../db";
import { BedrockError, asBedrockError } from "../error";
import { checkAccess } from "./access";
import { resolveUser } from "./identity";

export function createExecutor(pebble: PebbleConfig, database: ReturnType<typeof openDatabase>) {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  const listeners = new Set<(writes: Set<string>) => void>();
  function execute(kind: "query" | "mutation", name: string, args: unknown, request: Request, identity?: { user: User | null; validated?: boolean }, handler?: (ctx: FunctionContext) => unknown) {
    if (closed) return Promise.reject(new BedrockError("PEBBLE_STOPPED", "The pebble has stopped.", "Start a new pebble runtime before executing functions."));
    const run = tail.then(async () => {
      const definitions = kind === "query" ? pebble.queries : pebble.mutations;
      if (!handler && (!definitions || !Object.hasOwn(definitions, name))) {
        throw new BedrockError("FUNCTION_NOT_FOUND", `Unknown ${kind}: ${name}`, "Check the function name in pebble.ts.");
      }
      const definition = handler ? { run: handler, schema: undefined } : definitions![name]!;
      const user = identity ? identity.user : resolveUser(request);
      checkAccess(pebble, user);
      if (definition.schema && !identity?.validated) {
        const result = await definition.schema["~standard"].validate(args);
        if (result.issues) throw new BedrockError("INVALID_ARGS", result.issues.map(issue => issue.message).join("; "), "Send JSON matching the function's Standard Schema.");
        args = result.value;
      }
      const ctx: FunctionContext = { db: database.db, user, pebble, storage: null!, request };
      const effects: StorageEffects = { rollback: [], commit: [] };
      ctx.storage = createStorage(join(database.dataDir, "files"), pebble.storage ?? [], ctx, kind === "mutation", effects);
      const { sqlite, tracker } = database;
      let committed = false;
      try {
        if (kind === "query") sqlite.exec("PRAGMA query_only=ON");
        sqlite.exec(kind === "query" ? "BEGIN DEFERRED" : "BEGIN IMMEDIATE");
        const result = await tracker.capture(() => definition.run(ctx, args));
        // Detect unserializable results before committing any writes.
        JSON.stringify({ ok: true, value: result.value ?? null });
        sqlite.exec("COMMIT");
        committed = true;
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
  return Object.assign(execute, {
    storage(kind: "query" | "mutation", request: Request, handler: (ctx: FunctionContext) => unknown) {
      return execute(kind, "storage", null, request, undefined, handler);
    },
    onCommit(listener: (writes: Set<string>) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async close() { closed = true; await tail; },
  });
}
