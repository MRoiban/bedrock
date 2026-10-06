import type { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BedrockError, asBedrockError } from "../error";
import { sqlTokens } from "./tracker";

export interface Migration { name: string; sql: string; hash: string }

export async function migrationPlan(sqlite: Database, dir: string): Promise<Migration[]> {
  const exists = sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name='_bedrock_migrations'").get();
  const applied = new Map(exists
    ? (sqlite.query("SELECT name, hash FROM _bedrock_migrations").all() as { name: string; hash: string }[]).map(row => [row.name, row.hash])
    : []);
  const pending: Migration[] = [];
  if (!existsSync(dir)) return pending;
  for (const name of readdirSync(dir).filter(name => name.endsWith(".sql")).sort()) {
    const sql = await Bun.file(join(dir, name)).text();
    const hash = new Bun.CryptoHasher("sha256").update(sql).digest("hex");
    if (applied.has(name)) {
      if (applied.get(name) !== hash) {
        throw new BedrockError("MIGRATION_CHANGED", `Applied migration ${name} has changed.`, "Restore the applied file and put new changes in a new migration.");
      }
    } else pending.push({ name, sql, hash });
  }
  return pending;
}

function validateMigrationSql(sql: string, name: string) {
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

export async function applyMigrations(sqlite: Database, dir: string): Promise<string[]> {
  try {
    const plan = await migrationPlan(sqlite, dir);
    sqlite.exec("CREATE TABLE IF NOT EXISTS _bedrock_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    const applied: string[] = [];
    for (const migration of plan) {
      validateMigrationSql(migration.sql, migration.name);
      try {
        sqlite.transaction(() => {
          const row = sqlite.query("SELECT hash FROM _bedrock_migrations WHERE name=?").get(migration.name) as { hash: string } | null;
          if (row) {
            if (row.hash !== migration.hash) throw new Error("Migration checksum changed");
            return;
          }
          sqlite.exec(migration.sql);
          sqlite.query("INSERT INTO _bedrock_migrations (name, hash, applied_at) VALUES (?, ?, ?)").run(migration.name, migration.hash, Date.now());
          applied.push(migration.name);
        }).immediate();
      } catch (error) {
        throw asBedrockError(error, "MIGRATION_FAILED", `Fix ${migration.name} and retry. This migration was rolled back; earlier migrations remain applied.`);
      }
    }
    return applied;
  } catch (error) {
    throw asBedrockError(error, "MIGRATION_FAILED", "Check the migrations directory and SQL files, then retry.");
  }
}
