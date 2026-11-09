import type { JobEvent } from "../daemon/alerts/model";
import type { FunctionContext, DetachedContext, DetachedJobDefinition, TransactionalJobDefinition, JobDefinition } from "../config/types";
import { BedrockError, asBedrockError } from "../error";
import { parseCron } from "./cron";

export function job(cron: string, run: (ctx: FunctionContext) => unknown, options?: { transaction?: true }): TransactionalJobDefinition;
export function job(cron: string, run: (ctx: DetachedContext) => unknown, options: { transaction: false }): DetachedJobDefinition;
export function job(cron: string, run: JobDefinition["run"], options?: { transaction?: boolean }): JobDefinition {
  parseCron(cron);
  if (typeof run !== "function") throw new BedrockError("INVALID_JOB", "Job handler is missing.", "Use job(cron, async ctx => { ... }).");
  return options?.transaction === false
    ? { cron, run: run as DetachedJobDefinition["run"], transaction: false }
    : { cron, run: run as TransactionalJobDefinition["run"] };
}

export function createJobs(definitions: Record<string, JobDefinition>, execute: (name: string, handler: JobDefinition["run"], definition: JobDefinition) => Promise<unknown>, clock = () => new Date(), log = (name: string, error: unknown) => console.error(`Job ${name} failed`, asBedrockError(error).toJSON()), observe: (event: JobEvent) => void = () => {}) {
  const matches = new Map(Object.entries(definitions).map(([name, definition]) => [name, parseCron(definition.cron)]));
  const running = new Map<string, Promise<unknown>>();
  let lastMinute: number | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  async function run(name: string, scheduled: number | null = null) {
    if (!Object.hasOwn(definitions, name)) throw new BedrockError("JOB_NOT_FOUND", `Unknown job: ${name}`, "Use bedrock jobs ls <pebble> to see available jobs.");
    if (stopped) throw new BedrockError("PEBBLE_STOPPED", "Jobs have stopped.", "Start the pebble before running jobs.");
    const run = crypto.randomUUID();
    const emit = (state: JobEvent["state"]) => { try { observe({ name, run, state, at: clock().getTime(), scheduled }); } catch {} };
    if (scheduled !== null) emit("scheduled");
    if (running.has(name)) { emit("skipped"); return { name, skipped: true }; }
    emit("started");
    const work = Promise.resolve().then(() => execute(name, definitions[name]!.run, definitions[name]!));
    running.set(name, work);
    try { await work; emit("succeeded"); return { name, skipped: false }; }
    catch (error) { emit("failed"); log(name, error); throw error; }
    finally { running.delete(name); }
  }
  function tick() {
    const date = clock();
    const minute = Math.floor(date.getTime() / 60000);
    if (stopped || lastMinute === minute) return;
    lastMinute = minute;
    for (const [name, match] of matches) if (match(date)) void run(name, minute * 60000).catch(() => {});
  }
  return {
    run, tick,
    list: () => Object.entries(definitions).map(([name, { cron }]) => ({ name, cron, running: running.has(name) })),
    start() { if (!timer) { tick(); timer = setInterval(tick, 1000); timer.unref(); } },
    async stop() { stopped = true; clearInterval(timer); await Promise.allSettled(running.values()); },
  };
}
