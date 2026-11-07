import { ErrorWorker, type ErrorWork } from "../errors/worker";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { requireSpace } from "../../disk";
import { asBedrockError, type BedrockError } from "../../error";
import { TelemetryStore } from "./store";
import type { Query, Record } from "./model";
import { sampleResources, type ResourceGroup } from "./resources";

declare const self: Worker;
const errors = new ErrorWorker();
let store: TelemetryStore | undefined, home = "", retryAt = 0;
let fault: "full" | "crash" | null = null;
let retryDelay = 60_000;
let lastError: BedrockError | undefined;
const secrets = new Map<string, string[]>();
const redact = (pebble: string, text: string) => {
  for (const secret of secrets.get(pebble) ?? []) text = text.replaceAll(secret, "[REDACTED]");
  return text;
};
const handle = async ({ data }: MessageEvent<{ op: string; id: number; home: string; records: Record[]; query: Query; pebble: string; secrets: string[]; groups: ResourceGroup[]; fault: "full" | "crash" | null; retryMs: number; boot: string; drops: { [pebble: string]: object }; before?: number } & ErrorWork>) => {
  if (data.op === "init") { home = data.home; self.postMessage({ op: "ready" }); return; }
  if (data.op === "forget" && data.before === undefined) secrets.delete(data.pebble);
  if (data.op === "protect") { secrets.set(data.pebble, data.secrets); return; }
  if (data.op === "fault") {
    fault = data.fault; retryAt = 0; retryDelay = data.retryMs;
    self.postMessage({ id: data.id, value: true });
    if (fault === "crash") setTimeout(() => { throw new Error("Injected telemetry Worker crash"); }, 1);
    return;
  }
  try {
    if (data.op.startsWith("errors.")) {
      const value = await errors.handle(home, data, secrets);
      self.postMessage({ id: data.id, value }); return;
    }
    if (Date.now() < retryAt) throw lastError ?? new Error("Telemetry storage is waiting to retry");
    if (!store) {
      await requireSpace(home, 4 * 1024 ** 2);
      store = new TelemetryStore(join(home, "observability.sqlite"));
    }
    if (data.op === "forget") {
      const before = data.before ?? store.db.query<{ id: number }, []>("SELECT coalesce(max(id),0) AS id FROM records").get()!.id;
      const removed = store.purge(data.pebble, before);
      if (!removed) {
        store.db.query("DELETE FROM losses WHERE pebble=?").run(data.pebble);
        store.db.query("DELETE FROM drop_snapshots WHERE pebble=?").run(data.pebble);
      }
      self.postMessage({ id: data.id, value: { before, remaining: removed > 0 } }); return;
    }
    if (data.op === "query") { self.postMessage({ id: data.id, value: { ...store.query(data.query), historical_drops: store.historicalDrops(data.query.pebble, data.boot) } }); return; }
    if (data.op === "close") { errors.close(); store.close(); store = undefined; self.postMessage({ id: data.id, value: true }); return; }
    if (data.op === "batch" || data.op === "resources") {
      if (fault === "full") throw Object.assign(new Error("Injected full telemetry filesystem"), { code: "SQLITE_FULL" });
      await requireSpace(home, 4 * 1024 ** 2);
      const wal = await stat(join(home, "observability.sqlite-wal")).catch(() => null);
      if (wal && wal.size >= 64 * 1024 ** 2) throw new Error("Telemetry WAL budget reached");
      const records = data.op === "resources" ? await sampleResources(data.groups) : data.records;
      for (const record of records) if (record.kind === "logs") record.text = redact(record.pebble, record.text);
      const dropped = store.write(records);
      if (data.drops) store.snapshots(data.boot, data.drops);
      self.postMessage({ id: data.id, value: { dropped } });
    }
  } catch (error) {
    const typed = asBedrockError(error, "TELEMETRY_UNAVAILABLE", "Free disk space or fix observability.sqlite permissions; telemetry retries once a minute.", join(home, "observability.sqlite"));
    if (data.op.startsWith("errors.")) { self.postMessage({ id: data.id, error: typed.toJSON() }); return; }
    // A bad query is a caller error, not a storage outage.
    if (typed.code !== "INVALID_ARGS") {
      if (Date.now() >= retryAt) retryAt = Date.now() + retryDelay;
      lastError = typed;
      try { store?.close(); } catch {}
      store = undefined;
    }
    self.postMessage({ id: data.id, error: typed.toJSON() });
  }
};

let work = Promise.resolve();
self.onmessage = event => { work = work.then(() => handle(event)); };
