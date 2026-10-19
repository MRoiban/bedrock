import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { is, Table } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { openDatabase, migrationPlan, applyMigrations, validateMigrationSql } from "../db";
import { loadPebble } from "../runtime/load";
import { BedrockError } from "../error";
import { diffSchema } from "./schema-diff";

export interface DbOptions { name?: string | undefined; allowDataLoss?: boolean }

export async function dbCommand(command: string, dir = process.cwd(), options: DbOptions = {}) {
  const migrations = join(dir, "migrations");
  if (command === "new") {
    const name = slug(options.name ?? "");
    const file = await reserveFile(migrations, name);
    await Bun.write(join(migrations, file), `-- ${name}: hand-written migration; Bedrock applies it in one transaction.\n`);
    return { command: "db new", file: `migrations/${file}` };
  }
  const pebble = await loadPebble(dir);
  const tables = Object.fromEntries(Object.entries(pebble.schema ?? {}).filter(([, value]) => is(value, Table))) as Record<string, SQLiteTable>;
  if (command === "generate") return generate(dir, tables, options);
  if (command === "check") {
    const diff = await diffSchema(dir, tables);
    if (diff.statements.length) {
      throw new BedrockError("SCHEMA_DRIFT", `Schema changed without a migration: ${diff.statements.length} statement(s) pending, starting with ${diff.statements[0]}`, "Run bedrock db generate, review the new file in migrations/, and commit it.");
    }
    return { command: "db check", migrations: diff.migrations, unmanagedTables: diff.unmanaged, message: "Migrations match the schema." };
  }
  const database = openDatabase(join(dir, ".bedrock"), pebble.schema);
  try {
    if (command === "plan") return { command: "db plan", pending: await migrationPlan(database.sqlite, migrations) };
    if (command === "migrate") return { command: "db migrate", applied: await applyMigrations(database.sqlite, migrations) };
    throw new BedrockError("UNKNOWN_COMMAND", `Unknown db command: ${command}`, "Use bedrock db generate, new, check, plan, or migrate.");
  } finally { database.close(); }
}

async function generate(dir: string, tables: Record<string, SQLiteTable>, options: DbOptions) {
  if (!Object.keys(tables).length) throw new BedrockError("NO_SCHEMA", "No Drizzle tables found in pebble.schema.", "Add tables to schema in definePebble before generating migrations.");
  const diff = await diffSchema(dir, tables);
  const base = { command: "db generate", unmanagedTables: diff.unmanaged };
  if (!diff.statements.length) return { ...base, file: null, statements: 0, message: "Schema unchanged; no migration written." };
  if (diff.dataLoss.length && !options.allowDataLoss) {
    throw new BedrockError("MIGRATION_DATA_LOSS", `This migration would lose data: ${diff.dataLoss.join("; ")}.`,
      "If this is a rename, run bedrock db new <name> and write ALTER TABLE … RENAME … by hand. To drop the data on purpose, rerun with --allow-data-loss.");
  }
  // SQLite only accepts these on an empty table, and push would wipe a non-empty one to add them.
  if (diff.unfillable.length || diff.statements.some(statement => /^delete\s+from/i.test(statement))) {
    throw new BedrockError("MIGRATION_NOT_NULL", `New NOT NULL column${diff.unfillable.length === 1 ? "" : "s"} without a SQL default: ${diff.unfillable.join(", ") || "unknown"}. Existing rows cannot be filled.`,
      "Add .default(...) to the column, or add it nullable, backfill with bedrock db new <name>, then make it NOT NULL.");
  }
  const sql = diff.statements.map(statement => statement.endsWith(";") ? statement : `${statement};`).join("\n") + "\n";
  const file = await reserveFile(join(dir, "migrations"), slug(options.name ?? "") || "schema");
  validateMigrationSql(sql, file);
  // Prove the file applies after every existing migration and leaves nothing to diff.
  try {
    const after = await diffSchema(dir, tables, [{ name: file, sql, hash: "" }]);
    if (after.statements.length) throw new Error(`${after.statements.length} statement(s) still differ, starting with ${after.statements[0]}`);
  } catch (error) {
    throw new BedrockError("GENERATE_FAILED", `Generated migration does not apply cleanly: ${error instanceof Error ? error.message : String(error)}`, "Write this change by hand with bedrock db new <name>, then run bedrock db check.");
  }
  await Bun.write(join(dir, "migrations", file), sql);
  return { ...base, file: `migrations/${file}`, statements: diff.statements.length, dataLoss: diff.dataLoss };
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
}

// Timestamped names sort after legacy 0000_* files and keep parallel branches from colliding.
async function reserveFile(migrations: string, name: string) {
  if (!name) throw new BedrockError("INVALID_ARGS", "A migration name is required.", "Use bedrock db new <name>, for example bedrock db new backfill_titles.");
  await mkdir(migrations, { recursive: true });
  const stamps = (await readdir(migrations)).map(file => /^(\d{14})_/.exec(file)?.[1]).filter(Boolean) as string[];
  const latest = stamps.sort().at(-1);
  let time = Math.floor(Date.now() / 1000) * 1000;
  // A later stamp from the clock or a merged branch must still sort before this file.
  if (latest && stamp(time) <= latest) time = parseStamp(latest) + 1000;
  return `${stamp(time)}_${name}.sql`;
}

const stamp = (time: number) => new Date(time).toISOString().replace(/\D/g, "").slice(0, 14);
const parseStamp = (value: string) =>
  Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8), +value.slice(8, 10), +value.slice(10, 12), +value.slice(12, 14));
