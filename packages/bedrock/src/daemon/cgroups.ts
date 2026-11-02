import { access, mkdir, readFile, readdir, rmdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";

export const QUIET_MEMORY_MS = 15 * 60_000;
const GiB = 1024 ** 3;
export const emptyMemory = { resident: null, swapped: null, hibernated_at: null };
export interface ChildCgroup { path: string; attempted: boolean; activity: number; hibernatedAt: number | null }
interface DetectionOptions { root?: string; proc?: string; platform?: string; dev?: boolean; log?: (message: string) => void }

export function meminfo(text: string, key: string) {
  const value = text.match(new RegExp(`^${key}:\\s+(\\d+) kB$`, "m"))?.[1];
  return value === undefined ? 0 : Number(value) * 1024;
}

export async function detectCgroups(options: DetectionOptions = {}): Promise<PebbleCgroups | undefined> {
  const log = options.log ?? console.warn;
  try {
    if ((options.platform ?? process.platform) !== "linux") throw new Error("Linux only");
    if (options.dev) throw new Error("development daemon");
    const proc = options.proc ?? "/proc";
    const membership = (await readFile(join(proc, "self/cgroup"), "utf8")).trim().match(/^0::(\/[^\n]*)$/)?.[1];
    if (!membership) throw new Error("cgroup v2 required");
    let root = join(options.root ?? "/sys/fs/cgroup", membership);
    // DelegateSubgroup places the service in a leaf; delegation belongs to its parent.
    if (basename(root) === "supervisor") root = dirname(root);
    const controllers = (await readFile(join(root, "cgroup.controllers"), "utf8")).split(/\s+/);
    if (!controllers.includes("memory")) throw new Error("memory controller unavailable");
    for (const file of ["cgroup.procs", "cgroup.subtree_control", "memory.reclaim"]) await access(join(root, file), constants.W_OK);
    await access(join(root, "memory.swap.current"), constants.R_OK);
    const memory = await readFile(join(proc, "meminfo"), "utf8");
    const high = Math.max(GiB, Math.floor(meminfo(memory, "MemTotal") / 4));
    await mkdir(join(root, "supervisor"), { recursive: true });
    // Older units/scopes start in the delegation root. Move all its processes,
    // including an inherited cloudflared, before enabling a domain controller.
    for (const pid of (await readFile(join(root, "cgroup.procs"), "utf8")).trim().split(/\s+/).filter(Boolean)) {
      try { await writeFile(join(root, "supervisor/cgroup.procs"), pid); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
    await writeFile(join(root, "cgroup.subtree_control"), "+memory");
    const pebbles = join(root, "pebbles");
    await mkdir(pebbles, { recursive: true });
    await writeFile(join(pebbles, "cgroup.subtree_control"), "+memory");
    const cgroups = new PebbleCgroups(pebbles, proc, high);
    await cgroups.clean();
    return cgroups;
  } catch (error) {
    log(`Pebble memory hibernation disabled: ${(error as Error).message}`);
    return;
  }
}

export class PebbleCgroups {
  private busy = false;
  private warned = false;
  constructor(readonly root: string, private readonly proc: string, readonly high: number) {}
  async clean() {
    for (const name of await readdir(this.root)) {
      if (/^[a-z0-9-]+-[a-f0-9-]{36}$/.test(name)) await rmdir(join(this.root, name)).catch(() => {});
    }
  }
  async create(name: string): Promise<ChildCgroup | undefined> {
    const path = join(this.root, `${name}-${crypto.randomUUID()}`);
    try {
      await mkdir(path);
      await writeFile(join(path, "memory.high"), String(this.high));
      return { path, attempted: false, activity: 0, hibernatedAt: null };
    } catch {
      await rmdir(path).catch(() => {});
      this.warn();
      return;
    }
  }
  async remove(group: ChildCgroup) { await rmdir(group.path).catch(() => {}); }
  command(group: ChildCgroup | undefined, command: string[]) {
    return group ? ["/bin/sh", "-c", 'echo $$ > "$0" && exec "$@"', join(group.path, "cgroup.procs"), ...command] : command;
  }
  activity(group?: ChildCgroup) {
    if (!group) return;
    group.activity++;
    group.attempted = false;
    group.hibernatedAt = null;
  }
  async status(group?: ChildCgroup) {
    if (!group) return { ...emptyMemory };
    try {
      const [resident, swapped] = await Promise.all(["memory.current", "memory.swap.current"].map(file => readFile(join(group.path, file), "utf8").then(Number)));
      if (!Number.isFinite(resident) || !Number.isFinite(swapped)) return { ...emptyMemory };
      return { resident: resident!, swapped: swapped!, hibernated_at: group.hibernatedAt };
    } catch { return { ...emptyMemory }; }
  }
  async hibernate(group: ChildCgroup, quiet: () => boolean) {
    if (this.busy || group.attempted || !quiet()) return;
    this.busy = true;
    try {
      const [stat, memory] = await Promise.all([readFile(join(group.path, "memory.stat"), "utf8"), readFile(join(this.proc, "meminfo"), "utf8")]);
      const anon = Number(stat.match(/^anon (\d+)$/m)?.[1] ?? 0);
      // Budget uncompressed bytes, reserving at least 256 MiB for other users.
      if (!anon || meminfo(memory, "SwapFree") < anon + Math.max(256 * 1024 ** 2, anon / 4) || !quiet() || group.attempted) return;
      group.attempted = true;
      const activity = group.activity;
      await reclaim(group.path, anon);
      if (group.activity === activity) group.hibernatedAt = Date.now();
    } catch { this.warn(); }
    finally { this.busy = false; }
  }
  private warn() {
    if (!this.warned) console.warn("Pebble memory hibernation unavailable for a child; continuing without reclaim.");
    this.warned = true;
  }
}

function reclaim(path: string, bytes: number) {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("./reclaim-worker.ts", import.meta.url).href);
    const finish = (error?: unknown) => { worker.terminate(); error ? reject(error) : resolve(); };
    worker.onmessage = ({ data }: MessageEvent<string | null>) => finish(data);
    worker.onerror = event => { event.preventDefault(); finish(event.message); };
    worker.postMessage({ path: join(path, "memory.reclaim"), bytes });
  });
}
