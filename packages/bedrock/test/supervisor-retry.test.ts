import { expect, test } from "bun:test";
import { Supervisor, restartTiming, type Child } from "../src/daemon/supervisor";
import { openDaemonDatabase } from "../src/daemon/db";
import { preferPebbleOom } from "../src/daemon/oom";
import { tempDirectory } from "./helpers";

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Supervisor did not reach expected state");
    await Bun.sleep(5);
  }
}
async function fixture(capMs = 20) {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(temp.dir);
  let now = 0;
  const timing = { ...restartTiming, baseMs: 1, fastCapMs: 5, capMs, stableMs: 100, now: () => now, random: () => 0 };
  class FakeSupervisor extends Supervisor {
    attempts = 0;
    fail = 0;
    crashes = 0;
    override async launch(): Promise<Child> {
      this.attempts++;
      if (this.fail-- > 0) throw new Error("fake startup failure");
      const crash = this.crashes-- > 0;
      const child = Bun.spawn([process.execPath, "-e", `setInterval(() => {}, 1000); process.on("message", () => process.exit(0)); ${crash ? 'setTimeout(() => process.exit(1), 40);' : ''}`], { stdin: "ignore", stdout: "pipe", stderr: "pipe", ipc() {} });
      return { process: child, started: now, release: temp.dir, releaseId: "fake", port: 0, reading: Promise.resolve(), requests: 0, lastActive: now, idleSafe: false, access: "public", publicRoutes: [], exclusiveServices: [] };
    }
  }
  const supervisor = new FakeSupervisor(temp.dir, db, "test", [], false, temp.dir, 15 * 60_000, timing);
  db.save({ name: "fake", release: temp.dir, previous_release: null, status: "running" });
  return { db, supervisor, timing, advance: (ms: number) => { now += ms; }, async cleanup() { await supervisor.shutdown(); db.close(); temp.cleanup(); } };
}

test("supervisor recovers after more than five failures and resets after a stable run", async () => {
  const h = await fixture();
  try {
    await h.supervisor.start(h.db.get("fake")!);
    h.supervisor.fail = 6;
    h.supervisor.child("fake")!.process.kill();
    await until(() => h.supervisor.attempts === 8 && h.db.get("fake")?.status === "running");
    h.timing.baseMs = 100;
    h.timing.fastCapMs = 1000;
    h.advance(100);
    h.supervisor.child("fake")!.process.kill();
    await until(() => h.db.get("fake")?.status === "restarting");
    expect(h.supervisor.nextRetryAt("fake")).toBeCloseTo(280);
  } finally { await h.cleanup(); }
});

test("stop cancels a long crashed backoff and crashed records retry at boot", async () => {
  const h = await fixture(1000);
  try {
    h.db.status("fake", "crashed");
    h.supervisor.fail = 10;
    await h.supervisor.restore();
    await until(() => h.db.get("fake")?.status === "crashed");
    expect(h.supervisor.nextRetryAt("fake")).toBe(900);
    const launches = h.supervisor.attempts;
    await h.supervisor.stop("fake");
    expect(h.supervisor.nextRetryAt("fake")).toBeNull();
    await Bun.sleep(950);
    expect(h.supervisor.attempts).toBe(launches);
    expect(h.db.get("fake")?.status).toBe("stopped");
  } finally { await h.cleanup(); }
});

test.skipIf(process.platform !== "linux")("pebble oom score is raised without changing the daemon score", async () => {
  const before = Number(await Bun.file("/proc/self/oom_score_adj").text());
  const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" });
  try {
    await preferPebbleOom(child.pid);
    expect(Number(await Bun.file(`/proc/${child.pid}/oom_score_adj`).text())).toBe(Math.min(1000, before + 500));
    expect(Number(await Bun.file("/proc/self/oom_score_adj").text())).toBe(before);
  } finally { child.kill(); await child.exited; }
});

test("a fake pebble that crashes seven times eventually stays running", async () => {
  const h = await fixture();
  try {
    h.supervisor.crashes = 7;
    await h.supervisor.start(h.db.get("fake")!);
    await until(() => h.supervisor.attempts === 8 && h.db.get("fake")?.status === "running");
    await Bun.sleep(100);
    expect(h.supervisor.child("fake")?.process.exitCode).toBeNull();
    expect(h.supervisor.attempts).toBe(8);
  } finally { await h.cleanup(); }
});

test("failed crash logging cannot stop boot recovery", async () => {
  const h = await fixture();
  try {
    h.db.status("fake", "crashed");
    h.supervisor.fail = 6;
    h.supervisor.logs("fake").write = () => { throw new Error("disk full"); };
    await h.supervisor.restore();
    await until(() => h.supervisor.attempts === 7 && h.db.get("fake")?.status === "running");
  } finally { await h.cleanup(); }
});
