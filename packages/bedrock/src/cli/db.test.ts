import { expect, test } from "bun:test";
import { join } from "node:path";
import { openDatabase } from "../db";
import { dbCommand } from "./db";
import { tempDirectory } from "../../test/helpers";

test("db generate includes schema tables even when not exported by pebble.ts", async () => {
  const temp = tempDirectory();
  try {
    const bedrock = join(import.meta.dir, "../index.ts");
    await Bun.write(join(temp.dir, "pebble.ts"), `import { definePebble, sqliteTable, text } from ${JSON.stringify(bedrock)};
export default definePebble({ name: "schema-only", schema: { extra: sqliteTable("schema_table", { id: text("id").primaryKey() }) } });`);
    await dbCommand("generate", temp.dir);
    const { readdir } = await import("node:fs/promises");
    const sql = (await readdir(join(temp.dir, "migrations"))).find(name => name.endsWith(".sql"))!;
    expect(await Bun.file(join(temp.dir, "migrations", sql)).text()).toContain("schema_table");
    const database = openDatabase(join(temp.dir, "data"));
    try { const { applyMigrations } = await import("../db"); await applyMigrations(database.sqlite, join(temp.dir, "migrations")); expect(database.sqlite.query("SELECT * FROM schema_table").all()).toEqual([]); }
    finally { database.close(); }
  } finally { temp.cleanup(); }
});
