import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, applyMigrations } from "../db";
import { dbCommand } from "./db";
import { tempDirectory } from "../../test/helpers";

const bedrock = JSON.stringify(join(import.meta.dir, "../index.ts"));
const temps: { cleanup(): void }[] = [];
afterAll(() => temps.forEach(temp => temp.cleanup()));

// Each schema version gets its own directory: Bun caches pebble.ts by path.
async function pebble(tables: string, from?: string) {
  const temp = tempDirectory();
  temps.push(temp);
  if (from && existsSync(join(from, "migrations"))) cpSync(join(from, "migrations"), join(temp.dir, "migrations"), { recursive: true });
  await Bun.write(join(temp.dir, "pebble.ts"), `import { definePebble, sqliteTable, text, integer, index, uniqueIndex, unique, sql } from ${bedrock};
${tables}
export default definePebble({ name: "fixture", schema: { ${[...tables.matchAll(/export const (\w+) =/g)].map(m => m[1]).join(", ")} } });\n`);
  return temp.dir;
}

const sqlFiles = (dir: string) => existsSync(join(dir, "migrations")) ? readdirSync(join(dir, "migrations")).filter(name => name.endsWith(".sql")).sort() : [];

async function migrate(dir: string, dataDir = join(dir, "data")) {
  const database = openDatabase(dataDir);
  try { return await applyMigrations(database.sqlite, join(dir, "migrations")); } finally { database.close(); }
}

const items = `export const items = sqliteTable("items", { id: text("id").primaryKey(), title: text("title").notNull() });`;
const tags = `export const tags = sqliteTable("tags", { id: text("id").primaryKey() });`;

test("db generate includes schema tables even when not exported by pebble.ts", async () => {
  const dir = await pebble("");
  await Bun.write(join(dir, "pebble.ts"), `import { definePebble, sqliteTable, text } from ${bedrock};
export default definePebble({ name: "schema-only", schema: { extra: sqliteTable("schema_table", { id: text("id").primaryKey() }) } });`);
  await dbCommand("generate", dir);
  const [file] = sqlFiles(dir);
  expect(await Bun.file(join(dir, "migrations", file!)).text()).toContain("schema_table");
  await migrate(dir);
});

test("generate writes one timestamped file from an empty directory, then nothing", async () => {
  const dir = await pebble(`${items}\n${tags}`);
  const first = await dbCommand("generate", dir, { name: "Initial Schema!" });
  expect(first).toMatchObject({ statements: 2 });
  expect(sqlFiles(dir)).toEqual([expect.stringMatching(/^\d{14}_initial_schema\.sql$/)]);
  expect(existsSync(join(dir, "migrations", "meta"))).toBe(false);
  expect(await dbCommand("generate", dir)).toMatchObject({ file: null, statements: 0 });
  expect(sqlFiles(dir)).toHaveLength(1);
  expect(await dbCommand("check", dir)).toMatchObject({ migrations: 1 });
});

test("indexes, unique constraints, foreign keys and SQL defaults survive a no-op round trip", async () => {
  const dir = await pebble(`export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  managerId: integer("manager_id").references((): any => people.id, { onDelete: "set null" }),
  team: text("team").notNull().default("core"),
  createdAt: integer("created_at").notNull().default(sql\`(unixepoch())\`),
  stamp: text("stamp").default(sql\`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))\`),
}, t => [index("people_team").on(t.team), uniqueIndex("people_team_email").on(t.team, t.email), unique("people_team_manager").on(t.team, t.managerId)]);
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  personId: integer("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0),
});`);
  await dbCommand("generate", dir);
  expect(await dbCommand("generate", dir)).toMatchObject({ statements: 0 });
  expect(await dbCommand("check", dir)).toMatchObject({ migrations: 1 });
});

