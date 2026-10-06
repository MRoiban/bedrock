import { test, expect } from "bun:test";
import { join } from "node:path";
import { openDatabase, applyMigrations, migrationPlan } from "./index";
import { tempDirectory } from "../../test/helpers";

test("opens SQLite with required pragmas and ordered, idempotent migrations", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  try {
    const { sqlite } = database;
    expect(sqlite.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(sqlite.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    await Bun.write(join(temp.dir, "migrations/0002_insert.sql"), "INSERT INTO items VALUES ('second');");
    await Bun.write(join(temp.dir, "migrations/0001_create.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY);");
    expect((await migrationPlan(sqlite, join(temp.dir, "migrations"))).map(m => m.name)).toEqual(["0001_create.sql", "0002_insert.sql"]);
    expect(await applyMigrations(sqlite, join(temp.dir, "migrations"))).toHaveLength(2);
    expect(await applyMigrations(sqlite, join(temp.dir, "migrations"))).toEqual([]);
    expect(sqlite.query("SELECT * FROM items").all()).toEqual([{ id: "second" }]);
    await Bun.write(join(temp.dir, "migrations/0001_create.sql"), "CREATE TABLE changed (id TEXT);");
    await expect(migrationPlan(sqlite, join(temp.dir, "migrations"))).rejects.toMatchObject({ code: "MIGRATION_CHANGED" });
  } finally { database.close(); temp.cleanup(); }
});

test("a failed migration rolls back both SQL and history, retaining earlier migrations", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  try {
    const dir = join(temp.dir, "migrations");
    await Bun.write(join(dir, "0001.sql"), "CREATE TABLE items (id TEXT);");
    await Bun.write(join(dir, "0002.sql"), "INSERT INTO items VALUES ('oops'); CREATE TABLE partial (id TEXT); INSERT INTO missing VALUES (1);");
    await expect(applyMigrations(database.sqlite, dir)).rejects.toMatchObject({ code: "MIGRATION_FAILED" });
    expect(database.sqlite.query("SELECT * FROM items").all()).toEqual([]);
    expect(database.sqlite.query("SELECT name FROM _bedrock_migrations").all()).toEqual([{ name: "0001.sql" }]);
    expect(database.sqlite.query("SELECT name FROM sqlite_master WHERE name='partial'").get()).toBeNull();
    await Bun.write(join(dir, "0002.sql"), "INSERT INTO items VALUES ('fixed');");
    expect(await applyMigrations(database.sqlite, dir)).toEqual(["0002.sql"]);
  } finally { database.close(); temp.cleanup(); }
});

test("migration-owned transactions are rejected, CASE and triggers are accepted", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  try {
    const dir = join(temp.dir, "migrations");
    await Bun.write(join(dir, "0001.sql"), "BEGIN; CREATE TABLE items (id TEXT); COMMIT;");
    await expect(applyMigrations(database.sqlite, dir)).rejects.toMatchObject({ code: "INVALID_MIGRATION" });
    await Bun.write(join(dir, "0001.sql"), "CREATE TABLE items (id TEXT); CREATE TABLE log (id TEXT); CREATE TRIGGER audit AFTER INSERT ON items BEGIN INSERT INTO log VALUES (CASE WHEN NEW.id = 'a' THEN 'b' ELSE NEW.id END); END; INSERT INTO items VALUES ('a');");
    expect(await applyMigrations(database.sqlite, dir)).toEqual(["0001.sql"]);
    expect(database.sqlite.query("SELECT * FROM log").all()).toEqual([{ id: "b" }]);
  } finally { database.close(); temp.cleanup(); }
});
