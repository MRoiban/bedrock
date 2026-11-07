import { cleanEvent, type ErrorEvent } from "../../errors/model";
import type { ErrorTransition } from "./store";
type Rpc = (op: string, body?: object) => Promise<any>;
export class ErrorTracking {
  private queue: { pebble: string; event: ErrorEvent }[] = [];
  private bytes = 0;
  private inFlight = 0;
  private bodies = 0;
  private busy: Promise<void> | undefined;
  private rates = new Map<string, { minute: number; browser: number; server: number }>();
  private listeners = new Set<(event: ErrorTransition) => void>();
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private counters: Record<string, number> = {};
  private lastMaintenance = Date.now();
  constructor(private rpc: Rpc) {
    this.timer = setInterval(() => {
      void this.flush();
      if (Date.now() - this.lastMaintenance >= 60000 && !this.busy) {
        this.lastMaintenance = Date.now(); void this.rpc("errors.maintain").catch(() => {});
      }
    }, 1000); this.timer.unref();
  }
  body() {
    if (this.bodies >= 16 || this.stopped) return null;
    this.bodies++; return () => { this.bodies--; };
  }
  onIssue(listener: (event: ErrorTransition) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  drop(reason: string, count = 1) { this.counters[reason] = (this.counters[reason] ?? 0) + count; }
  accept(pebble: string, events: ErrorEvent[], now = Date.now()) {
    if (this.stopped) return "unavailable";
    const minute = Math.floor(now / 60000);
    let rate = this.rates.get(pebble);
    if (!rate || rate.minute !== minute) { rate = { minute, browser: 0, server: 0 }; this.rates.set(pebble, rate); }
    const browser = events[0]?.runtime === "browser";
    const used = browser ? rate.browser : rate.server;
    // Browser traffic cannot consume the 30 reserved server reports.
    if (used + events.length > (browser ? 90 : 120 - rate.browser) || rate.browser + rate.server + events.length > 120) { this.drop("rate", events.length); return "rate"; }
    const bytes = events.reduce((n, event) => n + Buffer.byteLength(JSON.stringify(event)), 0);
    if (this.bytes + bytes > (browser ? 768 : 1024) * 1024 || this.queue.length + this.inFlight + events.length > (browser ? 192 : 256)) { this.drop("queue", events.length); return "queue"; }
    if (browser) rate.browser += events.length; else rate.server += events.length;
    this.bytes += bytes;
    for (const event of events) this.queue.push({ pebble, event });
    return null;
  }
  server(pebble: string, input: unknown, release: string) {
    const event = cleanEvent(input, "server");
    if (event) { event.release = release; this.accept(pebble, [event]); }
  }
  flush() {
    if (this.busy) return this.busy;
    if (!this.queue.length) return Promise.resolve();
    const records = this.queue.splice(0, 20);
    // Keep in-flight bytes charged until the Worker acknowledges them.
    const bytes = records.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r.event)), 0);
    this.inFlight = records.length;
    this.busy = this.rpc("errors.batch", { errorRecords: records }).then(result => {
      for (const event of result.transitions) for (const listener of this.listeners) { try { listener(event); } catch {} }
    }).catch(() => { this.drop("storage", records.length); }).finally(() => { this.bytes = Math.max(0, this.bytes - bytes); this.inFlight = 0; this.busy = undefined; });
    return this.busy;
  }
  async query(pebble: string, id?: string, cursor = 0) {
    const batches = Math.ceil(this.queue.length / 20) + 1;
    for (let i = 0; i < batches; i++) await this.flush();
    return { ...await this.rpc("errors.query", { pebble, issue: id, cursor }), drops_since_boot: { ...this.counters } };
  }
  change(pebble: string, issue: string, action: string, target?: string) { return this.rpc("errors.change", { pebble, issue, action, target }); }
  transitions(pebble: string, after: number) { return this.rpc("errors.transitions", { pebble, after }); }
  forget(pebble: string) { this.bytes -= this.queue.filter(r => r.pebble === pebble).reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r.event)), 0); this.queue = this.queue.filter(r => r.pebble !== pebble); this.rates.delete(pebble); void this.rpc("errors.forget", { pebble }).catch(() => {}); }
  async close() { clearInterval(this.timer); this.stopped = true; while (this.queue.length || this.busy) await this.flush(); }
}
