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

export { TableTracker } from "./tracker";
export type { TableUsage } from "./tracker";
export { migrationPlan, applyMigrations } from "./migrations";

export function defaultDataDir(name: string) {
  return join(process.env.BEDROCK_HOME ?? join(homedir(), ".bedrock"), "pebbles", name, "data");
}

export function openDatabase(dataDir: string, schema: Record<string, unknown> = {}) {
  let sqlite: Database | undefined;
  try {
    mkdirSync(resolve(dataDir), { recursive: true });
    sqlite = new Database(join(dataDir, "db.sqlite"), { create: true, strict: true });
    sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    sqlite.exec(storageMigration);
    schema = { ...schema, _bedrockFiles: files };
    const tableNames = new Set(Object.values(schema).filter(t => is(t, Table)).map(t => getTableName(t as Table)));
    const tracker = new TableTracker(tableNames);
    const refreshTracking = () => tracker.setEffects(writeEffects(sqlite!));
    refreshTracking();
    const db = drizzle(sqlite, { schema, logger: tracker });
    return { dataDir, sqlite, db, tracker, tableNames, refreshTracking, close: () => sqlite!.close() };
  } catch (error) {
    sqlite?.close();
    throw asBedrockError(error, "DATABASE_OPEN_FAILED", "Check that the data directory is writable and the SQLite file is valid.");
  }
}
