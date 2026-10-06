import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { startPebble } from "../src/runtime";
import { definePebble, query, job } from "../src/config";
import { createClient } from "../src/client";
import { tempDirectory } from "./helpers";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Timed out waiting for sync"); await Bun.sleep(10); }
}

test("custom route explicit invalidation and anonymous jobs commit, notify subscribers and roll back", async () => {
  const temp = tempDirectory();
  const items = sqliteTable("items", { id: text("id").primaryKey() });
  const dir = join(temp.dir, "source");
  await mkdir(join(dir, "migrations"), { recursive: true });
  await Bun.write(join(dir, "migrations", "0000.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY)");
  const pebble = definePebble({ name: "jobs", access: "users", sync: true, schema: { items }, queries: { list: query(({ db }) => db.select().from(items)) },
    jobs: {
      add: job("0 0 31 2 *", ctx => { expect(ctx.user).toBeNull(); ctx.db.insert(items).values({ id: "job" }).run(); }),
      fail: job("0 0 31 2 *", ctx => { ctx.db.insert(items).values({ id: "rollback" }).run(); throw new Error("expected failure"); }),
    },
    routes: { "POST /raw": (_request, _server, ctx) => { ctx.db.$client.exec("INSERT INTO items VALUES ('route')"); ctx.invalidate([items]); return new Response("ok"); } },
  });
  const running = await startPebble({ pebble, dir, dataDir: join(temp.dir, "data"), port: 0 });
  const { identityHeaders } = await import("./helpers");
  const client = createClient<typeof pebble>({ url: running.server.url.href, headers: identityHeaders("reader") });
  const values: { id: string }[][] = [];
  client.subscribe("list", undefined, rows => values.push(rows));
  try {
    await until(() => values.length === 1);
    expect((await fetch(new URL("/raw", running.server.url), { method: "POST" })).status).toBe(200);
    await until(() => values.at(-1)?.length === 1);
    await running.jobs.run("add");
    await until(() => values.at(-1)?.length === 2);
    await expect(running.jobs.run("fail")).rejects.toThrow("expected failure");
    await Bun.sleep(30);
    expect(values).toHaveLength(3);
    expect(await client.query("list", undefined)).toHaveLength(2);
    expect((await fetch(new URL("/_bedrock/jobs?name=add", running.server.url), { method: "POST" })).status).toBe(403);
  } finally { client.close(); await running.stop(); temp.cleanup(); }
});

