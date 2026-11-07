import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { databaseReadable } from "./readable";
test("diagnostic reads fail promptly under a database lock and restore the application timeout", () => {
  const temp = tempDirectory(), path = join(temp.dir, "db.sqlite");
  const writer = new Database(path, { create: true }), reader = new Database(path);
  try {
    writer.exec("CREATE TABLE pebbles(name TEXT); BEGIN EXCLUSIVE;");
    reader.exec("PRAGMA busy_timeout=5000");
    const start = performance.now();
    expect(databaseReadable(reader, "pebbles")).toBe(false);
    expect(performance.now() - start).toBeLessThan(250);
    expect(reader.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    writer.exec("ROLLBACK");
    expect(databaseReadable(reader, "pebbles")).toBe(true);
  } finally { reader.close(); writer.close(); temp.cleanup(); }
});
