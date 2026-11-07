import { createSecrets } from "../secrets";
import { join } from "node:path";
import { BedrockError } from "../../error";
import { scrub, type ErrorEvent } from "../../errors/model";
import { prepareError } from "./prepare";
import { ErrorStore } from "./store";
import { SourceMapCache, SymbolicationBatch } from "./symbolication";
export interface ErrorWork {
  op: string; errorRecords: { pebble: string; event: ErrorEvent }[];
  pebble: string; issue?: string; action: string; target?: string; cursor: number; after: number;
}
export class ErrorWorker {
  private store: ErrorStore | undefined;
  private retryAt = 0;
  private maps = new SourceMapCache();
  private protections = new Map<string, string[]>();
  async handle(home: string, data: ErrorWork, secrets: Map<string, string[]>) {
    try {
      if (Date.now() < this.retryAt) throw new Error("Storage retry pending");
      if (data.op === "errors.maintain" && !this.store && !await Bun.file(join(home, "errors.sqlite")).exists()) return true;
      const store = this.store ??= new ErrorStore(join(home, "errors.sqlite"));
      const loaded = new Set<string>();
      const protect = async (pebble: string) => {
        if (!loaded.has(pebble)) {
          const current = Object.values(await createSecrets(home).env(pebble));
          this.protections.set(pebble, [...new Set([...(this.protections.get(pebble) ?? []), ...(secrets.get(pebble) ?? []), ...current])].filter(value => value.length >= 4).sort((a, b) => b.length - a.length));
          loaded.add(pebble);
        }
        return this.protections.get(pebble)!;
      };
      if (data.op === "errors.batch") {
        const transitions = [], symbols = new SymbolicationBatch(this.maps);
        for (const { pebble, event } of data.errorRecords) {
          const prepared = await prepareError(home, pebble, event, event.runtime, await protect(pebble), symbols);
          if (!prepared) { store.drop("invalid"); continue; }
          const transition = store.write(pebble, prepared); if (transition) transitions.push(transition);
        }
        return { transitions };
      }
      if (data.op === "errors.maintain") { store.maintain(); return true; }
      if (data.op === "errors.query") {
        store.maintain();
        const page = store.query(data.pebble, data.issue, data.cursor), known = await protect(data.pebble);
        for (const issue of page.issues) if (typeof issue.type === "string") issue.type = scrub(issue.type, known);
        for (const sample of page.samples ?? []) {
          sample.type = scrub(sample.type, known); sample.message = scrub(sample.message, known);
          for (const frame of [...sample.frames, ...sample.generated]) { frame.file = scrub(frame.file, known); frame.function = scrub(frame.function, known); }
        }
        return page;
      }
      if (data.op === "errors.change") return store.change(data.pebble, data.issue!, data.action, data.target);
      if (data.op === "errors.forget") { store.forget(data.pebble); this.protections.delete(data.pebble); return true; }
      if (data.op === "errors.transitions") return store.db.query("SELECT * FROM transitions WHERE pebble=? AND id>? AND time>=? ORDER BY id LIMIT 100").all(data.pebble, data.after, Date.now() - 90 * 86400000);
      throw new BedrockError("INVALID_ARGS", "Unknown error operation.", "Use the documented error API endpoints.");
    } catch (error) {
      if (error instanceof BedrockError) throw error;
      try { this.store?.close(); } catch {} this.store = undefined;
      if (Date.now() >= this.retryAt) this.retryAt = Date.now() + 60000;
      throw new BedrockError("ERRORS_UNAVAILABLE", "Error storage is unavailable.", "Free disk space or fix errors.sqlite permissions; ingestion retries once a minute.");
    }
  }
  close() { this.store?.close(); this.store = undefined; }
}
