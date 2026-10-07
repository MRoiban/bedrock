import { lstat, readdir, mkdir, chmod, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { DirectoryBackup } from "../config/hosting";
import { BedrockError } from "../error";
import type { BackupTarget } from "./target";

export interface DirectoryFile { path: string; sha256: string; size: number; mode: number; mtimeMs: number }
export interface DirectoryManifest { directories: Record<string, DirectoryFile[]>; emptyDirs: Record<string, string[]> }
const invalid = () => new BedrockError("INVALID_BACKUP_DIRECTORY", "Unsafe or reserved backup directory path.", "Use relative directory paths outside db.sqlite, files, uploads; omit dot segments and backslashes.");
export function safeRelative(path: string, root = false) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes(":") || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === "..")) throw invalid();
  if (root && /^(?:db\.sqlite(?:-wal|-shm)?|files|uploads)$/i.test(path.split("/")[0]!)) throw invalid();
  return path;
}
export function validateDirectories(config?: DirectoryBackup) {
  if (!config) return;
  if (!Array.isArray(config.directories) || config.exclude && (!Array.isArray(config.exclude) || config.exclude.some(pattern => typeof pattern !== "string"))) throw invalid();
  const roots: string[] = [];
  for (const dir of config.directories) {
    safeRelative(dir, true);
    if (roots.some(root => root === dir || root.startsWith(dir + "/") || dir.startsWith(root + "/"))) throw invalid();
    roots.push(dir);
  }
}
const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
export async function snapshotDirectories(target: BackupTarget, base: string, dataDir: string, config: DirectoryBackup): Promise<DirectoryManifest> {
  validateDirectories(config);
  const result: DirectoryManifest = { directories: Object.create(null), emptyDirs: Object.create(null) };
  const globs = (config.exclude ?? []).map(pattern => new Bun.Glob(pattern));
  for (const root of config.directories) {
    const files: DirectoryFile[] = result.directories[root] = [];
    const empty: string[] = result.emptyDirs[root] = [];
    async function walk(path: string) {
      const relative = path ? `${root}/${path}` : root;
      if (globs.some(glob => glob.match(relative) || glob.match(relative + "/"))) return;
      const stat = await lstat(join(dataDir, relative)).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
      if (!stat || stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        const entries = await readdir(join(dataDir, relative));
        if (!entries.length) empty.push(path);
        for (const name of entries.sort()) await walk(path ? `${path}/${name}` : name);
      } else if (stat.isFile()) {
        const bytes = new Uint8Array(await Bun.file(join(dataDir, relative)).arrayBuffer());
        const sha256 = hash(bytes);
        const key = `${base}files/${sha256}`;
        if (!await target.exists(key)) await target.put(key, bytes);
        files.push({ path, sha256, size: bytes.length, mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs });
      }
    }
    // Each parent is checked too: a symlink root ancestor must never escape dataDir.
    let parent = dataDir, safe = true;
    for (const part of root.split("/")) {
      parent = join(parent, part);
      const stat = await lstat(parent).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
      if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) { safe = false; break; }
    }
    if (safe) await walk("");
  }
  return result;
}
export async function restoreDirectories(target: BackupTarget, base: string, stage: string, manifest: Partial<DirectoryManifest>) {
  const directories = manifest.directories ?? {};
  validateDirectories({ directories: Object.keys(directories) });
  for (const [root, files] of Object.entries(directories)) {
    await mkdir(join(stage, root), { recursive: true });
    for (const path of manifest.emptyDirs?.[root] ?? []) {
      if (path) safeRelative(path);
      await mkdir(join(stage, root, path), { recursive: true });
    }
    for (const file of files) {
      safeRelative(file.path);
      if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777 || !Number.isFinite(file.mtimeMs)) throw invalid();
      const body = await target.get(`${base}files/${file.sha256}`);
      if (hash(body) !== file.sha256 || body.length !== file.size) throw new BedrockError("BACKUP_CHECKSUM", `Directory file ${root}/${file.path} checksum mismatch.`, "Choose another snapshot or repair the backup blob.");
      const destination = join(stage, root, file.path);
      await mkdir(join(destination, ".."), { recursive: true });
      await Bun.write(destination, body);
      await chmod(destination, file.mode);
      await utimes(destination, file.mtimeMs / 1000, file.mtimeMs / 1000);
    }
  }
}
