import { readFile, writeFile } from "node:fs/promises";

export async function preferPebbleOom(pid: number) {
  if (process.platform !== "linux") return;
  try {
    const inherited = Number((await readFile("/proc/self/oom_score_adj", "utf8")).trim());
    if (!Number.isInteger(inherited)) return;
    await writeFile(`/proc/${pid}/oom_score_adj`, String(Math.min(1000, inherited + 500)));
  } catch { /* Restricted procfs or an already-exited child must not prevent startup. */ }
}
