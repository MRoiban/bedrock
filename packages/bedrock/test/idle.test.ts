import { expect, test } from "bun:test";
import { join } from "node:path";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";
import { backupSetup } from "../src/backup";
import { HeaderWebSocket, tempDirectory } from "./helpers";

const idleMs = 160;
async function until(predicate: () => Promise<boolean>, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > end) throw new Error("Timed out waiting for idle lifecycle");
    await Bun.sleep(20);
  }
}
const source = (extra = "", version = "v1") => `import { definePebble, job, service, socket, detached, bucket, publicRoute } from "bedrock";
let finish, closeStream;
const instance = crypto.randomUUID();
export default definePebble({ name: "sample", access: "public", tokens: true, sync: true,
 routes: { "GET /": () => Response.json({ version: "${version}", instance }),
 "GET /background": detached((_r, _s, ctx) => { void ctx.read(async () => { await new Promise(resolve => { finish = resolve; }); }); return new Response("started"); }),
 "GET /finish": publicRoute(detached(() => { finish?.(); closeStream?.(); return new Response("finished"); })),
 "GET /stream": detached(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("first")); closeStream = () => controller.close(); } }))),
 "POST /body": detached(async request => new Response(await request.text())) }, ${extra} });`;

async function harness(extra = "") {
  const temp = tempDirectory();
  const home = join(temp.dir, "home"), dir = join(temp.dir, "source");
  await setup(home, "example.test", "creator@example.test", 0);
  let daemon = await startDaemon({ home, idleTimeoutForTests: idleMs });
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "bedrock.localhost", authorization: `Bearer ${token}`, ...init.headers } });
  const request = (path = "/", init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "sample.localhost", origin: "http://sample.localhost", ...init.headers } });
  const record = async () => (await (await api("/api/pebbles")).json()).value[0];
  const state = async (status: string) => until(async () => (await record())?.status === status);
  const deploy = async (code = source(extra)) => {
    await Bun.write(join(dir, "pebble.ts"), code);
    const archive = join(temp.dir, "release.tar.gz");
    await createArchive(dir, archive);
    const response = await api("/api/deploy?name=sample", { method: "POST", body: Bun.file(archive) });
    expect(await response.json()).toMatchObject({ ok: true });
  };
  const socket = async (path = "/echo") => {
    const url = new URL(path, daemon.server.url); url.protocol = "ws:";
    const ws = new HeaderWebSocket(url, { headers: { host: "sample.localhost", origin: "http://sample.localhost" } });
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = reject; });
    return ws;
  };
  try { await deploy(); } catch (error) { await daemon.stop(); temp.cleanup(); throw error; }
  return { home, temp, api, request, record, state, deploy, socket,
    async reboot() { await daemon.stop(); daemon = await startDaemon({ home, idleTimeoutForTests: idleMs }); },
    async cleanup() { await daemon.stop(); temp.cleanup(); },
  };
}

test("idle HTTP wake is health-gated and shared; deploy, rollback, restart, IPC, backup, boot and stop interoperate", async () => {
  const h = await harness();
  try {
    const first = await (await h.request()).json();
    const old = await h.record();
    await h.state("idle");
    expect((await h.record()).pid).toBeNull();
    expect(await Bun.file(join(old.release, ".bedrock-idle.json")).json()).toMatchObject({ safe: true, jobs: [], services: [] });
    const explicitStart = h.api("/api/pebbles/sample/start", { method: "POST" });
    const responses = await Promise.all(Array.from({ length: 12 }, async () => (await h.request()).json()));
    expect((await explicitStart).status).toBe(200);
    expect(new Set(responses.map(value => value.instance)).size).toBe(1);
    expect(responses[0].instance).not.toBe(first.instance);
    expect(responses.every(value => value.version === "v1")).toBe(true);
    await h.state("idle");
    await h.deploy(source("", "v2"));
    expect(await (await h.request()).json()).toMatchObject({ version: "v2" });
    await h.state("idle");
    expect((await h.api("/api/pebbles/sample/rollback", { method: "POST" })).status).toBe(200);
    expect(await (await h.request()).json()).toMatchObject({ version: "v1" });
    await h.state("idle");
    expect((await h.api("/api/pebbles/sample/restart", { method: "POST" })).status).toBe(200);
    await h.state("idle");
    expect(await (await h.api("/api/jobs/sample")).json()).toMatchObject({ ok: true, value: [] });
    expect((await h.record()).status).toBe("running");
    await h.state("idle");
    await backupSetup(h.home, { type: "fs", directory: join(h.temp.dir, "backups") });
    expect((await h.api("/api/backup/run?name=sample", { method: "POST" })).status).toBe(200);
    expect((await h.record()).status).toBe("idle");
    await h.reboot();
    expect((await h.record()).status).toBe("idle");
    expect((await h.record()).pid).toBeNull();
    expect((await h.request()).status).toBe(200);
    await h.state("idle");
    expect((await h.api("/api/pebbles/sample/stop", { method: "POST" })).status).toBe(200);
    expect((await h.request()).status).toBe(503);
    await Bun.sleep(idleMs * 2);
    expect((await h.record()).status).toBe("stopped");
    expect((await h.api("/api/pebbles/sample/start", { method: "POST" })).status).toBe(200);
    await h.state("idle");
    expect((await h.api("/api/pebbles/sample?confirm=true", { method: "DELETE" })).status).toBe(200);
  } finally { await h.cleanup(); }
}, 30000);

