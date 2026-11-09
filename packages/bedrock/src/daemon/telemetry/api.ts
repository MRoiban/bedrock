import { BedrockError } from "../../error";
import type { Telemetry } from "./index";
import { emptyRed, mergeRed, quantile, type Red, type Query } from "./model";
export function duration(value: string, parameter = "duration") {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  const result = match ? Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]!] ?? 0) : 0;
  if (!result || !Number.isSafeInteger(result) || result > 365 * 86400000) throw new BedrockError("INVALID_ARGS", `Invalid ${parameter} '${value}'.`, "Use a positive duration up to 365d, for example 15m or 1h.");
  return result;
}
export function telemetryQuery(url: URL, kind: Query["kind"], pebble: string): Query {
  const to = Number(url.searchParams.get("to") ?? Date.now());
  const from = Number(url.searchParams.get("from") ?? to - duration(url.searchParams.get("since") ?? (kind === "logs" ? "7d" : "1h"), "since"));
  const steps: { [key: string]: number } = { "1m": 60, "1h": 3600, "1d": 86400 };
  const step = steps[url.searchParams.get("step") ?? "1m"];
  const limit = Number(url.searchParams.get("limit") ?? 1000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new BedrockError("INVALID_ARGS", `Invalid limit '${url.searchParams.get("limit")}'.`, "Use limit 1–1000.");
  if (!step) throw new BedrockError("INVALID_ARGS", `Invalid step '${url.searchParams.get("step")}'.`, "Use step 1m|1h|1d.");
  const token = url.searchParams.get("cursor");
  const decoded = token ? Buffer.from(token, "base64url").toString("utf8") : null;
  if (token && (!/^v1:[1-9]\d*$/.test(decoded ?? "") || Buffer.from(decoded!).toString("base64url") !== token)) throw new BedrockError("INVALID_ARGS", "Invalid telemetry cursor.", "Use the opaque cursor returned by the previous page.");
  const cursor = decoded ? decoded.slice(3) : null;
  if (![from, to].every(Number.isSafeInteger) || from < 0 || from > to || to - from > 365 * 86400000 || !step || !Number.isInteger(limit) || limit < 1 || limit > 1000 || cursor !== null && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))))
    throw new BedrockError("INVALID_ARGS", "Invalid telemetry range or pagination.", "Use from/to epoch milliseconds, step 1m|1h|1d, limit 1–1000 and the returned cursor.");
  const search = url.searchParams.get("q");
  if (search && (kind !== "logs" || search.length > 1024)) throw new BedrockError("INVALID_ARGS", "Invalid log query.", "Use an FTS5 query of at most 1024 characters.");
  return { kind, pebble, from, to, step, limit, ...(cursor !== null ? { cursor: Number(cursor) } : {}), ...(search ? { search } : {}) };
}
async function statusMetrics(store: Telemetry, pebble: string, from: number, to: number) {
  const query: Query = { kind: "metrics", pebble, from: Math.ceil(from / 1000) * 1000, to, step: 1, limit: 1000 };
  const result = await store.query(query);
  // Four classes × 300 seconds can cross the public 1,000-row page limit.
  if (result.cursor) {
    const cursor = Number(Buffer.from(result.cursor, "base64url").toString().slice(3));
    const next = await store.query({ ...query, cursor });
    result.rows.push(...next.rows);
  }
  return result;
}
export async function telemetryStatus(store: Telemetry | undefined, pebble: string, measurable = true) {
  if (!store) return null;
  const to = Date.now(), from = to - 300000;
  try {
    const [metrics, resources, lifecycle] = await Promise.all([statusMetrics(store, pebble, from, to), store.query({ kind: "resources", pebble, from: to - 60000, to, step: 0, limit: 1 }), store.query({ kind: "lifecycle", pebble, from: 0, to, step: 0, limit: 1 })]);
    const red = new Map<string, Red>();
    for (const row of [...metrics.rows].sort((a: any, b: any) => a.time - b.time)) red.set(row.traffic, mergeRed(red.get(row.traffic) ?? emptyRed(), row));
    return { now: store.now(pebble), last_5m: Object.fromEntries([...red].map(([traffic, value]) => [traffic, { ...value, starts_per_s: value.starts / 300, completions_per_s: value.completions / 300, p95: { headers_success: quantile(value.headers_success), headers_failure: quantile(value.headers_failure), lifetime_success: quantile(value.lifetime_success), lifetime_failure: quantile(value.lifetime_failure) } }])), resources: (measurable ? resources.rows[0]?.value : null) ?? { resident: null, swap: null, cpu_us: null, oom_kills: null, source: null }, lifecycle: lifecycle.rows[0] ?? null, coverage: metrics.coverage, writer_coverage: metrics.writer_coverage, retained_losses: metrics.retained_losses, historical_drops: metrics.historical_drops, cursor: null, drops: store.drops(pebble), drop_scope: "daemon_boot", collected_since: store.started };
  } catch {
    return { now: store.now(pebble), last_5m: null, resources: { resident: null, swap: null, cpu_us: null, oom_kills: null, source: null }, lifecycle: null, coverage: { from_ms: null, to_ms: null }, cursor: null, drops: store.drops(pebble), unavailable: true };
  }
}
