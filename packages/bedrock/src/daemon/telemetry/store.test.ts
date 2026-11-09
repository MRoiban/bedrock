import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../../test/helpers";
import { TelemetryStore } from "./store";
import { budgets, emptyRed, observe, quantile, type Query, type Record } from "./model";
import { routeShape } from "./privacy";
import { telemetryQuery } from "./api";
const query = (kind: Query["kind"], extra: Partial<Query> = {}): Query => ({ kind, pebble: "test", from: 0, to: Date.now(), step: 60, limit: 1000, ...extra });

test("telemetry rollups merge histogram counts atomically at all three resolutions", () => {
  const temp = tempDirectory(); const store = new TelemetryStore(join(temp.dir, "observability.sqlite"));
  try {
    const value = emptyRed(); value.starts = value.completions = 20; observe(value.headers_success, .03);
    const time = Date.now();
    store.write([{ kind: "metrics", pebble: "test", time, traffic: "ordinary", value }, { kind: "metrics", pebble: "test", time, traffic: "ordinary", value }]);
    for (const step of [60, 3600, 86400]) {
      const rows = store.query(query("metrics", { step })).rows;
      expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ starts: 40, completions: 40, p95: { headers_success: { lower: .025, upper: .05, count: 2, unit: "s" } } });
    }
  } finally { store.close(); temp.cleanup(); }
});

