import { stat, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { diskFull } from "./error";

export const DISK_MARGIN = 64 * 1024 ** 2;
export async function diskSpace(path: string, inspect = statfs) {
  const space = await inspect(path);
  const free = Number(space.bavail) * Number(space.bsize);
  const total = Number(space.blocks) * Number(space.bsize);
  return { path, free, total, warning: free < 1024 ** 3 || free < total * 0.05 };
}

export async function requireSpace(path: string, bytes: number, inspect = statfs) {
  const space = await diskSpace(path, inspect);
  if (space.free < bytes + DISK_MARGIN) throw diskFull(path);
}

export async function snapshotSpace(databasePath: string, inspect = statfs) {
  const size = async (path: string) => {
    try { return (await stat(path)).size; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  };
  const [db, wal] = await Promise.all([size(databasePath), size(databasePath + "-wal")]);
  // Keep room for both the SQLite copy and incompressible gzip output.
  await requireSpace(dirname(databasePath), 2 * (db + wal), inspect);
}
