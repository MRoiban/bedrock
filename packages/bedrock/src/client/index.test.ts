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

const drain = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
for (const outcome of [426, 404, 401, 403, 400, 502, "network", "timeout"] as const) {
  test(`sync probe ${outcome} selects the correct transport and can recover`, async () => setup(async env => {
    const client = createClient({ url: "https://pebble.test", pollInterval: 100, autoReload: false });
    const errors: string[] = [], data: unknown[] = [];
    let queries = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/ws")) {
        if (outcome === "network") throw new TypeError("disconnected");
        if (outcome === "timeout") throw new DOMException("Timed out", "TimeoutError");
        return outcome === 426 ? new Response(null, { status: 426 }) : Response.json({ error: { code: outcome === 404 ? "NOT_FOUND" : outcome === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, { status: outcome });
      }
      queries++; return Response.json({ ok: true, value: queries });
    }) as unknown as typeof fetch;
    client.subscribe("notes", null, value => data.push(value), error => errors.push(error.code));
    latest().close(); await drain();
    if (outcome === 401 || outcome === 403 || outcome === 426) {
      expect(client.connection().state).toBe("reconnecting"); expect(queries).toBe(0);
      expect(errors).toEqual(outcome === 426 ? [] : [outcome === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"]);
    } else { expect(client.connection().state).toBe("polling"); expect(data).toEqual([1]); }
    env.clock.advance(250); await drain();
    if (outcome === 404) { expect(FakeSocket.instances).toHaveLength(1); }
    else {
      expect(FakeSocket.instances).toHaveLength(2);
      if (outcome === 401 || outcome === 403) {
        latest().close(); await drain(); expect(errors).toHaveLength(1);
        env.window.emit("online");
      }
      latest().open(); expect(client.connection()).toMatchObject({ state: "live", attempt: 0 });
      const count = queries; env.clock.advance(1000); await drain(); expect(queries).toBe(count);
    }
    client.close();
  }));
}

test("an unrecognised 404 is temporary and online retries while polling", async () => setup(async env => {
  globalThis.fetch = (async (input: string | URL | Request) => String(input).endsWith("/ws") ? Response.json({}, { status: 404 }) : Response.json({ ok: true, value: [] })) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", autoReload: false });
  client.subscribe("notes", null, () => {}); latest().close(); await drain();
  expect(client.connection().state).toBe("polling");
  env.window.emit("online"); expect(FakeSocket.instances).toHaveLength(2);
  client.close();
}));

test("polling suppresses duplicates, pauses hidden tabs, deduplicates errors and recovers offline", async () => setup(async env => {
  let value = 1, requests = 0, failure = "";
  globalThis.fetch = (async () => {
    requests++;
    if (failure === "network") throw new TypeError("offline");
    if (failure) return Response.json({ ok: false, error: { code: failure } }, { status: 403 });
    return Response.json({ ok: true, value });
  }) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", sync: false, pollInterval: 100, autoReload: false });
  const data: unknown[] = [], errors: string[] = [];
  client.subscribe("notes", null, x => data.push(x), e => errors.push(e.code)); await drain();
  env.clock.advance(100); await drain(); expect(data).toEqual([1]);
  value = 2; env.clock.advance(100); await drain(); expect(data).toEqual([1, 2]);
  env.document.hidden = true; env.document.emit("visibilitychange");
  const count = requests; env.clock.advance(1000); await drain(); expect(requests).toBe(count);
  value = 3; env.document.hidden = false; env.document.emit("visibilitychange"); await drain(); expect(data).toEqual([1, 2, 3]);
  failure = "FORBIDDEN";
  for (let i = 0; i < 2; i++) { env.clock.advance(100); await drain(); }
  expect(errors).toEqual(["FORBIDDEN"]); expect(client.connection().state).toBe("polling");
  failure = "network"; env.clock.advance(100); await drain(); expect(client.connection().state).toBe("offline");
  failure = ""; env.clock.advance(100); await drain(); expect(client.connection().state).toBe("polling");
  failure = "FORBIDDEN"; env.clock.advance(100); await drain(); expect(errors).toEqual(["FORBIDDEN", "REQUEST_FAILED", "FORBIDDEN"]);
  client.close();
}));

test("HTTP saves refresh every subscription before resolving even with polling disabled", async () => setup(async () => {
  let value = 0;
  const order: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).includes("/m/")) { value++; return Response.json({ ok: true, value: "saved" }); }
    return Response.json({ ok: true, value });
  }) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", sync: false, pollInterval: 0, autoReload: false });
  client.subscribe("notes", null, x => order.push(`a${x}`));
  client.subscribe("notes", null, x => order.push(`b${x}`)); await drain(); order.length = 0;
  await client.mutate("save", null).then(() => order.push("resolved"));
  expect(order).toEqual(["a1", "b1", "resolved"]);
  client.close();
}));

