import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "./helpers";
import { setup } from "../src/daemon/config";
import { Alerts } from "../src/daemon/alerts";
import { AlertStore } from "../src/daemon/alerts/store";
import { AlertEvaluator } from "../src/daemon/alerts/evaluator";
import type { Snapshot } from "../src/daemon/alerts/model";

test("R3-6 real Alerts Worker catches up 24 minutely jobs after 90 days below the watchdog", async () => {
  const temp = tempDirectory();
  let now = Date.parse("2026-08-01T12:00:00Z");
  await setup(temp.dir, "example.test", undefined, 0);
  const snapshot: Snapshot = { tunnel: null, pebbles: Array.from({ length: 24 }, (_, i) => ({ name: `p-${i}`, status: "running", readiness: "ready", release: "r1", jobs: [{ name: "sync", cron: "* * * * *" }] })) };
  const critical = Object.fromEntries(snapshot.pebbles.map(p => [p.name, ["sync"]]));
  const config = await Bun.file(join(temp.dir, "config.json")).json();
  config.alerts = { criticalJobs: critical };
  await Bun.write(join(temp.dir, "config.json"), JSON.stringify(config));
  const seed = new AlertStore(join(temp.dir, "alerts.sqlite"), "example.test", () => now);
  new AlertEvaluator(seed, critical).evaluate(snapshot); seed.close();
  now += 90 * 86400000;
  let alerts = new Alerts(temp.dir, () => now);
  try {
    await alerts.view();
    for (let sweep = 1; sweep <= 3; sweep++) {
      const start = performance.now();
      await alerts.snapshotForTests(snapshot);
      const elapsed = performance.now() - start;
      console.log(`R3-6 90-day Worker sweep ${sweep}: ${elapsed.toFixed(2)} ms`);
      expect(elapsed).toBeLessThan(2000);
      const view = await alerts.view();
      expect(view.incidents.filter((i: any) => i.rule === "critical-job" && i.resolved === null)).toHaveLength(24);
      expect(view.outbox.filter((r: any) => r.incident && r.transition === "opened")).toHaveLength(24);
      const check = new AlertStore(join(temp.dir, "alerts.sqlite"), "example.test", () => now);
      try {
        expect(check.db.query("SELECT 1 FROM jobs WHERE due<?").all(now - 300000)).toHaveLength(0);
        expect(check.db.query("SELECT 1 FROM runs").all()).toHaveLength(0);
      } finally { check.close(); }
      if (sweep === 1) { await alerts.close(); alerts = new Alerts(temp.dir, () => now); await alerts.view(); }
    }
  } finally { await alerts.close(); temp.cleanup(); }
}, 15000);
