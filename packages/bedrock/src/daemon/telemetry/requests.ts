import { emptyRed, observe, type Red, type Traffic, type Record as TelemetryRecord } from "./model";
import { requestMethod, routeShape } from "./privacy";
export interface RequestObservation { headers(status: number, stream?: boolean): void; finish(outcome?: "failure" | "abort"): void; route(keys: string[]): void }
interface Gauge { pebble: string; traffic: Traffic; inflight: number; sockets: number; closed: boolean; updated: number }
export class RequestMetrics {
  private gauges = new Map<string, Gauge>();
  private deltas = new Map<string, { kind: "metrics"; pebble: string; traffic: Traffic; time: number; value: Red }>();
  constructor(private readonly diagnostic: (record: TelemetryRecord) => void) {}
  private bucket(pebble: string, traffic: Traffic, time = Date.now()) {
    time = Math.floor(time / 1000) * 1000;
    const key = `${pebble}:${traffic}:${time}`;
    let delta = this.deltas.get(key);
    if (!delta) { delta = { kind: "metrics", pebble, traffic, time, value: emptyRed() }; this.deltas.set(key, delta); }
    return delta.value;
  }
  private gauge(pebble: string, traffic: Traffic) {
    const key = `${pebble}:${traffic}`;
    let gauge = this.gauges.get(key);
    if (!gauge) { gauge = { pebble, traffic, inflight: 0, sockets: 0, closed: false, updated: Date.now() }; this.gauges.set(key, gauge); }
    return gauge;
  }
  private touch(gauge: Gauge) {
    const now = Date.now();
    // Split integrals at UTC second boundaries, even for quiet long-lived streams.
    for (let time = gauge.inflight || gauge.sockets ? gauge.updated : now; time < now;) {
      const end = Math.min(now, Math.floor(time / 1000) * 1000 + 1000);
      const value = this.bucket(gauge.pebble, gauge.traffic, time);
      value.inflight_ms += gauge.inflight * (end - time); value.socket_ms += gauge.sockets * (end - time);
      time = end;
    }
    gauge.updated = now;
    const value = this.bucket(gauge.pebble, gauge.traffic);
    value.gauge_at = now; value.inflight = gauge.inflight; value.sockets = gauge.sockets;
    value.inflight_peak = Math.max(value.inflight_peak, gauge.inflight); value.sockets_peak = Math.max(value.sockets_peak, gauge.sockets);
  }
  now(pebble: string) { return Object.fromEntries((["ordinary", "stream", "websocket", "control"] as Traffic[]).map(traffic => { const value = this.gauge(pebble, traffic); return [traffic, { inflight: value.inflight, open_sockets: value.sockets }]; })); }
  begin(pebble: string, method: string, path: string, traffic: Traffic): RequestObservation {
    const start = performance.now(), wall = Date.now();
    let gauge = this.gauge(pebble, traffic), status = 0, headers: number | null = null, finished = false, keys: string[] = [];
    this.touch(gauge); gauge.inflight++; this.touch(gauge); this.bucket(pebble, traffic, wall).starts++;
    return {
      route(value) { keys = value; },
      headers: (code, stream = false) => {
        if (finished || gauge.closed || headers !== null) return;
        status = code; headers = (performance.now() - start) / 1000;
        if (stream && traffic === "ordinary") {
          this.touch(gauge); gauge.inflight--; this.touch(gauge);
          this.bucket(pebble, traffic, wall).starts--;
          traffic = "stream"; gauge = this.gauge(pebble, traffic);
          this.touch(gauge); gauge.inflight++; this.touch(gauge); this.bucket(pebble, traffic, wall).starts++;
        }
        if (traffic === "websocket" && code === 101) { this.touch(gauge); gauge.sockets++; this.touch(gauge); this.bucket(pebble, traffic).handshakes++; }
      },
      finish: outcome => {
        if (finished || gauge.closed) return; finished = true;
        const lifetime = (performance.now() - start) / 1000, failed = outcome !== "abort" && (outcome === "failure" || status >= 500);
        this.touch(gauge); gauge.inflight--; if (traffic === "websocket" && status === 101) gauge.sockets--; this.touch(gauge);
        const value = this.bucket(pebble, traffic);
        value.completions++; if (outcome === "abort") value.client_aborts++; else if (failed) value.failures++;
        if (status >= 400 && status < 500) value.client_errors++; if (status === 429) value.throttled++;
        if (headers !== null) { value.headers_sum_s += headers; value.headers_max_s = Math.max(value.headers_max_s, headers); }
        value.lifetime_sum_s += lifetime; value.lifetime_max_s = Math.max(value.lifetime_max_s, lifetime);
        if (outcome !== "abort" && headers !== null) observe(failed ? value.headers_failure : value.headers_success, headers);
        if (outcome !== "abort") observe(failed ? value.lifetime_failure : value.lifetime_success, lifetime);
        if (failed || lifetime > 1 || Math.random() < .01) this.diagnostic({ kind: "events", pebble, time: Date.now(), route: routeShape(method, path, keys), method: requestMethod(method), status, outcome: outcome ?? (failed ? "failure" : "success"), headers_s: headers, lifetime_s: lifetime });
      },
    };
  }
  hasPending() { return this.deltas.size > 0; }
  take() {
    for (const gauge of this.gauges.values()) if (gauge.inflight || gauge.sockets) this.touch(gauge); else gauge.updated = Date.now();
    const values = [...this.deltas.values()]; this.deltas.clear(); return values;
  }
  forget(pebble: string) {
    for (const [key, gauge] of this.gauges) if (gauge.pebble === pebble) { gauge.closed = true; this.gauges.delete(key); }
    for (const [key, delta] of this.deltas) if (delta.pebble === pebble) this.deltas.delete(key);
  }
}
