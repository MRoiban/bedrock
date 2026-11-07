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
    if (name === current || !(await stat(join(path, "complete.json")).catch(() => null))?.isFile()) continue;
    const info = await stat(join(path, "complete.json"));
    runs.push({ path, time: info.mtimeMs, size: await bytes(path) });
  }
  runs.sort((a, b) => a.time - b.time);
  const currentBytes = await bytes(join(root, current));
  let total = currentBytes + runs.reduce((sum, run) => sum + run.size, 0);
  const removed: string[] = [];
  for (const run of runs) if (now - run.time > 7 * 86_400_000 || total > budget) {
    await rm(run.path, { recursive: true, force: true });
    total -= run.size;
    removed.push(run.path);
  }
  return { removed, bytes: total, overBudget: total > budget };
}
