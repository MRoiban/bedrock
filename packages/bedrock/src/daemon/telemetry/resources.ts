import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Record, Resource } from "./model";
export interface ResourceGroup { pebble: string; paths: string[] }
const baselines = new Map<string, { cpu: number; oom: number; time: number }>();
export async function sampleResources(groups: ResourceGroup[]): Promise<Record[]> {
  const live = new Set(groups.flatMap(group => group.paths));
  for (const path of baselines.keys()) if (!live.has(path)) baselines.delete(path);
  return Promise.all(groups.map(async group => {
    let value: Resource = { resident: null, swap: null, cpu_us: null, oom_kills: null, source: null, interval_ms: 0, cpu_percent: null };
    if (group.paths.length) try {
      const samples = await Promise.all(group.paths.map(async path => {
        const [memory, swap, cpu, events] = await Promise.all(["memory.current", "memory.swap.current", "cpu.stat", "memory.events"].map(file => readFile(join(path, file), "utf8")));
        const usage = Number(cpu!.match(/^usage_usec (\d+)$/m)?.[1]);
        const oom = Number(events!.match(/^oom_kill (\d+)$/m)?.[1]);
        const time = Date.now();
        const previous = baselines.get(path); baselines.set(path, { cpu: usage, oom, time });
        if (![Number(memory), Number(swap), usage, oom].every(Number.isFinite)) throw new Error("Invalid cgroup sample");
        return { elapsed: previous ? time - previous.time : 0, memory: Number(memory), swap: Number(swap), cpu: previous && usage >= previous.cpu ? usage - previous.cpu : null, oom: previous && oom >= previous.oom ? oom - previous.oom : null };
      }));
      value = { resident: samples.reduce((n, s) => n + s.memory, 0), swap: samples.reduce((n, s) => n + s.swap, 0),
        cpu_us: samples.every(s => s.cpu !== null) ? samples.reduce((n, s) => n + s.cpu!, 0) : null,
        oom_kills: samples.every(s => s.oom !== null) ? samples.reduce((n, s) => n + s.oom!, 0) : null, source: "cgroup", interval_ms: Math.min(...samples.map(s => s.elapsed)), cpu_percent: samples.every(s => s.cpu !== null && s.elapsed > 0) ? samples.reduce((n, s) => n + s.cpu! / (s.elapsed * 10), 0) : null };
    } catch {}
    return { kind: "resources", pebble: group.pebble, time: Date.now(), value };
  }));
}