test("parallel branches touching different tables apply in either order", async () => {
  const base = await pebble(`${items}\n${tags}`);
  await dbCommand("generate", base);
  const branchA = await pebble(`export const items = sqliteTable("items", { id: text("id").primaryKey(), title: text("title").notNull(), done: integer("done").notNull().default(0) });\n${tags}`, base);
  await dbCommand("generate", branchA, { name: "items_done" });
  const branchB = await pebble(`${items}\nexport const tags = sqliteTable("tags", { id: text("id").primaryKey(), color: text("color") });`, base);
  await dbCommand("generate", branchB, { name: "tags_color" });
  // Each branch has run its own migration locally before the merge.
  await migrate(branchA);
  await migrate(branchB);
  const merged = await pebble(`export const items = sqliteTable("items", { id: text("id").primaryKey(), title: text("title").notNull(), done: integer("done").notNull().default(0) });
export const tags = sqliteTable("tags", { id: text("id").primaryKey(), color: text("color") });`, branchA);
  cpSync(join(branchB, "migrations"), join(merged, "migrations"), { recursive: true });
  expect(sqlFiles(merged)).toHaveLength(3);
  expect(await dbCommand("check", merged)).toMatchObject({ migrations: 3 });
  const fileA = sqlFiles(branchA).at(-1)!;
  const fileB = sqlFiles(branchB).at(-1)!;
  expect(await migrate(merged, join(branchA, "data"))).toEqual([fileB]);
  expect(await migrate(merged, join(branchB, "data"))).toEqual([fileA]);
});

test("check names the second file when merged branches add the same column", async () => {
  const dir = await pebble(items);
  await dbCommand("generate", dir);
  await Bun.write(join(dir, "migrations", "20990101000000_a.sql"), "ALTER TABLE `items` ADD `done` integer;\n");
  await Bun.write(join(dir, "migrations", "20990101000001_b.sql"), "ALTER TABLE `items` ADD `done` integer;\n");
  const error = await dbCommand("check", dir).catch(error => error);
  expect(error).toMatchObject({ code: "MIGRATION_REPLAY_FAILED" });
  expect(error.message).toContain("20990101000001_b.sql");
  expect(error.message).toContain("duplicate column");
});

test("check fails when the schema changed without a migration", async () => {
  const base = await pebble(items);
  await dbCommand("generate", base);
  const changed = await pebble(`${items}\n${tags}`, base);
  await expect(dbCommand("check", changed)).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
});

test("generate refuses data loss unless allowed, and refuses ambiguous renames", async () => {
  const base = await pebble(`export const items = sqliteTable("items", { id: text("id").primaryKey(), title: text("title").notNull(), body: text("body") });`);
  await dbCommand("generate", base);
  const dropped = await pebble(items, base);
  await expect(dbCommand("generate", dropped)).rejects.toMatchObject({ code: "MIGRATION_DATA_LOSS", message: expect.stringContaining("items.body") });
  expect(sqlFiles(dropped)).toHaveLength(1);
  const result = await dbCommand("generate", dropped, { allowDataLoss: true });
  expect(result).toMatchObject({ dataLoss: ["drops column items.body"] });
  expect(await Bun.file(join(dropped, result.file!)).text()).toContain("DROP COLUMN `body`");
  const renamed = await pebble(`export const items = sqliteTable("items", { id: text("id").primaryKey(), title: text("title").notNull(), text: text("text") });`, base);
  await expect(dbCommand("generate", renamed, { allowDataLoss: true })).rejects.toMatchObject({ code: "MIGRATION_AMBIGUOUS" });
  const unfillable = await pebble(`export const items = sqliteTable("items", { id: text("id").primaryKey(), title: text("title").notNull(), body: text("body"), rank: integer("rank").notNull() });`, base);
  await expect(dbCommand("generate", unfillable)).rejects.toMatchObject({ code: "MIGRATION_NOT_NULL", message: expect.stringContaining("items.rank") });
});

