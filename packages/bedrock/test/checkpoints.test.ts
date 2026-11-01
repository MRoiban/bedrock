import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { openDatabase } from "../src/db";
import { createExecutor } from "../src/runtime/functions";
import { definePebble } from "../src/config";
import { setup } from "../src/daemon/config";
import { moveData } from "../src/daemon/move-data";
import { snapshot, restoreData } from "../src/backup/snapshot";
import { fsTarget } from "../src/backup/target";
import { tempDirectory } from "./helpers";

const dbModule = JSON.stringify(new URL("../src/db/index.ts", import.meta.url).href);
const workerModule = JSON.stringify(new URL("../src/db/checkpoint-worker.ts", import.meta.url).href);

async function leaveWal(dir: string, crash: boolean) {
  const script = join(dir, "writer.ts");
  await Bun.write(script, `
    import { openDatabase } from ${dbModule};
    const database = openDatabase(${JSON.stringify(join(dir, "data"))});
    database.sqlite.exec("DROP TABLE IF EXISTS sample; CREATE TABLE sample (body BLOB); INSERT INTO sample VALUES (randomblob(5000000))");
    const worker = new Worker(${workerModule}, { smol: true, ref: true });
    worker.onmessage = ({data}) => {
      if (data === "ready") {
        worker.postMessage("finish");
        ${crash ? 'process.kill(process.pid, "SIGKILL")' : 'process.exit(0)'};
      }
    };
    worker.postMessage({path: ${JSON.stringify(join(dir, "data", "db.sqlite"))}, final: true});
  `);
  const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
  await child.exited;
  if (!crash) expect(child.exitCode).toBe(0);
  expect(await Bun.file(join(dir, "data", "db.sqlite-wal")).exists()).toBe(true);
}

for (const crash of process.platform === "win32" ? [false] : [false, true]) {
  test(`process ${crash ? "crash" : "exit"} during a checkpoint leaves recoverable committed data`, async () => {
    const temp = tempDirectory();
    try {
      await leaveWal(temp.dir, crash);
      const database = openDatabase(join(temp.dir, "data"));
      try {
        expect(database.sqlite.query("SELECT length(body) AS n FROM sample").get()).toEqual({ n: 5_000_000 });
        expect(database.sqlite.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
        expect(database.sqlite.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
      } finally { await database.closeAsync(); }
    } finally { temp.cleanup(); }
  });
}

test("a queued write waits at the WAL backstop for a checkpoint instead of failing", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  const execute = createExecutor(definePebble({ name: "wal-wait" }), database);
  const reader = new Database(join(temp.dir, "db.sqlite"));
  try {
    database.sqlite.exec("CREATE TABLE sample (body BLOB); INSERT INTO sample VALUES (randomblob(100))");
    database.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    reader.exec("BEGIN"); reader.query("SELECT * FROM sample").get();
    database.sqlite.exec("UPDATE sample SET body=randomblob(68000000)");
    await database.checkpoints.check();
    const write = execute.job(() => database.sqlite.exec("DELETE FROM sample"));
    await Bun.sleep(100);
    reader.exec("ROLLBACK");
    await write;
    expect(database.sqlite.query("SELECT count(*) AS n FROM sample").get()).toEqual({ n: 0 });
  } finally { reader.close(); await execute.close(); await database.closeAsync(); temp.cleanup(); }
}, 15000);

test("queued writes respect the WAL backstop while queries can release a pinned reader", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  const execute = createExecutor(definePebble({ name: "wal-backstop" }), database);
  const reader = new Database(join(temp.dir, "db.sqlite"));
  try {
    database.sqlite.exec("CREATE TABLE sample (body BLOB); INSERT INTO sample VALUES (randomblob(100))");
    database.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    reader.exec("BEGIN"); reader.query("SELECT * FROM sample").get();
    database.sqlite.exec("UPDATE sample SET body=randomblob(68000000)");
    await database.checkpoints.check();
    await expect(execute.job(() => database.sqlite.exec("DELETE FROM sample"))).rejects.toMatchObject({ code: "DATABASE_WAL_BUSY" });
    const result = await execute("query", "release", null, new Request("http://localhost"), { user: null }, () => {
      reader.exec("ROLLBACK");
      return database.sqlite.query("SELECT length(body) AS n FROM sample").get();
    });
    expect(result.value).toEqual({ n: 68_000_000 });
    database.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    await database.checkpoints.check();
    await execute.job(() => database.sqlite.exec("DELETE FROM sample"));
    expect(database.sqlite.query("SELECT count(*) AS n FROM sample").get()).toEqual({ n: 0 });
  } finally { reader.close(); await execute.close(); await database.closeAsync(); temp.cleanup(); }
}, 15000);

test("VACUUM INTO backup and restore coexist with checkpoints and a retained old WAL", async () => {
  const temp = tempDirectory();
  const data = join(temp.dir, "data");
  const database = openDatabase(data);
  const target = fsTarget(join(temp.dir, "backups"));
  try {
    database.sqlite.exec("DROP TABLE IF EXISTS sample; CREATE TABLE sample (body BLOB); INSERT INTO sample VALUES (randomblob(5000000))");
    const [manifest] = await Promise.all([
      snapshot(target, "wal", join(data, "db.sqlite")),
      database.checkpoints.check(),
    ]);
    await database.closeAsync();
    const held = new Database(join(data, "db.sqlite"));
    held.exec("BEGIN"); held.query("SELECT * FROM sample").get();
    const writer = new Database(join(data, "db.sqlite"));
    writer.exec("UPDATE sample SET body=randomblob(100)"); writer.close();
    held.exec("ROLLBACK");
    // On Windows every connection must be closed before moving the data directory.
    held.close();
    await leaveWal(temp.dir, false);
    const restored = await restoreData(target, "wal", data, manifest.timestamp);
    const recovered = openDatabase(data);
    try { expect(recovered.sqlite.query("SELECT length(body) AS n FROM sample").get()).toEqual({ n: 5_000_000 }); }
    finally { await recovered.closeAsync(); }
    expect(await Bun.file(join(restored.previous, "db.sqlite-wal")).exists()).toBe(true);
  } finally { temp.cleanup(); }
});

test("offline data move copies an uncheckpointed WAL with its database", async () => {
  const temp = tempDirectory();
  try {
    const home = join(temp.dir, "home");
    await setup(home, "example.test", "creator@example.test", 0);
    const pebble = join(home, "pebbles", "wal");
    await Bun.write(join(pebble, "placeholder"), "");
    await leaveWal(pebble, false);
    const target = join(temp.dir, "moved");
    await moveData(home, target, { running: async () => false });
    const database = openDatabase(join(target, "pebbles", "wal", "data"));
    try { expect(database.sqlite.query("SELECT length(body) AS n FROM sample").get()).toEqual({ n: 5_000_000 }); }
    finally { await database.closeAsync(); }
  } finally { temp.cleanup(); }
});
