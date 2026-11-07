// Run manually: bun packages/bedrock/test/telemetry-bench.ts. No real Bedrock home is used.
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startDaemon } from "../src/daemon";
import { TelemetryStore } from "../src/daemon/telemetry/store";
import { emptyRed, type Record as TelemetryRecord } from "../src/daemon/telemetry/model";

if (process.argv[2] === "--daemon") {
  const home = process.argv[3]!, enabled = process.argv[4] === "on";
  const daemon = await startDaemon({ home, dev: true, domain: "localhost", port: 0, devPebble: { name: "bench", dir: join(home, "source") }, telemetryForTests: enabled });
  let baseline = process.cpuUsage(), last = performance.now(), lag = 0;
  const timer = setInterval(() => { const now = performance.now(); lag = Math.max(lag, now - last - 5); last = now; }, 5);
  process.on("message", async (message: { op: string }) => {
    if (message.op === "begin") { baseline = process.cpuUsage(); lag = 0; last = performance.now(); process.send?.({ op: "begun" }); }
    if (message.op === "end") { await Bun.sleep(1100); const cpu = process.cpuUsage(baseline); process.send?.({ op: "result", cpu_us: cpu.user + cpu.system, max_lag_ms: lag, drops: daemon.telemetry.drops("bench") }); }
    if (message.op === "stop") { clearInterval(timer); await daemon.stop(); process.exit(0); }
  });
  process.send?.({ op: "ready", port: daemon.server.port });
} else if (import.meta.main) {
  const root = await mkdtemp(join(process.cwd(), ".m1-bench-"));
  const output: object[] = [];
  try {
    if (process.argv[2] !== "--growth-only") for (const enabled of [false, true, true, false, false, true]) {
      const home = join(root, crypto.randomUUID());
      await Bun.write(join(home, "source/pebble.ts"), `import { definePebble } from ${JSON.stringify(resolve(import.meta.dir, "../src/index.ts"))};
let lines=0; export default definePebble({name:"bench",access:"public",routes:{"GET /":()=>new Response("ok"),"GET /count":()=>Response.json(lines),"GET /flood":()=>{setTimeout(async()=>{const end=performance.now()+3000;while(performance.now()<end){for(let i=0;i<1000;i++){console.log("flood line "+lines+" "+"x".repeat(100));lines++;}await Bun.sleep(0);}},0);return new Response("flooding");}}});`);
      const waiters = new Map<string, (message: any) => void>();
      const wait = (op: string) => new Promise<any>(resolve => waiters.set(op, resolve));
      const ready = wait("ready");
      const child = Bun.spawn([process.execPath, import.meta.path, "--daemon", home, enabled ? "on" : "off"], { ipc(message: any) { waiters.get(message.op)?.(message); waiters.delete(message.op); }, stdout: "ignore", stderr: "inherit" });
      try {
        const { port } = await ready;
        const request = async (path = "/") => { const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { host: "bench.localhost" } }); const text = await response.text(); if (!response.ok) throw new Error(text); return text; };
        const load = async (count: number) => {
          let cursor = 0; const latencies: number[] = [];
          const start = performance.now();
          await Promise.all(Array.from({ length: 16 }, async () => { while (cursor++ < count) { const begin = performance.now(); await request(); latencies.push(performance.now() - begin); } }));
          latencies.sort((a, b) => a - b); return { p50_ms: latencies[Math.ceil(count * .5) - 1], p99_ms: latencies[Math.ceil(count * .99) - 1], elapsed_ms: performance.now() - start };
        };
        await load(5000);
        await Bun.sleep(1100);
        let reply = wait("begun"); child.send({ op: "begin" }); await reply;
        const latency = await load(5000);
        reply = wait("result"); child.send({ op: "end" }); const cpu = await reply;
        output.push({ telemetry: enabled, requests: 5000, concurrency: 16, ...latency, ...cpu });
        if (enabled && output.length === 6) {
          reply = wait("begun"); child.send({ op: "begin" }); await reply;
          await request("/flood"); await Bun.sleep(3500);
          const lines = Number(await request("/count"));
          reply = wait("result"); child.send({ op: "end" });
          output.push({ scenario: "3s log flood", printed_lines: lines, ...await reply });
        }
      } finally { child.send({ op: "stop" }); await child.exited; }
    }
    if (process.argv[2] !== "--load-only") {
    const path = join(root, "growth.sqlite"), store = new TelemetryStore(path);
    const now = Date.now(), records: TelemetryRecord[] = [];
    let budgetDrops = 0;
    // 24 pebbles, each 1 request/s, 1 log/min and one resource sample/15s.
    const flush = () => { budgetDrops += store.write(records.splice(0), now).length; };
    for (let minute = 0; minute < 1440; minute++) for (let pebble = 0; pebble < 24; pebble++) {
      const time = now - 86400_000 + minute * 60000, name = `p${pebble}`;
      records.push({ kind: "metrics", pebble: name, time, traffic: "ordinary", value: { ...emptyRed(), starts: 60, completions: 60 } }, { kind: "logs", pebble: name, time, stream: "stdout", run: "run", text: "A normal application log entry " + "x".repeat(150) });
      for (let i = 0; i < 4; i++) records.push({ kind: "resources", pebble: name, time: time + i * 15000, value: { resident: 20000000, swap: 0, cpu_us: 100000, oom_kills: 0, source: "cgroup", interval_ms: 15000, cpu_percent: 100 / 150 } });
      // 1% successful diagnostic events at 1 request/s = 0.6 events/minute/pebble.
      if ((minute * 24 + pebble) % 5 < 3) records.push({ kind: "events", pebble: name, time, route: "/:segment", method: "GET", status: 200, outcome: "success", headers_s: .005, lifetime_s: .006 });
      if (records.length >= 250) flush();
    }
    flush();
    const firstDay = (await stat(path)).size;
    output.push({ scenario: "simulated day", pebbles: 24, requests_per_s_per_pebble: 1, logs_per_minute_per_pebble: 1, bytes: firstDay, dropped_records: budgetDrops, accounting: store.db.query("SELECT * FROM accounting").all() });
    // Hit the actual default log budget (not a scaled test budget) with capped 16KiB lines.
    for (let batch = 0; batch < 40; batch++) {
      budgetDrops += store.write(Array.from({ length: 256 }, (_, i) => ({ kind: "logs" as const, pebble: "p0", time: now, stream: "stdout", run: "run", text: `budget ${batch} ${i} ` + crypto.randomUUID().repeat(450).slice(0, 16000) })), now).length;
    }
    output.push({ scenario: "default budget", dropped_records: budgetDrops, retained_losses: store.db.query("SELECT reason,sum(count) AS count FROM losses GROUP BY reason").all(), bytes: (await stat(path)).size, accounting: store.db.query("SELECT * FROM accounting").all(), physical_limit: store.db.query("PRAGMA max_page_count").get(), wal_bytes: await stat(path + "-wal").then(s => s.size).catch(() => 0) });
    store.close();
    }
    console.log(JSON.stringify(output, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
}
