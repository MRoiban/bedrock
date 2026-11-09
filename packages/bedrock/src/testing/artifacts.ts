import { lstat, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

async function bytes(path: string): Promise<number> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) return 0;
  if (!info.isDirectory()) return info.size;
  return (await Promise.all((await readdir(path)).map(name => bytes(join(path, name))))).reduce((sum, size) => sum + size, 0);
}

export async function pruneRuns(root: string, current: string, now = Date.now(), budget = 500 * 1024 ** 2) {
  const runs = [];
  for (const name of await readdir(root)) {
    const path = join(root, name);
    if (name === current) continue;
    const complete = await stat(join(path, "complete.json")).catch(() => null);
    const info = complete?.isFile() ? complete : await stat(path).catch(() => null);
    if (!info) continue;
    // Interrupted runs never write complete.json; count their bytes and reclaim them once
    // nothing has touched them for a day, so another live run is never deleted.
    const abandoned = !complete?.isFile() && now - info.mtimeMs > 86_400_000;
    runs.push({ path, time: info.mtimeMs, size: await bytes(path), removable: !!complete?.isFile() || abandoned });
  }
  runs.sort((a, b) => a.time - b.time);
  const currentBytes = await bytes(join(root, current));
  let total = currentBytes + runs.reduce((sum, run) => sum + run.size, 0);
  const removed: string[] = [];
  for (const run of runs) if (run.removable && (now - run.time > 7 * 86_400_000 || total > budget)) {
    await rm(run.path, { recursive: true, force: true });
    total -= run.size;
    removed.push(run.path);
  }
  return { removed, bytes: total, overBudget: total > budget };
}
