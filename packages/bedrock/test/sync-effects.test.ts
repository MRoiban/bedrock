import * as v from "valibot";
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sqliteTable, integer } from "drizzle-orm/sqlite-core";
import { definePebble, query, mutation } from "../src/config";
import { startPebble } from "../src/runtime";
import { createClient } from "../src/client";
import { tempDirectory } from "./helpers";

const parents = sqliteTable("parents", { id: integer().primaryKey() });
const children = sqliteTable("children", { id: integer().primaryKey(), parent: integer() });
const audit = sqliteTable("audit", { id: integer().primaryKey() });
async function until(predicate: () => boolean) {
  for (let tries = 0; tries < 300; tries++) { if (predicate()) return; await Bun.sleep(10); }
  throw new Error("Timed out");
}
test("cascade and trigger writes push live results; no-op and rolled-back writes do not", async () => {
  const temp = tempDirectory();
  mkdirSync(join(temp.dir, "migrations"));
  writeFileSync(join(temp.dir, "migrations/0000.sql"), `
    CREATE TABLE parents(id INTEGER PRIMARY KEY);
    CREATE TABLE children(id INTEGER PRIMARY KEY, parent INTEGER REFERENCES parents(id) ON DELETE CASCADE);
    CREATE TABLE audit(id INTEGER PRIMARY KEY);
    CREATE TRIGGER deleted AFTER DELETE ON children BEGIN INSERT INTO audit VALUES(old.id); END;
    INSERT INTO parents VALUES(1); INSERT INTO children VALUES(1,1);
  `);
  let validations = 0;
  const schema = v.pipe(v.string(), v.transform(value => {
    validations++;
    return { transformed: value };
  }));
  const pebble = definePebble({ name: "effects", access: "public", sync: true, schema: { parents, children, audit }, queries: {
    children: query(schema, ({ db }, args) => ({ rows: db.select().from(children).all(), args })),
    audit: query(({ db }) => db.select().from(audit).all()),
  }, mutations: {
    noop: mutation(({ db }) => db.update(children).set({ parent: 1 }).run()),
    remove: mutation(({ db }) => db.delete(parents).run()),
    rollback: mutation(({ db }) => { db.delete(parents).run(); throw new Error("rollback"); }),
  } });
  const running = await startPebble({ dir: temp.dir, pebble, dataDir: join(temp.dir, "data"), port: 0 });
  const client = createClient<typeof pebble>({ url: running.server.url.href });
  const childValues: any[] = [], auditValues: any[] = [];
  client.subscribe("children", "input", value => childValues.push(value));
  client.subscribe("audit", undefined, value => auditValues.push(value));
  try {
    await until(() => childValues.length === 1 && auditValues.length === 1);
    await client.mutate("noop", undefined);
    await Bun.sleep(60);
    expect(childValues).toHaveLength(1);
    expect(validations).toBe(1);
    await expect(client.mutate("rollback", undefined)).rejects.toThrow("rollback");
    await Bun.sleep(30);
    expect(childValues).toHaveLength(1);
    expect(auditValues).toHaveLength(1);
    await client.mutate("remove", undefined);
    await until(() => childValues.length === 2 && auditValues.length === 2);
    expect(childValues[1]).toEqual({ rows: [], args: { transformed: "input" } });
    expect(auditValues[1]).toEqual([{ id: 1 }]);
    expect(validations).toBe(1);
  } finally { client.close(); await running.stop(); temp.cleanup(); }
});

test("sync disabled falls back to HTTP and returns one subscription snapshot", async () => {
  const temp = tempDirectory();
  const pebble = definePebble({ name: "plain", access: "public", queries: { hello: query(() => "hello") }, mutations: { echo: mutation(() => "echo") } });
  const running = await startPebble({ pebble, dir: temp.dir, dataDir: temp.dir, port: 0 });
  const client = createClient<typeof pebble>({ url: running.server.url.href });
  let data: string | undefined;
  client.subscribe("hello", undefined, result => { data = result; });
  try {
    expect(await client.mutate("echo", undefined)).toBe("echo");
    await until(() => data === "hello");
    expect((await fetch(new URL("/_bedrock/ws", running.server.url))).status).toBe(404);
  } finally { client.close(); await running.stop(); temp.cleanup(); }
});
