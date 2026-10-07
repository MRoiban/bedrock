import { expect, test } from "bun:test";
import { createClient } from "./index";
import { fakeBrowser } from "./browser-fake";
import { savePlace } from "./restore";
import { browserEnvironment } from "./browser";

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  closes: number[] = [];
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: string }) => void;
  constructor() { FakeSocket.instances.push(this); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  open() { this.readyState = 1; this.onopen?.(); }
  close(code = 1006) { this.closes.push(code); this.readyState = 3; this.onclose?.({ code }); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
async function setup(run: (env: ReturnType<typeof fakeBrowser>) => Promise<void> | void) {
  const original = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const random = Math.random;
  const env = fakeBrowser("old");
  FakeSocket.instances = [];
  globalThis.window = env.window as unknown as Window & typeof globalThis;
  globalThis.document = env.document as unknown as Document;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  globalThis.setTimeout = env.window.setTimeout;
  globalThis.clearTimeout = env.window.clearTimeout;
  Math.random = () => 0.5;
  globalThis.fetch = (async () => new Response(null, { status: 426 })) as unknown as typeof fetch;
  try { await run(env); }
  finally { Object.assign(globalThis, original); Math.random = random; }
}
const latest = () => FakeSocket.instances.at(-1)!;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("hello mismatch waits for pending mutation; data arrives before mutation resolution", async () => setup(async env => {
  const client = createClient({ url: "https://pebble.test" });
  let data: unknown;
  client.subscribe("notes", undefined, value => { data = value; });
  const mutation = client.mutate("save", undefined);
  latest().open(); latest().message({ op: "hello", release: "new" });
  expect(client.release()).toEqual({ page: "old", server: "new", stale: true });
  expect(env.reloads()).toBe(0);
  latest().message({ op: "data", id: "s1", result: ["saved"] });
  latest().message({ op: "result", id: "m2", ok: true, value: "ok" });
  expect(await mutation).toBe("ok"); expect(data).toEqual(["saved"]); expect(env.reloads()).toBe(1);
  client.close();
}));

test("1012 retries in 100–1000 ms without consuming failed attempt", async () => setup(async env => {
  const client = createClient({ url: "https://pebble.test", autoReload: false });
  client.subscribe("notes", undefined, () => {}); latest().open(); latest().close(1006);
  env.clock.advance(250);
  latest().close(1012);
  const restart = [...env.clock.timers.values()].find(timer => timer.delay !== 5000)!;
  expect(restart.delay).toBeGreaterThanOrEqual(100); expect(restart.delay).toBeLessThanOrEqual(1000);
  env.clock.advance(restart.delay);
  latest().close(1006); await tick();
  expect([...env.clock.timers.values()].map(timer => timer.delay)).toEqual([500]);
  client.close();
}));

test("online and becoming visible cancel backoff and reset failures", async () => setup(env => {
  const client = createClient({ url: "https://pebble.test" });
  client.subscribe("notes", undefined, () => {}); latest().open(); latest().close();
  expect(FakeSocket.instances).toHaveLength(1);
  env.window.emit("online"); expect(FakeSocket.instances).toHaveLength(2);
  latest().open(); latest().close();
  env.document.hidden = true; env.document.emit("visibilitychange"); expect(FakeSocket.instances).toHaveLength(2);
  env.document.hidden = false; env.document.emit("visibilitychange"); expect(FakeSocket.instances).toHaveLength(3);
  latest().open(); latest().close();
  expect([...env.clock.timers.values()].map(timer => timer.delay)).toEqual([250]);
  client.close(); env.clock.advance(30_000); expect(FakeSocket.instances).toHaveLength(3);
}));

test("pagehide rejects sent mutations, keeps unsent work, pageshow resubscribes, close removes listeners", async () => setup(async env => {
  const client = createClient({ url: "https://pebble.test" });
  client.subscribe("notes", undefined, () => {}); latest().open();
  const sent = client.mutate("save", undefined);
  const rejection = sent.catch(error => error);
  env.window.emit("pagehide"); expect(await rejection).toMatchObject({ code: "CONNECTION_LOST" });
  expect(latest().closes).toEqual([1000]);
  const unsent = client.mutate("later", undefined);
  expect(FakeSocket.instances).toHaveLength(1);
  env.window.emit("pageshow"); expect(FakeSocket.instances).toHaveLength(2);
  latest().open();
  expect(latest().sent).toEqual([{ op: "sub", id: "s1", query: "notes", args: null }, { op: "mut", id: "m3", mutation: "later", args: null }]);
  latest().message({ op: "result", id: "m3", ok: true, value: "saved" }); expect(await unsent).toBe("saved");
  client.close(); expect(env.window.listenerCount()).toBe(0); expect(env.document.listenerCount()).toBe(0);
  env.window.emit("pageshow"); env.window.emit("online"); env.document.emit("visibilitychange");
  expect(FakeSocket.instances).toHaveLength(2);
}));

test("HTTP functions, auth, storage and uploads observe headers, including failed responses", async () => setup(async env => {
  const client = createClient({ url: "https://pebble.test", sync: false, autoReload: false });
  let release = 0;
  globalThis.fetch = (async () => Response.json({ ok: true, value: [], user: null, id: "file" }, { headers: { "x-bedrock-release": `r${++release}` } })) as unknown as typeof fetch;
  await client.query("notes", undefined); expect(client.release().server).toBe("r1"); expect(client.release().stale).toBe(true);
  await client.mutate("save", undefined); expect(client.release().server).toBe("r2");
  await client.user(); expect(client.release().server).toBe("r3");
  await client.logout(); expect(client.release().server).toBe("r4");
  await client.upload("assets", new File(["hello"], "hello")); expect(client.release().server).toBe("r5");
  await client.deleteFile("assets", "file"); expect(client.release().server).toBe("r6");
  globalThis.fetch = (async () => Response.json({ error: { code: "FORBIDDEN" } }, { status: 403, headers: { "x-bedrock-release": "failed" } })) as unknown as typeof fetch;
  await expect(client.deleteFile("assets", "file")).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(client.release().server).toBe("failed");
  expect(env.reloads()).toBe(0); client.close();
}));

test("HTTP mutation and whole upload block reload until settlement", async () => setup(async env => {
  const client = createClient({ url: "https://pebble.test", sync: false });
  let respond!: (response: Response) => void;
  globalThis.fetch = (() => new Promise(resolve => { respond = resolve; })) as unknown as typeof fetch;
  const mutation = client.mutate("save", undefined);
  respond(Response.json({ ok: true, value: "ok" }, { headers: { "x-bedrock-release": "new" } }));
  await mutation; expect(env.reloads()).toBe(1); client.close();
  env.values.delete("bedrock:reload");
  const uploader = createClient({ url: "https://pebble.test", sync: false });
  let sawReloadDuringProgress = false;
  const upload = uploader.upload("assets", new File(["hello"], "hello"), { onProgress(progress) { if (progress === 1) sawReloadDuringProgress = env.reloads() > 1; } });
  respond(Response.json({ id: "file" }, { headers: { "x-bedrock-release": "new" } }));
  await upload;
  expect(sawReloadDuringProgress).toBe(false); expect(env.reloads()).toBe(2); uploader.close();
}));

test("a stale client does not reload while pagehide is active", async () => setup(env => {
  const client = createClient({ url: "https://pebble.test" });
  client.subscribe("notes", undefined, () => {}); latest().open();
  env.document.activeElement = { closest: () => ({}) };
  latest().message({ op: "hello", release: "new" });
  env.window.emit("pagehide"); env.document.hidden = true;
  env.document.emit("visibilitychange"); expect(env.reloads()).toBe(0);
  env.window.emit("pageshow"); expect(env.reloads()).toBe(1); client.close();
}));

test("a new client restores saved scroll after its first subscription data", async () => setup(env => {
  savePlace(browserEnvironment()!);
  env.window.scrollTo(0, 0);
  const client = createClient({ url: "https://pebble.test", autoReload: false });
  expect(env.values.has("bedrock:restore")).toBe(true);
  client.subscribe("notes", undefined, () => {});
  env.frame(); expect(env.window.scrollY).toBe(0);
  latest().open(); latest().message({ op: "data", id: "s1", result: [] });
  env.frame(); expect(env.window.scrollY).toBe(200);
  expect(env.values.has("bedrock:restore")).toBe(false);
  client.close(); expect(env.clock.timers.size).toBe(0);
}));

for (const phase of ["startup", "fields", "scroll"] as const) {
  test(`a throwing restore during ${phase} leaves a working client and clears saved place`, async () => setup(async env => {
    savePlace(browserEnvironment()!);
    if (phase === "startup") env.window.requestAnimationFrame = () => { throw new Error("Broken animation API"); };
    if (phase === "fields") env.document.querySelectorAll = () => { throw new Error("Broken DOM"); };
    if (phase === "scroll") Object.defineProperty(env.document, "documentElement", { get() { throw new Error("Broken DOM"); } });
    const client = createClient({ url: "https://pebble.test", autoReload: false });
    let data: unknown;
    client.subscribe("notes", undefined, value => { data = value; });
    latest().open(); latest().message({ op: "data", id: "s1", result: ["loaded"] });
    env.frame(); env.clock.advance(2000);
    expect(data).toEqual(["loaded"]);
    expect(env.values.has("bedrock:restore")).toBe(false);
    expect(env.frames.size).toBe(0);
    const mutation = client.mutate("save", undefined);
    latest().message({ op: "result", id: "m2", ok: true, value: "saved" });
    expect(await mutation).toBe("saved");
    client.close(); expect(env.clock.timers.size).toBe(0);
  }));
}
