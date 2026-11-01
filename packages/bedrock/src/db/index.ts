import { pebbleTokens, migrateTokens } from "../runtime/token-schema";
import { idempotencyMigration } from "../runtime/idempotency";
import { files, storageMigration } from "../storage/schema";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getTableName, is, Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { asBedrockError } from "../error";
import { writeEffects } from "./effects";
import { TableTracker } from "./tracker";
import { createCheckpoints } from "./checkpoints";

export { TableTracker } from "./tracker";
export type { TableUsage } from "./tracker";
export { migrationPlan, applyMigrations, readMigrations, replayMigrations, validateMigrationSql } from "./migrations";

export function defaultDataDir(name: string) {
  return join(process.env.BEDROCK_HOME ?? join(homedir(), ".bedrock"), "pebbles", name, "data");
}

export function openDatabase(dataDir: string, schema: Record<string, unknown> = {}, tokens = false) {
  let sqlite: Database | undefined;
  try {
    mkdirSync(resolve(dataDir), { recursive: true });
    sqlite = new Database(join(dataDir, "db.sqlite"), { create: true, strict: true });
    // NORMAL avoids fsync on most commits (WAL reuse can still sync): WAL still survives process crashes, and power loss can drop only the latest commits.
    sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA wal_autocheckpoint=0; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    sqlite.exec(storageMigration);
    sqlite.exec(idempotencyMigration);
    if (tokens) migrateTokens(sqlite);
    schema = { ...schema, _bedrockFiles: files, ...(tokens ? { _bedrockTokens: pebbleTokens } : {}) };
    const tableNames = new Set(Object.values(schema).filter(t => is(t, Table)).map(t => getTableName(t as Table)));
    const tracker = new TableTracker(tableNames);
    const refreshTracking = () => tracker.setEffects(writeEffects(sqlite!));
    refreshTracking();
    const db = drizzle(sqlite, { schema, logger: tracker });
    const checkpoints = createCheckpoints(sqlite, join(resolve(dataDir), "db.sqlite"));
    // Finalize cached statements so Windows can move or remove the database after close.
    const closeWriter = () => sqlite!.close(true);
    return { dataDir, sqlite, db, tracker, tableNames, refreshTracking, checkpoints,
      close() { checkpoints.stop(); closeWriter(); },
      closeAsync(deadline = Date.now() + 500) { return checkpoints.close(closeWriter, deadline); },
    };
  } catch (error) {
    sqlite?.close(true);
    throw asBedrockError(error, "DATABASE_OPEN_FAILED", "Check that the data directory is writable and the SQLite file is valid.");
  }
}
