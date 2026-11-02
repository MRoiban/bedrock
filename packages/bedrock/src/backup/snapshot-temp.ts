import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

// A killed daemon cannot run finally; reclaim its staging before checking space.
export async function cleanupSnapshots(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const match = /^\.bedrock-backup-(\d+)-/.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647) continue;
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
      await rm(join(directory, entry.name), { recursive: true, force: true });
    }
  }
}
