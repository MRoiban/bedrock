import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { BedrockError } from "../../error";
import { bounds, budgets, mergeRed, quantile, type Query, type Record } from "./model";

import { packRed, unpackRed, packResource, unpackResource, packLog, unpackLog } from "./encoding";

const day = 86400_000;
const category = (kind: Record["kind"]) => kind === "resources" ? "metrics" : kind;
// Charge compact payloads plus row/index allowance; logs also reserve FTS space. The physical cap is independent.
const charge = (record: Record) => record.kind === "logs" ? Buffer.byteLength(record.text) * 2 + 256 : record.kind === "metrics" ? Buffer.byteLength(packRed(record.value)) + 64 : record.kind === "resources" ? Buffer.byteLength(packResource(record.value)) + 64 : Buffer.byteLength(JSON.stringify(record)) * 2 + 256;
export class TelemetryStore {
  readonly db: Database;
  constructor(path: string, readonly limits = budgets) {
    this.db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      PRAGMA busy_timeout=0; PRAGMA cache_size=-8192; PRAGMA cache_spill=OFF; PRAGMA journal_size_limit=0;
      CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, pebble TEXT NOT NULL, time INTEGER NOT NULL, step INTEGER NOT NULL DEFAULT 0, traffic TEXT NOT NULL DEFAULT '', value TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', bytes INTEGER NOT NULL);
      DROP INDEX IF EXISTS records_budget;
      DROP INDEX IF EXISTS records_physical;
      DROP INDEX IF EXISTS records_time;
      CREATE INDEX IF NOT EXISTS records_retention ON records(kind,step,time);
      DROP INDEX IF EXISTS records_page;
      CREATE INDEX IF NOT EXISTS records_raw_page ON records(kind,pebble,time,id) WHERE step=0;
      CREATE UNIQUE INDEX IF NOT EXISTS rollup ON records(kind,pebble,time,step,traffic) WHERE step>0;
      CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(text,content='records',content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS logs_insert AFTER INSERT ON records WHEN new.kind='logs' BEGIN INSERT INTO logs_fts(rowid,text) VALUES(new.id,new.text); END;
      CREATE TRIGGER IF NOT EXISTS logs_delete AFTER DELETE ON records WHEN old.kind='logs' BEGIN INSERT INTO logs_fts(logs_fts,rowid,text) VALUES('delete',old.id,old.text); END;
      CREATE TABLE IF NOT EXISTS accounting(kind TEXT PRIMARY KEY, bytes INTEGER NOT NULL DEFAULT 0, evicted INTEGER NOT NULL DEFAULT 0);
      CREATE TRIGGER IF NOT EXISTS account_insert AFTER INSERT ON records BEGIN INSERT INTO accounting(kind,bytes) VALUES(CASE WHEN new.kind='resources' THEN 'metrics' ELSE new.kind END,new.bytes) ON CONFLICT(kind) DO UPDATE SET bytes=bytes+new.bytes; END;
      CREATE TRIGGER IF NOT EXISTS account_delete AFTER DELETE ON records BEGIN UPDATE accounting SET bytes=bytes-old.bytes WHERE kind=CASE WHEN old.kind='resources' THEN 'metrics' ELSE old.kind END; END;
      CREATE TRIGGER IF NOT EXISTS account_update AFTER UPDATE OF bytes ON records BEGIN UPDATE accounting SET bytes=bytes+new.bytes-old.bytes WHERE kind=CASE WHEN old.kind='resources' THEN 'metrics' ELSE old.kind END; END;
      CREATE TABLE IF NOT EXISTS metric_tiers(step INTEGER PRIMARY KEY, bytes INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS tier_insert AFTER INSERT ON records WHEN new.kind IN ('metrics','resources') BEGIN INSERT INTO metric_tiers VALUES(new.step,new.bytes) ON CONFLICT(step) DO UPDATE SET bytes=bytes+new.bytes; END;
      CREATE TRIGGER IF NOT EXISTS tier_delete AFTER DELETE ON records WHEN old.kind IN ('metrics','resources') BEGIN UPDATE metric_tiers SET bytes=bytes-old.bytes WHERE step=old.step; END;
      CREATE TRIGGER IF NOT EXISTS tier_update AFTER UPDATE OF bytes ON records WHEN old.kind IN ('metrics','resources') BEGIN UPDATE metric_tiers SET bytes=bytes+new.bytes-old.bytes WHERE step=old.step; END;
      CREATE TABLE IF NOT EXISTS losses(pebble TEXT NOT NULL,reason TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(pebble,reason));
      CREATE TABLE IF NOT EXISTS drop_snapshots(boot TEXT NOT NULL,pebble TEXT NOT NULL,time INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(boot,pebble));
      CREATE TABLE IF NOT EXISTS windows(id INTEGER PRIMARY KEY,start INTEGER NOT NULL,end INTEGER NOT NULL);`);
    const page = this.db.query<{ page_size: number }, []>("PRAGMA page_size").get()!.page_size;
    // With no spills, a transaction writes each dirty page once. DB + a full-page WAL stays below 512 MiB.
    this.db.exec(`PRAGMA max_page_count=${Math.floor(248 * 1024 ** 2 / page)}`);
    this.compactLegacy();
  }
  private legacyAfter = 0;
  private compacted = false;
  private compactLegacy() {
    if (this.compacted) return;
    if (this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version >= 1) { this.compacted = true; return; }
    if (!this.legacyAfter) this.db.exec("INSERT OR IGNORE INTO metric_tiers SELECT step,sum(bytes) FROM records WHERE kind IN ('metrics','resources') GROUP BY step");
    // Upgrade disposable history incrementally so opening an old full DB cannot trip the Worker watchdog.
    const rows = this.db.query<{ id: number; kind: string; value: string; text: string }, [number]>(`SELECT id,kind,value,text FROM records WHERE id>? AND
      ((kind IN ('metrics','resources') AND substr(value,1,1)='{') OR (kind='logs' AND json_type(value,'$.text')='text')) ORDER BY id LIMIT 256`).all(this.legacyAfter);
    this.db.transaction(() => {
      for (const row of rows) {
        let value = row.value;
        if (row.kind === "metrics") value = packRed(unpackRed(value));
        else if (row.kind === "resources") {
          const resource = unpackResource(value);
          if (resource.source !== "cgroup") { this.db.query("DELETE FROM records WHERE id=?").run(row.id); continue; }
          value = packResource(resource);
        } else { const log = JSON.parse(value); value = packLog(log); }
        this.db.query("UPDATE records SET value=?,bytes=? WHERE id=?").run(value, row.kind === "logs" ? Buffer.byteLength(row.text) * 2 + 256 : Buffer.byteLength(value) + 64, row.id);
      }
    })();
    this.checkpoint();
    if (rows.length) this.legacyAfter = rows.at(-1)!.id;
    else { this.db.exec("PRAGMA user_version=1"); this.compacted = true; }
  }
  private deletions = 0;
  private room(kind: keyof typeof budgets, bytes: number, step = 0, keepId?: number) {
    if (bytes <= 0) return true;
    const shares: { [step: number]: number } = { 0: 32, 1: 4, 60: 96, 3600: 22, 86400: 6 };
    const limit = kind === "metrics" ? this.limits.metrics * shares[step]! / 160 : this.limits[kind];
    const used = () => kind === "metrics" ? (this.db.query<{ bytes: number }, [number]>("SELECT bytes FROM metric_tiers WHERE step=?").get(step)?.bytes ?? 0) : (this.db.query<{ bytes: number }, [string]>("SELECT bytes FROM accounting WHERE kind=?").get(kind)?.bytes ?? 0);
    if (bytes > limit) return false;
    if (used() + bytes <= limit) return true;
    let needed = used() + bytes - limit, removed = 0;
    const rows = this.oldest(kind === "metrics" ? ["metrics", "resources"] : [kind], step, Math.min(128 - this.deletions, Math.ceil(needed / 64) + 2)).filter(row => row.id !== keepId);
    for (const row of rows) { if (needed <= 0) break; this.db.query("DELETE FROM records WHERE id=?").run(row.id); needed -= row.bytes; removed++; this.deletions++;
      this.db.query("INSERT INTO losses VALUES(?,?,1) ON CONFLICT(pebble,reason) DO UPDATE SET count=count+1").run(row.pebble, `${kind}_budget_evicted`); }
    this.db.query("UPDATE accounting SET evicted=evicted+? WHERE kind=?").run(removed, kind);
    return needed <= 0;
  }
  private oldest(kinds: string[], step: number, limit: number) {
    return kinds.flatMap(kind => this.db.query<{ id: number; time: number; bytes: number; pebble: string }, [string, number, number]>("SELECT id,time,bytes,pebble FROM records WHERE kind=? AND step=? ORDER BY time,id LIMIT ?").all(kind, step, limit))
      .sort((a, b) => a.time - b.time || a.id - b.id).slice(0, limit);
  }
  private physicalRoom(bytes: number) {
    const available = () => {
      const pages = this.db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count;
      const free = this.db.query<{ freelist_count: number }, []>("PRAGMA freelist_count").get()!.freelist_count;
      const limit = this.db.query<{ max_page_count: number }, []>("PRAGMA max_page_count").get()!.max_page_count;
      const size = this.db.query<{ page_size: number }, []>("PRAGMA page_size").get()!.page_size;
      return (limit - pages + free) * size;
    };
    if (available() >= bytes) return true;
    this.db.transaction(() => {
      const rows = [];
      // Keep the status tier until every longer-lived tier has been reclaimed.
      for (const [kinds, step] of [[["resources", "logs", "events", "lifecycle"], 0], [["metrics", "resources"], 60], [["metrics", "resources"], 3600], [["metrics", "resources"], 86400], [["metrics"], 1]] as [string[], number][]) {
        rows.push(...this.oldest(kinds, step, 128 - rows.length));
        if (rows.length === 128) break;
      }
      for (const row of rows) {
        this.db.query("DELETE FROM records WHERE id=?").run(row.id);
        this.db.query("INSERT INTO losses VALUES(?,'physical_budget_evicted',1) ON CONFLICT(pebble,reason) DO UPDATE SET count=count+1").run(row.pebble);
      }
    })();
    this.checkpoint();
    return available() >= bytes;
  }
  private checkpoint() {
    const checkpoint = this.db.query<{ busy: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (checkpoint?.busy) throw new BedrockError("TELEMETRY_UNAVAILABLE", "Telemetry WAL is pinned by an external reader.", "Close external observability.sqlite readers; ingestion retries automatically.");
  }
  private window = 0;
  private lastWrite = 0;
  snapshots(boot: string, drops: { [pebble: string]: object }) {
    this.db.transaction(() => {
      for (const [pebble, value] of Object.entries(drops)) this.db.query("INSERT INTO drop_snapshots VALUES(?,?,?,?) ON CONFLICT(boot,pebble) DO UPDATE SET time=excluded.time,value=excluded.value").run(boot, pebble, Date.now(), JSON.stringify(value));
      this.db.exec("DELETE FROM drop_snapshots WHERE rowid IN (SELECT rowid FROM drop_snapshots ORDER BY time DESC LIMIT -1 OFFSET 4096)");
    })();
  }
  historicalDrops(pebble: string, boot: string) {
    const total: { [reason: string]: number } = {};
    for (const row of this.db.query<{ value: string }, [string, string]>("SELECT value FROM drop_snapshots WHERE pebble=? AND boot<>?").all(pebble, boot)) for (const [reason, count] of Object.entries(JSON.parse(row.value))) total[reason] = (total[reason] ?? 0) + Number(count);
    return total;
  }
  private expired = 0;
  write(records: Record[], now = Date.now()) {
    this.checkpoint();
    this.compactLegacy();
    this.expired = 0;
    this.db.transaction(() => this.expire(now))();
    if (this.expired) this.checkpoint();
    if (!this.physicalRoom(records.reduce((bytes, record) => bytes + charge(record), 0) + 8 * 1024 ** 2)) return records.map(record => ({ pebble: record.pebble, kind: "physical_budget" }));
    this.deletions = 0;
    const dropped: { pebble: string; kind: string }[] = [];
    this.db.transaction(() => {
      for (const record of records) {
        if (record.kind === "metrics") {
          if (packRed({ ...record.value, gauge_at: 0 }) === "[]") continue;
          for (const step of [1, 60, 3600, 86400]) {
            const time = Math.floor(record.time / (step * 1000)) * step * 1000;
            const previous = this.db.query<{ id: number; value: string; bytes: number }, [string, number, number, string]>("SELECT id,value,bytes FROM records WHERE kind='metrics' AND pebble=? AND time=? AND step=? AND traffic=?").get(record.pebble, time, step, record.traffic);
            if (previous) {
              const value = packRed(mergeRed(unpackRed(previous.value), record.value));
              const bytes = Buffer.byteLength(value) + 64;
              if (this.room("metrics", bytes - previous.bytes, step, previous.id)) this.db.query("UPDATE records SET value=?,bytes=? WHERE id=?").run(value, bytes, previous.id);
              else dropped.push({ pebble: record.pebble, kind: "budget" });
            } else if (this.room("metrics", charge(record), step)) this.insert(record, time, step, record.traffic);
            else dropped.push({ pebble: record.pebble, kind: "budget" });
          }
        } else if (record.kind === "resources") {
          if (record.value.source !== "cgroup") continue;
          if (this.room("metrics", charge(record))) this.insert(record, record.time);
          else dropped.push({ pebble: record.pebble, kind: "budget" });
          for (const step of [60, 3600, 86400]) {
            const time = Math.floor(record.time / (step * 1000)) * step * 1000;
            const previous = this.db.query<{ id: number; value: string; bytes: number }, [string, number, number]>("SELECT id,value,bytes FROM records WHERE kind='resources' AND pebble=? AND time=? AND step=?").get(record.pebble, time, step);
            const old = previous ? unpackResource(previous.value) : null;
            const value = { ...record.value, covered_ms: (old?.covered_ms ?? 0) + record.value.interval_ms,
              cpu_us: record.value.cpu_us === null && old?.cpu_us == null ? null : (old?.cpu_us ?? 0) + (record.value.cpu_us ?? 0),
              oom_kills: record.value.oom_kills === null && old?.oom_kills == null ? null : (old?.oom_kills ?? 0) + (record.value.oom_kills ?? 0),
              resident_bytes_ms: record.value.resident === null && old?.resident_bytes_ms == null ? null : (old?.resident_bytes_ms ?? 0) + (record.value.resident ?? 0) * record.value.interval_ms,
              swap_bytes_ms: record.value.swap === null && old?.swap_bytes_ms == null ? null : (old?.swap_bytes_ms ?? 0) + (record.value.swap ?? 0) * record.value.interval_ms,
              resident_peak: record.value.resident === null && old?.resident_peak == null ? null : Math.max(old?.resident_peak ?? 0, record.value.resident ?? 0), swap_peak: record.value.swap === null && old?.swap_peak == null ? null : Math.max(old?.swap_peak ?? 0, record.value.swap ?? 0) };
            const json = packResource(value);
            const bytes = Buffer.byteLength(json) + 64;
            if (previous) {
              if (this.room("metrics", bytes - previous.bytes, step, previous.id)) this.db.query("UPDATE records SET value=?,bytes=? WHERE id=?").run(json, bytes, previous.id);
              else dropped.push({ pebble: record.pebble, kind: "budget" });
            }
            else if (this.room("metrics", bytes, step)) this.db.query("INSERT INTO records(kind,pebble,time,step,value,bytes) VALUES('resources',?,?,?,?,?)").run(record.pebble, time, step, json, bytes);
            else dropped.push({ pebble: record.pebble, kind: "budget" });
          }
        } else if (this.room(category(record.kind), charge(record))) this.insert(record, record.time);
        else dropped.push({ pebble: record.pebble, kind: "budget" });
      }
      if (now - this.lastWrite > 2500 || !this.window) {
        this.window = Number(this.db.query("INSERT INTO windows(start,end) VALUES(?,?)").run(now, now).lastInsertRowid);
      } else this.db.query("UPDATE windows SET end=? WHERE id=?").run(now, this.window);
      this.lastWrite = now;
      this.expire(now);
      this.db.exec("DELETE FROM windows WHERE id IN (SELECT id FROM windows ORDER BY id DESC LIMIT -1 OFFSET 4096)");

    })();
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum(64)");
    return dropped;
  }
  private expire(now: number) {
    let remaining = 1000 - this.expired;
    for (const [kind, step, age] of [["metrics", 1, 300000], ["resources", 0, day], ["logs", 0, 7 * day], ["events", 0, 90 * day], ["lifecycle", 0, 90 * day],
      ...["metrics", "resources"].flatMap(kind => [[kind, 60, 7 * day], [kind, 3600, 90 * day], [kind, 86400, 365 * day]])] as [string, number, number][]) {
      if (!remaining) break;
      remaining -= this.db.query("DELETE FROM records WHERE id IN (SELECT id FROM records WHERE kind=? AND step=? AND time<? LIMIT ?)").run(kind, step, now - age, remaining).changes;
    }
    this.expired = 1000 - remaining;
  }

  private insert(record: Record, time: number, step = 0, traffic = "") {
    this.db.query("INSERT INTO records(kind,pebble,time,step,traffic,value,text,bytes) VALUES(?,?,?,?,?,?,?,?)")
      .run(record.kind, record.pebble, time, step, traffic, record.kind === "metrics" ? packRed(record.value) : record.kind === "resources" ? packResource(record.value) : record.kind === "logs" ? packLog(record) : JSON.stringify(record), record.kind === "logs" ? record.text : "", charge(record));
  }
  query(query: Query) {
    const params: (string | number)[] = [query.kind, query.pebble, query.from, query.to];
    let filter = "kind=? AND pebble=? AND time>=? AND time<=?";
    if (query.kind === "metrics" || query.kind === "resources") { filter += " AND step=?"; params.push(query.step); }
    else filter += " AND step=0";
    const coverage = this.db.query(`SELECT min(time) AS from_ms,max(time) AS to_ms FROM records WHERE ${filter}`).get(...params);
    if (query.kind === "logs" && query.watermark) {
      filter += " AND (json_extract(value,'$[2]') IS NOT ? OR json_extract(value,'$[3]')<=?)";
      params.push(query.watermark.boot, query.watermark.sequence);
    }
    if (query.search) { filter += " AND id IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?)"; params.push(query.search); }
    if (query.cursor !== undefined) { filter += " AND id<?"; params.push(query.cursor); }
    let rows: { id: number; time: number; traffic: string; value: string; text: string; pebble: string }[];
    try { rows = this.db.query<{ id: number; time: number; traffic: string; value: string; text: string; pebble: string }, (string | number)[]>(`SELECT id,time,traffic,value,text,pebble FROM records WHERE ${filter} ORDER BY id DESC LIMIT ?`).all(...params, query.limit + 1); }
    catch (error) { if (!String(error).match(/fts5|syntax|unterminated|no such column/i)) throw error; throw new BedrockError("INVALID_ARGS", "Invalid telemetry search.", "Use an FTS5 query, for example timeout or \"connection reset\"."); }
    const more = rows.length > query.limit; rows = rows.slice(0, query.limit);
    return { rows: rows.map(row => {
      const value = query.kind === "metrics" ? unpackRed(row.value) : query.kind === "resources" ? { kind: "resources", pebble: row.pebble, time: row.time, value: unpackResource(row.value) } : query.kind === "logs" ? { ...unpackLog(row.value), kind: "logs", pebble: row.pebble, time: row.time, text: row.text } : JSON.parse(row.value);
      return query.kind === "metrics" ? { id: row.id, time: row.time, traffic: row.traffic, ...value, p95: { headers_success: quantile(value.headers_success), headers_failure: quantile(value.headers_failure), lifetime_success: quantile(value.lifetime_success), lifetime_failure: quantile(value.lifetime_failure) } } : { id: row.id, ...value };
    }), range: { from_ms: query.from, to_ms: query.to }, cursor: more ? Buffer.from(`v1:${rows.at(-1)!.id}`).toString("base64url") : null, coverage, resolution_s: query.kind === "metrics" || query.kind === "resources" ? query.step : null,
      writer_coverage: this.db.query("SELECT start AS from_ms,end AS to_ms FROM windows WHERE end>=? AND start<=? ORDER BY id DESC LIMIT 128").all(query.from, query.to),
      coverage_note: "Record bounds and writer intervals; sparse data, restart and drop gaps are not zero traffic. Writer intervals may be truncated to the latest 128.",
      retained_losses: Object.fromEntries(this.db.query<{ reason: string; count: number }, [string]>("SELECT reason,count FROM losses WHERE pebble=?").all(query.pebble).map(row => [row.reason, row.count])),
      histogram: query.kind === "metrics" ? { version: 1, unit: "s", upper_bounds: [...bounds, null], buckets: "noncumulative" } : undefined };
  }
  purge(pebble: string, before: number) {
    const checkpoint = this.db.query<{ busy: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (checkpoint?.busy) throw new BedrockError("TELEMETRY_UNAVAILABLE", "Telemetry WAL is pinned.", "Close external readers and retry.");
    return this.db.query("DELETE FROM records WHERE id IN (SELECT id FROM records WHERE pebble=? AND id<=? LIMIT 128)").run(pebble, before).changes;
  }
  close() { this.db.close(); }
}
