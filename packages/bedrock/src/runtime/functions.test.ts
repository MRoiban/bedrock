import { test, expect } from "bun:test";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import * as v from "valibot";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { definePebble, query, mutation } from "../config";
import { openDatabase } from "../db";
import { createExecutor } from "./functions";
import { functionHandler } from "./http";
import { tempDirectory } from "../../test/helpers";

test("function endpoints validate, enforce read-only queries, roll back, and keep async calls isolated", async () => {
  const temp = tempDirectory();
  const items = sqliteTable("items", { id: text("id").primaryKey() });
  const database = openDatabase(temp.dir, { items });
  database.sqlite.exec("CREATE TABLE items (id TEXT PRIMARY KEY)");
  const pebble = definePebble({
    name: "test",
    queries: {
      list: query(({ db }) => db.select().from(items)),
      bad: query(({ db }) => db.insert(items).values({ id: "illegal" }).run()),
    },
    mutations: {
      add: mutation(v.object({ id: v.string() }), async ({ db }, { id }) => {
        db.insert(items).values({ id }).run();
        await Bun.sleep(5);
        return db.select().from(items);
      }),
      fail: mutation(({ db }) => { db.insert(items).values({ id: "rolled-back" }).run(); throw new Error("failure"); }),
    },
  });
  const execute = createExecutor(pebble, database);
  const call = async (kind: "query" | "mutation", name: string, body = "null") => {
    const request = Object.assign(new Request("http://localhost/", { method: "POST", body }), { params: { name } });
    const response = await functionHandler(execute, kind)(request);
    return { status: response.status, json: await response.json() };
  };
  try {
    expect((await call("mutation", "add", '{"id":123}')).json.error.code).toBe("INVALID_ARGS");
    expect((await call("query", "list", "bad")).json.error.code).toBe("INVALID_JSON");
    expect((await call("query", "constructor")).status).toBe(404);
    expect((await call("query", "bad")).json.error.code).toBe("FUNCTION_FAILED");
    expect((await call("mutation", "fail")).status).toBe(500);
    expect((await call("query", "list")).json).toEqual({ ok: true, value: [] });
    const [a, b] = await Promise.all([call("mutation", "add", '{"id":"a"}'), call("mutation", "add", '{"id":"b"}')]);
    expect(a.json.value).toEqual([{ id: "a" }]);
    expect(b.json.value).toEqual([{ id: "a" }, { id: "b" }]);
    const tracked = await execute("query", "list", null, new Request("http://localhost"));
    expect([...tracked.reads]).toEqual(["items"]);
  } finally { database.close(); temp.cleanup(); }
});

test("async Standard Schema transforms arguments and serializable results are checked before commit", async () => {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir);
  database.sqlite.exec("CREATE TABLE numbers (value TEXT)");
  const schema: StandardSchemaV1<unknown, number> = { "~standard": { version: 1 as const, vendor: "test", validate: async (input: unknown) => ({ value: Number(input) }) } };
  const execute = createExecutor(definePebble({
    name: "async",
    queries: { double: query(schema, (_ctx, value) => value * 2) },
    mutations: { big: mutation(({ db }) => { db.run("INSERT INTO numbers VALUES ('x')"); return 1n; }) },
  }), database);
  try {
    expect((await execute("query", "double", "4", new Request("http://localhost"))).value).toBe(8);
    await expect(execute("mutation", "big", null, new Request("http://localhost"))).rejects.toMatchObject({ code: "FUNCTION_FAILED" });
    expect(database.sqlite.query("SELECT * FROM numbers").all()).toEqual([]);
  } finally { database.close(); temp.cleanup(); }
});

for (const useName of [false, true]) {
  test(`explicit invalidation accepts ${useName ? "SQL names" : "Drizzle tables"} and notifies only after commit`, async () => {
    const temp = tempDirectory();
    const items = sqliteTable("sql_items", { id: text("id").primaryKey() });
    const database = openDatabase(temp.dir, { items });
    database.sqlite.exec("CREATE TABLE sql_items (id TEXT PRIMARY KEY)");
    const tables = useName ? ["sql_items"] : [items];
    const execute = createExecutor(definePebble({
      name: "invalidate", schema: { items },
      queries: { bad: query(ctx => ctx.invalidate(tables)) },
      mutations: {
        add: mutation(ctx => {
          ctx.db.$client.exec("INSERT INTO sql_items VALUES ('raw')");
          ctx.invalidate(tables);
        }),
        fail: mutation(ctx => {
          ctx.db.$client.exec("INSERT INTO sql_items VALUES ('rollback')");
          ctx.invalidate(tables);
          throw new Error("rollback");
        }),
      },
    }), database);
    const notifications: Set<string>[] = [];
    execute.onCommit(writes => notifications.push(writes));
    const request = new Request("http://localhost");
    try {
      await expect(execute("query", "bad", null, request)).rejects.toMatchObject({ code: "READ_ONLY" });
      const result = await execute("mutation", "add", null, request);
      expect([...result.writes]).toEqual(["sql_items"]);
      expect(notifications.map(writes => [...writes])).toEqual([["sql_items"]]);
      await expect(execute("mutation", "fail", null, request)).rejects.toThrow("rollback");
      expect(notifications).toHaveLength(1);
      expect(database.sqlite.query("SELECT * FROM sql_items").all()).toEqual([{ id: "raw" }]);
    } finally { await execute.close(); database.close(); temp.cleanup(); }
  });
}

test("unknown invalidation names and unregistered tables throw repair hints and roll back writes", async () => {
  const temp = tempDirectory();
  const items = sqliteTable("sql_items", { id: text("id").primaryKey() });
  const unknown = sqliteTable("unknown", { id: text("id").primaryKey() });
  const database = openDatabase(temp.dir, { items });
  database.sqlite.exec("CREATE TABLE sql_items (id TEXT PRIMARY KEY)");
  const execute = createExecutor(definePebble({ name: "invalidate", schema: { items } }), database);
  const notifications: Set<string>[] = [];
  execute.onCommit(writes => notifications.push(writes));
  try {
    for (const table of ["unknown", "items", unknown]) {
      await expect(execute.job(ctx => {
        ctx.db.insert(items).values({ id: "rollback" }).run();
        ctx.invalidate([items, table]);
      })).rejects.toMatchObject({ code: "UNKNOWN_TABLE", hint: expect.stringContaining("registered Drizzle table") });
    }
    expect(database.sqlite.query("SELECT * FROM sql_items").all()).toEqual([]);
    expect(notifications).toEqual([]);
  } finally { await execute.close(); database.close(); temp.cleanup(); }
});
