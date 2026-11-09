import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { BedrockError } from "../../error";
import type { PreparedError } from "./prepare";
const day = 86400000;
interface ErrorIssue {
  id: string; pebble: string; runtime: string; type: string; state: string;
  first_seen: number; last_seen: number; release: string; missing_maps: number; quarantine: number; noise: number;
}
export interface ErrorTransition { id: number; pebble: string; issue: string; kind: "new-issue" | "regression"; time: number; delivery: "digest" }
export class ErrorStore {
  readonly db: Database;
  constructor(path: string, readonly budget = 1024 ** 3) {
    this.db = new Database(path, { create: true }); chmodSync(path, 0o600);
    this.db.exec(`PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      PRAGMA busy_timeout=0; PRAGMA cache_size=-4096; PRAGMA cache_spill=OFF; PRAGMA journal_size_limit=0;
      CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY,pebble TEXT NOT NULL,runtime TEXT NOT NULL,type TEXT NOT NULL,state TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,release TEXT NOT NULL,missing_maps INTEGER NOT NULL,quarantine INTEGER NOT NULL,noise INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS issue_page ON issues(pebble,last_seen);
      CREATE INDEX IF NOT EXISTS issue_expiry ON issues(last_seen);
      CREATE TABLE IF NOT EXISTS fingerprints(pebble TEXT NOT NULL,key TEXT NOT NULL,issue TEXT NOT NULL,PRIMARY KEY(pebble,key));
      CREATE INDEX IF NOT EXISTS fingerprint_issue ON fingerprints(issue,pebble);
      CREATE TABLE IF NOT EXISTS merges(pebble TEXT NOT NULL,id TEXT NOT NULL,target TEXT NOT NULL,PRIMARY KEY(pebble,id));
      CREATE TABLE IF NOT EXISTS samples(id TEXT PRIMARY KEY,issue TEXT NOT NULL,release TEXT NOT NULL,day INTEGER NOT NULL,time INTEGER NOT NULL,json TEXT NOT NULL,bytes INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sample_issue ON samples(issue,release,day);
      CREATE INDEX IF NOT EXISTS sample_time ON samples(time);
      CREATE TABLE IF NOT EXISTS counts(issue TEXT NOT NULL,release TEXT NOT NULL,day INTEGER NOT NULL,count INTEGER NOT NULL,sampled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(issue,release,day));
      CREATE TABLE IF NOT EXISTS seen(id TEXT PRIMARY KEY,time INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS transitions(id INTEGER PRIMARY KEY AUTOINCREMENT,pebble TEXT NOT NULL,issue TEXT NOT NULL,kind TEXT NOT NULL,time INTEGER NOT NULL,delivery TEXT NOT NULL DEFAULT 'digest');
      CREATE TABLE IF NOT EXISTS losses(reason TEXT PRIMARY KEY,count INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS seen_time ON seen(time);
      CREATE INDEX IF NOT EXISTS count_day ON counts(day);
      CREATE INDEX IF NOT EXISTS transition_time ON transitions(time);
      CREATE TABLE IF NOT EXISTS accounting(id INTEGER PRIMARY KEY,bytes INTEGER NOT NULL);
      INSERT OR IGNORE INTO accounting VALUES(1,0);
      CREATE TRIGGER IF NOT EXISTS sample_add AFTER INSERT ON samples BEGIN UPDATE accounting SET bytes=bytes+new.bytes; END;
      CREATE TRIGGER IF NOT EXISTS sample_remove AFTER DELETE ON samples BEGIN UPDATE accounting SET bytes=bytes-old.bytes; END;`);
    const page = this.db.query<{ page_size: number }, []>("PRAGMA page_size").get()!.page_size;
    this.db.exec(`PRAGMA max_page_count=${Math.floor(480 * 1024 ** 2 / page)}`);
  }
  drop(reason: string, count = 1) { this.db.query("INSERT INTO losses VALUES(?,?) ON CONFLICT(reason) DO UPDATE SET count=count+excluded.count").run(reason, count); }
  private checkpoint() {
    const result = this.db.query<{ busy: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (result?.busy) throw new BedrockError("ERRORS_UNAVAILABLE", "Error storage has a pinned reader.", "Close external errors.sqlite readers and retry.");
  }
  write(pebble: string, event: PreparedError, now = Date.now()): ErrorTransition | null {
    this.maintain(now);
    let transition: ErrorTransition | null = null;
    this.db.transaction(() => {
      if (this.db.query("SELECT 1 FROM seen WHERE id=?").get(event.id)) return;
      this.db.query("INSERT INTO seen VALUES(?,?)").run(event.id, now);
      let issue = this.db.query<{ id: string; state: string }, [string, string]>("SELECT i.id,i.state FROM fingerprints f JOIN issues i ON i.id=f.issue AND i.pebble=f.pebble WHERE f.pebble=? AND f.key=?").get(pebble, event.fingerprint);
      let kind: ErrorTransition["kind"] | undefined;
      if (!issue) {
        const size = this.db.query<{ n: number }, []>("SELECT count(*) n FROM fingerprints").get()!.n;
        if (event.runtime === "browser") {
          const browser = this.db.query<{ total: number; local: number }, [string]>("SELECT count(*) total,coalesce(sum(f.pebble=?),0) local FROM fingerprints f JOIN issues i ON i.id=f.issue AND i.pebble=f.pebble WHERE i.runtime='browser'").get(pebble)!;
          if (browser.local >= 1000 || browser.total >= 8000) { this.drop("browser_issue_budget"); return; }
        }
        if (size >= 10000) { this.drop("issue_budget"); return; }
        issue = { id: crypto.randomUUID(), state: "open" }; kind = "new-issue";
        this.db.query("INSERT INTO issues VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(issue.id, pebble, event.runtime, event.type, "open", now, now, event.release, +event.missingMaps, +event.quarantine, +event.noise);
        this.db.query("INSERT INTO fingerprints VALUES(?,?,?)").run(pebble, event.fingerprint, issue.id);
      } else if (issue.state === "resolved") { kind = "regression"; this.db.query("UPDATE issues SET state='open' WHERE id=?").run(issue.id); }
      this.db.query("UPDATE issues SET last_seen=?,release=?,missing_maps=max(missing_maps,?) WHERE id=?").run(now, event.release, +event.missingMaps, issue.id);
      const date = Math.floor(now / day) * day;
      this.db.query("INSERT INTO counts(issue,release,day,count) VALUES(?,?,?,1) ON CONFLICT(issue,release,day) DO UPDATE SET count=count+1").run(issue.id, event.release, date);
      const count = this.db.query<{ sampled: number }, [string, string, number]>("SELECT sampled FROM counts WHERE issue=? AND release=? AND day=?").get(issue.id, event.release, date)!.sampled;
      if (!event.noise && count < 20) {
        this.db.query("UPDATE counts SET sampled=sampled+1 WHERE issue=? AND release=? AND day=?").run(issue.id, event.release, date);
        const json = JSON.stringify(event), bytes = Buffer.byteLength(json) * 2 + 1024;
        let used = this.db.query<{ bytes: number }, []>("SELECT bytes FROM accounting").get()!.bytes;
        for (const row of this.db.query<{ id: string; bytes: number }, []>("SELECT id,bytes FROM samples ORDER BY time LIMIT 128").all()) {
          if (used + bytes <= this.budget) break;
          this.db.query("DELETE FROM samples WHERE id=?").run(row.id); used -= row.bytes; this.drop("payload_budget_evicted");
        }
        if (used + bytes <= this.budget) this.db.query("INSERT INTO samples VALUES(?,?,?,?,?,?,?)").run(event.id, issue.id, event.release, date, now, json, bytes);
        else this.drop("payload_budget");
      }
      if (kind && issue.state !== "ignored" && !event.noise && !event.quarantine) {
        const id = Number(this.db.query("INSERT INTO transitions(pebble,issue,kind,time) VALUES(?,?,?,?)").run(pebble, issue.id, kind, now).lastInsertRowid);
        transition = { id, pebble, issue: issue.id, kind, time: now, delivery: "digest" };
      }
    })();
    this.checkpoint(); return transition;
  }
  maintain(now = Date.now()) {
    this.db.exec("DELETE FROM seen WHERE rowid IN (SELECT rowid FROM seen ORDER BY time DESC LIMIT -1 OFFSET 20000)");
    this.db.query("DELETE FROM samples WHERE id IN (SELECT id FROM samples WHERE time<? LIMIT 128)").run(now - 14 * day);
    this.db.query("DELETE FROM counts WHERE rowid IN (SELECT rowid FROM counts WHERE day<? LIMIT 128)").run(now - 90 * day);
    this.db.query("DELETE FROM transitions WHERE id IN (SELECT id FROM transitions WHERE time<? LIMIT 128)").run(now - 90 * day);
    this.db.transaction(() => {
      const stale = this.db.query<{ id: string; pebble: string }, [number]>("SELECT id,pebble FROM issues WHERE last_seen<? LIMIT 128").all(now - 90 * day);
      for (const { id, pebble } of stale) {
        for (const table of ["samples", "counts"]) this.db.query(`DELETE FROM ${table} WHERE issue IN (SELECT id FROM issues WHERE pebble=? AND id=?)`).run(pebble, id);
        for (const table of ["fingerprints", "transitions"]) this.db.query(`DELETE FROM ${table} WHERE pebble=? AND issue=?`).run(pebble, id);
        this.db.query("DELETE FROM merges WHERE pebble=? AND (id=? OR target=?)").run(pebble, id, id);
        this.db.query("DELETE FROM issues WHERE pebble=? AND id=?").run(pebble, id);
      }
    })();
    this.checkpoint(); this.db.exec("PRAGMA incremental_vacuum(64)");
  }
  query(pebble: string, id?: string, cursor = 0) {
    const rows = id ? this.db.query<ErrorIssue, [string, string]>("SELECT * FROM issues WHERE pebble=? AND id=?").all(pebble, id)
      : this.db.query<ErrorIssue, [string, number]>("SELECT * FROM issues WHERE pebble=? AND rowid>? ORDER BY rowid LIMIT 101").all(pebble, cursor);
    if (id && !rows.length) throw new BedrockError("NOT_FOUND", "Error issue not found.", "List this pebble's error issues first.");
    const more = rows.length > 100; if (more) rows.pop();
    const next = more ? this.db.query<{ rowid: number }, [string, string]>("SELECT rowid FROM issues WHERE pebble=? AND id=?").get(pebble, (rows.at(-1) as { id: string }).id)!.rowid : null;
    return { fingerprints: id ? this.db.query("SELECT key FROM fingerprints WHERE pebble=? AND issue=?").all(pebble, id) : undefined, issues: rows, cursor: next, samples: id ? this.db.query<{ json: string }, [string, string, number]>("SELECT s.json FROM samples s JOIN issues i ON i.id=s.issue WHERE i.pebble=? AND i.id=? AND s.time>=? ORDER BY s.time DESC LIMIT 20").all(pebble, id, Date.now() - 14 * day).map(r => JSON.parse(r.json)) : undefined,
      counts: this.db.query("SELECT c.* FROM counts c JOIN issues i ON i.id=c.issue WHERE i.pebble=? AND (?='' OR i.id=?) AND c.day>=? ORDER BY day DESC LIMIT 1000").all(pebble, id ?? "", id ?? "", Date.now() - 90 * day),
      drops: this.db.query("SELECT * FROM losses").all(), payload_bytes: this.db.query<{ bytes: number }, []>("SELECT bytes FROM accounting").get()!.bytes, payload_budget: this.budget };
  }
  suggestionIds(pebble: string) {
    return this.db.query<{ id: string }, [string]>("SELECT id FROM issues WHERE pebble=? ORDER BY last_seen DESC LIMIT 200").all(pebble).map(row => row.id);
  }
  change(pebble: string, id: string, action: string, target?: string) {
    const merged = this.db.query<{ target: string }, [string, string]>("SELECT target FROM merges WHERE pebble=? AND id=?").get(pebble, id);
    if (action === "merge" && merged?.target === target && this.db.query("SELECT 1 FROM issues WHERE pebble=? AND id=?").get(pebble, target!)) return { id, action, target };
    if (!this.db.query("SELECT 1 FROM issues WHERE pebble=? AND id=?").get(pebble, id)) throw new BedrockError("NOT_FOUND", "Error issue not found.", "List this pebble's error issues first.");
    if (action === "resolve" || action === "ignore") this.db.query("UPDATE issues SET state=? WHERE pebble=? AND id=?").run(action === "resolve" ? "resolved" : "ignored", pebble, id);
    else if (action === "merge" && target && target !== id) {
      if (!this.db.query("SELECT 1 FROM issues WHERE pebble=? AND id=?").get(pebble, target)) throw new BedrockError("NOT_FOUND", "Merge target not found.", "Choose another issue in the same pebble.");
      this.db.transaction(() => {
        this.db.query("UPDATE merges SET target=? WHERE pebble=? AND target=?").run(target, pebble, id);
        this.db.query("INSERT INTO merges VALUES(?,?,?)").run(pebble, id, target);
        this.db.query("UPDATE fingerprints SET issue=? WHERE pebble=? AND issue=?").run(target, pebble, id);
        this.db.query("UPDATE samples SET issue=? WHERE issue IN (SELECT id FROM issues WHERE pebble=? AND id=?)").run(target, pebble, id);
        this.db.query("INSERT INTO counts SELECT ?,release,day,count,sampled FROM counts WHERE issue IN (SELECT id FROM issues WHERE pebble=? AND id=?) ON CONFLICT(issue,release,day) DO UPDATE SET count=count+excluded.count,sampled=sampled+excluded.sampled").run(target, pebble, id);
        this.db.query("DELETE FROM counts WHERE issue IN (SELECT id FROM issues WHERE pebble=? AND id=?)").run(pebble, id);
        this.db.query("UPDATE transitions SET issue=? WHERE pebble=? AND issue=?").run(target, pebble, id);
        this.db.query("DELETE FROM issues WHERE pebble=? AND id=?").run(pebble, id);
        this.db.query("DELETE FROM samples WHERE id IN (SELECT id FROM (SELECT id,row_number() OVER (PARTITION BY release,day ORDER BY time DESC) n FROM samples WHERE issue IN (SELECT id FROM issues WHERE pebble=? AND id=?)) WHERE n>20)").run(pebble, target);
      })();
    } else throw new BedrockError("INVALID_ARGS", "Invalid error issue action.", "Use resolve, ignore, or merge with a different target issue.");
    return { id, action, target: target ?? null };
  }
  forget(pebble: string) {
    this.db.transaction(() => {
      for (const table of ["samples", "counts"]) this.db.query(`DELETE FROM ${table} WHERE issue IN (SELECT id FROM issues WHERE pebble=?)`).run(pebble);
      for (const table of ["merges", "fingerprints", "transitions", "issues"]) this.db.query(`DELETE FROM ${table} WHERE pebble=?`).run(pebble);
    })();
  }
  close() { this.db.close(); }
}
