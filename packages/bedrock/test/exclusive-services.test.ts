import { expect, test } from "bun:test";
import { basename, join, resolve } from "node:path";
import { startDaemon } from "../src/daemon";
import { createArchive } from "../src/daemon/archive";
import { openDaemonDatabase } from "../src/daemon/db";
import { Supervisor, retireChild } from "../src/daemon/supervisor";
import { startPebble } from "../src/runtime";
import { tempDirectory } from "./helpers";

type Event = { event: string; release: string; kind: string; t: number; pid: number; code?: number };
const now = () => performance.timeOrigin + performance.now();
async function until(predicate: () => boolean | Promise<boolean>, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > end) throw new Error("Timed out waiting for exclusive services");
    await Bun.sleep(10);
  }
}
function fixture(delay = 200, fail = false, normal = true, stopDelay = 50, exclusive = true) {
  return `
    import { appendFileSync } from "node:fs";
    import { join } from "node:path";
    import { definePebble, service } from ${JSON.stringify(resolve(import.meta.dir, "../src/config/index.ts"))};
    let file;
    const event = (event, kind, code) => appendFileSync(file, JSON.stringify({ event, kind, code, release: process.env.BEDROCK_RELEASE_ID, pid: process.pid, t: performance.timeOrigin + performance.now() }) + "\\n");
    process.on("exit", code => { if (file) event("exit", "process", code); });
    export default definePebble({ name: "exclusive", access: "public", services: {
      host: service({ exclusive: ${exclusive}, async start(ctx) {
        file = join(ctx.dataDir, "events.jsonl");
        event("attempt", "exclusive");
        await Bun.sleep(${delay});
        if (${fail}) throw new Error("exclusive fixture failure");
        event("start", "exclusive"); return 42;
      }, async stop() { await Bun.sleep(${stopDelay}); event("stop", "exclusive"); } }),
      ${normal ? 'ordinary: service({ start(ctx) { file = join(ctx.dataDir, "events.jsonl"); event("start", "ordinary"); }, stop() { event("stop", "ordinary"); } })' : ''}
    }, routes: {
      "GET /value": (_req, _server, ctx) => Response.json({ value: ctx.services.host }),
      "GET /pid": () => Response.json({ pid: process.pid })
    } });
  `;
}
async function harness() {
  const temp = tempDirectory();
  const home = join(temp.dir, "home"), source = join(temp.dir, "source");
  let daemon = await startDaemon({ home, domain: "localhost", dev: true, port: 0 });
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = async (path: string, init: RequestInit = {}) => (await fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "bedrock.localhost", authorization: `Bearer ${token}`, ...init.headers } })).json();
  const request = (path: string) => fetch(new URL(path, daemon.server.url), { headers: { host: "exclusive.localhost" } });
  const events = async (): Promise<Event[]> => (await Bun.file(join(home, "pebbles/exclusive/data/events.jsonl")).text().catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  return {
    temp, home, source, api, request, events,
    async deploy(delay = 200, fail = false, normal = true, exclusive = true) {
      await Bun.write(join(source, "pebble.ts"), fixture(delay, fail, normal, 50, exclusive));
      const archive = join(temp.dir, "release.tar.gz");
      await createArchive(source, archive);
      return api("/api/deploy?name=exclusive", { method: "POST", body: Bun.file(archive) });
    },
    async restartDaemon() { await daemon.stop(); daemon = await startDaemon({ home, domain: "localhost", dev: true, port: 0 }); },
    async cleanup() { await daemon.stop(); temp.cleanup(); },
  };
}
function assertSwap(events: Event[], oldPid: number, newPid: number) {
  const index = (pid: number, event: string, kind: string) => events.findIndex(row => row.pid === pid && row.event === event && row.kind === kind);
  expect(index(oldPid, "stop", "exclusive")).toBeGreaterThanOrEqual(0);
  expect(index(newPid, "attempt", "exclusive")).toBeGreaterThan(index(oldPid, "exit", "process"));
  expect(index(newPid, "start", "exclusive")).toBeGreaterThan(index(oldPid, "stop", "exclusive"));
  expect(index(newPid, "start", "ordinary")).toBeLessThan(index(oldPid, "stop", "ordinary"));
}

