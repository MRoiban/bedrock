import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openDatabase } from "../db";
import { tempDirectory } from "../../test/helpers";
import { fsTarget, snapshot, manifests, prune, restoreData, backupSetup } from "./index";
import { sha256 } from "./snapshot";
import { atomicWrite } from "../daemon/config";

async function fixture() {
  const temp = tempDirectory();
  const data = join(temp.dir, "data");
  const database = openDatabase(data);
  const bytes = new TextEncoder().encode("attachment");
  database.sqlite.exec("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('before'); CREATE TABLE _bedrock_migrations (name TEXT, hash TEXT)");
  database.sqlite.query("INSERT INTO _bedrock_migrations VALUES (?, ?)").run("0000_notes.sql", "hash");
  await mkdir(join(data, "files", "attachments"), { recursive: true });
  await Bun.write(join(data, "files", "attachments", "file1"), bytes);
  database.sqlite.query("INSERT INTO _bedrock_files VALUES (?, ?, NULL, ?, ?, ?, ?, ?)").run("file1", "attachments", "example.txt", "text/plain", bytes.length, sha256(bytes), Date.now());
  return { temp, data, database, target: fsTarget(join(temp.dir, "target")), bytes };
}

test("live VACUUM snapshot, gzip, content dedup, metadata and verified restore round-trip", async () => {
  const f = await fixture();
  const puts: string[] = [];
  const target = { ...f.target, async put(key: string, bytes: Uint8Array) { puts.push(key); await f.target.put(key, bytes); } };
  try {
    const first = await snapshot(target, "notes", join(f.data, "db.sqlite"), join(f.data, "files"), new Date("2026-10-06T01:00:00Z"));
    await snapshot(target, "notes", join(f.data, "db.sqlite"), join(f.data, "files"), new Date("2026-10-06T02:00:00Z"));
    expect(puts.filter(key => key.includes("/files/"))).toHaveLength(1);
    expect(first.migrations).toEqual([{ name: "0000_notes.sql", hash: "hash" }]);
    expect(first.timestamp).toBe("2026-10-06T01:00:00.000Z");
    expect(first.db).toBe("pebbles/notes/db/2026-10-06T01-00-00.000Z.sqlite.gz");
    expect(first.version).toBe("0.1.0");
    f.database.sqlite.exec("UPDATE notes SET body='after'; DELETE FROM _bedrock_files");
    f.database.close();
    await Bun.write(join(f.data, "files", "attachments", "file1"), "changed");
    const restored = await restoreData(target, "notes", f.data, first.timestamp);
    const db = new Database(join(f.data, "db.sqlite"));
    try { expect(db.query("SELECT body FROM notes").get()).toEqual({ body: "before" }); expect(db.query("SELECT * FROM _bedrock_files").all()).toHaveLength(1); } finally { db.close(); }
    expect(await Bun.file(join(f.data, "files", "attachments", "file1")).text()).toBe("attachment");
    const old = new Database(join(restored.previous, "db.sqlite"));
    try { expect(old.query("SELECT body FROM notes").get()).toEqual({ body: "after" }); } finally { old.close(); }
  } finally { f.database.close(); f.temp.cleanup(); }
});

test("retention keeps hourly and daily representatives then collects unreferenced blobs", async () => {
  const f = await fixture();
  try {
    await snapshot(f.target, "notes", join(f.data, "db.sqlite"), join(f.data, "files"), new Date("2026-10-01T01:00:00Z"));
    f.database.sqlite.exec("DELETE FROM _bedrock_files");
    for (const timestamp of ["2026-10-02T01:00:00Z", "2026-10-02T01:30:00Z", "2026-10-03T01:00:00Z", "2026-10-03T02:00:00Z"]) await snapshot(f.target, "notes", join(f.data, "db.sqlite"), join(f.data, "files"), new Date(timestamp));
    await prune(f.target, "notes", 1, 2);
    expect((await manifests(f.target, "notes")).map(entry => entry.manifest.timestamp)).toEqual(["2026-10-02T01:30:00.000Z", "2026-10-03T02:00:00.000Z"]);
    expect(await f.target.list("pebbles/notes/files/")).toEqual([]);
    expect(await f.target.list("pebbles/notes/db/")).toHaveLength(2);
  } finally { f.database.close(); f.temp.cleanup(); }
});

test("corrupt file or database cannot replace live data", async () => {
  const f = await fixture();
  try {
    const manifest = await snapshot(f.target, "notes", join(f.data, "db.sqlite"), join(f.data, "files"));
    await f.target.put(`pebbles/notes/files/${sha256(f.bytes)}`, new TextEncoder().encode("corrupt"));
    await expect(restoreData(f.target, "notes", f.data)).rejects.toMatchObject({ code: "BACKUP_CHECKSUM" });
    expect(f.database.sqlite.query("SELECT body FROM notes").get()).toEqual({ body: "before" });
    await f.target.put(manifest.db, Bun.gzipSync("corrupt sqlite"));
    await expect(restoreData(f.target, "notes", f.data)).rejects.toMatchObject({ code: "BACKUP_CHECKSUM" });
  } finally { f.database.close(); f.temp.cleanup(); }
});

test("backup setup keeps credentials in a separate private file and validates retention", async () => {
  const temp = tempDirectory();
  try {
    await atomicWrite(join(temp.dir, "config.json"), JSON.stringify({ domain: "example.test", creators: [], port: 3000 }));
    await backupSetup(temp.dir, { type: "r2", account: "a".repeat(32), bucket: "backup-bucket" }, { accessKeyId: "id", secretAccessKey: "secret" });
    if (process.platform !== "win32") expect((await stat(join(temp.dir, "backup-credentials"))).mode & 0o777).toBe(0o600);
    expect(await Bun.file(join(temp.dir, "config.json")).text()).not.toContain("secret");
    await expect(backupSetup(temp.dir, { type: "fs", directory: temp.dir, hourly: 0, daily: 0 })).rejects.toMatchObject({ code: "INVALID_BACKUP_CONFIG" });
  } finally { temp.cleanup(); }
});
