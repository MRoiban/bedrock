import { expect, test } from "bun:test";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { tempDirectory } from "./helpers";
import { startDaemon } from "../src/daemon";
import { atomicWrite, setup } from "../src/daemon/config";
import { setupAlerts } from "../src/daemon/alerts/config";
import type { Snapshot } from "../src/daemon/alerts/model";

test("temp-home daemon injects all page rules, keeps one transition key across restart/retry, inhibits children, and obeys quiet hours", async () => {
  const temp = tempDirectory(), home = join(temp.dir, "home");
  let now = Date.parse("2026-11-03T12:00:00Z"), failing = true;
  const calls: { key: string; payload: any }[] = [];
  const receiver = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    expect(request.headers.get("authorization")).toBe("Bearer test-only");
    const payload = await request.json();
    calls.push({ key: request.headers.get("idempotency-key")!, payload });
    return new Response(null, { status: failing ? 503 : 202 });
  } });
  await setup(home, "example.test", "owner@example.test", 0);
  await setupAlerts(home, "test-only", `${receiver.url}api/v1/messages`);
  const config = await Bun.file(join(home, "config.json")).json();
  config.alerts.criticalJobs = { notes: ["sync"] };
  await atomicWrite(join(home, "config.json"), JSON.stringify(config));
  let daemon = await startDaemon({ home, telemetryForTests: false, alertsClockForTests: () => now });
  const snapshot: Snapshot = { tunnel: true, pebbles: [{ name: "notes", status: "running", readiness: "ready", release: "r1", jobs: [{ name: "sync", cron: "* * * * *" }] }, { name: "idle", status: "idle", readiness: "idle", release: "r1" }] };
  const view = () => daemon.alerts.view();
  const pageRows = async () => (await view()).outbox.filter((r: any) => r.incident && r.transition === "opened");
  try {
    expect((await stat(join(home, "alerts-secret"))).mode & 0o777).toBe(0o600);
    await view();
    await daemon.alerts.snapshotForTests(snapshot);
    snapshot.pebbles[0]!.readiness = "failed";
    now += 30000; await daemon.alerts.snapshotForTests(snapshot);
    expect(await pageRows()).toHaveLength(0);
    snapshot.pebbles[0]!.readiness = "ready";
    now += 30000; await daemon.alerts.snapshotForTests(snapshot);
    daemon.alerts.job("notes", { name: "ordinary", state: "failed", run: "noise", at: now, scheduled: null });
    expect(await pageRows()).toHaveLength(0);
    snapshot.pebbles[0]!.status = "crashed";
    snapshot.tunnel = false;
    snapshot.backup = { interval: 3600000, successes: { _daemon: now - 7200001 } };
    await daemon.alerts.snapshotForTests(snapshot);
    daemon.alerts.job("notes", { name: "sync", state: "failed", run: "critical", at: now, scheduled: null });
    expect(await pageRows()).toHaveLength(4);
    await daemon.alerts.dispatchForTests();
    expect(calls).toHaveLength(0);
    now += 30000; await daemon.alerts.dispatchForTests();
    expect(calls.filter(c => c.payload.metadata.rule === "readiness")).toHaveLength(0);
    const originalKeys = new Set(calls.map(c => c.key));
    expect(originalKeys.size).toBe(calls.length);
    expect((await view()).outbox.filter((r: any) => r.attempts > 0).every((r: any) => r.state === "pending")).toBe(true);
    now += 600001; await daemon.alerts.dispatchForTests();
    expect((await view()).incidents.filter((i: any) => i.rule === "alert-delivery" && i.resolved === null)).toHaveLength(1);
    expect(await pageRows()).toHaveLength(4);
    const attemptsBeforeRestart = calls.length;
    await daemon.stop();
    daemon = await startDaemon({ home, telemetryForTests: false, alertsClockForTests: () => now });
    await view(); failing = false; now += 2000;
    await daemon.alerts.dispatchForTests();
    expect(calls.length).toBe(attemptsBeforeRestart + originalKeys.size);
    for (const key of originalKeys) expect(new Set(calls.filter(c => c.key === key).map(c => JSON.stringify(c.payload))).size).toBe(1);
    expect((await view()).outbox.filter((r: any) => originalKeys.has(r.id)).every((r: any) => r.state === "accepted")).toBe(true);
    // Re-submit identical snapshots after restart: each episode still has a single open transition.
    await daemon.alerts.snapshotForTests(snapshot);
    expect(await pageRows()).toHaveLength(4);
    snapshot.tunnel = true; snapshot.pebbles[0]!.status = "running";
    snapshot.backup.successes._daemon = now;
    await daemon.alerts.snapshotForTests(snapshot); await daemon.alerts.snapshotForTests(snapshot);
    daemon.alerts.job("notes", { name: "sync", state: "succeeded", run: "repair", at: now, scheduled: null });
    now += 30000; await daemon.alerts.dispatchForTests();
    const transitions = (await view()).outbox.filter((r: any) => r.incident);
    expect(transitions.filter((r: any) => r.transition === "resolved")).toHaveLength(4);
    expect(new Set(transitions.map((r: any) => r.id)).size).toBe(8);
    // A new outage at night remains in the outbox until 07:30 Brussels.
    now = Date.parse("2026-11-03T22:10:00Z");
    await daemon.alerts.snapshotForTests({ ...snapshot, tunnel: false });
    now += 30000;
    const count = calls.length; await daemon.alerts.dispatchForTests(); expect(calls).toHaveLength(count);
    now = Date.parse("2026-11-04T06:30:00Z");
    await daemon.alerts.dispatchForTests(); expect(calls.length).toBeGreaterThan(count);
    const canary = await fetch(new URL("healthz", daemon.server.url), { headers: { host: "bedrock.example.test" }, redirect: "manual" });
    expect(canary.status).toBe(200); expect(canary.headers.get("cache-control")).toContain("no-store");
    expect(await canary.text()).toBe("bedrock-health-v1\n");
    const token = (await Bun.file(join(home, "admin-token")).text()).trim();
    const db = (await import("../src/daemon/db")).openDaemonDatabase;
    const authDb = await db(home);
    const scoped = authDb.createToken(undefined, { scope: { actions: ["status"], pebbles: ["notes"] } }); authDb.close();
    for (const path of ["api/alerts", "api/jobs/notes/history"]) {
      expect((await fetch(new URL(path, daemon.server.url), { headers: { authorization: `Bearer ${scoped}` } })).status).toBe(403);
      expect((await fetch(new URL(path, daemon.server.url), { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    }
  } finally { await daemon.stop(); await receiver.stop(true); temp.cleanup(); }
});

test("dev monitoring uses the resolved config without requiring a stored production config", async () => {
  const temp = tempDirectory();
  const daemon = await startDaemon({ home: join(temp.dir, "home"), dev: true, domain: "localhost", port: 0, telemetryForTests: false });
  try { expect((await daemon.alerts.view()).incidents).toEqual([]); }
  finally { await daemon.stop(); temp.cleanup(); }
});

test("persisted daemon deadlines turn days of missed critical runs into one restart gap without replay", async () => {
  const temp = tempDirectory(), home = join(temp.dir, "home");
  await setup(home, "example.test", undefined, 0);
  const config = await Bun.file(join(home, "config.json")).json();
  config.alerts = { criticalJobs: { notes: ["sync"] } };
  await atomicWrite(join(home, "config.json"), JSON.stringify(config));
  let now = Date.parse("2026-11-03T12:00:00Z");
  let daemon = await startDaemon({ home, telemetryForTests: false, alertsClockForTests: () => now });
  const snapshot: Snapshot = { tunnel: null, pebbles: [{ name: "notes", status: "running", readiness: "ready", release: "r1", jobs: [{ name: "sync", cron: "* * * * *" }] }] };
  try {
    await daemon.alerts.snapshotForTests(snapshot);
    await daemon.stop(); now += 3 * 86400000;
    daemon = await startDaemon({ home, telemetryForTests: false, alertsClockForTests: () => now });
    await daemon.alerts.snapshotForTests(snapshot); await daemon.alerts.snapshotForTests(snapshot);
    const view = await daemon.alerts.view();
    expect(view.incidents.filter((i: any) => i.page && i.job === "sync")).toHaveLength(1);
    expect(view.outbox.filter((r: any) => r.incident)).toHaveLength(1);
    expect(await daemon.alerts.history("notes")).toEqual([]);
  } finally { await daemon.stop(); temp.cleanup(); }
});