test("telemetry FTS cursors, bad search, budget eviction and time retention stay consistent", () => {
  const temp = tempDirectory(); const store = new TelemetryStore(join(temp.dir, "observability.sqlite"), { ...budgets, logs: 900 });
  try {
    const time = Date.now();
    const log = (text: string, time = Date.now()): Record => ({ kind: "logs", pebble: "test", time, text, stream: "stdout", run: "run" });
    store.write([log("timeout one"), log("timeout two"), log("timeout three"), log("timeout four")]);
    const first = store.query(query("logs", { search: "timeout", limit: 1 }));
    expect(first.rows[0]).toMatchObject({ text: "timeout four" }); expect(first.cursor).not.toBeNull();
    expect(store.query(query("logs", { search: "timeout", cursor: Number(Buffer.from(first.cursor!, "base64url").toString().slice(3)) })).rows).toHaveLength(2);
    expect(first.retained_losses).toEqual({ logs_budget_evicted: 1 });
    expect(() => store.query(query("logs", { search: '"' }))).toThrow("Invalid telemetry search");
    store.write([log("expired", time - 8 * 86400_000)]);
    expect(store.query(query("logs", { search: "expired" })).rows).toHaveLength(0);
    expect(store.db.query("SELECT bytes FROM accounting WHERE kind='logs'").get()).toMatchObject({ bytes: expect.any(Number) });
    expect(store.db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    store.db.exec("INSERT INTO logs_fts(logs_fts,rank) VALUES('integrity-check',1)");
  } finally { store.close(); temp.cleanup(); }
});

test("telemetry retention keeps hour/day parents after minute expiry and resource rollups preserve integrals", () => {
  const temp = tempDirectory(); const store = new TelemetryStore(join(temp.dir, "observability.sqlite"));
  try {
    const time = Date.now() - 8 * 86400_000;
    store.write([{ kind: "metrics", pebble: "test", traffic: "ordinary", time, value: { ...emptyRed(), starts: 9 } }]);
    expect(store.query(query("metrics")).rows).toHaveLength(0);
    expect(store.query(query("metrics", { step: 3600 })).rows[0]).toMatchObject({ starts: 9 });
    const record: Record = { kind: "resources", time: Date.now(), pebble: "test", value: { resident: 1000, swap: 2000, cpu_us: 500000, oom_kills: 1, interval_ms: 15000, cpu_percent: 100 / 30, source: "cgroup" } };
    store.write([record, record]);
    expect(store.query(query("resources")).rows[0]).toMatchObject({ value: { cpu_us: 1000000, oom_kills: 2, resident_bytes_ms: 30000000, covered_ms: 30000 } });
  } finally { store.close(); temp.cleanup(); }
});

test("telemetry only retains known route shapes and validates bounded queries", () => {
  expect(routeShape("GET", "/members/alice@example.test/12345")).toBe("/:segment/:segment/:segment");
  expect(routeShape("GET", "/items/12345", ["GET /items/:id"])).toBe("GET /items/:id");
  const longPath = "/" + "a".repeat(300);
  expect(routeShape("GET", longPath, [`GET ${longPath}`])).toBe("/:segment");
  expect(quantile(Array(15).fill(0))).toBeNull();
  for (const suffix of ["since=0h", "step=5s", "limit=1001", "cursor=oops", "from=-1"]) expect(() => telemetryQuery(new URL(`http://localhost/?${suffix}`), "metrics", "test")).toThrow();
});

test("real SQLite FULL rolls back telemetry and accepts writes after its page limit is restored", () => {
  const temp = tempDirectory(), store = new TelemetryStore(join(temp.dir, "observability.sqlite"));
  try {
    const pages = store.db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count;
    store.db.exec(`PRAGMA max_page_count=${pages}`);
    const record: Record = { kind: "logs", pebble: "test", time: Date.now(), text: "x".repeat(16384), stream: "stderr", run: "test" };
    expect(() => store.db.query("INSERT INTO records(kind,pebble,time,value,text,bytes) VALUES(?,?,?,?,?,?)").run("logs", "test", Date.now(), JSON.stringify(record), record.text, 65536)).toThrow();
    expect(store.query(query("logs")).rows).toHaveLength(0);
    store.db.exec("PRAGMA max_page_count=63488");
    expect(store.write([record])).toHaveLength(0);
    expect(store.query(query("logs")).rows).toHaveLength(1);
    expect(store.db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally { store.close(); temp.cleanup(); }
});

test("status aggregates all four traffic classes beyond the 1000-row page", async () => {
  const { telemetryStatus } = await import("./api");
  const { spyOn } = await import("bun:test");
  const temp = tempDirectory(), store = new TelemetryStore(join(temp.dir, "observability.sqlite"));
  const now = Math.floor(Date.now() / 1000) * 1000;
  const clock = spyOn(Date, "now").mockReturnValue(now);
  try {
    const records: Record[] = [];
    for (let second = 0; second < 300; second++) for (const traffic of ["ordinary", "stream", "websocket", "control"] as const) records.push({ kind: "metrics", pebble: "test", traffic, time: now - second * 1000, value: { ...emptyRed(), starts: 1, completions: 1 } });
    store.write(records, now);
    const adapter = { query: async (query: Query) => store.query(query), now: () => ({}), drops: () => ({}), started: now - 300000 } as unknown as import("./index").Telemetry;
    const status = await telemetryStatus(adapter, "test");
    for (const traffic of ["ordinary", "stream", "websocket", "control"]) expect(status?.last_5m?.[traffic]).toMatchObject({ starts: 300, completions: 300 });
  } finally { clock.mockRestore(); store.close(); temp.cleanup(); }
});

test("late request completion cannot resurrect a deleted pebble's metrics", async () => {
  const { RequestMetrics } = await import("./requests");
  const metrics = new RequestMetrics(() => {});
  const request = metrics.begin("test", "GET", "/", "ordinary");
  metrics.forget("test"); request.headers(200, true); request.finish();
  expect(metrics.take()).toEqual([]);
});

test("eight clock-driven days of sparse traffic keep seven-day minutes and the status tier", () => {
  const temp = tempDirectory(), store = new TelemetryStore(join(temp.dir, "observability.sqlite"), { ...budgets, metrics: budgets.metrics / 10 });
  const start = Date.UTC(2026, 0, 1), end = start + 8 * 86400000;
  try {
    // One interval in ten, with one tenth of the budget: exercise retention pressure without a slow soak.
    for (let time = start; time < end; time += 600000) {
      const records: Record[] = [];
      for (let p = 0; p < 24; p++) records.push({ kind: "metrics", pebble: `p${p}`, time, traffic: "ordinary", value: { ...emptyRed(), starts: 1, completions: 1 } });
      expect(store.write(records, time)).toEqual([]);
    }
    for (let p = 0; p < 24; p++) {
      const pebble = `p${p}`;
      store.write([{ kind: "metrics", pebble, time: end, traffic: "ordinary", value: { ...emptyRed(), starts: 1 } }, { kind: "metrics", pebble, time: end, traffic: "control", value: { ...emptyRed(), gauge_at: end } }], end);
      expect(store.query(query("metrics", { pebble, to: end, step: 60 })).coverage).toMatchObject({ from_ms: end - 7 * 86400000 });
      expect(store.query(query("metrics", { pebble, to: end, step: 1 })).rows).toHaveLength(1);
    }
    expect(store.db.query("SELECT * FROM losses").all()).toEqual([]);
    expect(store.db.query("SELECT count(*) AS count FROM records WHERE traffic='control'").get()).toEqual({ count: 0 });
    const actual = store.db.query<{ step: number; bytes: number }, []>("SELECT step,sum(bytes) AS bytes FROM records WHERE kind IN ('metrics','resources') GROUP BY step ORDER BY step").all();
    expect(store.db.query("SELECT * FROM metric_tiers ORDER BY step").all()).toEqual(actual);
  } finally { store.close(); temp.cleanup(); }
});

test("minute budget pressure cannot evict the five-minute status tier", () => {
  const temp = tempDirectory(), store = new TelemetryStore(join(temp.dir, "observability.sqlite"), { ...budgets, metrics: 160000 });
  const now = Date.UTC(2026, 0, 8);
  try {
    for (let i = 0; i < 1500; i++) store.write([{ kind: "metrics", pebble: "test", time: now - i * 60000, traffic: "ordinary", value: { ...emptyRed(), starts: 1 } }], now);
    expect(store.query(query("metrics", { step: 1, to: now })).rows).toHaveLength(6);
    expect(store.query(query("metrics", { to: now })).retained_losses.metrics_budget_evicted).toBeGreaterThan(0);
  } finally { store.close(); temp.cleanup(); }
});

test("unmeasurable resources are neither stored nor returned as stale status", async () => {
  const { telemetryStatus } = await import("./api");
  const temp = tempDirectory(), store = new TelemetryStore(join(temp.dir, "observability.sqlite"));
  const time = Date.now();
  try {
    const value = { resident: null, swap: null, cpu_us: null, oom_kills: null, source: null, interval_ms: 0, cpu_percent: null };
    store.write(Array.from({ length: 24 }, (_, p) => ({ kind: "resources", pebble: `p${p}`, time, value })), time);
    expect(store.db.query("SELECT count(*) AS count FROM records").get()).toEqual({ count: 0 });
    store.write([{ kind: "resources", pebble: "test", time, value: { ...value, resident: 1000, source: "cgroup" } }], time);
    const adapter = { query: async (q: Query) => store.query(q), now: () => ({}), drops: () => ({}) } as unknown as import("./index").Telemetry;
    expect((await telemetryStatus(adapter, "test", false))?.resources).toMatchObject({ resident: null, source: null });
    expect((await telemetryStatus(adapter, "test", true))?.resources).toMatchObject({ resident: 1000, source: "cgroup" });
  } finally { store.close(); temp.cleanup(); }
});

test("legacy verbose rows compact on reopen while public metrics, resources and log search stay readable", () => {
  const temp = tempDirectory(), path = join(temp.dir, "observability.sqlite"), time = Date.now();
  let store = new TelemetryStore(path);
  try {
    const value = { ...emptyRed(), starts: 12 }; observe(value.headers_success, .1);
    const records: Record[] = [
      { kind: "metrics", pebble: "test", time, traffic: "ordinary", value },
      { kind: "resources", pebble: "test", time, value: { resident: 123, swap: 0, cpu_us: null, oom_kills: null, source: "cgroup", interval_ms: 0, cpu_percent: null } },
      { kind: "logs", pebble: "test", time, stream: "stdout", run: "run", text: "legacy timeout" },
    ];
    for (const record of records) store.db.query("INSERT INTO records(kind,pebble,time,step,traffic,value,text,bytes) VALUES(?,?,?,?,?,?,?,1000)").run(record.kind, record.pebble, time, record.kind === "metrics" ? 60 : 0, record.kind === "metrics" ? "ordinary" : "", JSON.stringify(record.kind === "metrics" ? record.value : record), record.kind === "logs" ? record.text : "");
    store.db.exec("PRAGMA user_version=0"); store.close(); store = new TelemetryStore(path);
    expect(store.query(query("metrics", { to: time })).rows[0]).toMatchObject({ starts: 12, headers_success: value.headers_success });
    expect(store.query(query("resources", { to: time, step: 0 })).rows[0]).toMatchObject({ value: { resident: 123 } });
    expect(store.query(query("logs", { to: time, search: "timeout" })).rows[0]).toMatchObject({ text: "legacy timeout", stream: "stdout", run: "run" });
    expect(store.db.query<{ bytes: number }, []>("SELECT bytes FROM accounting WHERE kind='metrics'").get()!.bytes).toBeLessThan(500);
    expect(store.db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally { store.close(); temp.cleanup(); }
});

test("physical pressure reclaims history before the status window", () => {
  const temp = tempDirectory(), store = new TelemetryStore(join(temp.dir, "observability.sqlite"));
  const now = Date.UTC(2026, 0, 8);
  try {
    store.write(Array.from({ length: 300 }, (_, i) => ({ kind: "metrics", pebble: "test", time: now - i * 60000, traffic: "ordinary", value: { ...emptyRed(), starts: 1 } })), now);
    const pages = store.db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count;
    store.db.exec(`PRAGMA max_page_count=${pages + 1}`);
    expect(store.write([{ kind: "logs", pebble: "test", time: now, stream: "stdout", run: "run", text: "cannot fit the reserve" }], now)).toEqual([{ pebble: "test", kind: "physical_budget" }]);
    const status = store.query(query("metrics", { step: 1, to: now }));
    expect(status.rows).toHaveLength(6);
    expect(status.retained_losses.physical_budget_evicted).toBe(128);
  } finally { store.close(); temp.cleanup(); }
});
