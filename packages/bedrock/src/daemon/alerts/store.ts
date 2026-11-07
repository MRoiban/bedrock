import { Database } from "bun:sqlite";
import { BedrockError } from "../../error";
import { fingerprint, type Incident, type Outbox } from "./model";

export class AlertStore {
  readonly db: Database;
  constructor(path: string, readonly host: string, readonly clock = Date.now) {
    const db = this.db = new Database(path, { create: true });
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=50; PRAGMA journal_size_limit=4194304; PRAGMA wal_autocheckpoint=256; PRAGMA max_page_count=16384;
      CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY, fingerprint TEXT, pebble TEXT, rule TEXT, job TEXT, opened INTEGER, resolved INTEGER, notified INTEGER, reminder INTEGER, page INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS active_incident ON incidents(fingerprint) WHERE resolved IS NULL;
      CREATE TABLE IF NOT EXISTS silences(fingerprint TEXT PRIMARY KEY, until INTEGER);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, incident TEXT, transition TEXT, payload TEXT, created INTEGER, due INTEGER, attempts INTEGER DEFAULT 0, state TEXT DEFAULT 'pending', error TEXT);
      CREATE TABLE IF NOT EXISTS jobs(pebble TEXT, name TEXT, cron TEXT, release TEXT, due INTEGER, PRIMARY KEY(pebble,name));
      CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, pebble TEXT, job TEXT, run TEXT, state TEXT, at INTEGER, scheduled INTEGER);
      CREATE INDEX IF NOT EXISTS run_history ON runs(pebble,at);
      CREATE TABLE IF NOT EXISTS checks(name TEXT PRIMARY KEY, failures INTEGER, successes INTEGER, unhealthy INTEGER, observed INTEGER, open INTEGER);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);`);
  }
  open() { return this.db.query<Incident, []>("SELECT * FROM incidents WHERE resolved IS NULL").all(); }
  condition(pebble: string, rule: string, bad: boolean, job = "", page = true) {
    const fp = fingerprint(this.host, pebble, rule, job);
    this.db.transaction(() => {
      const previous = this.db.query<Incident, [string]>("SELECT * FROM incidents WHERE fingerprint=? AND resolved IS NULL").get(fp);
      if (bad && !previous) {
        const incident: Incident = { id: crypto.randomUUID(), fingerprint: fp, pebble, rule, job, opened: this.clock(), resolved: null, notified: null, reminder: null, page: Number(page) };
        this.db.query("INSERT INTO incidents VALUES(?,?,?,?,?,?,?,?,?,?)").run(...Object.values(incident));
        if (page) this.enqueue(incident, "opened");
      } else if (!bad && previous) {
        this.db.query("UPDATE incidents SET resolved=? WHERE id=?").run(this.clock(), previous.id);
        if (previous.page) this.enqueue(previous, "resolved");
      }
    })();
  }
  enqueue(incident: Incident | null, transition: string, text?: string) {
    const id = `bedrock:${incident?.id ?? crypto.randomUUID()}:${transition}`;
    if (this.db.query("SELECT 1 FROM outbox WHERE id=?").get(id)) return id;
    const pending = this.db.query<{ n: number }, []>("SELECT count(*) n FROM outbox WHERE state='pending'").get()!.n;
    if (pending >= 1000) throw new BedrockError("ALERT_OUTBOX_FULL", "Alert outbox reached 1,000 pending transitions.", "Repair webhook delivery and inspect bedrock alerts; incident state is retained on the next evaluation.");
    const email = transition === "digest";
    const escalated = transition === "escalated" || transition.startsWith("reminder:");
    const payload = { to: ["me"], subject: `Bedrock ${transition}: ${incident?.rule ?? "digest"}`, text: text?.slice(0, 24000) ?? `${incident?.fingerprint}\nObserved since ${new Date(incident!.opened).toISOString()}. Run bedrock alerts --json and bedrock doctor --json.`, urgency: email ? "low" : "normal", channels: email ? ["email"] : escalated ? ["ntfy", "email"] : ["poke"], idempotency_key: id, metadata: { incident_id: incident?.id ?? null, rule: incident?.rule ?? transition, target: incident?.pebble ?? "", fingerprint: incident?.fingerprint ?? null } };
    this.db.query("INSERT INTO outbox(id,incident,transition,payload,created,due) VALUES(?,?,?,?,?,?)").run(id, incident?.id ?? null, transition, JSON.stringify(payload), this.clock(), this.clock() + (transition === "test" ? 0 : 30000));
    if (incident?.rule === "readiness" && this.open().some(i => i.rule === "tunnel")) this.db.query("UPDATE outbox SET error='INHIBITED' WHERE id=?").run(id);
    return id;
  }
  silence(fp: string, until: number) {
    this.db.query("INSERT INTO silences VALUES(?,?) ON CONFLICT(fingerprint) DO UPDATE SET until=excluded.until").run(fp, until);
    return { fingerprint: fp, until };
  }
  silenced(fp: string) { return !!this.db.query("SELECT 1 FROM silences WHERE fingerprint=? AND until>?").get(fp, this.clock()); }
  history(pebble: string) { return this.db.query("SELECT * FROM runs WHERE pebble=? ORDER BY id DESC LIMIT 1000").all(pebble); }
  view() {
    return { incidents: this.db.query("SELECT * FROM incidents ORDER BY resolved IS NULL DESC, opened DESC LIMIT 1000").all(), silences: this.db.query("SELECT * FROM silences WHERE until>?").all(this.clock()), outbox: this.db.query("SELECT id,incident,transition,created,due,attempts,state,error FROM outbox ORDER BY state='pending' DESC, created DESC LIMIT 1000").all(), checks: this.db.query("SELECT * FROM checks").all(), pending: this.db.query("SELECT count(*) count, min(created) oldest FROM outbox WHERE state='pending'").get() };
  }
  pending() { return this.db.query<Outbox, [number]>("SELECT * FROM outbox WHERE state='pending' AND due<=? ORDER BY created LIMIT 1000").all(this.clock()); }
  prune() {
    const before = this.clock() - 365 * 86400000;
    this.db.query("DELETE FROM outbox WHERE state!='pending' AND created<?").run(before);
    this.db.query("DELETE FROM incidents WHERE resolved<? AND id NOT IN (SELECT incident FROM outbox WHERE incident IS NOT NULL)").run(before);
    this.db.query("DELETE FROM runs WHERE at<? OR id NOT IN (SELECT id FROM runs ORDER BY id DESC LIMIT 100000)").run(this.clock() - 30 * 86400000);
    this.db.query("DELETE FROM silences WHERE until<=?").run(this.clock());
  }
  close() { this.db.close(); }
}