for (const path of ["/echo", "/_bedrock/ws"]) test(`idle wakes on WebSocket upgrade and stays awake for anonymous ${path}`, async () => {
  const h = await harness('sockets: { "/echo": socket({ message(ws, data) { ws.send(data); } }) },');
  let ws: WebSocket | undefined;
  try {
    await h.state("idle");
    ws = await h.socket(path);
    await Bun.sleep(idleMs * 4);
    expect((await h.record()).status).toBe("running");
    if (path === "/echo") {
      const message = new Promise(resolve => { ws!.onmessage = event => resolve(event.data); });
      ws.send("hello"); expect(await message).toBe("hello");
    }
    ws.close();
    await h.state("idle");
  } finally { ws?.close(); await h.cleanup(); }
}, 10000);

for (const declaration of [
  'jobs: { tick: job("* * * * *", () => {}) },',
  'services: { resource: service({ start() { return {}; } }) },',
  'services: { resource: service({ exclusive: true, start() { return {}; } }) },',
]) test(`idle never stops declarations: ${declaration}`, async () => {
  const h = await harness(declaration);
  try { await Bun.sleep(idleMs * 4); expect((await h.record()).status).toBe("running"); }
  finally { await h.cleanup(); }
}, 10000);

test("idle never stops detached work after its HTTP response, or a resumable upload", async () => {
  const h = await harness('storage: [bucket("files", { access: "public", maxSize: "1mb" })],');
  try {
    expect(await (await h.request("/background")).text()).toBe("started");
    await Bun.sleep(idleMs * 4);
    expect((await h.record()).status).toBe("running");
    expect((await h.request("/finish")).status).toBe(200);
    await h.state("idle");
    const response = await h.request("/_bedrock/files/files/uploads", { method: "POST", body: JSON.stringify({ name: "test.txt", size: 4 }) });
    const upload = await response.json();
    expect(response.status).toBe(201);
    await Bun.sleep(idleMs * 4);
    expect((await h.record()).status).toBe("running");
    expect((await h.request(`/_bedrock/files/files/uploads/${upload.uploadId}`, { method: "DELETE" })).status).toBe(204);
    await h.state("idle");
  } finally { await h.request("/finish").catch(() => {}); await h.cleanup(); }
}, 10000);

test("idle failed wake returns the styled 503 and enters crash supervision", async () => {
  const h = await harness();
  try {
    await h.state("idle");
    const record = await h.record();
    await Bun.write(join(record.release, "pebble.ts"), "throw new Error('startup failed');");
    const response = await h.request("/", { headers: { accept: "text/html" } });
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(["restarting", "crashed"]).toContain((await h.record()).status);
  } finally { await h.cleanup(); }
}, 10000);


test("idle keeps request bodies and response streams alive until completion", async () => {
  const h = await harness();
  try {
    let closeBody!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("body")); closeBody = () => controller.close(); } });
    const inFlight = h.request("/body", { method: "POST", body });
    await Bun.sleep(idleMs * 4);
    expect((await h.record()).status).toBe("running");
    closeBody();
    expect(await (await inFlight).text()).toBe("body");
    await h.state("idle");
    const response = await h.request("/stream");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    await Bun.sleep(idleMs * 4);
    expect((await h.record()).status).toBe("running");
    await h.request("/finish");
    expect((await reader.read()).done).toBe(true);
    await h.state("idle");
  } finally { await h.request("/finish").catch(() => {}); await h.cleanup(); }
}, 10000);

test("dev children never idle, even with the internal short timeout", async () => {
  const temp = tempDirectory(), home = join(temp.dir, "home"), dir = join(temp.dir, "source");
  await Bun.write(join(dir, "pebble.ts"), source().replace('"bedrock"', JSON.stringify(join(import.meta.dir, "../src/index.ts"))));
  await setup(home, "localhost", "creator@example.test", 0);
  const daemon = await startDaemon({ home, dev: true, domain: "localhost", devPebble: { name: "sample", dir }, idleTimeoutForTests: idleMs });
  try {
    await Bun.sleep(idleMs * 4);
    const response = await fetch(new URL("/", daemon.server.url), { headers: { host: "sample.localhost" } });
    expect(response.status).toBe(200);
  } finally { await daemon.stop(); temp.cleanup(); }
}, 10000);


test("stop during an idle wake cancels candidate activation", async () => {
  const h = await harness();
  try {
    await h.state("idle");
    const record = await h.record();
    await Bun.write(join(record.release, "pebble.ts"), "await Bun.sleep(300);\n" + source());
    const waking = h.request();
    await Bun.sleep(50);
    expect((await h.api("/api/pebbles/sample/stop", { method: "POST" })).status).toBe(200);
    expect((await waking).status).toBe(503);
    expect(await h.record()).toMatchObject({ status: "stopped", pid: null });
    await Bun.sleep(idleMs * 2);
    expect((await h.request()).status).toBe(503);
  } finally { await h.cleanup(); }
}, 10000);
