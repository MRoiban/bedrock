import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../../test/helpers";
import { AlertStore } from "./store";
import { AlertEvaluator } from "./evaluator";
import { deliver } from "./delivery";
import { fingerprint, isQuiet, type Snapshot, type PebbleCheck } from "./model";
import { nextRun } from "./jobs";

const pebble = (name = "notes", readiness: PebbleCheck["readiness"] = "ready"): PebbleCheck => ({ name, readiness, status: readiness === "idle" ? "idle" : "running", release: "r1", jobs: [{ name: "sync", cron: "* * * * *" }] });
function harness() {
  const temp = tempDirectory();
  let now = new Date("2026-11-03T12:00:00Z").getTime();
  const store = new AlertStore(join(temp.dir, "alerts.sqlite"), "example.test", () => now);
  store.db.query("INSERT INTO meta VALUES('digest-day',?)").run("2026-11-3");
  const evaluator = new AlertEvaluator(store, { notes: ["sync"] });
  const snapshot: Snapshot = { pebbles: [pebble()], tunnel: true };
  return { temp, store, evaluator, snapshot, now: () => now, advance: (ms: number) => { now += ms; }, close() { store.close(); temp.cleanup(); } };
}
test("probe hysteresis, prolonged readiness and crash loops page once; idle and single failures do not", () => {
  const h = harness();
  try {
    h.snapshot.pebbles = [pebble("notes", "failed"), pebble("idle", "idle")];
    h.evaluator.evaluate(h.snapshot);
    expect(h.store.pending()).toHaveLength(0);
    h.snapshot.pebbles[0]!.readiness = "ready";
    h.advance(30000); h.evaluator.evaluate(h.snapshot);
    h.snapshot.pebbles[0]!.readiness = "failed";
    for (let i = 0; i < 5; i++) { h.advance(30000); h.evaluator.evaluate(h.snapshot); }
    expect(h.store.open().filter(i => i.rule === "readiness")).toHaveLength(1);
    h.advance(30000); h.evaluator.evaluate(h.snapshot);
    expect(h.store.pending().filter(i => i.transition === "opened")).toHaveLength(1);
    h.snapshot.pebbles[0]!.readiness = "ready";
    h.evaluator.evaluate(h.snapshot);
    expect(h.store.open()).toHaveLength(1);
    h.advance(30000); h.evaluator.evaluate(h.snapshot);
    h.advance(30000);
    expect(h.store.pending().map(i => i.transition)).toEqual(["opened", "resolved"]);
    h.snapshot.pebbles[0]!.status = "crashed";
    h.evaluator.evaluate(h.snapshot);
    expect(h.store.open()).toHaveLength(1);
  } finally { h.close(); }
});
test("daemon deadlines detect missing starts, over-budget runs, failed critical jobs and one restart gap without replay", () => {
  const h = harness();
  try {
    h.evaluator.evaluate(h.snapshot);
    h.advance(360001); h.evaluator.evaluate(h.snapshot);
    h.evaluator.evaluate(h.snapshot);
    expect(h.store.open()).toHaveLength(1);
    expect(h.store.history("notes")).toHaveLength(0);
    const event = { name: "sync", run: "a", state: "succeeded" as const, at: h.now(), scheduled: null };
    h.evaluator.jobs.event("notes", event);
    h.evaluator.jobs.event("ordinary", { ...event, state: "failed" });
    expect(h.store.open().filter(i => i.page)).toHaveLength(0);
    h.evaluator.jobs.event("notes", { ...event, run: "b", state: "started" });
    h.advance(600001); h.evaluator.evaluate(h.snapshot);
    expect(h.store.open().filter(i => i.page)).toHaveLength(1);
    h.evaluator.jobs.interrupt("notes");
    h.evaluator.jobs.interrupt("notes");
    expect(h.store.history("notes").filter((r: any) => r.state === "interrupted")).toHaveLength(1);
    h.advance(30000);
    expect(h.store.pending().filter(i => i.incident)).toHaveLength(3);
  } finally { h.close(); }
});
test("30s grouping, child inhibition under tunnel failure, silences expire and unrelated data incidents survive", async () => {
  const h = harness(), calls: any[] = [];
  const fetcher = (async (_: any, init: any) => { calls.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); }) as typeof fetch;
  await Bun.write(join(h.temp.dir, "alerts-secret"), "test");
  try {
    h.snapshot.tunnel = false;
    h.snapshot.pebbles[0]!.status = "crashed";
    h.evaluator.evaluate(h.snapshot);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls).toHaveLength(0);
    h.advance(30000);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls.map(c => c.metadata.rule)).toEqual(["tunnel"]);
    const fp = fingerprint("example.test", "notes", "backup-age");
    h.store.silence(fp, h.now() + 60000);
    h.store.condition("notes", "backup-age", true);
    h.advance(30000); await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls).toHaveLength(1);
    h.advance(30000); await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls.at(-1).metadata.rule).toBe("backup-age");
    h.snapshot.pebbles[0]!.status = "running";
    h.evaluator.evaluate(h.snapshot); h.evaluator.evaluate(h.snapshot);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    const rows = (h.store.view().outbox as any[]).filter(r => r.incident && r.incident !== calls[0].metadata.incident_id);
    expect(rows.some(r => r.state === "suppressed")).toBe(true);
  } finally { h.close(); }
});
test("backup age uses per-target success and persistent initial grace, recovers once", () => {
  const h = harness();
  try {
    h.snapshot.backup = { interval: 3600000, successes: { _daemon: h.now() - 7200001, notes: null } };
    h.evaluator.evaluate(h.snapshot); h.evaluator.evaluate(h.snapshot);
    expect(h.store.open().map(i => i.rule)).toEqual(["backup-age"]);
    h.snapshot.backup.successes._daemon = h.now();
    h.evaluator.evaluate(h.snapshot);
    h.advance(30000);
    expect(h.store.pending().map(r => r.transition)).toEqual(["opened", "resolved"]);
  } finally { h.close(); }
});
test("critical escalation at 15m and reminders at most every 6h bypass quiet hours", async () => {
  const h = harness(), calls: any[] = [];
  const fetcher = (async (_: any, init: any) => { calls.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); }) as typeof fetch;
  await Bun.write(join(h.temp.dir, "alerts-secret"), "test");
  try {
    h.store.condition("", "tunnel", true); h.advance(30000);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    h.advance(900000); h.evaluator.evaluate({ pebbles: [], tunnel: false }); h.advance(30000);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls.map(c => c.channels)).toEqual([["ntfy"], ["ntfy", "email"]]);
    h.evaluator.evaluate({ pebbles: [], tunnel: false });
    expect(h.store.pending()).toHaveLength(0);
    expect(isQuiet(Date.parse("2026-11-03T22:00:00Z"))).toBe(true);
    expect(isQuiet(Date.parse("2026-11-04T06:29:00Z"))).toBe(true);
    expect(isQuiet(Date.parse("2026-11-04T06:30:00Z"))).toBe(false);
    h.advance(Date.parse("2026-11-03T22:30:00Z") - h.now());
    h.evaluator.evaluate({ pebbles: [], tunnel: false }); h.advance(30000);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls).toHaveLength(3);
    h.advance(9 * 3600000); h.evaluator.evaluate({ pebbles: [], tunnel: false }); h.advance(30000);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls.filter(c => c.metadata.rule === "tunnel")).toHaveLength(4);
  } finally { h.close(); }
});
test("weekly digest and unhealthy daily digest are durable and ordinary job failures never page", () => {
  const h = harness();
  try {
    h.store.db.exec("DELETE FROM meta WHERE key='digest-day'");
    h.evaluator.jobs.event("notes", { name: "normal", run: "a", state: "failed", at: h.now(), scheduled: null });
    expect(h.store.pending()).toHaveLength(0);
    h.evaluator.evaluate(h.snapshot); h.advance(30000);
    expect(h.store.pending().map(r => r.transition)).toEqual(["digest"]);
    h.evaluator.evaluate(h.snapshot);
    expect(h.store.pending()).toHaveLength(1);
  } finally { h.close(); }
});
test("cron expected occurrences follow server local schedules and leap days", () => {
  expect(new Date(nextRun("* * * * *", Date.parse("2026-11-03T12:00:22Z"))).toISOString()).toBe("2026-11-03T12:01:00.000Z");
  expect(nextRun("0 0 29 2 *", new Date(2025, 2, 1).getTime())).toBe(new Date(2028, 1, 29).getTime());
});

