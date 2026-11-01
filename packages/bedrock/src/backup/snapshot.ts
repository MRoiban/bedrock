import { restoreDirectories, type DirectoryManifest } from "./directories";
import type { DirectoryBackup } from "../config/hosting";
import { Database } from "bun:sqlite";
import { mkdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { BedrockError } from "../error";
import type { BackupTarget } from "./target";
import { snapshotInWorker } from "./snapshot-thread";

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
  return snapshotInWorker(target, { name, databasePath, filesDir, now, directories });
}

export async function manifests(target: BackupTarget, name: string) {
  return Promise.all((await target.list(`${prefix(name)}manifests/`)).filter(key => key.endsWith(".json")).map(async key => ({ key, manifest: JSON.parse(new TextDecoder().decode(await target.get(key))) as Manifest })));
}

export const DEFAULT_KEEP = 24;
export async function prune(target: BackupTarget, name: string, keep = DEFAULT_KEEP) {
  const entries = (await manifests(target, name)).sort((a, b) => b.manifest.timestamp.localeCompare(a.manifest.timestamp));
  const retained = entries.slice(0, keep);
  for (const entry of entries.slice(keep)) { await target.delete(entry.key); await target.delete(entry.manifest.db); }
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
