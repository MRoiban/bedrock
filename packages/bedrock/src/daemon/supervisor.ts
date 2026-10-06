import { join } from "node:path";
import { BedrockError, asBedrockError } from "../error";
import type { Access } from "../config";
import type { DaemonDatabase, PebbleRecord } from "./db";
import { PebbleLogs } from "./logs";

export interface Child {
  process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  port: number;
  release: string;
  started: number;
  reading: Promise<unknown>;
  requests: number;
  access: Access;
}
interface State { child?: Child; timer?: ReturnType<typeof setTimeout>; failures: number; generation: number }

export async function stopChild(child: Child) {
  if (child.process.exitCode === null) child.process.kill("SIGTERM");
  const timer = setTimeout(() => { if (child.process.exitCode === null) child.process.kill("SIGKILL"); }, 3000);
  try { await child.process.exited; await child.reading; } finally { clearTimeout(timer); }
}

export async function retireChild(child: Child) {
  const deadline = Date.now() + 3000;
  while (child.requests && Date.now() < deadline) await Bun.sleep(10);
  await stopChild(child);
}

export class Supervisor {
  private states = new Map<string, State>();
  private loggers = new Map<string, PebbleLogs>();
  private stopping = false;
  private launches = new Set<Promise<unknown>>();
  constructor(readonly home: string, readonly db: DaemonDatabase, readonly secret = "", readonly creators: string[] = [], readonly dev = false) {}
  logs(name: string) {
    let logs = this.loggers.get(name);
    if (!logs) { logs = new PebbleLogs(this.home, name); this.loggers.set(name, logs); }
    return logs;
  }
  child(name: string) { return this.states.get(name)?.child; }
  private state(name: string) {
    let state = this.states.get(name);
    if (!state) { state = { failures: 0, generation: 0 }; this.states.set(name, state); }
    return state;
  }
  async launch(name: string, release: string): Promise<Child> {
    const logs = this.logs(name);
    let ready!: (value: { name: string; port: number }) => void;
    let failed!: (error: unknown) => void;
    const readiness = new Promise<{ name: string; port: number }>((resolve, reject) => { ready = resolve; failed = reject; });
    const processChild = Bun.spawn([process.execPath, join(import.meta.dir, "../runtime/child.ts")], {
      cwd: release, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, BEDROCK_HOME: this.home, BEDROCK_RELEASE: release,
        BEDROCK_DATA: this.dev ? join(release, ".bedrock") : join(this.home, "pebbles", name, "data"), BEDROCK_IDENTITY_SECRET: this.secret, BEDROCK_CREATORS: JSON.stringify(this.creators) },
      ipc(message: unknown) {
        const value = message as { name: string; port: number; error?: { code: string; message: string; hint: string } };
        if (value.error) failed(new BedrockError(value.error.code, value.error.message, value.error.hint));
        else ready(value);
      },
    });
    const reading = Promise.all([logs.pump(processChild.stdout), logs.pump(processChild.stderr)]);
    // Observe pipe failures immediately; the child is also reaped on every failure path.
    void reading.catch(() => {});
    const child: Child = { process: processChild, port: 0, release, started: Date.now(), reading, requests: 0, access: "users" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        readiness,
        processChild.exited.then(() => { throw new BedrockError("PEBBLE_START_FAILED", `${name} exited before it was ready.`, `Check bedrock logs ${name}; fix its code or migrations and redeploy.`); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BedrockError("HEALTH_TIMEOUT", `${name} did not start within 15 seconds.`, `Check bedrock logs ${name} and remove blocking startup work.`)), 15000); }),
      ]);
      if (value.name !== name || !Number.isInteger(value.port) || value.port < 1) throw new BedrockError("PEBBLE_NAME_MISMATCH", "Deployed pebble name does not match the requested name.", "Use the name from definePebble in the deploy request.");
      child.port = value.port;
      const health = await fetch(`http://127.0.0.1:${child.port}/_bedrock/health`, { signal: AbortSignal.timeout(3000) });
      const info = await health.json();
      if (!health.ok || info.name !== name || processChild.exitCode !== null) throw new BedrockError("HEALTH_FAILED", `${name} failed its health check.`, `Check bedrock logs ${name} before retrying.`);
      const access = info.access;
      if (!["public", "users", "creators"].includes(access) && !(access && Array.isArray(access.allow) && access.allow.every((email: unknown) => typeof email === "string"))) throw new BedrockError("HEALTH_FAILED", "Invalid child access policy.", "Return a valid access value in the health check.");
      child.access = access;
      return child;
    } catch (error) {
      await stopChild(child).catch(() => {});
      throw asBedrockError(error, "PEBBLE_START_FAILED", `Check bedrock logs ${name} and retry.`);
    } finally { clearTimeout(timer); }
  }
  activate(name: string, child: Child, resetFailures = true) {
    if (this.stopping) throw new BedrockError("DAEMON_STOPPING", "The daemon is stopping.", "Restart the daemon and retry.");
    const state = this.state(name);
    clearTimeout(state.timer);
    delete state.timer;
    state.generation++;
    if (resetFailures) state.failures = 0;
    state.child = child;
    void child.process.exited.then(() => this.crashed(name, child));
  }
  private crashed(name: string, child: Child) {
    const state = this.state(name);
    if (this.stopping || state.child !== child) return;
    delete state.child;
    state.failures = Date.now() - child.started < 10000 ? state.failures + 1 : 0;
    if (state.failures >= 5) { this.db.status(name, "crashed"); return; }
    this.db.status(name, "restarting");
    const generation = state.generation;
    state.timer = setTimeout(() => {
      delete state.timer;
      const work = this.launch(name, child.release).then(next => {
        if (this.stopping || state.generation !== generation || (!this.dev && this.db.get(name)?.status !== "restarting")) return stopChild(next);
        this.activate(name, next, false);
        this.db.status(name, "running");
      }).catch(error => {
        if (this.stopping || state.generation !== generation) return;
        this.logs(name).write(new TextEncoder().encode(JSON.stringify(asBedrockError(error).toJSON()) + "\n"));
        // Failed restarts count just like children which die after becoming healthy.
        state.child = child;
        child.started = Date.now();
        this.crashed(name, child);
      });
      this.launches.add(work);
      void work.finally(() => this.launches.delete(work));
    }, Math.min(30000, 250 * 2 ** state.failures));
  }
  async start(record: PebbleRecord) {
    if (this.child(record.name)) return;
    await this.stop(record.name, false);
    const child = await this.launch(record.name, record.release);
    this.state(record.name).failures = 0;
    this.activate(record.name, child);
    this.db.status(record.name, "running");
  }
  async stop(name: string, persist = true) {
    const state = this.state(name);
    state.generation++;
    clearTimeout(state.timer);
    delete state.timer;
    const child = state.child;
    delete state.child;
    if (persist) this.db.status(name, "stopped");
    if (child) await stopChild(child);
  }
  forget(name: string) { this.loggers.get(name)?.close(); this.states.delete(name); this.loggers.delete(name); }
  async restore() {
    for (const record of this.db.list()) {
      if (["running", "restarting"].includes(record.status)) {
        try { await this.start(record); }
        catch (error) {
          this.db.status(record.name, "crashed");
          this.logs(record.name).write(new TextEncoder().encode(JSON.stringify(asBedrockError(error).toJSON()) + "\n"));
        }
      }
    }
  }
  async shutdown() {
    this.stopping = true;
    await Promise.all([...this.states.keys()].map(name => this.stop(name, false)));
    await Promise.allSettled(this.launches);
    for (const logs of this.loggers.values()) logs.close();
  }
}
