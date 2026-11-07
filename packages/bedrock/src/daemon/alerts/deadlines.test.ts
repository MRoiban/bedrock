import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../../test/helpers";
import { AlertStore } from "./store";
import { AlertEvaluator } from "./evaluator";
import type { PebbleCheck } from "./model";

const pebble: PebbleCheck = { name: "notes", status: "running", readiness: "ready", release: "r1", jobs: [{ name: "sync", cron: "* * * * *" }] };

test("R3-5 pressure reclaim preserves unchecked successes and unfinished runs until their consumers advance", () => {
  const temp = tempDirectory();
  let now = Date.parse("2026-11-03T12:00:00Z");
  const store = new AlertStore(join(temp.dir, "alerts.sqlite"), "example.test", () => now);
  const evaluator = new AlertEvaluator(store, { notes: ["sync"] });
  try {
    evaluator.evaluate({ tunnel: null, pebbles: [pebble] });
    const scheduled = now + 60000;
    evaluator.jobs.event("notes", { name: "sync", run: "ok", state: "succeeded", at: scheduled, scheduled });
    evaluator.jobs.event("notes", { name: "sync", run: "active", state: "started", at: now, scheduled: null });
    store.db.exec("PRAGMA max_page_count=256");
    const insert = store.db.query("INSERT INTO runs(pebble,job,run,state,at,scheduled) VALUES('old','history',?,'skipped',?,NULL)");
    let count = 0;
    try { for (; count < 500; count++) insert.run("x".repeat(24000) + count, now); } catch {}
    expect(count).toBeGreaterThan(10);
    store.prune();
    expect(store.db.query("SELECT 1 FROM runs WHERE run='ok'").get()).not.toBeNull();
    expect(store.db.query("SELECT 1 FROM runs WHERE run='active'").get()).not.toBeNull();
    expect(store.history("old").length).toBeLessThan(count);
    now += 360001;
    evaluator.evaluate({ tunnel: null, pebbles: [pebble] });
    expect(store.open().filter(i => i.rule === "critical-job")).toHaveLength(0);
    expect(store.db.query<{ due: number }, []>("SELECT due FROM jobs").get()!.due).toBe(scheduled + 60000);
    // Expired history is disposable only after its deadline or terminal-event consumer is done.
    now += 31 * 86400000;
    store.prune();
    expect(store.db.query("SELECT 1 FROM runs WHERE run='ok'").get()).toBeNull();
    expect(store.db.query("SELECT 1 FROM runs WHERE run='active'").get()).not.toBeNull();
    evaluator.jobs.interrupt("notes");
    expect(store.history("notes").filter((r: any) => r.state === "interrupted")).toHaveLength(1);
  } finally { store.close(); temp.cleanup(); }
});

test("R3-5 time retention preserves evidence at and beyond the deadline cursor", () => {
  const temp = tempDirectory();
  let now = Date.parse("2026-08-01T12:00:00Z");
  const store = new AlertStore(join(temp.dir, "alerts.sqlite"), "example.test", () => now);
  const evaluator = new AlertEvaluator(store, { notes: ["sync"] });
  try {
    evaluator.evaluate({ tunnel: null, pebbles: [pebble] });
    for (let minute = 1; minute <= 2; minute++) evaluator.jobs.event("notes", { name: "sync", run: `ok-${minute}`, state: "succeeded", at: now + minute * 60000, scheduled: now + minute * 60000 });
    now += 90 * 86400000;
    store.prune();
    expect(store.history("notes")).toHaveLength(2);
  } finally { store.close(); temp.cleanup(); }
});

test("R3-6 dense evidence catch-up commits bounded cursor chunks and one gap incident across restart", () => {
  const temp = tempDirectory(), path = join(temp.dir, "alerts.sqlite");
  let now = Date.parse("2026-11-03T12:00:00Z");
  let store = new AlertStore(path, "example.test", () => now);
  let evaluator = new AlertEvaluator(store, { notes: ["sync"] });
  const snapshot = { tunnel: null, pebbles: [pebble] };
  try {
    evaluator.evaluate(snapshot);
    const first = now + 60000;
    const insert = store.db.query("INSERT INTO runs(pebble,job,run,state,at,scheduled) VALUES('notes','sync',?,'succeeded',?,?)");
    store.db.transaction(() => {
      for (let minute = 2; minute <= 700; minute++) insert.run(`ok-${minute}`, now + minute * 60000, now + minute * 60000);
    })();
    now += 710 * 60000;
    evaluator.evaluate(snapshot);
    const cursor = () => store.db.query<{ due: number }, []>("SELECT due FROM jobs").get()!.due;
    expect(cursor()).toBeGreaterThan(first);
    expect(cursor()).toBeLessThan(now - 300000);
    const incident = store.open().find(i => i.rule === "critical-job")!;
    expect(incident).toBeDefined();
    const saved = cursor();
    store.close(); store = new AlertStore(path, "example.test", () => now);
    evaluator = new AlertEvaluator(store, { notes: ["sync"] });
    expect(cursor()).toBe(saved);
    for (let sweep = 0; sweep < 3 && cursor() < now - 300000; sweep++) evaluator.evaluate(snapshot);
    expect(cursor()).toBeGreaterThanOrEqual(now - 300000);
    expect(store.open().filter(i => i.rule === "critical-job").map(i => i.id)).toEqual([incident.id]);
    expect(store.db.query("SELECT 1 FROM outbox WHERE transition='opened' AND incident=?").all(incident.id)).toHaveLength(1);
    expect(store.history("notes")).toHaveLength(699);
  } finally { store.close(); temp.cleanup(); }
});
