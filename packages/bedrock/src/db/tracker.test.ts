import { test, expect } from "bun:test";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { TableTracker, openDatabase } from "./index";
import { tempDirectory } from "../../test/helpers";

test("tracks joins, quoted names, qualified writes, CTEs, and ignores literals/comments", async () => {
  const tracker = new TableTracker(["notes", "users", "audit"]);
  const result = await tracker.capture(async () => {
    tracker.logQuery('WITH n AS (SELECT * FROM "notes") SELECT * FROM n JOIN [users] u ON 1=1 WHERE u.id=\'audit\' -- audit', []);
    tracker.logQuery('INSERT INTO main.`audit` SELECT * FROM "notes"', []);
    tracker.logQuery("UPDATE OR IGNORE notes SET body='users'; DELETE FROM audit; /* users */", []);
    return 42;
  });
  expect(result.value).toBe(42);
  expect([...result.reads].sort()).toEqual(["audit", "notes", "users"]);
  expect([...result.writes].sort()).toEqual(["audit", "notes"]);
  const clean = await tracker.capture(() => tracker.logQuery("SELECT 'notes'; -- users", []));
  expect(clean.reads.size).toBe(0);
});

test("AsyncLocalStorage isolates concurrent calls", async () => {
  const tracker = new TableTracker(["notes", "users"]);
  const [a, b] = await Promise.all([
    tracker.capture(async () => { await Bun.sleep(5); tracker.logQuery("SELECT * FROM notes", []); }),
    tracker.capture(async () => { tracker.logQuery("INSERT INTO users VALUES (?)", []); await Bun.sleep(10); }),
  ]);
  expect([...a.reads]).toEqual(["notes"]);
  expect(a.writes.size).toBe(0);
  expect([...b.writes]).toEqual(["users"]);
  expect(b.reads.size).toBe(0);
});

test("Drizzle logger captures executed SQL, including awaited builders", async () => {
  const temp = tempDirectory();
  const notes = sqliteTable("notes", { id: text("id").primaryKey() });
  const database = openDatabase(temp.dir, { notes });
  try {
    database.sqlite.exec("CREATE TABLE notes (id TEXT PRIMARY KEY)");
    const write = await database.tracker.capture(() => database.db.insert(notes).values({ id: "a" }).returning());
    expect([...write.writes]).toEqual(["notes"]);
    const read = await database.tracker.capture(() => database.db.select().from(notes));
    expect([...read.reads]).toEqual(["notes"]);
    expect(read.value).toEqual([{ id: "a" }]);
  } finally { database.close(); temp.cleanup(); }
});
