import { BedrockError } from "../../error";
import { parseCron } from "../../jobs/cron";
import type { JobEvent, PebbleCheck } from "./model";
import type { AlertStore } from "./store";
interface Deadline { pebble: string; name: string; cron: string; release: string; due: number }
export function nextRun(cron: string, after: number) {
  const matches = parseCron(cron);
  let time = (Math.floor(after / 60000) + 1) * 60000;
  const end = time + 5 * 366 * 86400000;
  for (; time < end; time += 60000) if (matches(new Date(time))) return time;
  return end;
}
export class JobDeadlines {
  constructor(private store: AlertStore, private critical: { [pebble: string]: string[] }) {}
  register(pebble: PebbleCheck) {
    if (!pebble.jobs) return;
    const db = this.store.db;
    for (const job of pebble.jobs) {
      const previous = db.query<Deadline, [string, string]>("SELECT * FROM jobs WHERE pebble=? AND name=?").get(pebble.name, job.name);
      if (!previous) db.query("INSERT INTO jobs VALUES(?,?,?,?,?)").run(pebble.name, job.name, job.cron, pebble.release, nextRun(job.cron, this.store.clock()));
      else db.query("UPDATE jobs SET cron=?, release=?, due=? WHERE pebble=? AND name=?").run(job.cron, pebble.release, previous.cron === job.cron ? previous.due : nextRun(job.cron, this.store.clock()), pebble.name, job.name);
    }
    for (const old of db.query<Deadline, [string]>("SELECT * FROM jobs WHERE pebble=?").all(pebble.name)) if (!pebble.jobs.some(job => job.name === old.name)) {
      db.query("DELETE FROM jobs WHERE pebble=? AND name=?").run(pebble.name, old.name);
      this.store.condition(pebble.name, "critical-job", false, old.name);
    }
  }
  event(pebble: string, event: JobEvent) {
    const db = this.store.db;
    this.store.prune();
    const pending = ["failed", "interrupted", "succeeded"].includes(event.state);
    db.query("INSERT INTO runs(pebble,job,run,state,at,scheduled,pending) VALUES(?,?,?,?,?,?,?)").run(pebble, event.name, event.run, event.state, event.at, event.scheduled, Number(pending));
    this.reconcile();
  }
  reconcile() {
    const db = this.store.db;
    const rows = db.query<{ id: number; pebble: string; job: string; state: string }, []>("SELECT id,pebble,job,state FROM runs WHERE pending=1 ORDER BY id").all();
    for (const row of rows) {
      try {
        db.transaction(() => {
          this.store.condition(row.pebble, "critical-job", row.state !== "succeeded", row.job, this.isCritical(row.pebble, row.job));
          db.query("UPDATE runs SET pending=0 WHERE id=?").run(row.id);
        })();
      } catch (error) {
        if (error instanceof BedrockError && error.code === "ALERT_OUTBOX_FULL") return;
        throw error;
      }
    }
  }
  interrupt(pebble: string) {
    const rows = this.store.db.query<{ job: string; run: string; scheduled: number | null }, [string]>(`SELECT job,run,scheduled FROM runs r WHERE pebble=? AND state='started' AND NOT EXISTS(SELECT 1 FROM runs x WHERE x.run=r.run AND x.state IN ('succeeded','failed','interrupted'))`).all(pebble);
    for (const row of rows) this.event(pebble, { name: row.job, run: row.run, state: "interrupted", scheduled: row.scheduled, at: this.store.clock() });
  }
  tick(pebbles: PebbleCheck[]) {
    const db = this.store.db, now = this.store.clock();
    let remaining = 256;
    const evidence = db.query<{ scheduled: number }, [string, string, number, number]>("SELECT scheduled FROM runs WHERE pebble=? AND job=? AND scheduled>=? AND scheduled<? AND state IN ('started','succeeded') ORDER BY scheduled LIMIT 1");
    for (const job of db.query<Deadline, []>("SELECT * FROM jobs ORDER BY due").all()) {
      const pebble = pebbles.find(p => p.name === job.pebble);
      if (!pebble || ["idle", "stopped"].includes(pebble.status)) continue;
      const overdue = db.query("SELECT 1 FROM runs r WHERE pebble=? AND job=? AND state='started' AND at<? AND NOT EXISTS(SELECT 1 FROM runs x WHERE x.run=r.run AND x.state IN ('succeeded','failed','interrupted')) LIMIT 1").get(job.pebble, job.name, now - 600000);
      if (overdue) this.store.condition(job.pebble, "critical-job", true, job.name, this.isCritical(job.pebble, job.name));
      let due = job.due, missed = false;
      while (now > due + 300000 && remaining > 0) {
        remaining--;
        const next = evidence.get(job.pebble, job.name, due, now - 300000);
        if (next?.scheduled === due) due = nextRun(job.cron, due);
        else {
          // The indexed range proves every occurrence before the next evidence is missing.
          missed = true;
          due = nextRun(job.cron, (next?.scheduled ?? now - 300000) - 1);
        }
      }
      if (missed) this.store.condition(job.pebble, "critical-job", true, job.name, this.isCritical(job.pebble, job.name));
      if (due !== job.due) db.query("UPDATE jobs SET due=? WHERE pebble=? AND name=?").run(due, job.pebble, job.name);
    }
  }
  private isCritical(pebble: string, job: string) { return this.critical[pebble]?.includes(job) === true; }
}
