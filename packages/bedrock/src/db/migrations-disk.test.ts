import { test, expect } from "bun:test";
import { openDatabase } from "./index";
import { applyMigrations } from "./migrations";
import { tempDirectory } from "../../test/helpers";
import { join } from "node:path";

test("migrations expose SQLITE_FULL with database path and can retry", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  try {
    const dir = join(temp.dir, "migrations");
    await Bun.write(join(dir, "0000.sql"), "CREATE TABLE payloads (body BLOB); INSERT INTO payloads VALUES (zeroblob(1048576));");
    const pages = (database.sqlite.query("PRAGMA page_count").get() as { page_count: number }).page_count;
    database.sqlite.exec(`PRAGMA max_page_count=${pages}`);
    await expect(applyMigrations(database.sqlite, dir)).rejects.toMatchObject({ code: "DISK_FULL", message: expect.stringContaining(temp.dir) });
    database.sqlite.exec("PRAGMA max_page_count=1000000");
    expect(await applyMigrations(database.sqlite, dir)).toEqual(["0000.sql"]);
  } finally { database.close(); temp.cleanup(); }
});
