import { expect, test } from "bun:test";
import { cp, mkdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { tempDirectory } from "../../test/helpers";
import { createTemplate } from "./template";
import { loadTestConfig } from "./config";
import { pruneRuns } from "./artifacts";

const configModule = join(import.meta.dir, "../config/index.ts");
test("closed templates replay migrations, seed fixed identities and isolate copied SQLite and files", async () => {
  const temp = tempDirectory();
  try {
    await Bun.write(join(temp.dir, "pebble.ts"), `import {definePebble} from ${JSON.stringify(configModule)}; export default definePebble({name:'sample'});`);
    await Bun.write(join(temp.dir, "migrations/001.sql"), "CREATE TABLE notes (id TEXT, created_at TEXT);");
    await Bun.write(join(temp.dir, "tests/seed.ts"), `export default async ({sqlite,dataDir,users,now})=>{sqlite.query('INSERT INTO notes VALUES (?,?)').run(users.friend.id,now.toISOString());await Bun.write(dataDir+'/files/fixed','seed');};`);
    const template = join(temp.dir, "template");
    await createTemplate(temp.dir, template);
    const copy = join(temp.dir, "copy");
    await cp(template, copy, { recursive: true });
    const first = new Database(join(copy, "data/db.sqlite"));
    expect(first.query("SELECT * FROM notes").get()).toEqual({ id: "bedrock-test-friend", created_at: "2024-01-01T00:00:00.000Z" });
    first.exec("DELETE FROM notes"); first.close();
    const original = new Database(join(template, "data/db.sqlite"));
    expect(original.query("SELECT count(*) AS n FROM notes").get()).toEqual({ n: 1 }); original.close();
    expect(await Bun.file(join(copy, "data/files/fixed")).text()).toBe("seed");
    const identity = new Database(join(copy, "bedrock.sqlite"));
    expect(identity.query("SELECT id FROM users WHERE email='friend@example.test'").get()).toEqual({ id: "bedrock-test-friend" }); identity.close();
  } finally { temp.cleanup(); }
});

test("configuration rejects unknown keys and list does not invoke seed", async () => {
  const temp = tempDirectory();
  try {
    await Bun.write(join(temp.dir, "bedrock.test.ts"), "export default {typo: true}");
    await expect(loadTestConfig(temp.dir)).rejects.toMatchObject({ code: "INVALID_TEST_CONFIG" });
    const other = join(temp.dir, "other");
    await Bun.write(join(other, "pebble.ts"), `import {definePebble} from ${JSON.stringify(configModule)};export default definePebble({name:'sample'});`);
    await Bun.write(join(other, "tests/seed.ts"), "export default ()=>{throw Error('seed must not run')}");
    expect((await createTemplate(other, join(other, "template"), true)).name).toBe("sample");
  } finally { temp.cleanup(); }
});

test("retention prunes old completed runs and preserves active/current runs", async () => {
  const temp = tempDirectory();
  try {
    for (const name of ["old", "active", "current", "recent"]) {
      await mkdir(join(temp.dir, name));
      await Bun.write(join(temp.dir, name, "evidence"), "x".repeat(40));
      if (name !== "active") await Bun.write(join(temp.dir, name, "complete.json"), "{}");
    }
    const past = new Date(Date.now() - 8 * 86_400_000);
    await utimes(join(temp.dir, "old/complete.json"), past, past);
    const report = await pruneRuns(temp.dir, "current");
    expect(report.removed).toEqual([join(temp.dir, "old")]);
    expect(await Bun.file(join(temp.dir, "active/evidence")).exists()).toBe(true);
    const bounded = await pruneRuns(temp.dir, "current", Date.now(), 50);
    expect(bounded.removed).toEqual([join(temp.dir, "recent")]);
    expect(await Bun.file(join(temp.dir, "current/evidence")).exists()).toBe(true);
  } finally { temp.cleanup(); }
});
