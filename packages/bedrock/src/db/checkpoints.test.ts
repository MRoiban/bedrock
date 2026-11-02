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
    await expect(database.checkpoints.beforeWrite()).rejects.toMatchObject({ code: "DATABASE_WAL_BUSY" });
    expect(reader.query("SELECT count(*) AS n FROM sample").get()).toEqual({ n: 1024 });
    reader.exec("ROLLBACK"); reader.close(); reader = undefined;
    await database.checkpoints.check();
    await database.checkpoints.check();
    expect(() => database.checkpoints.beforeWrite()).not.toThrow();
    expect(walSize(temp.dir)).toBe(0);
  } finally { reader?.close(); await database.closeAsync(); temp.cleanup(); }
}, 15000);

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

test("the backstop still sees WAL growth while a slow checkpoint is running", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  const fixture = join(temp.dir, "stuck.ts");
  await Bun.write(fixture, "self.onmessage = () => {}");
  const OriginalWorker = globalThis.Worker;
  const worker = spyOn(globalThis as unknown as { Worker: (...args: any[]) => any }, "Worker").mockImplementation(() => new OriginalWorker(fixture, { ref: false }));
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    fill(database.sqlite, 4000, 1100);
    while (!worker.mock.calls.length) await Bun.sleep(25);
    database.sqlite.exec("UPDATE sample SET body=randomblob(65536)");
    await Bun.sleep(400);
    await expect(database.checkpoints.beforeWrite()).rejects.toMatchObject({ code: "DATABASE_WAL_BUSY" });
  } finally { await database.closeAsync(Date.now()); worker.mockRestore(); warn.mockRestore(); temp.cleanup(); }
}, 15000);

test("failed Workers retry with capped backoff, recover automatically and bound sustained writes", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const info = spyOn(console, "info").mockImplementation(() => {});
  const realNow = Date.now.bind(Date);
  let offset = 0;
  const now = spyOn(Date, "now").mockImplementation(() => realNow() + offset);
  const worker = spyOn(globalThis as unknown as { Worker: (...args: any[]) => any }, "Worker")
    .mockImplementation(() => { throw new Error("forced disk/Worker failure"); });
  let peak = 0;
  try {
    fill(database.sqlite);
    await database.checkpoints.check();
    expect(worker.mock.calls.length).toBe(1);
    for (const delay of [30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000]) {
      await database.checkpoints.check();
      const attempts = worker.mock.calls.length;
      offset += delay;
      await database.checkpoints.check();
      expect(worker.mock.calls.length).toBe(attempts + 1);
      for (let batch = 0; batch < 8; batch++) {
        await database.checkpoints.beforeWrite();
        fill(database.sqlite);
        peak = Math.max(peak, walSize(temp.dir));
      }
    }
    expect(warn.mock.calls).toHaveLength(1);
    expect(database.sqlite.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 1000 });
    worker.mockRestore();
    offset += 600_000;
    // The polling loop must recover without an explicit check, even when the WAL is idle.
    const deadline = realNow() + 3000;
    while (!info.mock.calls.length && realNow() < deadline) await Bun.sleep(25);
    expect(info.mock.calls).toHaveLength(1);
    expect(database.sqlite.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    for (let batch = 0; batch < 8; batch++) {
      await database.checkpoints.beforeWrite();
      fill(database.sqlite);
      peak = Math.max(peak, walSize(temp.dir));
      await database.checkpoints.check();
    }
    expect(peak).toBeLessThan(16 * 1024 * 1024);
    expect(database.sqlite.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    console.log(`WAL recovery measurement: 64 batches, peak ${peak} bytes, final ${walSize(temp.dir)} bytes; 8 forced failures, 1 degradation, 1 recovery`);
  } finally { now.mockRestore(); worker.mockRestore(); warn.mockRestore(); info.mockRestore(); await database.closeAsync(); temp.cleanup(); }
}, 15000);

test("vulnerable SQLite never starts a checkpoint Worker, including shutdown", async () => {
  const { createCheckpoints } = await import("./checkpoints");
  const temp = tempDirectory();
  const sqlite = new Database(join(temp.dir, "db.sqlite"));
  sqlite.exec("PRAGMA journal_mode=WAL");
  const query = sqlite.query.bind(sqlite);
  const version = spyOn(sqlite, "query").mockImplementation((sql: string) =>
    sql === "SELECT sqlite_version() AS version" ? { get: () => ({ version: "3.51.2" }) } as any : query(sql));
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const worker = spyOn(globalThis as unknown as { Worker: (...args: any[]) => any }, "Worker")
    .mockImplementation(() => { throw new Error("must not start"); });
  const checkpoints = createCheckpoints(sqlite, join(temp.dir, "db.sqlite"));
  try {
    fill(sqlite);
    await checkpoints.check();
    expect(sqlite.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 1000 });
    expect(warn.mock.calls).toHaveLength(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ code: "DATABASE_CHECKPOINT_UNSAFE_SQLITE", hint: expect.stringContaining("Upgrade Bun") });
    await checkpoints.close(() => sqlite.close(), Date.now() + 500);
    expect(worker.mock.calls).toHaveLength(0);
  } finally { checkpoints.stop(); sqlite.close(); version.mockRestore(); worker.mockRestore(); warn.mockRestore(); temp.cleanup(); }
});

test("stop cancels pending retry without a recovery or another Worker", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const worker = spyOn(globalThis as unknown as { Worker: (...args: any[]) => any }, "Worker")
    .mockImplementation(() => { throw new Error("forced failure"); });
  let now: ReturnType<typeof spyOn> | undefined;
  try {
    fill(database.sqlite);
    await database.checkpoints.check();
    database.checkpoints.stop();
    const later = Date.now() + 700_000;
    now = spyOn(Date, "now").mockReturnValue(later);
    await database.checkpoints.check();
    await Bun.sleep(300);
    expect(worker.mock.calls).toHaveLength(1);
    expect(database.sqlite.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 1000 });
  } finally { now?.mockRestore(); worker.mockRestore(); warn.mockRestore(); database.close(); temp.cleanup(); }
});

test("degraded auto-checkpoint still refuses writes pinned beyond the WAL backstop", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const worker = spyOn(globalThis as unknown as { Worker: (...args: any[]) => any }, "Worker")
    .mockImplementation(() => { throw new Error("forced failure"); });
  let reader: Database | undefined;
  try {
    fill(database.sqlite);
    await database.checkpoints.check();
    database.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    reader = new Database(join(temp.dir, "db.sqlite"), { readonly: true });
    reader.exec("BEGIN"); reader.query("SELECT count(*) FROM sample").get();
    database.sqlite.exec("UPDATE sample SET body=randomblob(65536)");
    await database.checkpoints.check();
    await expect(database.checkpoints.beforeWrite()).rejects.toMatchObject({ code: "DATABASE_WAL_BUSY" });
    expect(database.sqlite.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    reader.close(); reader = undefined;
    await Bun.sleep(5100);
    await database.checkpoints.beforeWrite();
    expect(walSize(temp.dir)).toBe(0);
  } finally { reader?.close(); worker.mockRestore(); warn.mockRestore(); await database.closeAsync(); temp.cleanup(); }
}, 15000);
