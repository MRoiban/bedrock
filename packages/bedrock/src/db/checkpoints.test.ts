import { expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { openDatabase } from "./index";

function fill(sqlite: Database, bytes = 4000, rows = 1100) {
  sqlite.exec("CREATE TABLE IF NOT EXISTS sample (id INTEGER PRIMARY KEY, body BLOB)");
  const insert = sqlite.prepare("INSERT OR REPLACE INTO sample VALUES (?, randomblob(?))");
  sqlite.transaction(() => { for (let id = 0; id < rows; id++) insert.run(id, bytes); })();
}

const walSize = (dir: string) => { try { return statSync(join(dir, "db.sqlite-wal")).size; } catch { return 0; } };

test("writer disables auto-checkpoint; sustained raw writes checkpoint and bound the WAL", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  try {
    expect(database.sqlite.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    for (let round = 0; round < 4; round++) {
      fill(database.db.$client);
      expect(walSize(temp.dir)).toBeGreaterThan(4_000_000);
      await database.checkpoints.check();
      expect(walSize(temp.dir)).toBeLessThan(8_000_000);
      expect(statSync(join(temp.dir, "db.sqlite")).size).toBeGreaterThan(4_000_000);
    }
    expect(database.sqlite.query("SELECT count(*) AS n FROM sample").get()).toEqual({ n: 1100 });
    expect(database.sqlite.query("PRAGMA wal_checkpoint(TRUNCATE)").get()).toEqual({ busy: 0, log: 0, checkpointed: 0 });
  } finally { await database.closeAsync(); temp.cleanup(); }
});

test("Worker startup failure restores auto-checkpoint and warns with a repair hint", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const worker = spyOn(globalThis as unknown as { Worker: (...args: any[]) => any }, "Worker").mockImplementation(() => { throw new Error("Worker unavailable"); });
  try {
    fill(database.sqlite);
    await database.checkpoints.check();
    expect(database.sqlite.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 1000 });
    expect(warn.mock.calls).toHaveLength(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ code: "DATABASE_CHECKPOINT_FAILED", hint: expect.stringContaining("auto-checkpoint is restored") });
  } finally { worker.mockRestore(); warn.mockRestore(); await database.closeAsync(); temp.cleanup(); }
});

test("a pinned reader pauses queued writes at the backstop; reads and manual checkpoints still work", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  let reader: Database | undefined;
  try {
    fill(database.sqlite, 64 * 1024, 1024);
    database.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    reader = new Database(join(temp.dir, "db.sqlite"), { readonly: true });
    reader.exec("BEGIN");
    reader.query("SELECT count(*) FROM sample").get();
    database.sqlite.exec("UPDATE sample SET body=randomblob(65536)");
    await database.checkpoints.check();
    expect(walSize(temp.dir)).toBeGreaterThan(64 * 1024 * 1024);
    expect(() => database.checkpoints.beforeWrite()).toThrow(expect.objectContaining({ code: "DATABASE_WAL_BUSY" }));
    expect(reader.query("SELECT count(*) AS n FROM sample").get()).toEqual({ n: 1024 });
    reader.exec("ROLLBACK"); reader.close(); reader = undefined;
    await database.checkpoints.check();
    await database.checkpoints.check();
    expect(() => database.checkpoints.beforeWrite()).not.toThrow();
    expect(walSize(temp.dir)).toBe(0);
  } finally { reader?.close(); await database.closeAsync(); temp.cleanup(); }
});

test("shutdown checkpoints below the threshold, closes handles and preserves data after a move", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  fill(database.sqlite, 4000, 20);
  await database.closeAsync();
  const moved = `${temp.dir}-moved`;
  renameSync(temp.dir, moved);
  renameSync(moved, temp.dir);
  const reopened = openDatabase(temp.dir);
  try {
    expect(walSize(temp.dir)).toBeLessThan(100_000);
    expect(reopened.sqlite.query("SELECT count(*) AS n FROM sample").get()).toEqual({ n: 20 });
    expect(reopened.sqlite.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally { await reopened.closeAsync(); temp.cleanup(); }
});

test("shutdown with a pinned reader leaves a recoverable WAL and does not wait for that reader", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  let reader: Database | undefined;
  try {
    fill(database.sqlite, 4000, 20);
    reader = new Database(join(temp.dir, "db.sqlite"), { readonly: true });
    reader.exec("BEGIN"); reader.query("SELECT count(*) FROM sample").get();
    database.sqlite.exec("INSERT INTO sample VALUES (9999, randomblob(4000))");
    await database.closeAsync();
    reader.exec("ROLLBACK"); reader.close(); reader = undefined;
    const reopened = openDatabase(temp.dir);
    expect(reopened.sqlite.query("SELECT count(*) AS n FROM sample").get()).toEqual({ n: 21 });
    await reopened.closeAsync();
  } finally { reader?.close(); temp.cleanup(); }
});

test("an unexpectedly exited Worker restores auto-checkpoint", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  const fixture = join(temp.dir, "exited.ts");
  await Bun.write(fixture, "process.exit(1)");
  const OriginalWorker = globalThis.Worker;
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const worker = spyOn(globalThis as unknown as { Worker: (...args: any[]) => any }, "Worker")
    .mockImplementation(() => new OriginalWorker(fixture));
  try {
    fill(database.sqlite);
    await database.checkpoints.check();
    expect(database.sqlite.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 1000 });
    expect(warn.mock.calls[0]![0]).toMatchObject({ code: "DATABASE_CHECKPOINT_FAILED" });
  } finally { worker.mockRestore(); warn.mockRestore(); await database.closeAsync(); temp.cleanup(); }
});

test("an expired shutdown deadline cancels a Worker without waiting for a message", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  fill(database.sqlite, 4000, 20);
  const fixture = join(temp.dir, "stuck.ts");
  await Bun.write(fixture, "self.onmessage = () => {}");
  const OriginalWorker = globalThis.Worker;
  let exited!: Promise<void>;
  const worker = spyOn(globalThis as unknown as { Worker: (...args: any[]) => any }, "Worker").mockImplementation(() => {
    const instance = new OriginalWorker(fixture, { ref: false });
    exited = new Promise<void>(resolve => instance.addEventListener("close", () => resolve()));
    return instance;
  });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    await database.closeAsync(Date.now());
    await exited;
    expect(warn.mock.calls[0]![0]).toMatchObject({ code: "DATABASE_CHECKPOINT_STOPPED" });
    const reopened = new Database(join(temp.dir, "db.sqlite"));
    expect(reopened.query("SELECT count(*) AS n FROM sample").get()).toEqual({ n: 20 });
    reopened.close();
  } finally { worker.mockRestore(); warn.mockRestore(); temp.cleanup(); }
});
