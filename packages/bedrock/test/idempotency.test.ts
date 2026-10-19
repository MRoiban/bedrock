import { afterEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";
import { definePebble, mutation, query, sqliteTable, text, type FunctionContext, type FunctionMap } from "../src";
import { startPebble } from "../src/runtime";
import { HeaderWebSocket, identityHeaders, tempDirectory } from "./helpers";

const entries = sqliteTable("entries", { id: text("id").primaryKey(), body: text("body").notNull() });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function add(ctx: FunctionContext, args: { body: string }) {
  return ctx.db.insert(entries).values({ id: crypto.randomUUID(), body: args.body }).returning().get();
}

async function fixture(extra: FunctionMap = {}) {
  const temp = tempDirectory(), previousHome = process.env.BEDROCK_HOME;
  process.env.BEDROCK_HOME = temp.dir;
  cleanups.push(async () => {
    if (previousHome === undefined) delete process.env.BEDROCK_HOME;
    else process.env.BEDROCK_HOME = previousHome;
    temp.cleanup();
  });
  const dir = join(temp.dir, "source");
  await mkdir(join(dir, "migrations"), { recursive: true });
  await Bun.write(join(dir, "migrations/0000.sql"), "CREATE TABLE entries (id TEXT PRIMARY KEY, body TEXT NOT NULL);");
  const pebble = definePebble({ name: "idempotency", access: "users", sync: true, schema: { entries },
    queries: { list: query(({ db }) => db.select().from(entries).all()) },
    mutations: {
      add: mutation(v.object({ body: v.string() }), add),
      keyed: mutation({ args: v.object({ key: v.string(), body: v.string() }), idempotencyKey: args => args.key, run: add }),
      ...extra,
    },
  });
  const running = await startPebble({ pebble, dir, dataDir: join(temp.dir, "data"), port: 0 });
  cleanups.push(() => running.stop());
  return {
    ...running,
    call(name: string, args: unknown, key?: string, signal?: AbortSignal) {
      return fetch(new URL(`/_bedrock/m/${name}`, running.server.url), {
        method: "POST", headers: { "content-type": "application/json", ...identityHeaders("alice"), ...(key === undefined ? {} : { "idempotency-key": key }) },
        body: JSON.stringify(args), ...(signal ? { signal } : {}),
      });
    },
  };
}

test("HTTP rejects invalid idempotency headers and queries ignore them", async () => {
  const f = await fixture();
  for (const key of ["", "bad key", "a".repeat(256), "é"]) {
    const response = await f.call("add", { body: "bad key" }, key);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INVALID_IDEMPOTENCY_KEY" } });
  }
  const response = await fetch(new URL("/_bedrock/q/list", f.server.url), {
    method: "POST", headers: { ...identityHeaders("alice"), "idempotency-key": "" }, body: "null",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, value: [] });
});

test("HTTP replays identical JSON and commits only one application row", async () => {
  const f = await fixture();
  const first = await f.call("add", { body: "once" }, "http-key");
  const replay = await f.call("add", { body: "once" }, "http-key");
  expect(first.status).toBe(200);
  expect(replay.status).toBe(200);
  expect(await replay.text()).toBe(await first.text());
  expect(f.db.select().from(entries).all()).toHaveLength(1);
  const conflict = await f.call("add", { body: "different" }, "http-key");
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_KEY_REUSED" } });
});

test("HTTP retry after aborting an in-flight response replays the committed mutation", async () => {
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let runs = 0;
  const f = await fixture({ slow: mutation(v.object({ body: v.string() }), async (ctx, args) => {
    runs++;
    started.resolve();
    await release.promise;
    await Bun.sleep(20);
    return add(ctx, args);
  }) });
  const controller = new AbortController();
  const pending = f.call("slow", { body: "committed" }, "aborted", controller.signal).catch(error => error);
  try {
    await started.promise;
    controller.abort();
    expect(await pending).toMatchObject({ name: "AbortError" });
  } finally { release.resolve(); }
  const response = await f.call("slow", { body: "committed" }, "aborted");
  expect(response.status).toBe(200);
  const json = await response.json();
  expect(json).toMatchObject({ ok: true, value: { body: "committed" } });
  expect(f.db.select().from(entries).all()).toEqual([json.value]);
  expect(runs).toBe(1);
});

test("HTTP header keys take precedence over mutation argument keys", async () => {
  const f = await fixture();
  const args = { key: "args-key", body: "once" };
  const first = await (await f.call("keyed", args)).json();
  expect(await (await f.call("keyed", args)).json()).toEqual(first);
  const header = await (await f.call("keyed", args, "header-key")).json();
  expect(header.value.id).not.toBe(first.value.id);
  expect(await (await f.call("keyed", args, "header-key")).json()).toEqual(header);
  expect((await f.call("keyed", { key: "invalid key", body: "header bypasses args key" }, "valid-header")).status).toBe(200);
  expect(f.db.select().from(entries).all()).toHaveLength(3);
});

test("WebSocket mutation keys replay once and invalid keys return result errors", async () => {
  const f = await fixture();
  const endpoint = new URL("/_bedrock/ws", f.server.url);
  endpoint.protocol = "ws:";
  const ws = new HeaderWebSocket(endpoint, { headers: identityHeaders("alice") });
  cleanups.push(async () => { ws.close(); });
  const messages: any[] = [];
  ws.onmessage = event => messages.push(JSON.parse(String(event.data)));
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = reject; });
  const send = async (id: string, idempotencyKey: unknown) => {
    ws.send(JSON.stringify({ op: "mut", id, mutation: "add", args: { body: "ws" }, idempotencyKey }));
    const deadline = Date.now() + 4000;
    while (!messages.some(message => message.id === id)) {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for mutation result");
      await Bun.sleep(5);
    }
    return messages.find(message => message.id === id);
  };
  const first = await send("first", "ws-key"), replay = await send("replay", "ws-key");
  expect(first).toMatchObject({ op: "result", ok: true });
  expect(replay).toEqual({ ...first, id: "replay" });
  expect(f.db.select().from(entries).all()).toHaveLength(1);
  for (const [index, key] of ["", "bad key", 42, null].entries()) {
    expect(await send(`invalid-${index}`, key)).toMatchObject({ op: "result", ok: false, status: 400, error: { code: "INVALID_IDEMPOTENCY_KEY" } });
  }
  expect(f.db.select().from(entries).all()).toHaveLength(1);
});
