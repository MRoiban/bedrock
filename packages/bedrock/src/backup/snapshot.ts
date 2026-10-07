import { snapshotDirectories, restoreDirectories, type DirectoryManifest } from "./directories";
import type { DirectoryBackup } from "../config/hosting";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BedrockError } from "../error";
import type { BackupTarget } from "./target";
import { version } from "../../package.json";

export interface Manifest extends Partial<DirectoryManifest> {
  timestamp: string;
  db: string;
  dbSha256: string;
  files: Record<string, string>;
  version: string;
  migrations: { name: string; hash: string }[];
}
export const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const prefix = (name: string) => name === "_daemon" ? "daemon/" : `pebbles/${name}/`;
const hasTable = (db: Database, name: string) => !!db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);

export async function snapshot(target: BackupTarget, name: string, databasePath: string, filesDir?: string, now = new Date(), directories?: DirectoryBackup): Promise<Manifest> {
  const temp = await mkdtemp(join(tmpdir(), "bedrock-backup-"));
  let source: Database | undefined;
  let copy: Database | undefined;
  try {
    source = new Database(databasePath, { readonly: true });
    source.exec("PRAGMA busy_timeout=5000");
    source.query("VACUUM INTO ?").run(join(temp, "snapshot.sqlite"));
    copy = new Database(join(temp, "snapshot.sqlite"), { readonly: true });
    const bytes = new Uint8Array(await Bun.file(join(temp, "snapshot.sqlite")).arrayBuffer());
    const timestamp = now.toISOString();
    const filename = timestamp.replaceAll(":", "-");
    const base = prefix(name);
    const manifest: Manifest = { timestamp, db: `${base}db/${filename}.sqlite.gz`, dbSha256: sha256(bytes), files: {}, version, migrations: hasTable(copy, "_bedrock_migrations") ? copy.query("SELECT name, hash FROM _bedrock_migrations ORDER BY name").all() as Manifest["migrations"] : [] };
    if (filesDir && hasTable(copy, "_bedrock_files")) {
      const files = copy.query("SELECT id, bucket, sha256 FROM _bedrock_files").all() as { id: string; bucket: string; sha256: string }[];
      for (const file of files) {
        const key = `${base}files/${file.sha256}`;
        if (!await target.exists(key)) {
          const body = new Uint8Array(await Bun.file(join(filesDir, file.bucket, file.id)).arrayBuffer());
          if (sha256(body) !== file.sha256) throw new BedrockError("BACKUP_CHECKSUM", `File ${file.id} does not match its metadata.`, "Repair the file before backing up; retry if it was deleted during backup.");
          await target.put(key, body);
        }
        manifest.files[file.id] = file.sha256;
      }
    }
    if (directories) Object.assign(manifest, await snapshotDirectories(target, base, join(databasePath, ".."), directories));
    await target.put(manifest.db, Bun.gzipSync(bytes));
    // Publishing the manifest last makes incomplete uploads invisible to restore.
    await target.put(`${base}manifests/${filename}.json`, new TextEncoder().encode(JSON.stringify(manifest)));
    return manifest;
  } finally { source?.close(); copy?.close(); await rm(temp, { recursive: true, force: true }); }
}

export async function manifests(target: BackupTarget, name: string) {
  return Promise.all((await target.list(`${prefix(name)}manifests/`)).filter(key => key.endsWith(".json")).map(async key => ({ key, manifest: JSON.parse(new TextDecoder().decode(await target.get(key))) as Manifest })));
}

export async function prune(target: BackupTarget, name: string, hourly = 24, daily = 30) {
  const entries = (await manifests(target, name)).sort((a, b) => b.manifest.timestamp.localeCompare(a.manifest.timestamp));
  const hours = new Set<string>();
  const days = new Set<string>();
  const retained: typeof entries = [];
  for (const entry of entries) {
    const hour = entry.manifest.timestamp.slice(0, 13);
    const day = entry.manifest.timestamp.slice(0, 10);
    const keepHour = !hours.has(hour) && hours.size < hourly;
    const keepDay = !days.has(day) && days.size < daily;
    if (keepHour) hours.add(hour);
    if (keepDay) days.add(day);
    if (keepHour || keepDay) retained.push(entry);
    else { await target.delete(entry.key); await target.delete(entry.manifest.db); }
  }
  const blobs = new Set(retained.flatMap(entry => [...Object.values(entry.manifest.files), ...Object.values(entry.manifest.directories ?? {}).flat().map(file => file.sha256)]));
  for (const key of await target.list(`${prefix(name)}files/`)) if (!blobs.has(key.split("/").at(-1)!)) await target.delete(key);
  // Failed uploads can leave database objects without manifests.
  const databases = new Set(retained.map(entry => entry.manifest.db));
  for (const key of await target.list(`${prefix(name)}db/`)) if (!databases.has(key)) await target.delete(key);
}

export async function restoreData(target: BackupTarget, name: string, dataDir: string, at?: string) {
  const entries = await manifests(target, name);
  const manifest = entries.map(entry => entry.manifest).filter(entry => !at || entry.timestamp === at).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  if (!manifest) throw new BedrockError("BACKUP_NOT_FOUND", "No matching backup exists.", "Use bedrock backup ls <pebble> and pass an exact timestamp with --at.");
  const stage = `${dataDir}.restore-${crypto.randomUUID()}`;
  const previous = `${dataDir}.before-restore-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  let db: Database | undefined;
  try {
    await mkdir(stage, { recursive: true });
    const bytes = Bun.gunzipSync(new Uint8Array(await target.get(manifest.db)));
    if (sha256(bytes) !== manifest.dbSha256) throw new BedrockError("BACKUP_CHECKSUM", "Database checksum mismatch.", "Choose another snapshot; inspect your backup target.");
    await Bun.write(join(stage, "db.sqlite"), bytes);
    db = new Database(join(stage, "db.sqlite"), { readonly: true });
    if ((db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check !== "ok") throw new BedrockError("BACKUP_CORRUPT", "SQLite integrity check failed.", "Restore another snapshot.");
    const rows = hasTable(db, "_bedrock_files") ? db.query("SELECT id, bucket, sha256 FROM _bedrock_files").all() as { id: string; bucket: string; sha256: string }[] : [];
    if (rows.length !== Object.keys(manifest.files).length) throw new BedrockError("BACKUP_CORRUPT", "Manifest file count differs from database.", "Choose another snapshot.");
    for (const row of rows) {
      if (!/^[a-z0-9_-]{1,32}$/.test(row.bucket) || !/^[\w-]+$/.test(row.id) || !/^[a-f0-9]{64}$/.test(row.sha256) || manifest.files[row.id] !== row.sha256) throw new BedrockError("BACKUP_CORRUPT", "Manifest file metadata differs from database.", "Choose another snapshot.");
      const body = await target.get(`${prefix(name)}files/${row.sha256}`);
      if (sha256(body) !== row.sha256) throw new BedrockError("BACKUP_CHECKSUM", `File ${row.id} checksum mismatch.`, "Choose another snapshot or repair the backup blob.");
      await mkdir(join(stage, "files", row.bucket), { recursive: true });
      await Bun.write(join(stage, "files", row.bucket, row.id), body);
    }
    await restoreDirectories(target, prefix(name), stage, manifest);
    db.close(); db = undefined;
    await rename(dataDir, previous);
    try { await rename(stage, dataDir); }
    catch (error) { await rename(previous, dataDir); throw error; }
    return { timestamp: manifest.timestamp, previous };
  } finally { db?.close(); await rm(stage, { recursive: true, force: true }); }
}
