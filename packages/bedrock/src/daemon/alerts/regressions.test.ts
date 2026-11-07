import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../../test/helpers";
import { AlertStore } from "./store";
import { AlertEvaluator } from "./evaluator";
import { deliver } from "./delivery";
import type { PebbleCheck } from "./model";

function fixture() {
  const temp = tempDirectory(), path = join(temp.dir, "alerts.sqlite");
  let now = Date.parse("2026-11-03T12:00:00Z");
  const store = new AlertStore(path, "example.test", () => now);
  store.db.query("INSERT INTO meta VALUES('digest-day','2026-11-3')").run();
  const evaluator = new AlertEvaluator(store, { notes: ["sync"] });
  const pebble: PebbleCheck = { name: "notes", status: "running", readiness: "ready", release: "r1", jobs: [{ name: "sync", cron: "* * * * *" }] };
  return { temp, path, store, evaluator, pebble, now: () => now, advance(ms: number) { now += ms; }, close() { store.close(); temp.cleanup(); } };
}

test("R2-1 critical opening, escalation and recovery bypass both quiet-hour gates with high urgency", async () => {
  const h = fixture(), calls: any[] = [];
  await Bun.write(join(h.temp.dir, "alerts-secret"), "test");
  const fetcher = (async (_url: any, init: any) => { calls.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); }) as typeof fetch;
  try {
    h.advance(Date.parse("2026-11-03T22:10:00Z") - h.now());
    h.store.condition("", "tunnel", true); h.store.enqueue(null, "test", "Non-critical test");
    h.advance(30000); await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls.map(c => c.subject)).toEqual(["Bedrock opened: tunnel"]);
    h.advance(900000); h.evaluator.evaluate({ pebbles: [], tunnel: false });
    h.advance(30000); await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls.map(c => c.channels)).toEqual([["poke"], ["ntfy", "email"]]);
    h.store.condition("", "tunnel", false); h.advance(30000);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls.map(c => c.urgency)).toEqual(["high", "high", "high"]);
    expect(h.store.pending().map(r => r.transition)).toEqual(["test"]);
  } finally { h.close(); }
});

test("R2-3 99,999-event reconciliation for 24 pebbles uses an indexed terminal lookup below 2s", () => {
  const h = fixture();
  try {
    h.store.db.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<99999)
      INSERT INTO runs(pebble,job,run,state,at,scheduled) SELECT 'p-'||(x%24),'sync','run-'||(x/2),CASE WHEN x%2=1 THEN 'started' ELSE 'succeeded' END,${h.now()},NULL FROM n;`);
    const plan = h.store.db.query("EXPLAIN QUERY PLAN SELECT 1 FROM runs WHERE run=? AND state IN ('succeeded','failed','interrupted')").all("run-1");
    expect(JSON.stringify(plan)).toContain("SEARCH");
    const started = performance.now();
    for (let i = 0; i < 24; i++) h.evaluator.jobs.interrupt(`p-${i}`);
    const elapsed = performance.now() - started;
    console.log(`R2-3 reconciliation: ${elapsed.toFixed(2)} ms (24 pebbles, 99,999 events)`);
    expect(elapsed).toBeLessThan(2000);
  } finally { h.close(); }
}, 30000);

test("R2-4 recovery waits for opening Retry-After across a store restart", async () => {
  const h = fixture(), calls: string[] = [];
  await Bun.write(join(h.temp.dir, "alerts-secret"), "test");
  const fetcher = (async (_url: any, init: any) => {
    calls.push(JSON.parse(init.body).subject);
    return new Response(null, { status: calls.length === 1 ? 429 : 202, headers: { "retry-after": "3600" } });
  }) as typeof fetch;
  let restarted: AlertStore | undefined;
  try {
    h.store.condition("", "tunnel", true); h.advance(30000);
    await deliver(h.evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    h.store.condition("", "tunnel", false); h.advance(30000);
    h.store.close(); restarted = new AlertStore(h.path, "example.test", h.now);
    const evaluator = new AlertEvaluator(restarted);
    await deliver(evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls).toEqual(["Bedrock opened: tunnel"]);
    h.advance(3600000); await deliver(evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    await deliver(evaluator, h.temp.dir, "http://127.0.0.1/messages", fetcher);
    expect(calls).toEqual(["Bedrock opened: tunnel", "Bedrock opened: tunnel", "Bedrock resolved: tunnel"]);
  } finally { restarted?.close(); h.close(); }
});

test("R2-5 saturated outbox replays durable failure and success evaluation after restart", () => {
  const h = fixture(); let restarted: AlertStore | undefined;
  try {
    h.store.db.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000)
      INSERT INTO outbox(id,transition,payload,created,due) SELECT 'busy-'||x,'test','{}',${h.now()},${h.now()} FROM n;`);
    for (const state of ["failed", "succeeded"] as const) {
      try { h.evaluator.jobs.event("notes", { name: "sync", run: state, state, at: h.now(), scheduled: null }); } catch {}
    }
    h.store.close(); restarted = new AlertStore(h.path, "example.test", h.now);
    restarted.db.exec("UPDATE outbox SET state='accepted'");
    const evaluator = new AlertEvaluator(restarted, { notes: ["sync"] });
    evaluator.evaluate({ tunnel: null, pebbles: [h.pebble] });
    const transitions = restarted.db.query("SELECT transition FROM outbox WHERE incident IS NOT NULL ORDER BY rowid").all();
    expect(transitions).toEqual([{ transition: "opened" }, { transition: "resolved" }]);
    evaluator.evaluate({ tunnel: null, pebbles: [h.pebble] });
    expect(restarted.db.query("SELECT 1 FROM outbox WHERE incident IS NOT NULL").all()).toHaveLength(2);
    expect(restarted.open()).toHaveLength(0);
  } finally { restarted?.close(); h.close(); }
});

