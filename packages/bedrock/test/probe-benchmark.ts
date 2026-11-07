import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setup } from "../src/daemon/config";
import { openDaemonDatabase } from "../src/daemon/db";
import { Supervisor } from "../src/daemon/supervisor";
import { Alerts } from "../src/daemon/alerts";

// Keep the monitoring store on the checkout's disk; TMPDIR may be a RAM filesystem.
const home = await mkdtemp(join(process.cwd(), ".bedrock-probe-bench-"));
await setup(home, "example.test", undefined, 0);
const db = await openDaemonDatabase(home), supervisor = new Supervisor(home, db, "test", [], true);
try {
  for (let i = 0; i < 24; i++) {
    const name = `bench-${i}`, release = join(home, "pebbles", name, "releases", "r1");
    const source = resolve(import.meta.dir, "../src/index.ts");
    await Bun.write(join(release, "pebble.ts"), `import {definePebble} from ${JSON.stringify(source)}; export default definePebble({name:${JSON.stringify(name)}});`);
    db.save({ name, release, status: "running", previous_release: null });
    const child = await supervisor.launch(name, release); supervisor.activate(name, child);
    child.lastActive = 1;
  }
  const records = db.list();
  async function cycle() {
    let index = 0;
    const work = async () => {
      while (index < records.length) {
        const record = records[index++]!, child = supervisor.child(record.name)!;
        await supervisor.readiness(record.name, child);
        if (child.lastActive !== 1) throw new Error("A readiness probe reset application inactivity");
      }
    };
    await Promise.all([work(), work()]);
  }
  async function childCpu() {
    let sum = 0;
    for (const record of records) {
      const text = await Bun.file(`/proc/${supervisor.child(record.name)!.process.pid}/stat`).text();
      const parts = text.slice(text.lastIndexOf(")") + 2).split(" ");
      sum += Number(parts[11]) + Number(parts[12]);
    }
    return sum;
  }
  for (let i = 0; i < 5; i++) await cycle();
  const cpuBefore = process.cpuUsage(), rssBefore = process.memoryUsage().rss;
  const ticksBefore = await childCpu(), start = performance.now();
  for (let i = 0; i < 100; i++) await cycle();
  const elapsed = performance.now() - start, ticksAfter = await childCpu(), cpu = process.cpuUsage(cpuBefore);
  const rssAfter = process.memoryUsage().rss, beforeWorker = process.memoryUsage().rss;
  const alerts = new Alerts(home);
  try {
    await alerts.view();
    const afterWorker = process.memoryUsage().rss;
    const snapshot = { tunnel: null, pebbles: records.map(r => ({ name: r.name, release: r.release, status: "running", readiness: "ready" as const, jobs: [] })) };
    const evalCpu = process.cpuUsage(), evalStart = performance.now();
    for (let i = 0; i < 100; i++) await alerts.snapshotForTests(snapshot);
    const evalCost = process.cpuUsage(evalCpu);
    console.log(JSON.stringify({ pebbles: 24, concurrency: 2, cycles: 100, probes: 2400, elapsed_ms: elapsed,
      parent_cpu_ms: (cpu.user + cpu.system) / 1000, children_cpu_ms_at_100Hz: (ticksAfter - ticksBefore) * 10,
      parent_rss_before: rssBefore, parent_rss_after: rssAfter, worker_rss_delta: afterWorker - beforeWorker,
      evaluator_100_cycles_ms: performance.now() - evalStart, evaluator_100_cycles_cpu_ms: (evalCost.user + evalCost.system) / 1000,
      rss_with_alerts: process.memoryUsage().rss }));
  } finally { await alerts.close(); }
} finally { await supervisor.shutdown(); db.close(); await rm(home, { recursive: true, force: true }); }
