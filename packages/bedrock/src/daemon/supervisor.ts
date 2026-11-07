import type { Alerts } from "./alerts";
import type { JobSchedule, Readiness, JobEvent } from "./alerts/model";
import type { Telemetry } from "./telemetry";
import { QUIET_MEMORY_MS, emptyMemory, type ChildCgroup, type PebbleCgroups } from "./cgroups";
import { preferPebbleOom } from "./oom";
import { assertConcurrentWalSafe } from "../db/sqlite-version";
import { idleSourceSafe } from "./idle-source";
import { validatePublicRouteKey } from "../config/public-route";
import { childEnvironment } from "./child-env";
import { createSecrets } from "./secrets";
import type { User } from "../config";
import { DEFAULT_SERVICE_STOP_TIMEOUT, MAX_SERVICE_STOP_TIMEOUT } from "../config/hosting";
import { deriveIdentitySecret } from "../auth/identity";
import { basename, join, resolve } from "node:path";
import { BedrockError, asBedrockError } from "../error";
import type { Access } from "../config";
import type { DaemonDatabase, PebbleRecord } from "./db";
import { PebbleLogs } from "./logs";
import { pebbleDataDir } from "./config";
import { bunConfigArgs } from "../runtime/bundler";

export type ExclusiveServices = "none" | "running" | "failed";

export interface Child {
  process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  port: number;
  release: string;
  releaseId: string;
  started: number;
  reading: Promise<unknown>;
  requests: number;
  lastActive: number;
  idleSafe: boolean;
  cgroup?: ChildCgroup;
  stopTimeout?: number;
  devSource?: boolean;
  access: Access;
  publicRoutes: string[];
  exclusiveServices: string[];
  jobSchedules?: JobSchedule[];
}
interface State { launching?: number; candidates?: Set<Child>; relaunch?: Promise<unknown>; nextRetryAt?: number; waking?: Promise<Child | undefined>; sleeping?: Promise<void>; child?: Child; timer?: ReturnType<typeof setTimeout>; failures: number; generation: number; retired: Promise<void> }

export async function stopChild(child: Child) {
  if (child.process.exitCode === null) {
    try { child.process.send({ op: "stop" }); } catch { child.process.kill("SIGTERM"); }
  }
  const timer = setTimeout(() => { if (child.process.exitCode === null) child.process.kill("SIGKILL"); }, (child.stopTimeout ?? DEFAULT_SERVICE_STOP_TIMEOUT) + 1000);
  try { await child.process.exited; await child.reading; } finally { clearTimeout(timer); }
}

export async function retireChild(child: Child) {
  const deadline = Date.now() + 3000;
  while (child.requests && Date.now() < deadline) await Bun.sleep(10);
  await stopChild(child);
}

export const restartTiming = { baseMs: 250, fastCapMs: 30000, capMs: 300000, stableMs: 600000, now: Date.now, random: Math.random };

