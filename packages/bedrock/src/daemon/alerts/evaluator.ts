import { fingerprint, isQuiet, type Incident, type Snapshot } from "./model";
import { JobDeadlines } from "./jobs";
import { AlertStore } from "./store";
interface Check { open: number; failures: number; successes: number; unhealthy: number | null }
export class AlertEvaluator {
  readonly jobs: JobDeadlines;
  constructor(readonly store: AlertStore, critical: { [pebble: string]: string[] } = {}) { this.jobs = new JobDeadlines(store, critical); }
  evaluate(snapshot: Snapshot) {
    const store = this.store, db = store.db, now = store.clock();
    db.transaction(() => {
      store.condition("", "tunnel", snapshot.tunnel === false);
      for (const pebble of snapshot.pebbles) {
        this.jobs.register(pebble);
        const previous = db.query<Check, [string]>("SELECT * FROM checks WHERE name=?").get(pebble.name) ?? { failures: 0, successes: 0, unhealthy: null, open: 0 };
        const available = ["idle", "stopped"].includes(pebble.readiness);
        const success = pebble.readiness === "ready";
        const failures = available || success ? 0 : previous.failures + 1;
        const successes = available || !success ? 0 : previous.successes + 1;
        const unhealthy = available ? null : !success ? previous.unhealthy ?? now : successes >= 2 ? null : previous.unhealthy;
        const open = available || successes >= 2 ? 0 : failures >= 3 ? 1 : previous.open;
        db.query("INSERT INTO checks VALUES(?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET failures=excluded.failures,successes=excluded.successes,unhealthy=excluded.unhealthy,observed=excluded.observed,open=excluded.open").run(pebble.name, failures, successes, unhealthy, now, open);
        const bad = !available && (pebble.status === "crashed" || unhealthy !== null && failures >= 3 && now - unhealthy >= 120000);
        if (bad || available || successes >= 2) store.condition(pebble.name, "readiness", bad);
      }
      const backupNames = new Set<string>();
      if (snapshot.backup) for (const [name, success] of Object.entries(snapshot.backup.successes)) {
        backupNames.add(name);
        const key = `backup-baseline:${name}`;
        db.query("INSERT OR IGNORE INTO meta VALUES(?,?)").run(key, String(now));
        const baseline = Number(db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key=?").get(key)!.value);
        store.condition(name === "_daemon" ? "" : name, "backup-age", now - (success ?? baseline) > 2 * snapshot.backup.interval);
      }
      for (const incident of store.open()) {
        if (incident.pebble && !snapshot.pebbles.some(p => p.name === incident.pebble)) store.condition(incident.pebble, incident.rule, false, incident.job);
        if (incident.rule === "backup-age" && !backupNames.has(incident.pebble || "_daemon")) store.condition(incident.pebble, incident.rule, false);
      }
      for (const row of db.query<{ name: string }, []>("SELECT name FROM checks").all()) if (!snapshot.pebbles.some(p => p.name === row.name)) db.query("DELETE FROM checks WHERE name=?").run(row.name);
      for (const row of db.query<{ pebble: string }, []>("SELECT DISTINCT pebble FROM jobs").all()) if (!snapshot.pebbles.some(p => p.name === row.pebble)) db.query("DELETE FROM jobs WHERE pebble=?").run(row.pebble);
      this.jobs.tick(snapshot.pebbles);
      this.reminders();
      this.digest();
    })();
    store.prune();
  }
  inhibited(incident: Incident) { return incident.rule === "readiness" && this.store.open().some(i => i.rule === "tunnel"); }
  private reminders() {
    const now = this.store.clock();
    if (isQuiet(now)) return;
    for (const incident of this.store.open()) {
      if (!incident.page || !incident.notified || this.inhibited(incident) || this.store.silenced(incident.fingerprint)) continue;
      if (now - incident.opened >= 900000 && incident.reminder === null) {
        this.store.enqueue(incident, "escalated");
        this.store.db.query("UPDATE incidents SET reminder=? WHERE id=?").run(now, incident.id);
      } else if (incident.reminder !== null && now - incident.reminder >= 21600000) {
        this.store.enqueue(incident, `reminder:${Math.floor(now / 21600000)}`);
        this.store.db.query("UPDATE incidents SET reminder=? WHERE id=?").run(now, incident.id);
      }
    }
  }
  private digest() {
    const now = this.store.clock(), date = new Date(now), day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (date.getHours() < 8 || date.getDay() !== 1 && !this.store.open().length) return;
    const db = this.store.db;
    if (db.query("SELECT 1 FROM meta WHERE key='digest-day' AND value=?").get(day)) return;
    const latest = db.query("SELECT pebble,job,state,count(*) count FROM runs WHERE at>? AND state IN ('failed','skipped','interrupted') GROUP BY pebble,job,state LIMIT 100").all(now - 7 * 86400000);
    this.store.enqueue(null, "digest", JSON.stringify({ unresolved: this.store.open(), jobs: latest, checks: db.query("SELECT * FROM checks LIMIT 100").all(), outbox: db.query("SELECT state,count(*) count FROM outbox GROUP BY state").all() }));
    db.query("INSERT OR REPLACE INTO meta VALUES('digest-day',?)").run(day);
  }
  deliveryBroken() {
    const oldest = this.store.db.query<{ oldest: number | null }, []>("SELECT min(created) oldest FROM outbox WHERE state='pending' AND attempts>0").get()!.oldest;
    const broken = oldest !== null && this.store.clock() - oldest > 600000;
    const fp = fingerprint(this.store.host, "", "alert-delivery");
    if (broken && !this.store.open().some(i => i.fingerprint === fp)) console.error("ALERT_DELIVERY_BROKEN: webhook unaccepted for >10m; inspect bedrock alerts and repair alerts.webhook. External canary monitoring is required for whole-host outages.");
    this.store.condition("", "alert-delivery", broken, "", false);
  }
}
