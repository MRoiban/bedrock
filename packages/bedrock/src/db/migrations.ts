import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BedrockError, asBedrockError } from "../error";
import { sqlTokens } from "./tracker";

export interface Migration { name: string; sql: string; hash: string }

/** Every migration file in runner order: `*.sql` sorted by name. `meta/` and other files are ignored. */
export async function readMigrations(dir: string): Promise<Migration[]> {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter(name => name.endsWith(".sql") && !name.startsWith(".")).sort();
  return Promise.all(names.map(async name => {
    const sql = await Bun.file(join(dir, name)).text();
    return { name, sql, hash: new Bun.CryptoHasher("sha256").update(sql).digest("hex") };
  }));
}

export async function migrationPlan(sqlite: Database, dir: string): Promise<Migration[]> {
  const exists = sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name='_bedrock_migrations'").get();
  const applied = new Map(exists
    ? (sqlite.query("SELECT name, hash FROM _bedrock_migrations").all() as { name: string; hash: string }[]).map(row => [row.name, row.hash])
    : []);
  const pending: Migration[] = [];
  for (const migration of await readMigrations(dir)) {
    if (!applied.has(migration.name)) pending.push(migration);
    else if (applied.get(migration.name) !== migration.hash) {
      throw new BedrockError("MIGRATION_CHANGED", `Applied migration ${migration.name} has changed.`, "Restore the applied file and put new changes in a new migration.");
    }
  }
  return pending;
}

export function validateMigrationSql(sql: string, name: string) {
  // The runner owns transaction boundaries, including when SQL comes from a generator.
  const tokens = sqlTokens(sql).map(t => t.toLowerCase());
  let trigger = false;
  let caseDepth = 0;
  let first = true;
  let transactionControl = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (first && token === "create") {
      trigger = tokens[i + 1] === "trigger" ||
        (["temp", "temporary"].includes(tokens[i + 1] ?? "") && tokens[i + 2] === "trigger");
    }
    if (first && !trigger && ["begin", "commit", "rollback", "savepoint", "release", "end"].includes(token)) transactionControl = true;
    if (trigger && token === "case") caseDepth++;
    if (trigger && token === "end") {
      if (caseDepth > 0) caseDepth--;
      else if (tokens[i + 1] === ";") trigger = false;
    }
    first = token === ";";
  }
  if (transactionControl) {
    throw new BedrockError("INVALID_MIGRATION", `Migration ${name} contains transaction control.`, "Remove transaction statements; Bedrock applies each migration atomically.");
  }
}

function disablesForeignKeys(sql: string) {
  const tokens = sqlTokens(sql).map(t => t.toLowerCase());
  return tokens.some((token, i) => token === "pragma" && tokens[i + 1] === "foreign_keys" && ["off", "false", "no"].includes(tokens[i + 2] ?? ""));
}

/**
 * Runs one migration atomically. `PRAGMA foreign_keys` is a no-op inside a transaction, so a
 * migration that asks for it off (a table rebuild) runs with foreign keys off around the
 * transaction and must pass `PRAGMA foreign_key_check` before it commits.
 */
export function runMigration(sqlite: Database, migration: Migration, record: () => boolean = () => true) {
  validateMigrationSql(migration.sql, migration.name);
  const pauseForeignKeys = disablesForeignKeys(migration.sql) &&
    (sqlite.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys === 1;
  if (pauseForeignKeys) sqlite.exec("PRAGMA foreign_keys=OFF");
  try {
    return sqlite.transaction(() => {
      if (!record()) return false;
      sqlite.exec(migration.sql);
      if (pauseForeignKeys) {
        const violations = sqlite.query("PRAGMA foreign_key_check").all() as { table: string }[];
        if (violations.length) {
          throw new BedrockError("MIGRATION_FOREIGN_KEY", `Migration ${migration.name} leaves ${violations.length} foreign key violation(s), first in ${violations[0]!.table}.`, "Fix the data or the SQL so every foreign key still matches, then retry.");
        }
      }
      return true;
    }).immediate();
  } finally {
    if (pauseForeignKeys) sqlite.exec("PRAGMA foreign_keys=ON");
  }
}

export async function applyMigrations(sqlite: Database, dir: string): Promise<string[]> {
  try {
    const plan = await migrationPlan(sqlite, dir);
    sqlite.exec("CREATE TABLE IF NOT EXISTS _bedrock_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    const applied: string[] = [];
    for (const migration of plan) {
      try {
        const ran = runMigration(sqlite, migration, () => {
          const row = sqlite.query("SELECT hash FROM _bedrock_migrations WHERE name=?").get(migration.name) as { hash: string } | null;
          if (row) {
            if (row.hash !== migration.hash) throw new Error("Migration checksum changed");
            return false;
          }
          sqlite.query("INSERT INTO _bedrock_migrations (name, hash, applied_at) VALUES (?, ?, ?)").run(migration.name, migration.hash, Date.now());
          return true;
        });
        if (ran) applied.push(migration.name);
      } catch (error) {
        throw asBedrockError(error, "MIGRATION_FAILED", `Fix ${migration.name} and retry. This migration was rolled back; earlier migrations remain applied.`);
      }
    }
    return applied;
  } catch (error) {
    throw asBedrockError(error, "MIGRATION_FAILED", "Check the migrations directory and SQL files, then retry.");
  }
}

/**
 * Replays every migration into a fresh in-memory database exactly as the runner would. The
 * result is the schema the migrations produce, which is what `db generate` diffs against.
 */
export async function replayMigrations(dir: string, extra: Migration[] = []): Promise<{ scratch: Database; migrations: Migration[] }> {
  const scratch = new Database(":memory:", { strict: true });
  scratch.exec("PRAGMA foreign_keys=ON");
  const migrations = [...await readMigrations(dir), ...extra];
  for (const migration of migrations) {
    try { runMigration(scratch, migration); }
    catch (error) {
      scratch.close();
      const message = error instanceof Error ? error.message : String(error);
      throw new BedrockError("MIGRATION_REPLAY_FAILED", `Replaying migrations failed in ${migration.name}: ${message}`,
        `Fix migrations/${migration.name}. If two merged branches made the same change, remove the duplicate statement from the migration that has not been deployed, then run bedrock db check.`);
    }
  }
  return { scratch, migrations };
}