export class Supervisor {
  apiUrl = "";
  alerts?: Alerts;
  readiness(name: string, child: Child) {
    return this.request(name, "readiness", {}, { child, stoppedHint: "Start the pebble.", timeout: { ms: 2000, error: () => new BedrockError("READINESS_TIMEOUT", "Readiness probe timed out.", "Check pebble logs and restart if needed.") } }) as Promise<{ state: Readiness }>;
  }
  private requests = new Map<string, { child: Child; resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  private states = new Map<string, State>();
  private loggers = new Map<string, PebbleLogs>();
  private stopping = false;
  private launches = new Set<Promise<unknown>>();
  private idleTimer?: ReturnType<typeof setInterval>;
  constructor(readonly home: string, readonly db: DaemonDatabase, private readonly master: string, readonly creators: string[] = [], readonly dev = false, readonly dataRoot = home, private readonly idleMs = QUIET_MEMORY_MS, private readonly timing = restartTiming, private readonly cgroups?: PebbleCgroups, private readonly hibernateMs = QUIET_MEMORY_MS, readonly telemetry?: Telemetry) {
    if (!dev) {
      this.idleTimer = setInterval(() => { void this.sweepQuiet(); }, Math.min(60_000, Math.max(10, Math.min(idleMs, hibernateMs) / 4)));
      this.idleTimer.unref();
    }
  }
  logs(name: string) {
    let logs = this.loggers.get(name);
    if (!logs) { logs = new PebbleLogs(this.dataRoot, name, undefined, undefined, undefined, undefined, undefined, undefined, this.telemetry ? { store: this.telemetry, name } : undefined); this.loggers.set(name, logs); }
    return logs;
  }
  jobs(name: string, job?: string) {
    return this.request(name, job ? "jobs.run" : "jobs.list", job ? { name: job } : {}, { stoppedHint: "Start the pebble before inspecting or running jobs." });
  }
  serviceTokens(name: string, user: User, input?: unknown, id?: string) {
    return this.request(name, "service-token", { user, input, id }, {
      stoppedHint: "Start the pebble before managing service tokens.",
      timeout: { ms: 15000, error: () => new BedrockError("SERVICE_TOKEN_TIMEOUT", "Service token operation timed out.", "Check pebble logs and retry; a timed-out creation may have committed.") },
    });
  }
  private async request(name: string, op: string, payload: Record<string, unknown>, options: { stoppedHint: string; child?: Child; timeout?: { ms: number; error: () => BedrockError } }) {
    const child = options.child ?? await this.ensure(name);
    if (!child || child.process.exitCode !== null) throw new BedrockError("PEBBLE_STOPPED", `${name} is not running.`, options.stoppedHint);
    if (!["idle.check", "readiness"].includes(op)) child.lastActive = Date.now();
    const observation = this.telemetry?.begin(name, "POST", "/_bedrock/control", "control");
    const requestId = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = new Promise<unknown>((resolve, reject) => {
      this.requests.set(requestId, { child, resolve, reject });
      const timeout = options.timeout;
      if (timeout) timer = setTimeout(() => reject(timeout.error()), timeout.ms);
    });
    try {
      try { child.process.send({ op, requestId, ...payload }); }
      catch { throw new BedrockError("PEBBLE_STOPPED", `${name} could not receive the control request.`, "Start the pebble and retry."); }
      const value = await response; observation?.headers(200); observation?.finish(); return value;
    } catch (error) { observation?.finish("failure"); throw error; } finally {
      clearTimeout(timer); this.requests.delete(requestId);
      if (!["idle.check", "readiness"].includes(op)) child.lastActive = Date.now();
    }
  }
  // Callers reserve activity synchronously once ensure resolves, before any I/O.
  activity(child: Child) {
    this.cgroups?.activity(child.cgroup);
    child.requests++;
    child.lastActive = Date.now();
    let completed = false;
    return () => {
      if (completed) return;
      completed = true;
      child.requests--;
      child.lastActive = Date.now();
    };
  }
  async ensure(name: string): Promise<Child | undefined> {
    const state = this.states.get(name) ?? (this.db.get(name)?.status === "idle" ? this.state(name) : undefined);
    if (!state) return;
    if (state.sleeping) await state.sleeping;
    const current = this.child(name);
    if (current) { current.lastActive = Date.now(); return current; }
    if (state.waking) return state.waking;
    const record = this.db.get(name);
    if (this.stopping || record?.status !== "idle") return;
    const generation = state.generation;
    this.telemetry?.lifecycle(name, "wake");
    const work = this.launch(name, record.release, false, child => {
      if (this.stopping || state.generation !== generation) return;
      state.child = child;
      this.crashed(name, child);
    }).then(async child => {
      if (this.stopping || state.generation !== generation || this.db.get(name)?.release !== record.release || this.db.get(name)?.status !== "idle") {
        await stopChild(child);
        return this.child(name);
      }
      this.activate(name, child);
      this.db.status(name, "running");
      await this.startExclusive(name, child);
      return child;
    });
    state.waking = work;
    this.launches.add(work);
    try { return await work; }
    finally { if (state.waking === work) delete state.waking; this.launches.delete(work); }
  }
  private sweeping = false;
  private async sweepQuiet() {
    if (this.sweeping || this.stopping) return;
    this.sweeping = true;
    try {
      await this.sweepIdle();
      for (const [name, state] of this.states) {
        const child = state.child;
        if (!child?.cgroup || !this.cgroups) continue;
        const quiet = () => !this.stopping && !state.sleeping && this.child(name) === child && child.process.exitCode === null
          && !child.devSource && !child.requests && Date.now() - child.lastActive >= this.hibernateMs
          && ![...this.requests.values()].some(request => request.child === child);
        const before = child.cgroup.hibernatedAt;
        await this.cgroups.hibernate(child.cgroup, quiet);
        if (child.cgroup.hibernatedAt !== before && child.cgroup.hibernatedAt) this.telemetry?.lifecycle(name, "hibernate", child.releaseId);
      }
    } finally { this.sweeping = false; }
  }
  async memory(name: string) { return this.cgroups ? this.cgroups.status(this.child(name)?.cgroup) : { ...emptyMemory }; }
  private async sweepIdle() {
    for (const [name, state] of this.states) {
      const child = state.child;
      if (this.stopping || state.sleeping || !child?.idleSafe || child.devSource || child.requests || Date.now() - child.lastActive < this.idleMs) continue;
      if ([...this.requests.values()].some(request => request.child === child)) continue;
      const generation = state.generation;
      try {
        const quiet = await this.request(name, "idle.check", {}, { child, stoppedHint: "Restart the pebble.", timeout: { ms: 2000, error: () => new BedrockError("IDLE_CHECK_TIMEOUT", "Idle check timed out.", "The pebble will stay running; check its logs if it is unresponsive.") } });
        if (!quiet || this.stopping || state.generation !== generation || state.child !== child || child.requests || Date.now() - child.lastActive < this.idleMs) continue;
        if ([...this.requests.values()].some(request => request.child === child)) continue;
        this.telemetry?.lifecycle(name, "idle", child.releaseId);
        this.db.status(name, "idle");
        state.generation++;
        delete state.child;
        const sleeping = stopChild(child);
        state.sleeping = sleeping;
        try { await sleeping; } finally { if (state.sleeping === sleeping) delete state.sleeping; }
      } catch {
        // An uncertain child stays awake. Future sweeps retry without log spam.
      }
    }
  }
  resourceGroups() {
    return this.db.list().map(record => ({ pebble: record.name, paths: [...new Set([this.states.get(record.name)?.child, ...this.states.get(record.name)?.candidates ?? [], ...[...this.retiring].filter(child => child.release.includes(`/pebbles/${record.name}/`))].filter((child): child is Child => !!child && child.process.exitCode === null).flatMap(child => child.cgroup ? [child.cgroup.path] : []))] }));
  }
  private retiring = new Set<Child>();
  nextRetryAt(name: string) { return this.states.get(name)?.nextRetryAt ?? null; }
  child(name: string) { return this.states.get(name)?.child; }
  private state(name: string) {
    let state = this.states.get(name);
    if (!state) { state = { failures: 0, generation: 0, retired: Promise.resolve() }; this.states.set(name, state); }
    return state;
  }
  devOptions: { dataDir?: string; cron?: boolean } = {};

  async launch(name: string, release: string, devSource = false, onFailure?: (child: Child) => void): Promise<Child> {
    const state = this.state(name);
    const current = this.child(name);
    // A wake and a deploy can both be starting, or a healthy candidate may await activation; each is a writer.
    const candidate = [...state.candidates ?? []].some(child => child.process.exitCode === null);
    if (current && current.process.exitCode === null || state.launching || candidate) assertConcurrentWalSafe(this.db.db);
    state.launching = (state.launching ?? 0) + 1;
    try {
      const child = await this.spawnChild(name, release, devSource, onFailure);
      (state.candidates ??= new Set()).add(child);
      void child.process.exited.then(() => state.candidates?.delete(child));
      return child;
    } finally { state.launching!--; }
  }
  private async spawnChild(name: string, release: string, devSource: boolean, onFailure?: (child: Child) => void): Promise<Child> {
    const started = this.timing.now();
    const releaseId = basename(release) + (this.dev ? `-${started}` : "");
    const record = this.db.get(name);
    const previous = record?.release === release ? record.previous_release : record?.release;
    const logs = this.logs(name);
    let ready!: (value: { name: string; port: number; stopTimeout?: number }) => void;
    let failed!: (error: unknown) => void;
    const readiness = new Promise<{ name: string; port: number; stopTimeout?: number }>((resolve, reject) => { ready = resolve; failed = reject; });
    const secretEnv = await createSecrets(this.home).env(name);
    logs.protect(Object.values(secretEnv));
    const requests = this.requests;
    const alerts = this.alerts;
    const activeJobs = new Map<string, JobEvent>();
    const command = [process.execPath, ...await bunConfigArgs(release), join(import.meta.dir, "../runtime/child.ts")];
    const cgroup = !devSource ? await this.cgroups?.create(name) : undefined;
    let processChild: Child["process"];
    try {
      processChild = Bun.spawn(this.cgroups?.command(cgroup, command) ?? command, {
        cwd: release, stdin: "ignore", stdout: "pipe", stderr: "pipe",
        env: childEnvironment(process.env, secretEnv, devSource, { BEDROCK_API_URL: this.apiUrl, BEDROCK_HOME: this.home, BEDROCK_RELEASE: release,
          BEDROCK_RELEASE_ID: releaseId, BEDROCK_PREVIOUS_RELEASE: previous ? resolve(previous) : "",
          BEDROCK_DEV: devSource ? "1" : "0",
          BEDROCK_CRON: devSource && this.devOptions.cron === false ? "0" : "1",
          BEDROCK_DATA: devSource ? this.devOptions.dataDir ?? join(release, ".bedrock") : pebbleDataDir(this.dataRoot, name), BEDROCK_IDENTITY_SECRET: deriveIdentitySecret(this.master, name), BEDROCK_CREATORS: JSON.stringify(this.creators) }),
        ipc(message: unknown) {
          const value = message as { requestId?: string; value?: unknown; op?: string; name: string; port: number; stopTimeout?: number; error?: { code: string; message: string; hint: string } };
          if (value.op === "job-event") {
            const event = (message as { event: JobEvent }).event;
            if (event.state === "started") activeJobs.set(event.run, event);
            else if (["succeeded", "failed", "interrupted"].includes(event.state)) activeJobs.delete(event.run);
            alerts?.job(name, event); return;
          }
          if (value.op === "reply" && value.requestId) {
            const pending = requests.get(value.requestId);
            if (pending?.child !== child) return;
            if (value.error) pending?.reject(new BedrockError(value.error.code, logs.redact(value.error.message), logs.redact(value.error.hint)));
            else pending?.resolve(value.value);
            return;
          }
          if (Number.isSafeInteger(value.stopTimeout) && value.stopTimeout! >= DEFAULT_SERVICE_STOP_TIMEOUT && value.stopTimeout! <= MAX_SERVICE_STOP_TIMEOUT) child.stopTimeout = value.stopTimeout!;
          if (value.op === "stop-budget") return;
          if (value.error) failed(new BedrockError(value.error.code, logs.redact(value.error.message), logs.redact(value.error.hint)));
          else ready(value);
        },
      });
    } catch (error) {
      if (cgroup) await this.cgroups?.remove(cgroup);
      throw asBedrockError(error, "PEBBLE_START_FAILED", `Check bedrock logs ${name} and retry.`);
    }
    this.telemetry?.lifecycle(name, "spawn", releaseId);
    const reading = Promise.all([logs.pump(processChild.stdout, "stdout", releaseId), logs.pump(processChild.stderr, "stderr", releaseId)]);
    // Observe pipe failures immediately; the child is also reaped on every failure path.
    void reading.catch(() => {});
    const child: Child = { process: processChild, port: 0, release, releaseId, devSource, started, reading, requests: 0, lastActive: started, idleSafe: false, access: "users", publicRoutes: [], exclusiveServices: [], ...(cgroup ? { cgroup } : {}) };
    void processChild.exited.then(code => {
      for (const event of activeJobs.values()) alerts?.job(name, { ...event, state: "interrupted", at: Date.now() });
      this.telemetry?.lifecycle(name, code === 0 ? "exit" : "crash", releaseId, code, processChild.signalCode ?? null);
      if (cgroup) void this.cgroups?.remove(cgroup);
      for (const [requestId, pending] of requests) {
        if (pending.child !== child) continue;
        requests.delete(requestId);
        pending.reject(new BedrockError("PEBBLE_STOPPED", "The pebble stopped during the control request.", "Start the pebble and retry."));
      }
    });
    void preferPebbleOom(processChild.pid);
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
      const publicRoutes = info.public_routes ?? [];
      if (!Array.isArray(publicRoutes) || publicRoutes.some((key: unknown) => typeof key !== "string")) throw new BedrockError("HEALTH_FAILED", "Invalid public route list.", "Return registered public route keys in the health check.");
      publicRoutes.forEach(validatePublicRouteKey);
      const exclusiveServices = info.exclusive_services;
      if (!Array.isArray(exclusiveServices) || exclusiveServices.some((name: unknown) => typeof name !== "string")) throw new BedrockError("HEALTH_FAILED", "Invalid exclusive service list.", "Return exclusive service names in the health check.");
      child.exclusiveServices = exclusiveServices;
      child.jobSchedules = Array.isArray(info.job_schedules) ? info.job_schedules : [];
      child.publicRoutes = publicRoutes;
      const declarations = { jobs: info.jobs, services: info.services };
      child.idleSafe = !this.dev && Object.values(declarations).every(names => Array.isArray(names) && names.length === 0) && await idleSourceSafe(release);
      if (!devSource) {
        await Bun.write(join(release, ".bedrock-idle.json"), JSON.stringify({ ...declarations, safe: child.idleSafe, access }));
        await Bun.write(join(release, ".bedrock-public-routes.json"), JSON.stringify(publicRoutes));
        // Backups read this instead of importing pebble code into the daemon.
        await Bun.write(join(release, ".bedrock-backup.json"), JSON.stringify(info.backup ?? null));
      }
      this.telemetry?.lifecycle(name, "ready", releaseId);
      child.access = access;
      return child;
    } catch (error) {
      await stopChild(child).catch(() => {});
      onFailure?.(child);
      throw asBedrockError(error, "PEBBLE_START_FAILED", `Check bedrock logs ${name} and retry.`);
    } finally { clearTimeout(timer); }
  }
  async startExclusive(name: string, child: Child): Promise<ExclusiveServices> {
    if (!child.exclusiveServices.length) return "none";
    try {
      await this.state(name).retired;
      if (this.stopping || this.child(name) !== child) return "failed";
      await this.request(name, "services.exclusive.start", {}, {
        child, stoppedHint: `Restart ${name} and check bedrock logs ${name}.`,
        timeout: { ms: 60000, error: () => new BedrockError("EXCLUSIVE_START_TIMEOUT", `Exclusive services for ${name} did not start within 60 seconds.`, `Check bedrock logs ${name}; fix blocking service startup and restart the pebble.`) },
      });
      return "running";
    } catch (error) {
      try { this.logs(name).write(new TextEncoder().encode(JSON.stringify(asBedrockError(error).toJSON()) + "\n")); }
      catch { console.error("Could not write exclusive service failure to pebble logs."); }
      // A timed-out start must not leave a selected child silently missing a service.
      if (child.process.exitCode === null && (!(error instanceof BedrockError) || error.code !== "SERVICE_START_FAILED")) {
        try { child.process.kill("SIGKILL"); } catch {}
      }
      return "failed";
    }
  }
  activate(name: string, child: Child, resetFailures = true) {
    if (this.stopping) throw new BedrockError("DAEMON_STOPPING", "The daemon is stopping.", "Restart the daemon and retry.");
    const state = this.state(name);
    state.candidates?.delete(child);
    child.lastActive = Date.now();
    clearTimeout(state.timer);
    delete state.timer;
    delete state.nextRetryAt;
    state.generation++;
    if (resetFailures) state.failures = 0;
    // Preserve retiring children across replacement crashes, until they actually exit.
    this.telemetry?.lifecycle(name, "activate", child.releaseId);
    if (state.child) this.telemetry?.lifecycle(name, "retire", state.child.releaseId);
    if (state.child) { const retiring = state.child; this.retiring.add(retiring); void retiring.process.exited.then(() => this.retiring.delete(retiring)); }
    if (state.child) state.retired = Promise.all([state.retired, state.child.process.exited]).then(() => {});
    state.child = child;
    void child.process.exited.then(() => this.crashed(name, child));
  }
  private crashed(name: string, child: Child) {
    const state = this.state(name);
    if (this.stopping || state.child !== child) return;
    delete state.child;
    state.failures = this.timing.now() - child.started >= this.timing.stableMs ? 1 : state.failures + 1;
    this.retry(name, child.release, child.devSource);
  }
  private retry(name: string, release: string, devSource = false) {
    const state = this.state(name);
    this.db.status(name, state.failures >= 5 ? "crashed" : "restarting");
    const delay = state.failures >= 5 ? this.timing.capMs : Math.min(this.timing.fastCapMs, this.timing.baseMs * 2 ** state.failures);
    // Downward jitter spreads retries without exceeding the five-minute ceiling.
    const wait = delay * (0.9 + this.timing.random() * 0.1);
    state.nextRetryAt = this.timing.now() + wait;
    this.telemetry?.lifecycle(name, "retry", null, null, null, state.nextRetryAt);
    const generation = state.generation;
    state.timer = setTimeout(() => {
      delete state.timer;
      delete state.nextRetryAt;
      const work = this.launch(name, release, devSource).then(async next => {
        if (this.stopping || state.generation !== generation || (!devSource && !["restarting", "crashed"].includes(this.db.get(name)?.status ?? ""))) return stopChild(next);
        this.activate(name, next, false);
        this.db.status(name, "running");
        await this.startExclusive(name, next);
      }).catch(error => {
        if (this.stopping || state.generation !== generation) return;
        this.reportFailure(name, error);
        // Failed restarts count just like children which die after becoming healthy.
        state.failures++;
        this.retry(name, release, devSource);
      });
      state.relaunch = work;
      this.launches.add(work);
      void work.finally(() => { this.launches.delete(work); if (state.relaunch === work) delete state.relaunch; });
    }, wait);
  }
  async start(record: PebbleRecord) {
    if (this.child(record.name)) return;
    // Join a wake already in progress; a stale idle record (e.g. restore after stop) launches normally.
    if (this.db.get(record.name)?.status === "idle") { await this.ensure(record.name); return; }
    await this.stop(record.name, false);
    let child: Child;
    try { child = await this.launch(record.name, record.release); }
    catch (error) {
      // Stop cancelled any pending retry; a supervised pebble must keep recovering.
      if (["restarting", "crashed"].includes(record.status) && !this.stopping) { this.state(record.name).failures++; this.retry(record.name, record.release); }
      throw error;
    }
    this.state(record.name).failures = 0;
    this.activate(record.name, child);
    this.db.status(record.name, "running");
    await this.startExclusive(record.name, child);
  }
  async stop(name: string, persist = true) {
    const state = this.state(name);
    state.generation++;
    clearTimeout(state.timer);
    delete state.timer;
    delete state.nextRetryAt;
    const child = state.child;
    delete state.child;
    if (persist) { this.telemetry?.lifecycle(name, "stop", child?.releaseId); this.db.status(name, "stopped"); }
    if (child) await stopChild(child);
    await state.sleeping;
    await state.waking?.catch(() => {});
    // A retry child still starting would otherwise outlive delete and recreate its data.
    await state.relaunch?.catch(() => {});
  }
  forget(name: string) { this.telemetry?.forget(name); this.loggers.get(name)?.close(); this.states.delete(name); this.loggers.delete(name); }
  private reportFailure(name: string, error: unknown) {
    try { this.logs(name).write(new TextEncoder().encode(JSON.stringify(asBedrockError(error).toJSON()) + "\n")); }
    catch { console.error(`Could not write crash failure for ${name}; recovery will keep retrying.`); }
  }
  async restore() {
    for (const record of this.db.list()) {
      if (["running", "restarting", "crashed"].includes(record.status)) {
        try { await this.start(record); }
        catch (error) {
          const state = this.state(record.name);
          if (!state.timer) { state.failures++; this.retry(record.name, record.release); }
          this.reportFailure(record.name, error);
        }
      }
    }
  }
  async shutdown() {
    this.stopping = true;
    clearInterval(this.idleTimer);
    await Promise.all([...this.states.keys()].map(name => this.stop(name, false)));
    await Promise.allSettled(this.launches);
    for (const logs of this.loggers.values()) logs.close();
  }
}
