import { expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Worker } from "node:worker_threads";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { BedrockError } from "../error";
import { snapshot, restoreData, sha256 } from "./snapshot";
import { createBackups } from "./index";
import { openDaemonDatabase } from "../daemon/db";
import { Releases } from "../daemon/releases";
import { Supervisor } from "../daemon/supervisor";
import { pebbleDataDir } from "../daemon/config";
import { fsTarget } from "./target";

async function fixture() {
  const temp = tempDirectory();
  const data = join(temp.dir, "data");
  await mkdir(data);
  const path = join(data, "db.sqlite");
  const db = new Database(path);
  db.exec("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('before'); CREATE TABLE _bedrock_files (id TEXT, bucket TEXT, sha256 TEXT)");
  db.query("INSERT INTO _bedrock_files VALUES (?, ?, ?)").run("one", "attachments", sha256(new TextEncoder().encode("attachment")));
  db.close();
  await Bun.write(join(data, "files/attachments/one"), "attachment");
  return { temp, data, path, target: fsTarget(join(temp.dir, "target")) };
}

const temporaryFiles = async (directory: string) => (await readdir(directory)).filter(name => name.startsWith(".bedrock-backup-"));

test("snapshot SQLite and hashing run outside the caller thread and restore round-trips", async () => {
  const f = await fixture();
  await Bun.write(join(f.data, "workspaces/nested/note.txt"), "workspace");
  const query = spyOn(Database.prototype, "query").mockImplementation(() => { throw new Error("SQLite ran on the caller thread"); });
  const hash = spyOn(Bun.CryptoHasher.prototype, "update").mockImplementation(() => { throw new Error("Hashing ran on the caller thread"); });
  const gzip = spyOn(Bun, "gzipSync").mockImplementation(() => { throw new Error("Synchronous gzip ran on the caller thread"); });
  const puts: string[] = [];
  try {
    const manifest = await snapshot({ ...f.target, async put(key, body) {
      if (key.endsWith(".sqlite.gz")) expect(body instanceof Blob).toBe(true);
      puts.push(key);
      await f.target.put(key, body);
    } }, "notes", f.path, join(f.data, "files"), new Date(), { directories: ["workspaces"] });
    expect(query).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(gzip).not.toHaveBeenCalled();
    expect(manifest.directories?.workspaces?.[0]?.size).toBe(9);
    expect(puts.at(-1)).toContain("/manifests/");
    query.mockRestore(); hash.mockRestore(); gzip.mockRestore();
    expect(sha256(Bun.gunzipSync(new Uint8Array(await f.target.get(manifest.db))))).toBe(manifest.dbSha256);
    const db = new Database(f.path);
    db.exec("UPDATE notes SET body='after'"); db.close();
    await restoreData(f.target, "notes", f.data);
    expect(await Bun.file(join(f.data, "workspaces/nested/note.txt")).text()).toBe("workspace");
    const restored = new Database(f.path);
    try { expect(restored.query("SELECT body FROM notes").get()).toEqual({ body: "before" }); }
    finally { restored.close(); }
    expect(await Bun.file(join(f.data, "files/attachments/one")).text()).toBe("attachment");
  } finally { query.mockRestore(); hash.mockRestore(); gzip.mockRestore(); f.temp.cleanup(); }
});

test("worker checksum errors and target BedrockErrors preserve code, message and hint", async () => {
  const f = await fixture();
  try {
    await Bun.write(join(f.data, "files/attachments/one"), "corrupt");
    const work = snapshot(f.target, "notes", f.path, join(f.data, "files"));
    await expect(work).rejects.toBeInstanceOf(BedrockError);
    await expect(work).rejects.toMatchObject({ code: "BACKUP_CHECKSUM", message: "File one does not match its metadata.", hint: "Repair the file before backing up; retry if it was deleted during backup." });
    const failure = new BedrockError("BACKUP_TEST", "Target unavailable.", "Repair the target.", undefined, { status: 503 });
    await expect(snapshot({ ...f.target, async exists() { throw failure; } }, "notes", f.path, join(f.data, "files"))).rejects.toMatchObject({ ...failure.toJSON(), status: 503 });
    expect(await temporaryFiles(f.data)).toEqual([]);
    expect(await f.target.list("pebbles/notes/manifests/")).toEqual([]);
  } finally { f.temp.cleanup(); }
});

test.each(["error", "exit"])("worker %s fails the backup and removes its staging files", async kind => {
  const f = await fixture();
  let worker: Worker | undefined;
  const on = Worker.prototype.on;
  const observe = spyOn(Worker.prototype, "on").mockImplementation(function (this: Worker, event: string, listener: (...args: unknown[]) => void) {
    worker = this;
    return on.call(this, event, listener);
  });
  try {
    await expect(snapshot({ ...f.target, async exists() {
      if (kind === "error") worker!.emit("error", new Error("worker failed"));
      else await worker!.terminate();
      return false;
    } }, "notes", f.path, join(f.data, "files"))).rejects.toMatchObject({ code: "BACKUP_FAILED" });
    expect(await temporaryFiles(f.data)).toEqual([]);
    expect(await f.target.list("pebbles/notes/manifests/")).toEqual([]);
  } finally { observe.mockRestore(); f.temp.cleanup(); }
});

test("backup manager shutdown cancels a waiting worker and releases the pebble lock", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "home");
  const db = await openDaemonDatabase(home);
  const releases = new Releases(home, db, new Supervisor(home, db, "test-secret"));
  const release = join(temp.dir, "release");
  const data = pebbleDataDir(home, "notes");
  let stopped: Promise<void> | undefined;
  const target = fsTarget(join(temp.dir, "target"));
  const backups = createBackups(home, db, releases, { ...target, put() {
    stopped = backups.stop();
    return new Promise<void>(() => {});
  } });
  try {
    await Bun.write(join(release, ".bedrock-backup.json"), "null");
    await mkdir(data, { recursive: true });
    const sqlite = new Database(join(data, "db.sqlite"));
    sqlite.exec("CREATE TABLE notes (body TEXT)"); sqlite.close();
    db.save({ name: "notes", release, previous_release: null, status: "stopped" });
    await expect(backups.run("notes")).rejects.toMatchObject({ code: "BACKUP_CANCELLED" });
    expect(stopped).toBeDefined();
    await stopped;
    await expect(releases.exclusive("notes", async () => "released")).resolves.toBe("released");
    await expect(backups.run("notes")).rejects.toMatchObject({ code: "BACKUP_BUSY" });
    expect(await temporaryFiles(data)).toEqual([]);
    expect(await target.list("pebbles/notes/manifests/")).toEqual([]);
  } finally { await backups.stop(); db.close(); temp.cleanup(); }
});
