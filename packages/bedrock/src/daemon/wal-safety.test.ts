import { expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { openDaemonDatabase } from "./db";
import { Supervisor } from "./supervisor";

test("release candidates cannot overlap a live writer on vulnerable SQLite", async () => {
  const temp = tempDirectory();
  const database = await openDaemonDatabase(temp.dir);
  const supervisor = new Supervisor(temp.dir, database, "test-secret");
  const child = spyOn(supervisor, "child").mockReturnValue({ process: { exitCode: null } } as any);
  const realQuery = database.db.query.bind(database.db);
  const query = spyOn(database.db, "query").mockImplementation((sql: string) =>
    sql === "SELECT sqlite_version() AS version" ? { get: () => ({ version: "3.51.2" }) } as any : realQuery(sql));
  try {
    await expect(supervisor.launch("sample", join(temp.dir, "missing-release"))).rejects.toMatchObject({
      code: "DATABASE_UNSAFE_SQLITE", hint: expect.stringContaining("Stop the pebble"),
    });
  } finally { query.mockRestore(); child.mockRestore(); await supervisor.shutdown(); database.close(); temp.cleanup(); }
});
