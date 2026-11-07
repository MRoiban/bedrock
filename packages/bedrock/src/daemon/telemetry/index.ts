import { BedrockError } from "../../error";
import { type Query, type Record as TelemetryRecord, type Traffic } from "./model";
import { RequestMetrics, type RequestObservation } from "./requests";
export type { RequestObservation } from "./requests";
import type { ResourceGroup } from "./resources";

const QUEUE_BYTES = 4 * 1024 ** 2;
interface Pending { resolve: (value: any) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }
export class Telemetry {
  private worker: Worker | undefined;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private boot = crypto.randomUUID();
  private inflightBytes = 0;
  private queue: TelemetryRecord[] = [];
  private queueBytes = 0;
  private busy = false;
  private batch: Promise<void> | undefined;
  private stopped = false;
  private warned = false;
  private timer: ReturnType<typeof setInterval>;
  private resourceTimer: ReturnType<typeof setInterval>;
  private counters = new Map<string, { [reason: string]: number }>();
  private metrics = new RequestMetrics(record => this.add(record));
  private eventRates = new Map<string, { second: number; count: number }>();
  private protections = new Map<string, string[]>();
  private rates = new Map<string, { second: number; lines: number; bytes: number }>();
  readonly started = Date.now();
  constructor(readonly home: string, private readonly groups: () => ResourceGroup[], readonly enabled = true) {
    if (enabled) this.startWorker();
    this.timer = setInterval(() => this.flush(), 1000); this.timer.unref();
    this.resourceTimer = setInterval(() => this.resources(), 15_000); this.resourceTimer.unref();
  }
  /** Internal fault injection; no configuration, environment or API surface. */
  faultForTests(fault: "full" | "crash" | null, retryMs = 60_000) { return this.rpc("fault", { fault, retryMs }); }
  private startWorker() {
    if (this.stopped || !this.enabled) return;
    try {
      const worker = this.worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(data.id);
        if (data.error) pending.reject(new BedrockError(data.error.code, data.error.message, data.error.hint)); else pending.resolve(data.value);
      };
      worker.onerror = event => { event.preventDefault(); this.crash(); };
      worker.postMessage({ op: "init", home: this.home });
      for (const [pebble, secrets] of this.protections) worker.postMessage({ op: "protect", pebble, secrets });
    } catch { this.crash(); }
  }
  private crash() {
    this.worker?.terminate(); this.worker = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new BedrockError("TELEMETRY_UNAVAILABLE", "Telemetry Worker stopped.", "Telemetry restarts automatically; check daemon logs.")); }
    this.pending.clear();
    if (!this.stopped) { const timer = setTimeout(() => this.startWorker(), 1000); timer.unref(); }
  }
  private rpc(op: string, body: object = {}) {
    if (!this.worker || this.pending.size >= 16) return Promise.reject(new BedrockError("TELEMETRY_UNAVAILABLE", "Telemetry is unavailable or busy.", "Retry shortly; serving continues independently."));
    const id = ++this.sequence;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => this.crash(), 5000); timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker!.postMessage({ op, id, ...body }); } catch { this.crash(); }
    });
  }
  drop(pebble: string, reason: string, count = 1) {
    const counters = this.counters.get(pebble) ?? {}; counters[reason] = (counters[reason] ?? 0) + count; this.counters.set(pebble, counters);
  }
  drops(pebble: string) { return { ...(this.counters.get(pebble) ?? {}) }; }
  private add(record: TelemetryRecord, bytes = 1024) {
    if (!this.enabled || this.stopped) return;
    if (record.kind === "events") {
      const second = Math.floor(Date.now() / 1000);
      let rate = this.eventRates.get(record.pebble);
      if (rate?.second !== second) { rate = { second, count: 0 }; this.eventRates.set(record.pebble, rate); }
      if (rate!.count++ >= 10) { this.drop(record.pebble, "event_rate"); return; }
    }
    const reserve = record.kind === "logs" || record.kind === "events" ? 512 * 1024 : 0;
    if (this.queueBytes + this.inflightBytes + bytes > QUEUE_BYTES - reserve || this.queue.length >= (reserve ? 3584 : 4096)) { this.drop(record.pebble, "queue"); return; }
    this.queue.push(record); this.queueBytes += bytes;
    if (this.queue.length >= 256) this.flush();
  }
  flush() {
    if (this.busy || !this.enabled || this.stopped) return;
    for (const record of this.metrics.take()) {
      if (this.queueBytes + this.inflightBytes + 1024 > QUEUE_BYTES || this.queue.length >= 4096) this.drop(record.pebble, "metric_queue", Math.max(1, Math.abs(record.value.starts) + record.value.completions));
      else { this.queue.push(record); this.queueBytes += 1024; }
    }
    if (!this.queue.length) return;
    const records = this.queue.splice(0, 256); this.queueBytes = this.queue.reduce((n, r) => n + (r.kind === "logs" ? Buffer.byteLength(r.text) + 1024 : 1024), 0);
    this.inflightBytes = records.reduce((n, r) => n + (r.kind === "logs" ? Buffer.byteLength(r.text) + 1024 : 1024), 0);
    this.busy = true;
    this.batch = this.rpc("batch", { records, boot: this.boot, drops: Object.fromEntries(this.counters) }).then(result => {
      for (const drop of result.dropped) this.drop(drop.pebble, drop.kind);
      this.warned = false;
    }).catch(error => {
      for (const record of records) this.drop(record.pebble, "storage");
      if (!this.warned) console.error(`${error instanceof BedrockError ? error.code : "TELEMETRY_UNAVAILABLE"}: dropping telemetry; fix storage/Worker. Retrying automatically.`);
      this.warned = true;
    }).finally(() => { this.busy = false; this.inflightBytes = 0; if (this.queue.length >= 256) this.flush(); });
  }
  now(pebble: string) { return this.metrics.now(pebble); }
  begin(pebble: string, method: string, path: string, traffic: Traffic): RequestObservation {
    if (!this.enabled) return { headers() {}, finish() {}, route() {} };
    return this.metrics.begin(pebble, method, path, traffic);
  }
  protect(pebble: string, secrets: string[]) { this.protections.set(pebble, secrets); this.worker?.postMessage({ op: "protect", pebble, secrets }); }
  private logSequence = 0;
  logWatermark() { return { boot: this.boot, sequence: this.logSequence }; }
  log(pebble: string, text: string, stream: string, run: string) {
    const second = Math.floor(Date.now() / 1000);
    let rate = this.rates.get(pebble); if (rate?.second !== second) { rate = { second, lines: 0, bytes: 0 }; this.rates.set(pebble, rate); }
    if (rate!.lines++ >= 50 || rate!.bytes >= 128 * 1024) { this.drop(pebble, "log_rate"); return false; }
    const bytes = Buffer.from(text); if (bytes.length > 16384) this.drop(pebble, "log_truncated");
    text = new TextDecoder().decode(bytes.subarray(0, 16384), { stream: true }); rate!.bytes += Buffer.byteLength(text);
    this.add({ kind: "logs", pebble, time: Date.now(), text, stream, run, boot: this.boot, sequence: ++this.logSequence }, Buffer.byteLength(text) + 1024); return text;
  }
  lifecycle(pebble: string, event: string, run: string | null = null, code: number | null = null, signal: string | null = null, retry_at: number | null = null) { this.add({ kind: "lifecycle", pebble, time: Date.now(), event, run, code, signal, retry_at }); }
  private resources() {
    if (this.busy || this.stopped || !this.enabled) return;
    const groups = this.groups();
    void this.rpc("resources", { groups }).then(result => { for (const drop of result.dropped) this.drop(drop.pebble, drop.kind); }).catch(() => { for (const group of groups) this.drop(group.pebble, "resource_storage"); });
  }
  async query(query: Query) {
    this.flush();
    const queued = this.queue.length;
    await this.batch;
    for (let remaining = queued; remaining > 0; remaining -= 256) { this.flush(); await this.batch; }
    const result = await this.rpc("query", { query, boot: this.boot });
    return { ...result, drops: this.drops(query.pebble), drop_scope: "daemon_boot", collected_since: this.started, now: this.now(query.pebble) };
  }
  private async purge(pebble: string) {
    let before: number | undefined;
    while (!this.stopped) {
      const result = await this.rpc("forget", { pebble, before }).catch(() => null);
      if (!result?.remaining) return;
      before = result.before;
      await Bun.sleep(1);
    }
  }
  forget(pebble: string) {
    this.queue = this.queue.filter(record => record.pebble !== pebble);
    this.queueBytes = this.queue.reduce((n, r) => n + (r.kind === "logs" ? Buffer.byteLength(r.text) + 1024 : 1024), 0);
    this.counters.delete(pebble);
    void this.purge(pebble);
    this.metrics.forget(pebble); this.eventRates.delete(pebble);
    this.rates.delete(pebble); this.protections.delete(pebble);
  }
  async close() {
    clearInterval(this.timer); clearInterval(this.resourceTimer);
    this.flush();
    const deadline = Date.now() + 1500;
    while ((this.busy || this.queue.length || this.metrics.hasPending()) && Date.now() < deadline) { this.flush(); await Bun.sleep(10); }
    this.stopped = true;
    try { await this.rpc("close"); } catch {}
    this.worker?.terminate(); this.worker = undefined;
  }
}