test("inhibited children cannot starve unrelated data alerts behind the delivery batch limit", async () => {
  const h = harness(), rules: string[] = [];
  await Bun.write(join(h.temp.dir, "alerts-secret"), "test");
  try {
    h.store.condition("", "tunnel", true);
    for (let i = 0; i < 24; i++) h.store.condition(`child-${i}`, "readiness", true);
    h.store.condition("notes", "backup-age", true);
    h.advance(30000);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", (async (_: any, init: any) => {
      rules.push(JSON.parse(init.body).metadata.rule); return new Response(null, { status: 202 });
    }) as typeof fetch);
    expect(rules).toEqual(["tunnel", "backup-age"]);
  } finally { h.close(); }
});
test("healthy Monday produces one weekly digest, persisted across an evaluator restart", () => {
  const h = harness();
  try {
    h.advance(new Date(2026, 10, 9, 8).getTime() - h.now());
    const healthy: Snapshot = { tunnel: null, pebbles: [] };
    h.evaluator.evaluate(healthy); h.evaluator.evaluate(healthy);
    const restarted = new AlertEvaluator(h.store); restarted.evaluate(healthy);
    h.advance(30000);
    const messages = h.store.pending();
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0]!.payload).channels).toEqual(["email"]);
    h.advance(86400000); restarted.evaluate(healthy);
    expect(h.store.pending()).toHaveLength(1);
  } finally { h.close(); }
});

test("open incidents and pending delivery remain visible ahead of a long resolved history", () => {
  const h = harness();
  try {
    h.store.condition("", "tunnel", true);
    const open = h.store.open()[0]!;
    h.store.db.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1001)
      INSERT INTO incidents SELECT 'recent-'||x,'fp-'||x,'','tunnel','',2000000000000,2000000000001,NULL,NULL,1 FROM n;`);
    expect((h.store.view().incidents[0] as any).id).toBe(open.id);
    expect(h.store.view().incidents).toHaveLength(1000);
  } finally { h.close(); }
});
