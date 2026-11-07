import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { tempDirectory } from "../../../test/helpers";
import { setup } from "../config";
import type { DaemonDatabase } from "../db";
import type { Supervisor } from "../supervisor";
import { Alerts } from "./index";
test("probe sweep bounds concurrency, skips idle/stopped targets and known crashes override cached ready", async () => {
  const temp = tempDirectory();
  const { config } = await setup(temp.dir, "example.test", undefined, 0);
  const alerts = new Alerts(temp.dir);
  const records = Array.from({ length: 24 }, (_, i) => ({ name: `p-${i}`, status: "running", release: "r1" }));
  records.push({ name: "idle", status: "idle", release: "r1" }, { name: "stopped", status: "stopped", release: "r1" });
  let inflight = 0, peak = 0, calls = 0;
  const supervisor = {
    child: (name: string) => name.startsWith("p-") ? child : undefined,
    async readiness(name: string) {
      expect(name.startsWith("p-")).toBe(true); calls++; inflight++; peak = Math.max(peak, inflight);
      await Promise.resolve(); inflight--; return { state: "ready" };
    },
  };
  const child = {};
  try {
    alerts.start({ list: () => records } as unknown as DaemonDatabase, supervisor as unknown as Supervisor, config, () => null);
    await alerts.pause();
    expect(calls).toBe(24); expect(peak).toBe(2);
    expect(alerts.status("p-0", "running").state).toBe("ready");
    expect(alerts.status("p-0", "crashed").state).toBe("failed");
    expect(alerts.status("p-0", "restarting").state).toBe("starting");
    expect(alerts.status("idle", "idle")).toMatchObject({ state: "idle", available_on_demand: true });
    expect(alerts.status("stopped", "stopped").state).toBe("stopped");
  } finally { await alerts.close(); temp.cleanup(); }
});

test("R2-8 a child swap during readiness preserves registered incidents and deadlines", async () => {
  const temp = tempDirectory();
  const { config } = await setup(temp.dir, "example.test", undefined, 0);
  const alerts = new Alerts(temp.dir, () => Date.parse("2026-11-03T12:00:00Z"), config);
  const oldChild = {}, newChild = {};
  let child = oldChild;
  const record = { name: "notes", status: "running", release: "r1" };
  const db = { list: () => [record] } as unknown as DaemonDatabase;
  const supervisor = { child: () => child, async readiness() { child = newChild; return { state: "ready" }; } } as unknown as Supervisor;
  try {
    await alerts.snapshotForTests({ tunnel: null, pebbles: [{ ...record, status: "crashed", readiness: "failed", jobs: [{ name: "sync", cron: "* * * * *" }] }] });
    alerts.start(db, supervisor, config, () => null); await alerts.pause();
    const view = await alerts.view();
    expect(view.incidents.filter((i: any) => i.rule === "readiness" && i.resolved === null)).toHaveLength(1);
    expect(view.checks.map((c: any) => c.name)).toEqual(["notes"]);
    const stored = new Database(`${temp.dir}/alerts.sqlite`, { readonly: true });
    try { expect(stored.query("SELECT name FROM jobs").all()).toEqual([{ name: "sync" }]); } finally { stored.close(); }
    expect(alerts.status("notes", "running").state).toBe("starting");
    alerts.start({ list: () => [] } as unknown as DaemonDatabase, supervisor, config, () => null); await alerts.pause();
    expect((await alerts.view()).incidents.filter((i: any) => i.resolved === null)).toHaveLength(0);
  } finally { await alerts.close(); temp.cleanup(); }
});

test("R2-10 backup setup, interval changes and removal apply on the next probe sweep", async () => {
  const temp = tempDirectory();
  const { config } = await setup(temp.dir, "example.test", undefined, 0);
  const now = Date.parse("2026-11-03T12:00:00Z");
  const alerts = new Alerts(temp.dir, () => now, config);
  const db = { list: () => [] } as unknown as DaemonDatabase;
  const supervisor = {} as Supervisor;
  const sweep = async () => { alerts.start(db, supervisor, config, () => null); await alerts.pause(); };
  try {
    await sweep();
    await Bun.write(`${temp.dir}/config.json`, JSON.stringify({ ...config, backup: { type: "fs", directory: `${temp.dir}/backups`, intervalMinutes: 1 } }));
    await Bun.write(`${temp.dir}/backup-state.json`, JSON.stringify({ daemon: now - 180000 }));
    await sweep();
    expect((await alerts.view()).incidents.filter((i: any) => i.rule === "backup-age" && i.resolved === null)).toHaveLength(1);
    await Bun.write(`${temp.dir}/config.json`, JSON.stringify({ ...config, backup: { type: "fs", directory: `${temp.dir}/backups`, intervalMinutes: 60 } }));
    await sweep();
    expect((await alerts.view()).incidents.filter((i: any) => i.resolved === null)).toHaveLength(0);
    await Bun.write(`${temp.dir}/config.json`, JSON.stringify(config)); await sweep();
    expect((await alerts.view()).incidents.filter((i: any) => i.resolved === null)).toHaveLength(0);
  } finally { await alerts.close(); temp.cleanup(); }
});
