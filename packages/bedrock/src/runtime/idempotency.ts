import type { Database } from "bun:sqlite";
import type { FunctionDefinition, TokenIdentity, User } from "../config";
import { BedrockError } from "../error";

export const idempotencyMigration = `CREATE TABLE IF NOT EXISTS _bedrock_idempotency (
 scope TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, args_hash TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (scope, name, key));`;

export function checkIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 || /[^\x21-\x7e]/.test(value))
    throw new BedrockError("INVALID_IDEMPOTENCY_KEY", "Invalid idempotency key.", "Send 1-255 visible ASCII characters, such as crypto.randomUUID().");
  return value;
}

export function idempotencyScope(identity: { user: User | null; token: TokenIdentity | null }) {
  return identity.token ? `token:${identity.token.id}` : identity.user ? `user:${identity.user.id}` : "anon";
}

export function chooseIdempotencyKey(transportKey: string | undefined, definition: Pick<FunctionDefinition, "run" | "idempotencyKey">, args: unknown) {
  if (transportKey !== undefined) return checkIdempotencyKey(transportKey);
  const key = definition.idempotencyKey?.(args);
  return key === undefined || key === null ? undefined : checkIdempotencyKey(key);
}

function argsHash(args: unknown) {
  const json = JSON.stringify(args ?? null, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value))
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
    return value;
  });
  return new Bun.CryptoHasher("sha256").update(json).digest("hex");
}

type Slot = { replay: { value: unknown } } | { record: (value: unknown) => void };

export function createIdempotency(sqlite: Database) {
  let lastPurge = 0;
  return {
    open(scope: string, name: string, key: string | undefined, args: unknown): Slot | null {
      const now = Date.now(), cutoff = now - 24 * 60 * 60_000;
      if (now - lastPurge >= 10 * 60_000) {
        sqlite.query("DELETE FROM _bedrock_idempotency WHERE created_at <= ?").run(cutoff);
        lastPurge = now;
      }
      if (key === undefined) return null;
      const hash = argsHash(args);
      const row = sqlite.query<{ args_hash: string; result_json: string }, [string, string, string, number]>(
        "SELECT args_hash, result_json FROM _bedrock_idempotency WHERE scope = ? AND name = ? AND key = ? AND created_at > ?",
      ).get(scope, name, key, cutoff);
      if (row) {
        if (row.args_hash !== hash)
          throw new BedrockError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used with different arguments.", "Use a new idempotency key for different arguments.", undefined, { status: 409 });
        return { replay: { value: JSON.parse(row.result_json) } };
      }
      return { record(value) {
        sqlite.query("INSERT OR REPLACE INTO _bedrock_idempotency (scope, name, key, args_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(scope, name, key, hash, JSON.stringify(value ?? null), Date.now());
      } };
    },
  };
}
