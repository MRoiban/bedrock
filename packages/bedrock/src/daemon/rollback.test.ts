import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openDatabase } from "../db";
import { assertRollbackSafe } from "./rollback";
import { tempDirectory } from "../../test/helpers";

test("rollback refuses a release missing applied migrations with a restore hint", async () => {
  const temp = tempDirectory();
  const db = openDatabase(join(temp.dir, "data"));
  try {
    db.sqlite.exec("CREATE TABLE _bedrock_migrations (name TEXT); INSERT INTO _bedrock_migrations VALUES ('0000.sql'), ('0001.sql')");
    await mkdir(join(temp.dir, "release", "migrations"), { recursive: true });
    await Bun.write(join(temp.dir, "release", "migrations", "0000.sql"), "SELECT 1");
    await expect(assertRollbackSafe(join(temp.dir, "data", "db.sqlite"), join(temp.dir, "release"))).rejects.toMatchObject({ code: "ROLLBACK_MIGRATIONS", hint: expect.stringContaining("backup restore") });
    await Bun.write(join(temp.dir, "release", "migrations", "0001.sql"), "SELECT 1");
    await assertRollbackSafe(join(temp.dir, "data", "db.sqlite"), join(temp.dir, "release"));
  } finally { db.close(); temp.cleanup(); }
});
