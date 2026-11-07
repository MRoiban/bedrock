export const bounds = [.005, .01, .025, .05, .075, .1, .25, .5, .75, 1, 2.5, 5, 7.5, 10];
export type Traffic = "ordinary" | "stream" | "websocket" | "control";
export type Histogram = number[];
export const histogram = (): Histogram => Array(15).fill(0);
export function observe(hist: Histogram, seconds: number) { hist[bounds.findIndex(bound => seconds <= bound) < 0 ? 14 : bounds.findIndex(bound => seconds <= bound)]!++; }
export function quantile(hist: Histogram, fraction = .95) {
  const count = hist.reduce((a, b) => a + b, 0);
  if (!count) return null;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i]!;
    if (seen >= Math.ceil(count * fraction)) return { lower: i ? bounds[i - 1]! : 0, upper: bounds[i] ?? null, unit: "s", count };
  }
  return null;
}
export function emptyRed() {
  return { starts: 0, completions: 0, failures: 0, client_aborts: 0, client_errors: 0, throttled: 0,
    headers_success: histogram(), headers_failure: histogram(), lifetime_success: histogram(), lifetime_failure: histogram(),
    headers_sum_s: 0, lifetime_sum_s: 0, headers_max_s: 0, lifetime_max_s: 0, handshakes: 0,
    inflight: 0, sockets: 0, gauge_at: 0, inflight_ms: 0, socket_ms: 0, inflight_peak: 0, sockets_peak: 0 };
}
export type Red = ReturnType<typeof emptyRed>;
export function mergeRed(target: Red, value: Red) {
  for (const key of ["starts", "completions", "failures", "client_aborts", "client_errors", "throttled", "inflight_ms", "socket_ms", "headers_sum_s", "lifetime_sum_s", "handshakes"] as const) target[key] += value[key];
  for (const key of ["headers_success", "headers_failure", "lifetime_success", "lifetime_failure"] as const) value[key].forEach((n, i) => target[key][i]! += n);
  target.headers_max_s = Math.max(target.headers_max_s, value.headers_max_s); target.lifetime_max_s = Math.max(target.lifetime_max_s, value.lifetime_max_s);
  if (value.gauge_at >= target.gauge_at) { target.gauge_at = value.gauge_at; target.inflight = value.inflight; target.sockets = value.sockets; }
  target.inflight_peak = Math.max(target.inflight_peak, value.inflight_peak);
  target.sockets_peak = Math.max(target.sockets_peak, value.sockets_peak);
  return target;
}
export interface Resource { resident: number | null; swap: number | null; cpu_us: number | null; oom_kills: number | null; source: "cgroup" | null; interval_ms: number; cpu_percent: number | null }
export type Record =
  | { kind: "metrics"; pebble: string; time: number; traffic: Traffic; value: Red }
  | { kind: "logs"; pebble: string; time: number; text: string; stream: string; run: string }
  | { kind: "events"; pebble: string; time: number; route: string; method: string; status: number; outcome: string; headers_s: number | null; lifetime_s: number }
  | { kind: "lifecycle"; pebble: string; time: number; event: string; run: string | null; code: number | null; signal: string | null; retry_at: number | null }
  | { kind: "resources"; pebble: string; time: number; value: Resource };
export interface Query { kind: "metrics" | "logs" | "events" | "lifecycle" | "resources"; pebble: string; from: number; to: number; step: number; limit: number; cursor?: number; search?: string }
export const budgets = { logs: 256 * 1024 ** 2, events: 64 * 1024 ** 2, metrics: 160 * 1024 ** 2, lifecycle: 32 * 1024 ** 2 };
