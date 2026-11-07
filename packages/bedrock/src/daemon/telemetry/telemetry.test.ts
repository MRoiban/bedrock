import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { tempDirectory } from "../../../test/helpers";
import { Telemetry } from "./index";
import { PebbleLogs } from "../logs";
import { sampleResources } from "./resources";
import type { Query } from "./model";
const query = (kind: Query["kind"]): Query => ({ kind, pebble: "test", from: 0, to: Date.now() + 1000, step: 60, limit: 1000 });
async function settle(store: Telemetry) { store.flush(); await Bun.sleep(150); }

test("telemetry Worker keeps exact RED, separates abort/4xx/body failures, caps and scrubs logs", async () => {
  const temp = tempDirectory(); const store = new Telemetry(temp.dir, () => []);
  const logs = new PebbleLogs(temp.dir, "test", undefined, undefined, undefined, undefined, undefined, undefined, { store, name: "test" });
  try {
    logs.protect(["very-private-secret"]);
    for (let i = 0; i < 100; i++) { const request = store.begin("test", "GET", "/private/123?secret=yes", "ordinary"); request.headers(i < 10 ? 500 : i < 20 ? 404 : 200); request.finish(i >= 20 && i < 25 ? "failure" : i >= 25 && i < 30 ? "abort" : undefined); request.finish(); }
    const stream = store.begin("test", "GET", "/stream", "ordinary"); stream.headers(200, true); stream.finish();
    const ws = store.begin("test", "GET", "/ws", "websocket"); ws.headers(101); expect(store.now("test").websocket).toMatchObject({ open_sockets: 1 }); ws.finish();
    // The limiter counts per calendar second; start early in one so all 61 writes share a window.
    while (Date.now() % 1000 > 300) await Bun.sleep(5);
    logs.write(new TextEncoder().encode("very-private-secret " + "x".repeat(17000) + "\n"), "stderr", "run");
    for (let i = 0; i < 60; i++) logs.write(new TextEncoder().encode(`line ${i}\n`));
    await settle(store);
    const metrics = await store.query(query("metrics"));
    expect(metrics.rows.find((row: any) => row.traffic === "ordinary")).toMatchObject({ starts: 100, completions: 100, failures: 15, client_aborts: 5, client_errors: 10, inflight: 0 });
    expect(metrics.rows.find((row: any) => row.traffic === "stream")).toMatchObject({ starts: 1, completions: 1 });
    const page = await store.query(query("logs"));
    expect(page.rows).toHaveLength(50); expect(JSON.stringify(page.rows)).not.toContain("very-private-secret");
    expect(page.rows.at(-1).stream).toBe("stderr"); expect(Buffer.byteLength(page.rows.at(-1).text)).toBeLessThanOrEqual(16384);
    expect(store.drops("test")).toMatchObject({ log_rate: 11, log_truncated: 1 });
    expect(await Bun.file(join(temp.dir, "pebbles/test/logs/pebble.log")).exists()).toBe(false);
    expect(await (await logs.response(false, new AbortController().signal)).text()).toContain("[REDACTED]");
    expect(JSON.stringify((await store.query(query("events"))).rows)).not.toContain("secret=yes");
  } finally { logs.close(); await store.close(); temp.cleanup(); }
});

test("telemetry Worker storage denial drops without throwing on ingestion", async () => {
  const temp = tempDirectory(); await mkdir(join(temp.dir, "observability.sqlite"));
  const store = new Telemetry(temp.dir, () => []);
  try {
    store.lifecycle("test", "spawn"); await settle(store);
    expect(store.drops("test").storage).toBe(1);
    await rm(join(temp.dir, "observability.sqlite"), { recursive: true });
    const req = store.begin("test", "GET", "/", "ordinary"); req.headers(200); req.finish();
    await settle(store);
    expect(store.drops("test").storage).toBeGreaterThan(1);
  } finally { await store.close(); temp.cleanup(); }
});

test("resource sampling omits idle/unreadable cgroups and keeps live deltas without wakes", async () => {
  const temp = tempDirectory();
  try {
    let now = 1700000000000;
    const groups = [{ pebble: "idle", paths: [] }, { pebble: "gone", paths: [join(temp.dir, "gone")] }];
    for (let day = 0; day < 8; day++) {
      now += 86400000;
      expect(await sampleResources(groups, () => now)).toEqual([]);
    }
    await Bun.write(join(temp.dir, "memory.current"), "123"); await Bun.write(join(temp.dir, "memory.swap.current"), "456");
    await Bun.write(join(temp.dir, "cpu.stat"), "usage_usec 100\n"); await Bun.write(join(temp.dir, "memory.events"), "oom_kill 1\n");
    await sampleResources([{ pebble: "test", paths: [temp.dir] }], () => now);
    now += 15000;
    await Bun.write(join(temp.dir, "cpu.stat"), "usage_usec 600\n"); await Bun.write(join(temp.dir, "memory.events"), "oom_kill 2\n");
    expect((await sampleResources([{ pebble: "test", paths: [temp.dir] }], () => now))[0]).toMatchObject({ value: { resident: 123, swap: 456, cpu_us: 500, oom_kills: 1, interval_ms: 15000, source: "cgroup" } });
  } finally { temp.cleanup(); }
});

test("storage retry deadline does not slide under continuing ingestion", async () => {
  const temp = tempDirectory(); await mkdir(join(temp.dir, "observability.sqlite"));
  const store = new Telemetry(temp.dir, () => []);
  try {
    await store.faultForTests(null, 150);
    store.lifecycle("test", "spawn"); await settle(store);
    await rm(join(temp.dir, "observability.sqlite"), { recursive: true });
    // Continue querying/ingesting rather than resetting the retry clock on repair.
    for (let i = 0; i < 8; i++) {
      store.lifecycle("test", "ready"); store.flush();
      await store.query(query("lifecycle")).catch(() => null);
      await Bun.sleep(30);
    }
    expect((await store.query(query("lifecycle"))).rows.length).toBeGreaterThan(0);
    expect(store.drops("test").storage).toBeGreaterThan(0);
  } finally { await store.close(); temp.cleanup(); }
});

test("log byte cap preserves UTF-8 and empty lines", async () => {
  const temp = tempDirectory(), store = new Telemetry(temp.dir, () => []);
  const logs = new PebbleLogs(temp.dir, "test", undefined, undefined, undefined, undefined, undefined, undefined, { store, name: "test" });
  try {
    logs.write(new TextEncoder().encode("a" + "😀".repeat(5000) + "\n\n"));
    const page = await store.query(query("logs"));
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0].text).toBe("");
    expect(Buffer.byteLength(page.rows[1].text)).toBeLessThanOrEqual(16384);
    expect(page.rows[1].text).not.toContain("�");
  } finally { logs.close(); await store.close(); temp.cleanup(); }
});