test("custom fetch blocks stale reload, merges auth headers, refreshes writes and rejects other origins", async () => setup(async env => {
  let respond!: (response: Response) => void;
  let init: RequestInit | undefined;
  globalThis.fetch = ((_url: string | URL | Request, options?: RequestInit) => { init = options; return new Promise(resolve => { respond = resolve; }); }) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", sync: false });
  await expect(client.fetch("https://evil.test/save")).rejects.toMatchObject({ code: "INVALID_ARGS" });
  const work = client.fetch("/save", { method: "POST", headers: { "x-custom": "yes" } });
  expect(new Headers(init?.headers).get("x-custom")).toBe("yes"); expect(init?.credentials).toBe("include");
  respond(new Response("ok", { headers: { "x-bedrock-release": "new" } }));
  await drain(); await work; expect(env.reloads()).toBe(1); client.close();
  env.values.delete("bedrock:reload");
  const other = createClient({ url: "https://pebble.test", sync: false });
  const pending = other.fetch("/slow");
  globalThis.fetch = (async () => Response.json({ ok: true, value: [] }, { headers: { "x-bedrock-release": "new" } })) as unknown as typeof fetch;
  await other.query("notes", null); expect(env.reloads()).toBe(1);
  respond(new Response(null, { status: 403 })); expect((await pending).status).toBe(403); expect(env.reloads()).toBe(2);
  other.close();
}));

test("connection listeners only fire on state changes and unsubscribe", async () => setup(async env => {
  const client = createClient({ url: "https://pebble.test", autoReload: false });
  const states: string[] = [];
  const unsubscribe = client.onConnection(c => states.push(c.state));
  expect(client.connection().state).toBe("idle"); expect(states).toEqual([]);
  const unsub = client.subscribe("notes", null, () => {}); expect(states).toEqual(["connecting"]);
  latest().open(); latest().close(); env.clock.advance(250); latest().close(); await drain();
  expect(states).toEqual(["connecting", "live", "reconnecting"]); expect(client.connection().attempt).toBe(2);
  env.clock.advance(500); latest().open(); unsub(); expect(states.slice(-2)).toEqual(["live", "idle"]);
  unsubscribe(); client.subscribe("notes", null, () => {}); expect(states.at(-1)).toBe("idle"); client.close();
}));

test("user network failures are OFFLINE while remote errors retain their code", async () => setup(async () => {
  const client = createClient({ url: "https://pebble.test", autoReload: false });
  globalThis.fetch = (async () => { throw new TypeError("lost network"); }) as unknown as typeof fetch;
  await expect(client.user()).rejects.toMatchObject({ code: "OFFLINE" }); expect(client.connection().state).toBe("offline");
  globalThis.fetch = (async () => Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 })) as unknown as typeof fetch;
  await expect(client.user()).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(client.connection().state).toBe("idle");
  client.close();
}));

test("polling ticks are sequential and never overlap while a query is pending", async () => setup(async env => {
  let slow = false, queries = 0;
  const replies: ((response: Response) => void)[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    queries++;
    return slow ? new Promise(resolve => replies.push(resolve)) : Promise.resolve(Response.json({ ok: true, value: String(input) }));
  }) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", sync: false, pollInterval: 100, autoReload: false });
  client.subscribe("first", null, () => {}); client.subscribe("second", null, () => {}); await drain();
  slow = true; env.clock.advance(100); await drain(); expect(queries).toBe(3);
  env.clock.advance(1000); await drain(); expect(queries).toBe(3);
  replies.shift()!(Response.json({ ok: true, value: 1 })); await drain(); expect(queries).toBe(4);
  replies.shift()!(Response.json({ ok: true, value: 2 })); await drain();
  env.clock.advance(99); expect(queries).toBe(4); env.clock.advance(1); expect(queries).toBe(5);
  client.close(); replies.shift()!(Response.json({ ok: true, value: 3 })); await drain();
}));

test("disabled polling stays one-shot on visible events but custom writes refresh and ignore refresh errors", async () => setup(async env => {
  let value = 0, queries = 0, fail = false;
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).endsWith("/save")) { value++; return new Response("saved"); }
    queries++;
    return fail ? Response.json({ ok: false, error: { code: "FORBIDDEN" } }, { status: 403 }) : Response.json({ ok: true, value });
  }) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", sync: false, pollInterval: 0, autoReload: false });
  const data: unknown[] = [], errors: string[] = [];
  client.subscribe("notes", null, x => data.push(x), e => errors.push(e.code)); await drain();
  env.document.emit("visibilitychange"); env.clock.advance(10000); await drain(); expect(queries).toBe(1);
  await client.fetch("https://pebble.test/save", { method: "POST" }).then(() => expect(data).toEqual([0, 1]));
  fail = true; await client.fetch("/save", { method: "DELETE" }); expect(errors).toEqual(["FORBIDDEN"]);
  client.close();
}));

