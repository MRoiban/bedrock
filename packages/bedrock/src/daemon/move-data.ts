import { copyFile, chmod, lstat, mkdir, readdir, readlink, realpath, rename, rm, stat, statfs, symlink, utimes } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { BedrockError } from "../error";
import { atomicWrite, openDataRoot, readConfig } from "./config";

// Pebble data and logs are the categories that follow dataDir; releases and secrets stay in home.
const categories = ["data", "logs"] as const;

export interface MoveOptions { running?: (home: string) => Promise<boolean>; disk?: typeof statfs; progress?: (line: string) => void }

async function daemonRunning(home: string) {
  const config = await readConfig(home);
  const state = await Bun.file(join(home, "daemon.json")).json().catch(() => null);
  const port = state?.port ?? config.port;
  return fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
}

export const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return !path || !path.startsWith("..") && !isAbsolute(path);
};
const overlap = (a: string, b: string) => inside(a, b) || inside(b, a);

async function exists(path: string) { return !!await lstat(path).catch(() => null); }
// Symlinks can make lexically separate paths the same place on disk.
export async function physical(path: string): Promise<string> {
  const real = await realpath(path).catch(() => null);
  return real ?? (dirname(path) === path ? path : join(await physical(dirname(path)), basename(path)));
}

// Sockets and FIFOs are runtime endpoints of stopped processes, so they are neither copied nor compared.
async function walk(root: string, visit: (path: string, stats: Stats) => Promise<void>, path = "") {
  // A category that is itself a symlink (a manual move) is followed so its contents move.
  const stats = path ? await lstat(join(root, path)) : await stat(root);
  if (!stats.isDirectory() && !stats.isFile() && !stats.isSymbolicLink()) return;
  await visit(path, stats);
  if (stats.isDirectory()) for (const name of (await readdir(join(root, path))).sort()) await walk(root, visit, path ? join(path, name) : name);
}

async function size(root: string) {
  let bytes = 0;
  await walk(root, async (_, stats) => { if (stats.isFile()) bytes += stats.size; });
  return bytes;
}

async function copyTree(source: string, target: string) {
  const directories: [string, Stats][] = [];
  await walk(source, async (path, stats) => {
    const to = join(target, path);
    if (stats.isDirectory()) { await mkdir(to, { mode: 0o700 }); directories.push([to, stats]); return; }
    if (stats.isSymbolicLink()) {
      const link = await readlink(join(source, path));
      const type = process.platform === "win32" && (await stat(join(source, path)).catch(() => null))?.isDirectory() ? "junction" : undefined;
      await symlink(link, to, type);
      return;
    }
    await copyFile(join(source, path), to);
    await chmod(to, stats.mode & 0o777);
    await utimes(to, stats.atime, stats.mtime);
  });
  // Children need a writable parent, and writing them changes its time, so modes and times come last.
  for (const [path, stats] of directories.reverse()) { await chmod(path, stats.mode & 0o777); await utimes(path, stats.atime, stats.mtime); }
}

async function digest(root: string) {
  const entries: string[] = [];
  await walk(root, async (path, stats) => {
    if (stats.isDirectory()) entries.push(`d ${path} ${stats.mode & 0o777}`);
    else if (stats.isSymbolicLink()) entries.push(`l ${path} ${await readlink(join(root, path))}`);
    else {
      const hasher = new Bun.CryptoHasher("sha256");
      for await (const chunk of Bun.file(join(root, path)).stream()) hasher.update(chunk);
      entries.push(`f ${path} ${stats.size} ${stats.mode & 0o777} ${hasher.digest("hex")}`);
    }
  });
  return entries.join("\n");
}

async function freeBytes(path: string, disk: typeof statfs) {
  let existing = path;
  while (!await exists(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const space = await disk(existing);
  return Number(space.bavail) * Number(space.bsize);
}

export async function moveData(home: string, directory: string, options: MoveOptions = {}) {
  const config = await readConfig(home);
  const from = await openDataRoot(home, config);
  const to = resolve(directory);
  if (to === from) return { moved: false, dataDir: to, pebbles: [] as string[], bytes: 0 };
  const [fromPebbles, toPebbles] = [join(from, "pebbles"), join(to, "pebbles")];
  if (inside(fromPebbles, toPebbles) || inside(toPebbles, fromPebbles) || inside(join(home, "pebbles"), to)) {
    throw new BedrockError("INVALID_DATA_DIR", "The new data directory overlaps the current pebble directories.", "Choose a directory outside BEDROCK_HOME/pebbles and the current data directory, e.g. /data/bedrock.");
  }
  if (await (options.running ?? daemonRunning)(home)) {
    throw new BedrockError("DAEMON_RUNNING", "Pebble data can only move while the daemon is stopped.", process.platform === "linux" ? "Run systemctl --user stop bedrock, retry, then systemctl --user start bedrock." : "Stop the Bedrock service or daemon, retry, then start it again.");
  }
  const entries = await readdir(fromPebbles, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() || entry.isSymbolicLink() && (await stat(join(fromPebbles, entry.name))).isDirectory()) names.push(entry.name);
  }
  names.sort();
  const moves = [];
  for (const name of names) for (const category of categories) {
    const source = join(fromPebbles, name, category);
    if (!await exists(source)) continue;
    const target = join(toPebbles, name, category);
    moves.push({ name, source, target, real: await physical(source), copied: await exists(target) });
  }
  // Every target is checked against every source before anything is removed or written.
  for (const move of moves) for (const path of [move.target, `${move.target}.partial`]) {
    const real = await physical(path);
    const shared = moves.find(other => overlap(other.real, real));
    if (shared) throw new BedrockError("INVALID_DATA_DIR", `${path} and ${shared.source} are the same place on disk.`, "Choose a target directory that does not share files with the current pebble data through symlinks.");
  }
  let bytes = 0;
  for (const move of moves) if (!move.copied) bytes += await size(move.source);
  const free = await freeBytes(to, options.disk ?? statfs);
  if (free < bytes) throw new BedrockError("DATA_DIR_FULL", `The new data directory needs ${bytes} bytes but has ${free} free.`, "Free space on the target disk or choose another directory.");
  await mkdir(toPebbles, { recursive: true, mode: 0o700 });
  for (const move of moves) {
    options.progress?.(`Copying ${move.source}`);
    const expected = await digest(move.source);
    // A completed copy from an interrupted earlier run is accepted only when identical.
    if (move.copied) {
      if (await digest(move.target) === expected) continue;
      throw new BedrockError("DATA_DIR_NOT_EMPTY", `${move.target} already exists with different contents.`, "Remove or rename it after checking it is a stale copy, then retry.");
    }
    const partial = `${move.target}.partial`;
    await rm(partial, { recursive: true, force: true });
    await mkdir(dirname(partial), { recursive: true, mode: 0o700 });
    await copyTree(move.source, partial);
    if (await digest(partial) !== expected) throw new BedrockError("DATA_COPY_MISMATCH", `The copy of ${move.source} does not match its source.`, "Check the target disk for errors, then retry; the current data directory is unchanged.");
    await rename(partial, move.target);
  }
  if (to === home) delete config.dataDir;
  else config.dataDir = to;
  await atomicWrite(join(home, "config.json"), JSON.stringify(config, null, 2) + "\n");
  return {
    moved: true, from, dataDir: to, pebbles: names, bytes,
    hint: `Start the daemon and check your pebbles. The old copy stays in ${fromPebbles} (each pebble's data/ and logs/) until you remove it.`,
  };
}
