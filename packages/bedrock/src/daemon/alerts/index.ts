import { join } from "node:path";
import { BedrockError } from "../../error";
import type { DaemonDatabase } from "../db";
import { readConfig, type DaemonConfig } from "../config";
import type { Supervisor } from "../supervisor";
import type { JobEvent, PebbleCheck, Readiness, Snapshot } from "./model";
interface Pending { resolve: (value: any) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }
export class Alerts {
  private worker: Worker | undefined;
  private pending = new Map<number, Pending>();
  private id = 0;
  private stopped = false;
  private warned = false;
  private probing: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private proxyPort: number | undefined;
  private readiness = new Map<string, { state: Readiness; observed_at: number }>();
  constructor(readonly home: string, private clock?: () => number, private config?: DaemonConfig) { this.startWorker(); }
  private startWorker() {
    if (this.stopped) return;
    this.worker = new Worker(new URL("./worker.ts", import.meta.url).href);
    this.worker.onmessage = ({ data }) => {
      if (!data.id && data.error) { this.crash(); return; }
      const pending = this.pending.get(data.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(data.id);
      if (data.error) pending.reject(new BedrockError(data.error.code, data.error.message, data.error.hint)); else pending.resolve(data.value);
    };
    this.worker.onerror = event => { event.preventDefault(); this.crash(); };
    this.worker.postMessage({ op: "init", home: this.home, config: this.config ? { domain: this.config.domain, alerts: this.config.alerts } : undefined, proxyPort: this.proxyPort, testClock: !!this.clock, now: this.clock?.() });
  }
  private crash() {
    this.worker?.terminate(); this.worker = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new BedrockError("ALERTS_UNAVAILABLE", "Alert Worker stopped.", "Serving continues; alerts retry automatically. Inspect daemon logs and disk space.")); }
    this.pending.clear();
    if (!this.stopped) { const timer = setTimeout(() => this.startWorker(), 60000); timer.unref(); }
  }
  private rpc(op: string, body: object = {}) {
    if (!this.worker || this.pending.size >= 128) return Promise.reject(new BedrockError("ALERTS_UNAVAILABLE", "Alerts unavailable or busy.", "Retry shortly and inspect daemon logs; serving continues."));
    const id = ++this.id;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => this.crash(), 5000); timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ op, id, now: this.clock?.(), ...body });
    });
  }
  private record(work: Promise<unknown>) { void work.then(() => { this.warned = false; }).catch(() => { if (!this.warned) console.error("Alerts unavailable: inspect daemon logs, disk space and bedrock alerts."); this.warned = true; }); }
  job(pebble: string, event: JobEvent) { this.record(this.rpc("job", { pebble, event })); }
  exit(pebble: string) { this.record(this.rpc("exit", { pebble })); }
  setProxyPort(port: number) { this.proxyPort = port; this.record(this.rpc("proxy", { port })); }
  view() { return this.rpc("view"); }
  history(pebble: string) { return this.rpc("history", { pebble }); }
  silence(fingerprint: string, until: number) { return this.rpc("silence", { fingerprint, until }); }
  test() { return this.rpc("test"); }
  dispatchForTests() { return this.rpc("dispatchForTests"); }
  snapshotForTests(snapshot: Snapshot) { return this.rpc("snapshot", { snapshot }); }
  status(name: string, status: string) {
    if (status === "idle") return { state: "idle", available_on_demand: true, observed_at: null };
    if (status === "stopped") return { state: "stopped", observed_at: null };
    if (status === "crashed" || status === "restarting") return { state: status === "crashed" ? "failed" : "starting", observed_at: null };
    const observed = this.readiness.get(name);
    return observed && Date.now() - observed.observed_at < 65000 ? observed : { state: status === "crashed" ? "failed" : "starting", observed_at: null };
  }
  start(db: DaemonDatabase, supervisor: Supervisor, config: DaemonConfig, tunnel: () => boolean | null) {
    const tick = () => {
      if (this.probing || this.stopped) return;
      this.probing = this.probe(db, supervisor, config, tunnel).catch(() => { this.record(Promise.reject()); }).finally(() => { this.probing = undefined; });
    };
    this.timer = setInterval(tick, 30000); this.timer.unref(); tick();
  }
  private async probe(db: DaemonDatabase, supervisor: Supervisor, config: DaemonConfig, tunnel: () => boolean | null) {
    const records = db.list(), pebbles: PebbleCheck[] = [];
    let index = 0;
    const work = async () => {
      while (index < records.length) {
        const record = records[index++]!;
        let child = supervisor.child(record.name);
        let readiness: Readiness = record.status === "idle" ? "idle" : record.status === "stopped" ? "stopped" : child ? "starting" : "failed";
        if (child && !["idle", "stopped"].includes(record.status)) {
          try { readiness = (await supervisor.readiness(record.name, child)).state; } catch { readiness = "failed"; }
          if (supervisor.child(record.name) !== child) { child = supervisor.child(record.name); readiness = "starting"; }
        }
        this.readiness.set(record.name, { state: readiness, observed_at: Date.now() });
        pebbles.push({ name: record.name, status: record.status, release: record.release, readiness, ...(child?.jobSchedules ? { jobs: child.jobSchedules } : {}) });
      }
    };
    await Promise.all([work(), work()]);
    for (const name of this.readiness.keys()) if (!records.some(p => p.name === name)) this.readiness.delete(name);
    const snapshot: Snapshot = { pebbles, tunnel: tunnel() };
    const backup = (await readConfig(this.home).catch(error => { if (config.domain === "localhost") return config; throw error; })).backup;
    if (backup) {
      const state = await Bun.file(join(this.home, "backup-state.json")).json().catch(() => null);
      snapshot.backup = { interval: (backup.intervalMinutes ?? 60) * 60000, successes: Object.fromEntries(["_daemon", ...records.map(p => p.name)].map(name => [name, (name === "_daemon" ? state?.daemon : state?.pebbles?.[name]) ?? null])) };
    }
    await this.rpc("snapshot", { snapshot });
  }
  async pause() { clearInterval(this.timer); await this.probing; }
  async close() {
    this.stopped = true; clearInterval(this.timer);
    await this.probing;
    try { await this.rpc("close"); } catch {} finally { this.worker?.terminate(); this.worker = undefined; }
  }
}