test("R2-6 full page budget reclaims accepted history before admitting a pending transition", () => {
  const h = fixture();
  try {
    h.store.db.exec("PRAGMA max_page_count=256");
    const insert = h.store.db.query("INSERT INTO outbox(id,transition,payload,created,due,state) VALUES(?,'digest',?,?,?,'accepted')");
    let count = 0;
    try { for (; count < 500; count++) insert.run(`history-${count}`, "x".repeat(24000), h.now(), h.now()); } catch {}
    expect(count).toBeGreaterThan(10);
    h.evaluator.evaluate({ tunnel: false, pebbles: [] });
    h.advance(30000);
    expect(h.store.pending().filter(r => r.transition === "opened")).toHaveLength(1);
    expect(h.store.open().map(i => i.rule)).toEqual(["tunnel"]);
    expect(h.store.db.query<{ n: number }, []>("SELECT count(*) n FROM outbox WHERE state='accepted'").get()!.n).toBeLessThan(count);
  } finally { h.close(); }
});

test("R2-7 a successful prior occurrence cannot skip the next overdue minute", () => {
  const h = fixture();
  try {
    h.evaluator.evaluate({ tunnel: null, pebbles: [h.pebble] });
    h.evaluator.jobs.event("notes", { name: "sync", run: "ok", state: "succeeded", at: h.now() + 60000, scheduled: h.now() + 60000 });
    h.advance(390000); h.evaluator.evaluate({ tunnel: null, pebbles: [h.pebble] });
    expect(h.store.open()).toHaveLength(0);
    h.advance(60000); h.evaluator.evaluate({ tunnel: null, pebbles: [h.pebble] });
    expect(h.store.open().filter(i => i.rule === "critical-job")).toHaveLength(1);
    h.advance(60000); h.evaluator.evaluate({ tunnel: null, pebbles: [h.pebble] });
    expect(h.store.db.query("SELECT 1 FROM outbox WHERE transition='opened'").all()).toHaveLength(1);
  } finally { h.close(); }
});


test("R2-2 external webhooks retain their URL and generic headers with a local proxy configured", async () => {
  const h = fixture();
  await Bun.write(join(h.temp.dir, "alerts-secret"), "test");
  try {
    h.store.enqueue(null, "test", "Generic receiver");
    const calls: { url: string; host: string | null }[] = [];
    const fetcher = (async (url: any, init: any) => { calls.push({ url: String(url), host: new Headers(init.headers).get("host") }); return new Response(null, { status: 503 }); }) as typeof fetch;
    for (const url of ["https://notify.other.test/messages", "https://comms.example.test.other.test/messages", "https://nested.comms.example.test/messages"]) {
      h.advance(10000); await deliver(h.evaluator, h.temp.dir, url, fetcher, 12345);
    }
    expect(calls).toEqual([
      { url: "https://notify.other.test/messages", host: null },
      { url: "https://comms.example.test.other.test/messages", host: null },
      { url: "https://nested.comms.example.test/messages", host: null },
    ]);
  } finally { h.close(); }
});
