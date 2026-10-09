import { expect, test } from "bun:test";
import { join } from "node:path";
import { startPebble } from "../src/runtime";
import { definePebble, service, socket, query, mutation } from "../src/config";
import { tempDirectory, HeaderWebSocket, identityHeaders } from "./helpers";

async function connect(url: URL, headers: Record<string, string> = {}) {
  url.protocol = "ws:";
  const ws = new HeaderWebSocket(url, { headers });
  ws.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("upgrade rejected")); });
  return ws;
}
function echo(ws: WebSocket, body: string | Uint8Array) {
  return new Promise<any>(resolve => { ws.onmessage = event => resolve(event.data); ws.send(body); });
}

test("services gate readiness, share values in functions/routes/sockets/jobs, and stop in reverse order", async () => {
  const temp = tempDirectory();
  const order: string[] = [];
  let release!: () => void;
  let began!: () => void;
  const starting = new Promise<void>(resolve => { began = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let ready = false;
  const reservation = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = reservation.port!;
  await reservation.stop(true);
  const pending = startPebble({ dir: temp.dir, dataDir: join(temp.dir, "data"), port, pebble: definePebble({
    name: "hosting", services: {
      first: service({ async start(ctx) { order.push("first"); began(); await gate; expect(ctx.dataDir).toBe(join(temp.dir, "data")); return { answer: 42, signal: ctx.signal }; }, stop(value) { expect(value.signal.aborted).toBe(true); order.push("stop first"); } }),
      second: service({ start() { order.push("second"); return "two"; }, stop() { order.push("stop second"); } }),
    },
    queries: { answer: query(ctx => ctx.services.first.answer) },
    routes: { "GET /value": (_req, _server, ctx) => Response.json(ctx.services.second) },
    sockets: { "/api/host": socket<number>({ open(ws, ctx) { ws.data.value = ctx.services.first.answer; }, async message(ws, body, ctx) { expect(ws.data.value).toBe(42); expect(await ctx.read(c => c.services.second)).toBe("two"); ws.send(body); } }) },
  }) }).then(runtime => { ready = true; return runtime; });
  await starting;
  await expect(fetch(`http://127.0.0.1:${port}/_bedrock/health`)).rejects.toThrow();
  expect(ready).toBe(false); expect(order).toEqual(["first"]);
  release();
  const runtime = await pending;
  try {
    expect(order).toEqual(["first", "second"]);
    expect((await (await fetch(new URL("/_bedrock/health", runtime.server.url))).json()).ok).toBe(true);
    expect((await runtime.execute("query", "answer", undefined, new Request("http://localhost"))).value).toBe(42);
    expect((await runtime.execute.job(ctx => ctx.services.first.answer)).value).toBe(42);
    expect(await (await fetch(new URL("/value", runtime.server.url))).json()).toBe("two");
    const ws = await connect(new URL("/api/host", runtime.server.url));
    expect(await echo(ws, "hello")).toBe("hello");
    expect(new Uint8Array(await echo(ws, new Uint8Array([0, 255])))).toEqual(new Uint8Array([0, 255]));
    const closed = new Promise<CloseEvent>(resolve => { ws.onclose = resolve; });
    await runtime.stop();
    expect(await closed).toMatchObject({ code: 1012, reason: "Service restart" });
    expect(order).toEqual(["first", "second", "stop second", "stop first"]);
  } finally { await runtime.stop(); temp.cleanup(); }
});

test("failed service startup unwinds started services and never reports ready", async () => {
  const temp = tempDirectory();
  const order: string[] = [];
  try {
    await expect(startPebble({ dir: temp.dir, dataDir: temp.dir, port: 0, pebble: { name: "failure", services: {
      first: service({ start() { order.push("start"); return 1; }, stop() { order.push("stop"); } }),
      bad: service({ start() { throw new Error("missing resource"); } }),
    } } })).rejects.toMatchObject({ code: "SERVICE_START_FAILED", hint: expect.any(String) });
    expect(order).toEqual(["start", "stop"]);
  } finally { temp.cleanup(); }
});

test("application sockets reject anonymous access and enforce registered bearer permissions", async () => {
  const temp = tempDirectory();
  const previous = process.env.BEDROCK_IDENTITY_SECRET;
  const headers = identityHeaders("alice");
  const runtime = await startPebble({ dir: temp.dir, dataDir: temp.dir, port: 0, pebble: {
    name: "authsocket", access: "users", tokens: true,
    mutations: { mint: mutation(ctx => ({ allowed: ctx.tokens.create({ name: "socket", permissions: ["socket:/host"] }).token, denied: ctx.tokens.create({ name: "none", permissions: [] }).token })) },
    sockets: { "/host": socket({ message(ws, message) { ws.send(message); } }) },
  } });
  try {
    expect((await fetch(new URL("/host", runtime.server.url))).status).toBe(401);
    const tokens = (await runtime.execute("mutation", "mint", undefined, new Request("http://localhost", { headers }))).value;
    const denied = await fetch(new URL("/host", runtime.server.url), { headers: { authorization: `Bearer ${tokens.denied}` } });
    expect(denied.status).toBe(403);
    await expect(connect(new URL("/host", runtime.server.url), { authorization: `Bearer ${tokens.denied}` })).rejects.toThrow();
    const ws = await connect(new URL("/host", runtime.server.url), { authorization: `Bearer ${tokens.allowed}` });
    expect(await echo(ws, "token echo")).toBe("token echo");
    ws.close();
    await expect(runtime.execute.route(new Request("http://localhost", { headers }), ctx => ctx.tokens.create({ name: "bad", permissions: ["socket:/missing"] }))).rejects.toMatchObject({ code: "INVALID_TOKEN_PERMISSION" });
  } finally { await runtime.stop(); if (previous === undefined) delete process.env.BEDROCK_IDENTITY_SECRET; else process.env.BEDROCK_IDENTITY_SECRET = previous; temp.cleanup(); }
});

test("socket and service writes notify sync without occupying a lifetime executor slot", async () => {
  const { sqliteTable, text } = await import("drizzle-orm/sqlite-core");
  const temp = tempDirectory();
  const items = sqliteTable("items", { id: text("id").primaryKey() });
  await Bun.write(join(temp.dir, "migrations/0000.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY);");
  let serviceWrite!: () => Promise<unknown>;
  const runtime = await startPebble({ dir: temp.dir, dataDir: join(temp.dir, "data"), port: 0, pebble: {
    name: "socketwrites", schema: { items }, sync: true,
    services: { writer: service({ start(ctx) { serviceWrite = () => ctx.write(c => { c.db.insert(items).values({ id: "service" }).run(); }); return "ready"; } }) },
    queries: { all: query(ctx => ctx.db.select().from(items).all()) },
    sockets: { "/host": socket({ async message(ws, data, ctx) { await ctx.write(c => { c.db.insert(items).values({ id: String(data) }).run(); }); ws.send("committed"); } }) },
  } });
  const ws = await connect(new URL("/_bedrock/ws", runtime.server.url));
  const host = await connect(new URL("/host", runtime.server.url));
  const values: any[] = [];
  ws.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.op === "data") values.push(message.result); };
  async function until(count: number) {
    const deadline = Date.now() + 2000;
    while (values.length < count && Date.now() < deadline) await Bun.sleep(10);
    expect(values.length).toBe(count);
  }
  try {
    ws.send(JSON.stringify({ op: "sub", id: "all", query: "all" }));
    await until(1); expect(values[0]).toEqual([]);
    expect(await echo(host, "socket")).toBe("committed");
    await until(2); expect(values[1]).toEqual([{ id: "socket" }]);
    await serviceWrite();
    await until(3); expect(values[2]).toEqual([{ id: "socket" }, { id: "service" }]);
  } finally { ws.close(); host.close(); await runtime.stop(); temp.cleanup(); }
});

test("socket context retains upgrade URL and headers after Bun consumes request", async () => {
  const temp = tempDirectory();
  const runtime = await startPebble({ dir: temp.dir, dataDir: temp.dir, port: 0, pebble: { name: "original", sockets: {
    "/host": socket({ open(ws, ctx) { ws.data.value = { url: ctx.request.url, header: ctx.request.headers.get("x-original") }; }, message(ws, _body, ctx) { ws.send(JSON.stringify({ value: ws.data.value, url: ctx.request.url })); } })
  } } });
  try {
    const url = new URL('/host?workspace=original', runtime.server.url);
    const ws = await connect(url, { 'x-original': 'retained' });
    const result = JSON.parse(await echo(ws, 'inspect'));
    expect(new URL(result.value.url).searchParams.get('workspace')).toBe('original');
    expect(result.value.header).toBe('retained'); expect(result.url).toBe(result.value.url); ws.close();
  } finally { await runtime.stop(); temp.cleanup(); }
});

test('custom HTTP limit accepts streamed bodies above the default 90 MiB', async () => {
  const temp = tempDirectory();
  const runtime = await startPebble({ dir: temp.dir, dataDir: temp.dir, port: 0, pebble: { name: 'streamed', maxRequestBodySize: 100 * 1024 ** 2,
    routes: { 'PUT /large': async request => {
      let bytes = 0; const reader = request.body!.getReader();
      for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.length; }
      return Response.json({ bytes });
    } }
  } });
  try {
    let remaining = 91 * 1024 ** 2;
    const body = new ReadableStream({ pull(controller) { if (!remaining) { controller.close(); return; } const size = Math.min(65536, remaining); remaining -= size; controller.enqueue(new Uint8Array(size)); } });
    const response = await fetch(new URL('/large', runtime.server.url), { method: 'PUT', body });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ bytes: 91 * 1024 ** 2 });
  } finally { await runtime.stop(); temp.cleanup(); }
});

test("a socket cannot share its path with a GET route", async () => {
  const temp = tempDirectory();
  try {
    await expect(startPebble({ dir: temp.dir, dataDir: temp.dir, port: 0, pebble: {
      name: "conflict",
      routes: { "GET /host": () => new Response("http") },
      sockets: { "/host": socket({ message() {} }) },
    } })).rejects.toMatchObject({ code: "INVALID_SOCKET", hint: "Choose a separate socket path." });
  } finally { temp.cleanup(); }
});
