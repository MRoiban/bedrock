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
    db.query("INSERT INTO runs(pebble,job,run,state,at,scheduled) VALUES(?,?,?,?,?,?)").run(pebble, event.name, event.run, event.state, event.at, event.scheduled);
    if (event.state === "failed" || event.state === "interrupted") this.store.condition(pebble, "critical-job", true, event.name, this.isCritical(pebble, event.name));
    if (event.state === "succeeded") this.store.condition(pebble, "critical-job", false, event.name);
  }
  interrupt(pebble: string) {
    const rows = this.store.db.query<{ job: string; run: string; scheduled: number | null }, [string]>(`SELECT job,run,scheduled FROM runs r WHERE pebble=? AND state='started' AND NOT EXISTS(SELECT 1 FROM runs x WHERE x.run=r.run AND x.state IN ('succeeded','failed','interrupted'))`).all(pebble);
    for (const row of rows) this.event(pebble, { name: row.job, run: row.run, state: "interrupted", scheduled: row.scheduled, at: this.store.clock() });
  }
  tick(pebbles: PebbleCheck[]) {
    const db = this.store.db, now = this.store.clock();
    for (const job of db.query<Deadline, []>("SELECT * FROM jobs").all()) {
      const pebble = pebbles.find(p => p.name === job.pebble);
      if (!pebble || ["idle", "stopped"].includes(pebble.status)) continue;
      const overdue = db.query("SELECT 1 FROM runs r WHERE pebble=? AND job=? AND state='started' AND at<? AND NOT EXISTS(SELECT 1 FROM runs x WHERE x.run=r.run AND x.state IN ('succeeded','failed','interrupted')) LIMIT 1").get(job.pebble, job.name, now - 600000);
      if (overdue) this.store.condition(job.pebble, "critical-job", true, job.name, this.isCritical(job.pebble, job.name));
      if (now <= job.due + 300000) continue;
      // One observation covers every missed occurrence during a daemon gap; jobs are never replayed.
      const started = db.query("SELECT 1 FROM runs WHERE pebble=? AND job=? AND scheduled=? AND state IN ('started','succeeded') LIMIT 1").get(job.pebble, job.name, job.due);
      if (!started) this.store.condition(job.pebble, "critical-job", true, job.name, this.isCritical(job.pebble, job.name));
      db.query("UPDATE jobs SET due=? WHERE pebble=? AND name=?").run(nextRun(job.cron, now), job.pebble, job.name);
    }
  }
  private isCritical(pebble: string, job: string) { return this.critical[pebble]?.includes(job) === true; }
}