test("exclusive services never overlap across deploy, rollback, restart, crash restart and daemon restart", async () => {
  const h = await harness();
  const pid = async () => (await (await h.request("/pid")).json()).pid as number;
  const post = (action: string) => h.api(`/api/pebbles/exclusive/${action}`, { method: "POST" });
  try {
    expect((await h.deploy()).value.exclusive_services).toBe("running");
    let old = await pid();
    const deploying = h.deploy();
    await until(async () => (await h.events()).filter(e => e.event === "start" && e.kind === "ordinary").length === 2);
    await until(async () => (await (await h.request("/value")).json()).error?.code === "SERVICE_NOT_STARTED");
    const gap = await (await h.request("/value")).json();
    expect(gap.error).toMatchObject({ code: "SERVICE_NOT_STARTED", hint: expect.stringContaining("Retry shortly") });
    expect((await deploying).value.exclusive_services).toBe("running");
    let next = await pid();
    assertSwap(await h.events(), old, next);
    for (const action of ["rollback", "restart", "secrets"]) {
      old = next;
      const result = action === "secrets"
        ? await h.api("/api/pebbles/exclusive/secrets", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ set: { FIXTURE: "changed" }, restart: true }) })
        : await post(action);
      expect(result.value.exclusive_services).toBe("running");
      next = await pid(); assertSwap(await h.events(), old, next);
    }
    old = next;
    process.kill(old, "SIGKILL");
    const killedStart = (await h.events()).findLast(row => row.pid === old && row.event === "start")!.t;
    await until(async () => (await h.events()).some(e => e.pid !== old && e.t > killedStart && e.kind === "exclusive" && e.event === "start"));
    next = await pid(); expect(next).not.toBe(old);
    expect(() => process.kill(old, 0)).toThrow();
    expect((await (await h.request("/value")).json()).value).toBe(42);
    old = next;
    await h.restartDaemon();
    next = await pid(); expect(next).not.toBe(old);
    const events = await h.events();
    expect(events.filter(e => e.pid === next && e.event === "start" && e.kind === "exclusive")).toHaveLength(1);
    expect(events.findIndex(e => e.pid === next && e.event === "attempt")).toBeGreaterThan(events.findIndex(e => e.pid === old && e.event === "exit"));
  } finally { await h.cleanup(); }
}, 30000);

test("exclusive failure selects the new release, exits nonzero and exhausts crash backoff", async () => {
  const h = await harness();
  try {
    expect((await h.deploy()).ok).toBe(true);
    const failed = await h.deploy(200, true);
    expect(failed).toMatchObject({ ok: true, value: { exclusive_services: "failed" } });
    await until(async () => (await h.api("/api/pebbles")).value[0].status === "crashed", 18000);
    const row = (await h.api("/api/pebbles")).value[0];
    expect(row.release).toBe(failed.value.release);
    expect(row.pid).toBeNull();
    const failedEvents = (await h.events()).filter(e => e.release.startsWith(basename(failed.value.release)));
    expect(failedEvents.filter(e => e.event === "attempt")).toHaveLength(5);
    expect(failedEvents.filter(e => e.event === "start" && e.kind === "exclusive")).toHaveLength(0);
    expect(failedEvents.filter(e => e.event === "exit")).toHaveLength(5);
    expect((await h.api("/api/status")).value.pebbles[0].healthy).toBe(false);
    expect(failedEvents.filter(e => e.event === "exit").every(e => e.code === 1)).toBe(true);
    expect((await h.api("/api/pebbles/exclusive/rollback", { method: "POST" })).value.exclusive_services).toBe("running");
    expect((await h.api("/api/pebbles/exclusive/rollback", { method: "POST" })).value.exclusive_services).toBe("failed");
    expect((await h.api("/api/pebbles/exclusive/restart", { method: "POST" })).value.exclusive_services).toBe("failed");
  } finally { await h.cleanup(); }
}, 30000);

test("standalone startPebble starts exclusive services immediately unless explicitly deferred", async () => {
  const temp = tempDirectory();
  try {
    for (const deferExclusive of [false, true]) {
      const running = await startPebble({ pebble: { name: "standalone", services: { host: { exclusive: true, start: () => 42 } }, routes: { "GET /value": (_r, _s, ctx) => Response.json(ctx.services.host) } }, dir: temp.dir, dataDir: join(temp.dir, String(deferExclusive)), port: 0, deferExclusive });
      try {
        const health = await (await fetch(new URL("/_bedrock/health", running.server.url))).json();
        expect(health.exclusive_services).toEqual(["host"]);
        const response = await (await fetch(new URL("/value", running.server.url))).json();
        if (deferExclusive) {
          expect(response.error.code).toBe("SERVICE_NOT_STARTED");
          await running.startExclusive();
        } else expect(response).toBe(42);
        expect(await (await fetch(new URL("/value", running.server.url))).json()).toBe(42);
      } finally { await running.stop(); }
    }
  } finally { temp.cleanup(); }
});

