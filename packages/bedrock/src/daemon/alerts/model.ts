export type Readiness = "starting" | "ready" | "degraded" | "failed" | "idle" | "stopped";
export interface JobEvent { name: string; run: string; state: "scheduled" | "started" | "succeeded" | "failed" | "skipped" | "interrupted"; at: number; scheduled: number | null }
export interface JobSchedule { name: string; cron: string }
export interface PebbleCheck { name: string; status: string; release: string; readiness: Readiness; jobs?: JobSchedule[] }
export interface Snapshot { pebbles: PebbleCheck[]; tunnel: boolean | null; backup?: { interval: number; successes: { [name: string]: number | null } } }
export interface Incident { id: string; fingerprint: string; pebble: string; rule: string; job: string; opened: number; resolved: number | null; notified: number | null; reminder: number | null; page: number }
export interface Outbox { id: string; incident: string | null; transition: string; payload: string; created: number; due: number; attempts: number; state: string; error: string | null }
export function fingerprint(host: string, pebble: string, rule: string, job = "") { return JSON.stringify([host, pebble, rule, job]); }
const quietClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
export function isQuiet(now: number) { const time = quietClock.format(now); return time >= "23:00" || time < "07:30"; }