test("a table rebuild keeps rows and foreign keys through the real runner", async () => {
  const before = await pebble(`export const parents = sqliteTable("parents", { id: text("id").primaryKey(), name: text("name") });
export const kids = sqliteTable("kids", {
  id: text("id").primaryKey(),
  parentId: text("parent_id").notNull().references(() => parents.id, { onDelete: "cascade" }),
  age: text("age"),
}, t => [index("kids_parent").on(t.parentId)]);`);
  await dbCommand("generate", before);
  await migrate(before);
  const database = openDatabase(join(before, "data"));
  try { database.sqlite.exec("INSERT INTO parents VALUES ('p1', 'Ada'); INSERT INTO kids VALUES ('k1', 'p1', '7'), ('k2', 'p1', '9');"); }
  finally { database.close(); }
  // name gains NOT NULL and age changes type: SQLite needs both tables rebuilt.
  const after = await pebble(`export const parents = sqliteTable("parents", { id: text("id").primaryKey(), name: text("name").notNull() });
export const kids = sqliteTable("kids", {
  id: text("id").primaryKey(),
  parentId: text("parent_id").notNull().references(() => parents.id, { onDelete: "cascade" }),
  age: integer("age").notNull().default(0),
  score: integer("score").notNull().default(5),
}, t => [index("kids_parent").on(t.parentId)]);`, before);
  cpSync(join(before, "data"), join(after, "data"), { recursive: true });
  const result = await dbCommand("generate", after, { name: "rebuild" });
  const sql = await Bun.file(join(after, result.file!)).text();
  expect(sql).toContain("PRAGMA foreign_keys=OFF;");
  expect(sql).toContain("__new_parents");
  expect(await migrate(after)).toEqual([result.file!.slice("migrations/".length)]);
  const migrated = openDatabase(join(after, "data"));
  try {
    expect(migrated.sqlite.query("SELECT id, parent_id, age, score FROM kids ORDER BY id").all()).toEqual([{ id: "k1", parent_id: "p1", age: 7, score: 5 }, { id: "k2", parent_id: "p1", age: 9, score: 5 }]);
    expect(migrated.sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(migrated.sqlite.query("PRAGMA foreign_key_list(kids)").all()).toEqual([expect.objectContaining({ table: "parents", on_delete: "CASCADE" })]);
  } finally { migrated.close(); }
  expect(await dbCommand("check", after)).toMatchObject({ migrations: 2 });
});

test("a legacy pebble keeps 0000_* files, ignores meta/, and appends a timestamped file", async () => {
  const dir = await pebble(`${items}\n${tags}`);
  await Bun.write(join(dir, "migrations", "0000_init.sql"), "CREATE TABLE `items` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`title` text NOT NULL\n);\n");
  await Bun.write(join(dir, "migrations", "meta", "_journal.json"), "{ not json at all");
  await Bun.write(join(dir, "migrations", "meta", "0000_snapshot.json"), "{}");
  await migrate(dir);
  const result = await dbCommand("generate", dir, { name: "tags" });
  expect(sqlFiles(dir)).toEqual(["0000_init.sql", result.file!.slice("migrations/".length)]);
  expect(await Bun.file(join(dir, "migrations", "meta", "_journal.json")).text()).toBe("{ not json at all");
  expect(await dbCommand("check", dir)).toMatchObject({ migrations: 2 });
  expect(await migrate(dir)).toHaveLength(1);
});

test("db new creates an empty, timestamped migration after the latest one", async () => {
  const dir = await pebble(items);
  await Bun.write(join(dir, "migrations", "20990101000000_future.sql"), "SELECT 1;");
  const result = await dbCommand("new", dir, { name: "Backfill titles" });
  expect(result.file).toBe("migrations/20990101000001_backfill_titles.sql");
  expect(await Bun.file(join(dir, result.file!)).text()).toStartWith("-- backfill_titles:");
  await expect(dbCommand("new", dir, { name: "!!" })).rejects.toMatchObject({ code: "INVALID_ARGS" });
});

test("db generate and check print a single JSON value with --json", async () => {
  const dir = await pebble(items);
  const cli = (...args: string[]) => {
    const child = Bun.spawnSync([process.execPath, join(import.meta.dir, "index.ts"), "db", ...args, "--json"], { cwd: dir, env: { ...process.env, BEDROCK_HOME: join(dir, "home") } });
    return { code: child.exitCode, value: JSON.parse(child.stdout.toString()) };
  };
  expect(cli("check")).toMatchObject({ code: 1, value: { ok: false, error: { code: "SCHEMA_DRIFT" } } });
  expect(cli("generate", "init")).toMatchObject({ code: 0, value: { ok: true, file: expect.stringMatching(/_init\.sql$/) } });
  expect(cli("check")).toMatchObject({ code: 0, value: { ok: true, migrations: 1 } });
  rmSync(join(dir, "home"), { recursive: true, force: true });
});
