// Invoked only by hibernate.test.ts inside a fresh delegated systemd scope.
import { expect } from "bun:test";
import { open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { detectCgroups } from "../src/daemon/cgroups";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { openDaemonDatabase } from "../src/daemon/db";
import { tempDirectory } from "./helpers";

const cg = await detectCgroups();
if (!cg) process.exit(77);
if (process.argv.includes("--probe")) {
  const group = await cg.create("probe");
  if (!group) process.exit(77);
  try {
    const fd = await open(join(group.path, "memory.reclaim"), "w");
    try { await fd.write("0 swappiness=200"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error; }
    finally { await fd.close(); }
    const free = (await readFile("/proc/meminfo", "utf8")).match(/^SwapFree:\s+(\d+)/m)?.[1];
    if (Number(free) < 512 * 1024) process.exitCode = 77;
  } catch { process.exitCode = 77; }
  finally { await cg.remove(group); }
} else {
  const temp = tempDirectory(), home = join(temp.dir, "home"), release = join(home, "pebbles/sample/releases/kernel");
  process.env.BEDROCK_HOME = home;
  await setup(home, "example.test", "creator@example.test", 0);
  await Bun.write(join(release, "pebble.ts"), `import { definePebble, job, service } from ${JSON.stringify(join(import.meta.dir, "../src/index.ts"))};
const state = new Uint8Array(160 * 1024 * 1024); state.fill(123);
let ticks = 0;
export default definePebble({ name: "sample", access: "public",
 jobs: { tick: job("* * * * *", async () => { await Bun.write(process.env.BEDROCK_DATA + "/job-tick", String(Date.now())); }, { transaction: false }) },
 services: { heartbeat: service({ start() { const timer = setInterval(() => { ticks++; }, 50); return timer; }, stop(timer) { clearInterval(timer); } }) },
 routes: { "GET /": () => Response.json({ pid: process.pid, ticks, byte: state[0] }),
 "GET /walk": () => { let sum = 0; for (let i = 0; i < state.length; i += 4096) sum += state[i]; return Response.json({ sum, ticks }); } } });`);
  const db = await openDaemonDatabase(home);
  db.save({ name: "sample", release, previous_release: null, status: "running" }); db.close();
  const daemon = await startDaemon({ home, hibernateTimeoutForTests: 1500 });
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = async (path: string) => (await (await fetch(new URL(path, daemon.server.url), { headers: { authorization: `Bearer ${token}` } })).json()).value;
  const record = async () => (await api("/api/pebbles"))[0];
  const request = async (path = "/") => {
    const start = performance.now();
    const response = await fetch(new URL(path, daemon.server.url), { headers: { host: "sample.localhost" } });
    expect(response.status).toBe(200);
    const value = await response.json();
    return { ms: performance.now() - start, ...value };
  };
  const rss = async (pid: number) => Number((await readFile(`/proc/${pid}/status`, "utf8")).match(/^VmRSS:\s+(\d+)/m)?.[1]) * 1024;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const initial = await request();
    const before = await record(), beforeRss = await rss(initial.pid);
    expect(before.memory.resident).toBeGreaterThan(120 * 1024 ** 2);
    const membership = await readFile(`/proc/${initial.pid}/cgroup`, "utf8");
    expect(membership).toContain("/pebbles/sample-");
    let previous = performance.now(), lag = 0;
    timer = setInterval(() => { const now = performance.now(); lag = Math.max(lag, now - previous - 5); previous = now; }, 5);
    const deadline = Date.now() + 15000;
    let after = await record();
    while (after.memory.hibernated_at === null && Date.now() < deadline) { await Bun.sleep(20); after = await record(); }
    clearInterval(timer);
    expect(after.memory.hibernated_at).toBeNumber();
    const afterRss = await rss(initial.pid);
    expect(after.memory.swapped).toBeGreaterThan(100 * 1024 ** 2);
    expect(afterRss).toBeLessThan(beforeRss - 100 * 1024 ** 2);
    expect(lag).toBeLessThan(50);
    // Observe a real cron firing without HTTP/IPC touching the child or re-arming reclaim.
    const jobPath = join(home, "pebbles/sample/data/job-tick"), jobDeadline = Date.now() + 65000;
    let jobAt = 0;
    while (jobAt <= after.memory.hibernated_at && Date.now() < jobDeadline) {
      await Bun.sleep(100);
      jobAt = Number(await Bun.file(jobPath).text().catch(() => "0"));
    }
    expect(jobAt).toBeGreaterThan(after.memory.hibernated_at);
    expect((await record()).memory.hibernated_at).toBe(after.memory.hibernated_at);
    // Measure before status/CLI health probes can warm the child's runtime.
    const first = await request(), second = await request(), walk = await request("/walk");
    expect(first.pid).toBe(initial.pid);
    expect(first.ticks).toBeGreaterThan(initial.ticks + 20);
    expect(walk.sum).toBe(160 * 1024 * 1024 / 4096 * 123);
    expect((await record()).memory.hibernated_at).toBeNull();
    const status = await api("/api/status");
    expect(status.pebbles[0].memory).toMatchObject({ resident: expect.any(Number), swapped: expect.any(Number), hibernated_at: null });
    const cli = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/index.ts"), "status", "--json"], { env: { ...process.env, BEDROCK_HOME: home }, stdout: "pipe", stderr: "pipe" });
    const cliOutput = await new Response(cli.stdout).text();
    expect(await cli.exited).toBe(0);
    expect(JSON.parse(cliOutput).pebbles[0].memory).toMatchObject({ resident: expect.any(Number), swapped: expect.any(Number), hibernated_at: null });
    console.log("HIBERNATE_RESULT " + JSON.stringify({ before: { rss: beforeRss, ...before.memory }, after: { rss: afterRss, ...after.memory }, firstRequestMs: first.ms, secondRequestMs: second.ms, walkRequestMs: walk.ms, daemonMaxLagMs: lag, jobRanAt: jobAt, ticksBefore: initial.ticks, ticksAfter: first.ticks, pid: first.pid }));
  } finally {
    clearInterval(timer);
    await daemon.stop();
    // Exited children leave no process cgroup behind.
    await Bun.sleep(50);
    expect((await readdir(cg.root)).filter(name => name.startsWith("sample-"))).toEqual([]);
    temp.cleanup();
  }
}
