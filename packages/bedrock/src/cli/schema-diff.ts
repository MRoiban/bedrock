import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { replayMigrations, type Migration } from "../db/migrations";
import { BedrockError } from "../error";

type PushSQLiteSchema = (imports: Record<string, unknown>, db: unknown) =>
  Promise<{ hasDataLoss: boolean; warnings: string[]; statementsToExecute: string[] }>;

export interface SchemaDiff {
  /** SQL that turns the replayed migrations into the current schema. Empty when they match. */
  statements: string[];
  /** Human-readable reasons the statements would lose data. */
  dataLoss: string[];
  /** Columns added to existing tables as NOT NULL without a SQL default; SQLite rejects them once rows exist. */
  unfillable: string[];
  migrations: number;
  /** Tables and views the migrations create that pebble.schema does not declare; never diffed. */
  unmanaged: string[];
}

async function loadPush(dir: string): Promise<PushSQLiteSchema> {
  let entry: string;
  try {
    // Bedrock's own drizzle-kit sees its drizzle-orm; a link:ed bedrock installs none into the pebble.
    try { entry = Bun.resolveSync("drizzle-kit/api", import.meta.dir); }
    catch { entry = Bun.resolveSync("drizzle-kit/api", dir); }
  } catch {
    throw new BedrockError("DRIZZLE_KIT_MISSING", "drizzle-kit is required for migration generation.", "Run bun add --dev drizzle-kit in the pebble directory, then retry.");
  }
  return (await import(entry) as { pushSQLiteSchema: PushSQLiteSchema }).pushSQLiteSchema;
}

/** Replays `migrations/*.sql` (plus `extra`) into a scratch database and diffs it with `tables`. */
export async function diffSchema(dir: string, tables: Record<string, SQLiteTable>, extra: Migration[] = []): Promise<SchemaDiff> {
  const push = await loadPush(dir);
  const { scratch, migrations } = await replayMigrations(join(dir, "migrations"), extra);
  try {
    const unmanaged = dropUnmanaged(scratch, new Set(Object.values(tables).map(table => getTableName(table))));
    const { dataLoss, unfillable } = compareColumns(scratch, Object.values(tables));
    const result = await quietly(() => push(tables, drizzle(scratch)));
    if (result.hasDataLoss) dataLoss.push(...result.warnings.map(warning => warning.replace(/\x1b\[[0-9;]*m/g, "").replace(/^· /, "")));
    // Push repeats a rebuilt table's CREATE INDEX statements; the second copy would fail.
    const seen = new Set<string>();
    const statements = result.statementsToExecute.map(statement => copyExistingColumns(scratch, statement.trim()))
      .filter(statement => !/^create (unique )?index/i.test(statement) || !seen.has(statement) && !!seen.add(statement));
    return { statements, dataLoss, unfillable, migrations: migrations.length, unmanaged };
  } finally { scratch.close(); }
}

// Raw-SQL tables (FTS, caches) are the author's business; diffing them would always propose dropping them.
function dropUnmanaged(scratch: Database, managed: Set<string>) {
  const objects = () => scratch.query("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'").all() as { type: string; name: string; sql: string | null }[];
  // Virtual tables first: dropping one removes its shadow tables.
  const order = (sql: string | null) => /^create\s+virtual/i.test(sql ?? "") ? 0 : 1;
  const unmanaged: string[] = [];
  scratch.exec("PRAGMA foreign_keys=OFF");
  try {
    for (const object of objects().filter(o => !managed.has(o.name)).sort((a, b) => order(a.sql) - order(b.sql))) {
      if (!objects().some(o => o.name === object.name)) continue;
      scratch.exec(`DROP ${object.type === "view" ? "VIEW" : "TABLE"} "${object.name.replaceAll('"', '""')}"`);
      unmanaged.push(object.name);
    }
  } finally { scratch.exec("PRAGMA foreign_keys=ON"); }
  return unmanaged.sort();
}

// Push judges columns by row counts, and the scratch database is empty.
function compareColumns(scratch: Database, tables: SQLiteTable[]) {
  const dataLoss: string[] = [];
  const unfillable: string[] = [];
  for (const table of tables) {
    const name = getTableName(table);
    const existing = (scratch.query("SELECT name FROM pragma_table_xinfo(?)").all(name) as { name: string }[]).map(row => row.name);
    if (!existing.length) continue;
    const columns = getTableConfig(table).columns;
    const wanted = columns.map(column => column.name);
    const removed = existing.filter(column => !wanted.includes(column));
    const added = wanted.filter(column => !existing.includes(column));
    if (removed.length && added.length) {
      throw new BedrockError("MIGRATION_AMBIGUOUS", `Table ${name} removes ${removed.join(", ")} and adds ${added.join(", ")}; a rename and a drop plus add look the same.`,
        "For a rename, run bedrock db new <name> and write ALTER TABLE … RENAME COLUMN … by hand. Otherwise make the removal and the addition in two separate bedrock db generate runs.");
    }
    dataLoss.push(...removed.map(column => `drops column ${name}.${column}`));
    unfillable.push(...columns.filter(column => added.includes(column.name) && column.notNull && column.default === undefined && !column.generated)
      .map(column => `${name}.${column.name}`));
  }
  return { dataLoss, unfillable };
}

// A rebuild copies every new column from the old table; SQLite reads a missing "column" as a string
// literal, so a column added in the same rebuild would be filled with its own name.
function copyExistingColumns(scratch: Database, statement: string) {
  const copy = /^INSERT INTO `__new_(.+)`\((.*)\) SELECT .* FROM `\1`;$/s.exec(statement);
  if (!copy) return statement;
  const table = copy[1]!;
  const existing = new Set((scratch.query("SELECT name FROM pragma_table_xinfo(?)").all(table) as { name: string }[]).map(row => row.name));
  const columns = copy[2]!.split(", ").filter(column => existing.has(column.slice(1, -1).replaceAll('""', '"'))).join(", ");
  return `INSERT INTO \`__new_${table}\`(${columns}) SELECT ${columns} FROM \`${table}\`;`;
}

// drizzle-kit draws a spinner on stdout and prompts when stdin is a TTY; neither may reach --json output.
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const streams = [process.stdin, process.stdout] as const;
  const tty = streams.map(stream => Object.getOwnPropertyDescriptor(stream, "isTTY"));
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof write;
  for (const stream of streams) Object.defineProperty(stream, "isTTY", { value: false, configurable: true });
  try { return await run(); }
  catch (error) {
    throw new BedrockError("GENERATE_FAILED", error instanceof Error ? error.message : String(error), "Check the schema exports, then retry. For renames, write the migration by hand with bedrock db new <name>.");
  } finally {
    process.stdout.write = write;
    streams.forEach((stream, i) => {
      if (tty[i]) Object.defineProperty(stream, "isTTY", tty[i]!);
      else delete (stream as { isTTY?: boolean }).isTTY;
    });
  }
}
