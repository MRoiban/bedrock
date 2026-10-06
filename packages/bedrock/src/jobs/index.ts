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

export function createJobs(definitions: Record<string, JobDefinition>, execute: (name: string, handler: JobDefinition["run"], definition: JobDefinition) => Promise<unknown>, clock = () => new Date(), log = (name: string, error: unknown) => console.error(`Job ${name} failed`, asBedrockError(error).toJSON())) {
  const matches = new Map(Object.entries(definitions).map(([name, definition]) => [name, parseCron(definition.cron)]));
  const running = new Map<string, Promise<unknown>>();
  let lastMinute: number | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  async function run(name: string) {
    if (!Object.hasOwn(definitions, name)) throw new BedrockError("JOB_NOT_FOUND", `Unknown job: ${name}`, "Use bedrock jobs ls <pebble> to see available jobs.");
    if (stopped) throw new BedrockError("PEBBLE_STOPPED", "Jobs have stopped.", "Start the pebble before running jobs.");
    if (running.has(name)) return { name, skipped: true };
    const work = Promise.resolve().then(() => execute(name, definitions[name]!.run, definitions[name]!));
    running.set(name, work);
    try { await work; return { name, skipped: false }; }
    catch (error) { log(name, error); throw error; }
    finally { running.delete(name); }
  }
  function tick() {
    const date = clock();
    const minute = Math.floor(date.getTime() / 60000);
    if (stopped || lastMinute === minute) return;
    lastMinute = minute;
    for (const [name, match] of matches) if (match(date)) void run(name).catch(() => {});
  }
  return {
    run, tick,
    list: () => Object.entries(definitions).map(([name, { cron }]) => ({ name, cron, running: running.has(name) })),
    start() { if (!timer) { tick(); timer = setInterval(tick, 1000); timer.unref(); } },
    async stop() { stopped = true; clearInterval(timer); await Promise.allSettled(running.values()); },
  };
}