test("exclusive handoff measures process-exit to trivial service start", async () => {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(join(temp.dir, "home"));
  const supervisor = new Supervisor(db.home, db, "fixture-master");
  const eventsFile = join(db.home, "pebbles/exclusive/data/events.jsonl");
  try {
    const release = join(temp.dir, "release");
    await Bun.write(join(release, "pebble.ts"), fixture(0, false, false));
    const samples: number[] = [];
    let old = await supervisor.launch("exclusive", release);
    supervisor.activate("exclusive", old);
    expect(await supervisor.startExclusive("exclusive", old)).toBe("running");
    for (let i = 0; i < 5; i++) {
      const child = await supervisor.launch("exclusive", release);
      supervisor.activate("exclusive", child);
      let exitedAt = 0;
      void old.process.exited.then(() => { exitedAt = now(); });
      await retireChild(old);
      expect(await supervisor.startExclusive("exclusive", child)).toBe("running");
      const events: Event[] = (await Bun.file(eventsFile).text()).trim().split("\n").map(line => JSON.parse(line));
      const start = events.find(e => e.pid === child.process.pid && e.event === "attempt")!;
      const gap = start.t - exitedAt;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(1000);
      samples.push(gap);
      old = child;
    }
    console.log(`Exclusive handoff gap (old process.exited → trivial start entry), ms: ${samples.map(n => n.toFixed(3)).join(", ")}; median ${[...samples].sort((a, b) => a - b)[2]!.toFixed(3)}`);
  } finally { await supervisor.shutdown(); db.close(); temp.cleanup(); }
});

test("a candidate crash during retirement cannot bypass the old process exit barrier", async () => {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(join(temp.dir, "home"));
  const supervisor = new Supervisor(db.home, db, "fixture-master");
  const release = join(temp.dir, "release");
  const events = async (): Promise<Event[]> => (await Bun.file(join(db.home, "pebbles/exclusive/data/events.jsonl")).text()).trim().split("\n").map(line => JSON.parse(line));
  try {
    await Bun.write(join(release, "pebble.ts"), fixture(0, false, true, 1200));
    db.save({ name: "exclusive", release, previous_release: null, status: "running" });
    const old = await supervisor.launch("exclusive", release);
    supervisor.activate("exclusive", old);
    await supervisor.startExclusive("exclusive", old);
    const candidate = await supervisor.launch("exclusive", release);
    supervisor.activate("exclusive", candidate);
    const retiring = retireChild(old);
    candidate.process.kill("SIGKILL");
    await until(async () => (await events()).filter(e => e.kind === "ordinary" && e.event === "start").length === 3);
    expect(old.process.exitCode).toBeNull();
    expect((await events()).filter(e => e.event === "attempt")).toHaveLength(1);
    await retiring;
    await until(async () => (await events()).filter(e => e.kind === "exclusive" && e.event === "start").length === 2);
    const rows = await events();
    const next = supervisor.child("exclusive")!;
    expect(rows.findIndex(e => e.pid === next.process.pid && e.event === "attempt")).toBeGreaterThan(rows.findIndex(e => e.pid === old.process.pid && e.event === "exit"));
  } finally { await supervisor.shutdown(); db.close(); temp.cleanup(); }
}, 10000);

test("ordinary services retain overlapping swaps and report no exclusive services", async () => {
  const h = await harness();
  try {
    expect((await h.deploy(0, false, true, false)).value.exclusive_services).toBe("none");
    const oldPid = (await (await h.request("/pid")).json()).pid;
    expect((await h.deploy(0, false, true, false)).value.exclusive_services).toBe("none");
    const newPid = (await (await h.request("/pid")).json()).pid;
    const events = await h.events();
    expect(events.findIndex(e => e.pid === newPid && e.event === "start")).toBeLessThan(events.findIndex(e => e.pid === oldPid && e.event === "stop"));
    for (const action of ["rollback", "restart"]) {
      expect((await h.api(`/api/pebbles/exclusive/${action}`, { method: "POST" })).value.exclusive_services).toBe("none");
    }
  } finally { await h.cleanup(); }
}, 10000);
