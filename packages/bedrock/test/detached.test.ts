import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { detached, definePebble, job, mutation, query, sqliteTable, text, type FunctionContext } from "../src";
import { createClient } from "../src/client";
import { startPebble } from "../src/runtime";
import { handleControl } from "../src/runtime/control";
import { identityHeaders, tempDirectory } from "./helpers";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for detached handler or sync");
    await Bun.sleep(10);
  }
}

test("detached HTTP routes leave mutations free, notify sync, return errors and support daemon job runs", async () => {
  const temp = tempDirectory();
  const items = sqliteTable("items", { id: text("id").primaryKey() });
  const dir = join(temp.dir, "source");
  await mkdir(join(dir, "migrations"), { recursive: true });
  await Bun.write(join(dir, "migrations", "0000.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY)");
  let entered = false;
  const order: string[] = [];
  const pebble = definePebble({ name: "detached", access: "users", sync: true, schema: { items },
    queries: { list: query(ctx => ctx.db.select().from(items).all()) },
    mutations: { add: mutation(ctx => { ctx.db.insert(items).values({ id: "mutation" }).run(); }) },
    routes: {
      "GET /slow": detached(async (_request, _server, ctx) => {
        expect(ctx.user?.id).toBe("reader");
        entered = true;
        await Bun.sleep(300);
        await ctx.write(slot => slot.db.insert(items).values({ id: "route" }).run());
        order.push("route");
        return Response.json(await ctx.read(slot => slot.db.select().from(items).all()));
      }),
      "GET /db": detached((_request, _server, ctx) => { void (ctx as unknown as FunctionContext).db; return new Response("unreachable"); }),
      "GET /fail": detached(async (_request, _server, ctx) => {
        await ctx.write(slot => slot.db.insert(items).values({ id: "before-error" }).run());
        await ctx.write(slot => { slot.db.insert(items).values({ id: "rollback" }).run(); throw new Error("slot failed"); });
        return new Response("unreachable");
      }),
    },
    jobs: { refresh: job("0 0 31 2 *", async ctx => {
      expect(ctx.user).toBeNull();
      await ctx.write(slot => { expect(slot.user).toBeNull(); slot.db.insert(items).values({ id: "job" }).run(); });
    }, { transaction: false }) },
  });
  const running = await startPebble({ pebble, dir, dataDir: join(temp.dir, "data"), port: 0 });
  const headers = identityHeaders("reader");
  const client = createClient<typeof pebble>({ url: running.server.url.href, headers });
  const values: { id: string }[][] = [];
  client.subscribe("list", undefined, rows => values.push(rows));
  try {
    await until(() => values.length === 1);
    const route = fetch(new URL("/slow", running.server.url), { headers });
    await until(() => entered);
    await client.mutate("add", undefined); order.push("mutation");
    expect(order).toEqual(["mutation"]);
    expect((await route).status).toBe(200);
    expect(order).toEqual(["mutation", "route"]);
    await until(() => values.at(-1)?.length === 2);
    const direct = await fetch(new URL("/db", running.server.url), { headers });
    expect(direct.status).toBe(500);
    expect((await direct.json()).error).toMatchObject({ code: "DETACHED_CONTEXT", hint: expect.stringContaining("ctx.write") });
    const failed = await fetch(new URL("/fail", running.server.url), { headers });
    expect(failed.status).toBe(500);
    expect((await failed.json()).error.code).toBe("FUNCTION_FAILED");
    await until(() => values.at(-1)?.length === 3);
    expect((await client.query("list", undefined)).map(row => row.id)).toEqual(["mutation", "route", "before-error"]);
    expect(await handleControl(running, { op: "unknown", requestId: "bad" })).toMatchObject({
      op: "reply", requestId: "bad", error: { code: "UNKNOWN_OPERATION", hint: expect.any(String) },
    });
    const response = await handleControl(running, { op: "jobs.run", requestId: "refresh", name: "refresh" });
    expect(response).toEqual({ op: "reply", requestId: "refresh", value: { name: "refresh", skipped: false } });
    await until(() => values.at(-1)?.length === 4);
    expect((await fetch(new URL("/_bedrock/jobs?name=refresh", running.server.url), { method: "POST", headers })).status).toBe(404);
  } finally { client.close(); await running.stop(); temp.cleanup(); }
});
