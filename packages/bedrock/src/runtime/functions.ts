import type { FunctionContext, PebbleConfig } from "../config";
import type { openDatabase } from "../db";
import { BedrockError, asBedrockError } from "../error";
import { resolveUser } from "./identity";

export function createExecutor(pebble: PebbleConfig, database: ReturnType<typeof openDatabase>) {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  function execute(kind: "query" | "mutation", name: string, args: unknown, request: Request) {
    if (closed) return Promise.reject(new BedrockError("PEBBLE_STOPPED", "The pebble has stopped.", "Start a new pebble runtime before executing functions."));
    const run = tail.then(async () => {
      const definitions = kind === "query" ? pebble.queries : pebble.mutations;
      if (!definitions || !Object.hasOwn(definitions, name)) {
        throw new BedrockError("FUNCTION_NOT_FOUND", `Unknown ${kind}: ${name}`, "Check the function name in pebble.ts.");
      }
      const definition = definitions[name]!;
      const user = resolveUser(request);
      if (pebble.access && pebble.access !== "public") {
        if (!user) throw new BedrockError("UNAUTHENTICATED", "Sign-in is required.", "In local development enable BEDROCK_INSECURE_DEV_USER=1 and send x-bedrock-user.");
        if (pebble.access === "creators") throw new BedrockError("ACCESS_UNAVAILABLE", "Creator access requires the daemon.", "Use public or users access during Phase 1 development.");
        if (typeof pebble.access === "object" && !pebble.access.allow.some(entry => user.email &&
          (entry.startsWith("@") ? user.email.toLowerCase().endsWith(entry.toLowerCase()) : user.email.toLowerCase() === entry.toLowerCase()))) {
          throw new BedrockError("FORBIDDEN", "This user is not allowed to access the pebble.", "Use an email permitted by the pebble's access.allow list.");
        }
      }
      if (definition.schema) {
        const result = await definition.schema["~standard"].validate(args);
        if (result.issues) throw new BedrockError("INVALID_ARGS", result.issues.map(issue => issue.message).join("; "), "Send JSON matching the function's Standard Schema.");
        args = result.value;
      }
      const ctx: FunctionContext = { db: database.db, user, pebble, storage: {}, request };
      const { sqlite, tracker } = database;
      try {
        if (kind === "query") sqlite.exec("PRAGMA query_only=ON");
        sqlite.exec(kind === "query" ? "BEGIN DEFERRED" : "BEGIN IMMEDIATE");
        const result = await tracker.capture(() => definition.run(ctx, args));
        // Detect unserializable results before committing any writes.
        JSON.stringify({ ok: true, value: result.value ?? null });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
        throw asBedrockError(error, "FUNCTION_FAILED", kind === "query"
          ? "Queries must only read data. Check the query handler and database schema."
          : "Check the mutation handler, arguments, and database schema.");
      } finally {
        if (kind === "query") sqlite.exec("PRAGMA query_only=OFF");
      }
    });
    // Rejections must not poison the queue for later requests.
    tail = run.catch(() => {});
    return run;
  }
  return Object.assign(execute, {
    async close() { closed = true; await tail; },
  });
}
