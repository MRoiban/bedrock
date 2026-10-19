import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { definePebble, detached, job, mutation, publicRoute, query, sqliteTable, text } from "../src";
import { startPebble } from "../src/runtime";
import { linkDependencies, tempDirectory } from "./helpers";

const items = sqliteTable("items", { id: text("id").primaryKey() });

async function source(temp: { dir: string }) {
  const dir = join(temp.dir, "source");
  await mkdir(join(dir, "migrations"), { recursive: true });
  await Bun.write(join(dir, "migrations", "0000.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY)");
  return dir;
}

function target() {
  return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("pong") });
}

function call(port: number, kind: "q" | "m", name: string) {
  return fetch(`http://127.0.0.1:${port}/_bedrock/${kind}/${name}`, { method: "POST", body: "null" });
}

const slowSlotMs = process.env.BEDROCK_SLOW_SLOT_MS;
afterEach(() => {
  if (slowSlotMs === undefined) delete process.env.BEDROCK_SLOW_SLOT_MS;
  else process.env.BEDROCK_SLOW_SLOT_MS = slowSlotMs;
});

test("the harness rejects fetch inside a mutation and rolls it back", async () => {
  const temp = tempDirectory();
  const remote = target();
  const pebble = definePebble({ name: "slots-strict", access: "public", schema: { items },
    queries: { list: query(ctx => ctx.db.select().from(items).all()) },
    mutations: { add: mutation(async ctx => {
      ctx.db.insert(items).values({ id: "rolled-back" }).run();
      await fetch(remote.url);
    }) },
  });
  const running = await startPebble({ pebble, dir: await source(temp), dataDir: join(temp.dir, "data"), port: 0 });
  try {
    const response = await call(running.server.port!, "m", "add");
    expect(response.status).toBe(500);
    const body = await response.json() as { ok: false; error: { code: string; hint: string } };
    expect(body.error.code).toBe("NETWORK_IN_SLOT");
    expect(body.error.hint).toContain("detached route");
    expect(await (await call(running.server.port!, "q", "list")).json()).toEqual({ ok: true, value: [] });
  } finally { await running.stop(); remote.stop(true); temp.cleanup(); }
});

test("detached handlers fetch outside ctx.write while another slot holds the queue", async () => {
  const temp = tempDirectory();
  const remote = target();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held!: () => void;
  const holding = new Promise<void>(resolve => { held = resolve; });
  let fetched!: () => void;
  const fetchedEarly = new Promise<void>(resolve => { fetched = resolve; });
  const pebble = definePebble({ name: "slots-detached", access: "public", schema: { items },
    mutations: { hold: mutation(async () => { held(); await gate; }) },
    routes: { "GET /sync": publicRoute(detached(async (_request, _server, ctx) => {
      const body = await (await fetch(remote.url)).text();
      fetched();
      await ctx.write(slot => slot.db.insert(items).values({ id: body }).run());
      return new Response(body);
    })) },
  });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const running = await startPebble({ pebble, dir: await source(temp), dataDir: join(temp.dir, "data"), port: 0 });
  try {
    const holder = call(running.server.port!, "m", "hold");
    await holding;
    let settled = false;
    void holder.then(() => { settled = true; });
    const route = fetch(`http://127.0.0.1:${running.server.port}/sync`);
    // The fetch completes while the hold slot is still open; only ctx.write waits for it.
    await Promise.race([fetchedEarly, Bun.sleep(4000).then(() => { throw new Error("detached fetch was blocked by the open slot"); })]);
    expect(settled).toBe(false);
    release();
    expect((await holder).status).toBe(200);
    const response = await route;
    expect(await response.text()).toBe("pong");
  } finally { warn.mockRestore(); await running.stop(); remote.stop(true); temp.cleanup(); }
});

test("slow slots warn once with kind and name; fast slots stay quiet", async () => {
  const temp = tempDirectory();
  process.env.BEDROCK_SLOW_SLOT_MS = "100";
  const pebble = definePebble({ name: "slots-warn", access: "public", schema: { items },
    mutations: {
      slow: mutation(async () => { await Bun.sleep(250); }),
      fast: mutation(() => {}),
    },
    jobs: { sweep: job("0 0 1 1 *", async () => { await Bun.sleep(250); }) },
    routes: { "POST /import": publicRoute(detached(async (_request, _server, ctx) => {
      await ctx.write(async () => { await Bun.sleep(250); });
      return new Response("ok");
    })) },
  });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const running = await startPebble({ pebble, dir: await source(temp), dataDir: join(temp.dir, "data"), port: 0 });
  const lines = () => warn.mock.calls.map(args => String(args[0])).filter(line => line.startsWith("[slots-warn]"));
  try {
    expect((await call(running.server.port!, "m", "fast")).status).toBe(200);
    expect(lines()).toEqual([]);
    expect((await call(running.server.port!, "m", "slow")).status).toBe(200);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(/Slow slot: mutation "slow" held the write queue for \d+ ms/);
    expect(lines()[0]).toContain("job(..., { transaction: false })");
    await running.jobs.run("sweep");
    expect(lines()[1]).toMatch(/Slow slot: job "sweep" held/);
    await fetch(`http://127.0.0.1:${running.server.port}/import`, { method: "POST" });
    expect(lines()[2]).toMatch(/Slow slot: detached write "POST \/import" held/);
    expect(lines()).toHaveLength(3);
  } finally { warn.mockRestore(); await running.stop(); temp.cleanup(); }
});

for (const strict of [false, true]) test(`production child ${strict ? "guards" : "leaves"} fetch ${strict ? "with" : "without"} BEDROCK_STRICT_SLOTS=1`, async () => {
  const temp = tempDirectory();
  const remote = target();
  const dir = await source(temp);
  linkDependencies(resolve(import.meta.dir, "../../../examples/notes/node_modules"), join(dir, "node_modules"));
  // Captured before the runtime starts, so the route can tell whether fetch was replaced.
  await Bun.write(join(dir, "pebble.ts"), `import { definePebble, mutation, publicRoute } from "bedrock";
const original = globalThis.fetch;
export default definePebble({ name: "slots-prod", access: "public",
  mutations: { ping: mutation(async () => (await fetch(${JSON.stringify(remote.url.href)})).text()) },
  routes: { "GET /patched": publicRoute(() => Response.json(globalThis.fetch !== original)) },
});`);
  let ready!: (value: { port?: number; error?: unknown }) => void;
  const started = new Promise<{ port?: number; error?: unknown }>(resolve => { ready = resolve; });
  const env: Record<string, string | undefined> = { ...process.env, BEDROCK_RELEASE: dir, BEDROCK_DATA: join(temp.dir, "data"), BEDROCK_HOME: join(temp.dir, "home"), BEDROCK_DEV: "0" };
  if (strict) env.BEDROCK_STRICT_SLOTS = "1"; else delete env.BEDROCK_STRICT_SLOTS;
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/runtime/child.ts")], {
    cwd: dir, env, stdout: "ignore", stderr: "pipe",
    ipc(message: any) { if (message?.port || message?.error) ready(message); },
  });
  try {
    const { port, error } = await started;
    expect(error).toBeUndefined();
    expect(await (await fetch(`http://127.0.0.1:${port}/patched`)).json()).toBe(strict);
    const body = await (await call(port!, "m", "ping")).json() as { ok: boolean; value?: string; error?: { code: string } };
    if (strict) expect(body.error?.code).toBe("NETWORK_IN_SLOT");
    else expect(body).toEqual({ ok: true, value: "pong" });
  } finally { child.kill(); await child.exited; remote.stop(true); temp.cleanup(); }
}, 15000);
