import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { BedrockError } from "../../error";
import { bounds, budgets, mergeRed, quantile, type Query, type Record, type Red } from "./model";

const day = 86400_000;
const category = (kind: Record["kind"]) => kind === "resources" ? "metrics" : kind;
// Accounting deliberately overcharges text/FTS and row overhead; the physical cap is independent.
const charge = (record: Record) => record.kind === "logs" ? Buffer.byteLength(record.text) * 4 + 1024 : record.kind === "metrics" ? Buffer.byteLength(JSON.stringify(record.value)) * 2 + 256 : Buffer.byteLength(JSON.stringify(record)) * 2 + 256;
export class TelemetryStore {
  readonly db: Database;
  constructor(path: string, readonly limits = budgets) {
    this.db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      PRAGMA busy_timeout=0; PRAGMA cache_size=-8192; PRAGMA cache_spill=OFF; PRAGMA journal_size_limit=0;
      CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, pebble TEXT NOT NULL, time INTEGER NOT NULL, step INTEGER NOT NULL DEFAULT 0, traffic TEXT NOT NULL DEFAULT '', value TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', bytes INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS records_budget ON records((CASE WHEN kind='resources' THEN 'metrics' ELSE kind END),(CASE WHEN step IN (0,1) THEN 0 WHEN step=60 THEN 1 WHEN step=3600 THEN 2 ELSE 3 END),time,id);
      CREATE INDEX IF NOT EXISTS records_physical ON records((CASE WHEN step IN (0,1) THEN 0 WHEN step=60 THEN 1 WHEN step=3600 THEN 2 ELSE 3 END),time,id);
      CREATE INDEX IF NOT EXISTS records_retention ON records(kind,step,time);
      CREATE INDEX IF NOT EXISTS records_time ON records(kind,time);
      CREATE INDEX IF NOT EXISTS records_page ON records(kind,pebble,time,id);
      CREATE UNIQUE INDEX IF NOT EXISTS rollup ON records(kind,pebble,time,step,traffic) WHERE step>0;
      CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(text,content='records',content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS logs_insert AFTER INSERT ON records WHEN new.kind='logs' BEGIN INSERT INTO logs_fts(rowid,text) VALUES(new.id,new.text); END;
      CREATE TRIGGER IF NOT EXISTS logs_delete AFTER DELETE ON records WHEN old.kind='logs' BEGIN INSERT INTO logs_fts(logs_fts,rowid,text) VALUES('delete',old.id,old.text); END;
      CREATE TABLE IF NOT EXISTS accounting(kind TEXT PRIMARY KEY, bytes INTEGER NOT NULL DEFAULT 0, evicted INTEGER NOT NULL DEFAULT 0);
      CREATE TRIGGER IF NOT EXISTS account_insert AFTER INSERT ON records BEGIN INSERT INTO accounting(kind,bytes) VALUES(CASE WHEN new.kind='resources' THEN 'metrics' ELSE new.kind END,new.bytes) ON CONFLICT(kind) DO UPDATE SET bytes=bytes+new.bytes; END;
      CREATE TRIGGER IF NOT EXISTS account_delete AFTER DELETE ON records BEGIN UPDATE accounting SET bytes=bytes-old.bytes WHERE kind=CASE WHEN old.kind='resources' THEN 'metrics' ELSE old.kind END; END;
      CREATE TABLE IF NOT EXISTS losses(pebble TEXT NOT NULL,reason TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(pebble,reason));
      CREATE TABLE IF NOT EXISTS drop_snapshots(boot TEXT NOT NULL,pebble TEXT NOT NULL,time INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(boot,pebble));
      CREATE TABLE IF NOT EXISTS windows(id INTEGER PRIMARY KEY,start INTEGER NOT NULL,end INTEGER NOT NULL);`);
    const page = this.db.query<{ page_size: number }, []>("PRAGMA page_size").get()!.page_size;
    // With no spills, a transaction writes each dirty page once. DB + a full-page WAL stays below 512 MiB.
    this.db.exec(`PRAGMA max_page_count=${Math.floor(248 * 1024 ** 2 / page)}`);
  }
  private deletions = 0;
  private room(kind: keyof typeof budgets, bytes: number) {
    const used = () => (this.db.query<{ bytes: number }, [string]>("SELECT bytes FROM accounting WHERE kind=?").get(kind)?.bytes ?? 0);
    if (bytes > this.limits[kind]) return false;
    if (used() + bytes <= this.limits[kind]) return true;
    let needed = used() + bytes - this.limits[kind], removed = 0;
    const rows = this.db.query<{ id: number; bytes: number; pebble: string }, [string, number]>("SELECT id,bytes,pebble FROM records WHERE (CASE WHEN kind='resources' THEN 'metrics' ELSE kind END)=? ORDER BY (CASE WHEN step IN (0,1) THEN 0 WHEN step=60 THEN 1 WHEN step=3600 THEN 2 ELSE 3 END),time,id LIMIT ?").all(kind, Math.min(128 - this.deletions, Math.ceil(needed / 512) + 1));
    for (const row of rows) { if (needed <= 0) break; this.db.query("DELETE FROM records WHERE id=?").run(row.id); needed -= row.bytes; removed++; this.deletions++;
      this.db.query("INSERT INTO losses VALUES(?,?,1) ON CONFLICT(pebble,reason) DO UPDATE SET count=count+1").run(row.pebble, `${kind}_budget_evicted`); }
    this.db.query("UPDATE accounting SET evicted=evicted+? WHERE kind=?").run(removed, kind);
    return needed <= 0;
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
      const rows = this.db.query<{ id: number; pebble: string }, []>("SELECT id,pebble FROM records ORDER BY (CASE WHEN step IN (0,1) THEN 0 WHEN step=60 THEN 1 WHEN step=3600 THEN 2 ELSE 3 END),time,id LIMIT 128").all();
      for (const row of rows) {
        this.db.query("DELETE FROM records WHERE id=?").run(row.id);
        this.db.query("INSERT INTO losses VALUES(?,'physical_budget_evicted',1) ON CONFLICT(pebble,reason) DO UPDATE SET count=count+1").run(row.pebble);
      }
    })();
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return available() >= bytes;
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
  write(records: Record[], now = Date.now()) {
    const checkpoint = this.db.query<{ busy: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (checkpoint?.busy) throw new BedrockError("TELEMETRY_UNAVAILABLE", "Telemetry WAL is pinned by an external reader.", "Close external observability.sqlite readers; ingestion retries automatically.");
    if (!this.physicalRoom(records.reduce((bytes, record) => bytes + charge(record), 0) + 8 * 1024 ** 2)) return records.map(record => ({ pebble: record.pebble, kind: "physical_budget" }));
    this.deletions = 0;
    const dropped: { pebble: string; kind: string }[] = [];
    this.db.transaction(() => {
      for (const record of records) {
        if (record.kind === "metrics") {
          for (const step of [1, 60, 3600, 86400]) {
            const time = Math.floor(record.time / (step * 1000)) * step * 1000;
            const previous = this.db.query<{ id: number; value: string }, [string, number, number, string]>("SELECT id,value FROM records WHERE kind='metrics' AND pebble=? AND time=? AND step=? AND traffic=?").get(record.pebble, time, step, record.traffic);
            if (previous) {
              const value = mergeRed(JSON.parse(previous.value) as Red, record.value);
              this.db.query("UPDATE records SET value=? WHERE id=?").run(JSON.stringify(value), previous.id);
            } else if (this.room("metrics", charge(record))) this.insert(record, time, step, record.traffic);
            else dropped.push({ pebble: record.pebble, kind: "budget" });
          }
        } else if (record.kind === "resources") {
          if (this.room("metrics", charge(record))) this.insert(record, record.time);
          else dropped.push({ pebble: record.pebble, kind: "budget" });
          for (const step of [60, 3600, 86400]) {
            const time = Math.floor(record.time / (step * 1000)) * step * 1000;
            const previous = this.db.query<{ id: number; value: string }, [string, number, number]>("SELECT id,value FROM records WHERE kind='resources' AND pebble=? AND time=? AND step=?").get(record.pebble, time, step);
            const old = previous ? JSON.parse(previous.value).value : null;
            const value = { ...record.value, covered_ms: (old?.covered_ms ?? 0) + record.value.interval_ms,
              cpu_us: record.value.cpu_us === null && old?.cpu_us == null ? null : (old?.cpu_us ?? 0) + (record.value.cpu_us ?? 0),
              oom_kills: record.value.oom_kills === null && old?.oom_kills == null ? null : (old?.oom_kills ?? 0) + (record.value.oom_kills ?? 0),
              resident_bytes_ms: record.value.resident === null && old?.resident_bytes_ms == null ? null : (old?.resident_bytes_ms ?? 0) + (record.value.resident ?? 0) * record.value.interval_ms,
              swap_bytes_ms: record.value.swap === null && old?.swap_bytes_ms == null ? null : (old?.swap_bytes_ms ?? 0) + (record.value.swap ?? 0) * record.value.interval_ms,
              resident_peak: record.value.resident === null && old?.resident_peak == null ? null : Math.max(old?.resident_peak ?? 0, record.value.resident ?? 0), swap_peak: record.value.swap === null && old?.swap_peak == null ? null : Math.max(old?.swap_peak ?? 0, record.value.swap ?? 0) };
            const json = JSON.stringify({ ...record, time, value });
            if (previous) this.db.query("UPDATE records SET value=? WHERE id=?").run(json, previous.id);
            else if (this.room("metrics", Buffer.byteLength(json) * 2 + 256)) this.db.query("INSERT INTO records(kind,pebble,time,step,value,bytes) VALUES('resources',?,?,?,?,?)").run(record.pebble, time, step, json, Buffer.byteLength(json) * 2 + 256);
            else dropped.push({ pebble: record.pebble, kind: "budget" });
          }
        } else if (this.room(category(record.kind), charge(record))) this.insert(record, record.time);
        else dropped.push({ pebble: record.pebble, kind: "budget" });
      }
      if (now - this.lastWrite > 2500 || !this.window) {
        this.window = Number(this.db.query("INSERT INTO windows(start,end) VALUES(?,?)").run(now, now).lastInsertRowid);
      } else this.db.query("UPDATE windows SET end=? WHERE id=?").run(now, this.window);
      this.lastWrite = now;
      this.db.exec("DELETE FROM windows WHERE id IN (SELECT id FROM windows ORDER BY id DESC LIMIT -1 OFFSET 4096)");
      // Parents are written in the same transaction as minutes, before any retention deletion.
      this.db.query(`DELETE FROM records WHERE id IN (SELECT id FROM records WHERE
        (kind='metrics' AND step=1 AND time<?) OR (kind='logs' AND time<?) OR (kind IN ('events','lifecycle') AND time<?) OR
        (kind='resources' AND step=0 AND time<?) OR (kind IN ('metrics','resources') AND ((step=60 AND time<?) OR (step=3600 AND time<?) OR (step=86400 AND time<?))) LIMIT ?)`)
        .run(now - 300000, now - 7 * day, now - 90 * day, now - day, now - 7 * day, now - 90 * day, now - 365 * day, 128 - this.deletions);
    })();
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum(64)");
    return dropped;
  }
  private insert(record: Record, time: number, step = 0, traffic = "") {
    this.db.query("INSERT INTO records(kind,pebble,time,step,traffic,value,text,bytes) VALUES(?,?,?,?,?,?,?,?)")
      .run(record.kind, record.pebble, time, step, traffic, JSON.stringify(record.kind === "metrics" ? record.value : record), record.kind === "logs" ? record.text : "", charge(record));
  }
  query(query: Query) {
    const params: (string | number)[] = [query.kind, query.pebble, query.from, query.to];
    let filter = "kind=? AND pebble=? AND time>=? AND time<=?";
    if (query.kind === "metrics" || query.kind === "resources") { filter += " AND step=?"; params.push(query.step); }
    const coverage = this.db.query(`SELECT min(time) AS from_ms,max(time) AS to_ms FROM records WHERE ${filter}`).get(...params);
    if (query.search) { filter += " AND id IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?)"; params.push(query.search); }
    if (query.cursor !== undefined) { filter += " AND id<?"; params.push(query.cursor); }
    let rows: { id: number; time: number; traffic: string; value: string }[];
    try { rows = this.db.query<{ id: number; time: number; traffic: string; value: string }, (string | number)[]>(`SELECT id,time,traffic,value FROM records WHERE ${filter} ORDER BY id DESC LIMIT ?`).all(...params, query.limit + 1); }
    catch (error) { if (!String(error).match(/fts5|syntax|unterminated|no such column/i)) throw error; throw new BedrockError("INVALID_ARGS", "Invalid telemetry search.", "Use an FTS5 query, for example timeout or \"connection reset\"."); }
    const more = rows.length > query.limit; rows = rows.slice(0, query.limit);
    return { rows: rows.map(row => {
      const value = JSON.parse(row.value);
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