test("queued HTTP fallback refreshes before resolution and refresh errors do not reject a mutation", async () => setup(async () => {
  let written = false, fail = false;
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).endsWith("/ws")) return new Response("proxy", { status: 502 });
    if (String(input).includes("/m/")) { written = true; return Response.json({ ok: true, value: "saved" }); }
    if (fail) return Response.json({ ok: false, error: { code: "FORBIDDEN" } }, { status: 403 });
    return Response.json({ ok: true, value: written });
  }) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", autoReload: false });
  let data: unknown;
  client.subscribe("notes", null, x => { data = x; });
  const pending = client.mutate("save", null); latest().close();
  await pending.then(() => expect(data).toBe(true));
  fail = true; expect(await client.mutate("save", null)).toBe("saved"); client.close();
}));

test("custom fetch uses token auth and network errors remain offline after settlement", async () => setup(async () => {
  let init: RequestInit | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, options?: RequestInit) => { init = options; return new Response(null, { status: 404 }); }) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", token: "brk_test", headers: { cookie: "secret", "x-default": "yes" } });
  expect((await client.fetch("/custom", { headers: { "x-other": "yes" } })).status).toBe(404);
  expect(init?.credentials).toBe("omit");
  const headers = new Headers(init?.headers);
  expect(headers.get("authorization")).toBe("Bearer brk_test"); expect(headers.has("cookie")).toBe(false);
  expect(headers.get("origin")).toBe("https://pebble.test"); expect(headers.get("x-default")).toBe("yes");
  globalThis.fetch = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
  await expect(client.fetch("/custom")).rejects.toMatchObject({ code: "REQUEST_FAILED" }); expect(client.connection().state).toBe("offline"); client.close();
}));

test("missing WebSocket support polls and recovers from offline without referencing the global", async () => setup(async env => {
  globalThis.WebSocket = undefined as unknown as typeof WebSocket;
  let fail = true;
  globalThis.fetch = (async () => { if (fail) throw new TypeError("offline"); return Response.json({ ok: true, value: 1 }); }) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", pollInterval: 100, autoReload: false });
  client.subscribe("notes", null, () => {}); await drain(); expect(client.connection().state).toBe("offline");
  fail = false; env.clock.advance(100); await drain(); expect(client.connection().state).toBe("polling"); expect(FakeSocket.instances).toHaveLength(0); client.close();
}));

test("browser offline state survives events until a successful response", async () => setup(async env => {
  Object.assign(env.window, { navigator: { onLine: false } });
  globalThis.fetch = (async () => Response.json({ ok: true, value: 1 })) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", sync: false, autoReload: false });
  expect(client.connection().state).toBe("offline");
  client.subscribe("notes", null, () => {}); await drain(); expect(client.connection().state).toBe("offline");
  Object.assign(env.window, { navigator: { onLine: true } });
  env.window.emit("online"); expect(client.connection().state).toBe("offline");
  await drain(); expect(client.connection().state).toBe("polling"); client.close();
}));

test("unsubscribing during discovery stays idle and temporary polling retries after resubscription", async () => setup(async env => {
  let respond!: (response: Response) => void;
  globalThis.fetch = ((input: string | URL | Request) => String(input).endsWith("/ws") ? new Promise(resolve => { respond = resolve; }) : Promise.resolve(Response.json({ ok: true, value: 1 }))) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", autoReload: false });
  const first = client.subscribe("notes", null, () => {}); latest().close(); first();
  respond(new Response(null, { status: 502 })); await drain(); expect(client.connection().state).toBe("idle");
  const second = client.subscribe("notes", null, () => {}); latest().close(); respond(new Response(null, { status: 502 })); await drain();
  expect(client.connection().state).toBe("polling"); second(); expect(client.connection().state).toBe("idle");
  client.subscribe("notes", null, () => {}); expect(FakeSocket.instances).toHaveLength(3);
  latest().open(); expect(client.connection().state).toBe("live"); client.close(); env.clock.advance(30000);
}));

test("browser token clients poll without attempting WebSockets", async () => setup(async env => {
  const bundle = await Bun.build({ entrypoints: [new URL("./index.ts", import.meta.url).pathname], target: "browser", define: { Bun: "undefined" } });
  expect(bundle.success).toBe(true);
  const source = await bundle.outputs[0]!.text();
  const { createClient: browserClient } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`) as { createClient: typeof createClient };
  let value = 0;
  globalThis.fetch = (async () => Response.json({ ok: true, value: ++value })) as unknown as typeof fetch;
  const client = browserClient({ url: "https://pebble.test", token: "brk_browser", pollInterval: 100 });
  const data: unknown[] = [];
  client.subscribe("notes", null, x => data.push(x)); await drain();
  env.clock.advance(100); await drain();
  expect(data).toEqual([1, 2]); expect(FakeSocket.instances).toHaveLength(0); expect(client.connection().state).toBe("polling"); client.close();
}));

test("storage transport network failures also mark the client offline", async () => setup(async () => {
  globalThis.fetch = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
  const client = createClient({ url: "https://pebble.test", autoReload: false });
  await expect(client.deleteFile("assets", "file")).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
  expect(client.connection().state).toBe("offline"); client.close();
}));
