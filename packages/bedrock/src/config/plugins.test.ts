import { expect, test } from "bun:test";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { join } from "node:path";
import { definePebble, plugin, query, mutation, job } from "./index";
import { openDatabase } from "../db";
import { createExecutor } from "../runtime/functions";
import { dbCommand } from "../cli/db";
import { tempDirectory } from "../../test/helpers";
import { auditLog, auditEntries } from "../../../../examples/plugins/audit-log";

test("plugin middleware wraps in array order, short-circuits and remains transactional", async () => {
  const temp = tempDirectory();
  const events: string[] = [];
  const middleware = (name: string) => plugin({ name, onQuery: async (_ctx, _name, _args, next) => { events.push(`${name}:in`); const result = await next(); events.push(`${name}:out`); return result; } });
  const pebble = definePebble({ name: "plugins", plugins: [middleware("a"), middleware("b"), auditLog], queries: { value: query(() => { events.push("handler"); return 42; }) }, mutations: { change: mutation(() => "changed") } });
  const database = openDatabase(temp.dir, pebble.schema);
  database.sqlite.exec("CREATE TABLE audit_entries (id TEXT PRIMARY KEY, action TEXT NOT NULL, user_id TEXT, created_at INTEGER NOT NULL)");
  const execute = createExecutor(pebble, database);
  try {
    expect((await execute("query", "value", null, new Request("http://localhost"))).value).toBe(42);
    expect(events).toEqual(["a:in", "b:in", "handler", "b:out", "a:out"]);
    await execute("mutation", "change", null, new Request("http://localhost"));
    expect(database.db.select().from(auditEntries).get()?.action).toBe("change");
    const stopped = createExecutor(definePebble({ name: "short", plugins: [plugin({ name: "short", onQuery: async () => 7 })], queries: { value: query(() => { throw new Error("unreachable"); }) } }), database);
    expect((await stopped("query", "value", null, new Request("http://localhost"))).value).toBe(7);
    await stopped.close();
  } finally { await execute.close(); database.close(); temp.cleanup(); }
});

test("plugins merge schema routes jobs idempotently and reject collisions", () => {
  const table = sqliteTable("extra", { id: text("id") });
  const extension = plugin({ name: "extra", schema: { table }, routes: { "GET /x": () => new Response("x") }, jobs: { sweep: job("0 3 * * *", () => {}) } });
  const config = definePebble({ name: "plugins", plugins: [extension] });
  expect(definePebble(config)).toBe(config);
  expect((config as import("./types").PebbleConfig).schema?.table).toBe(table);
  expect(() => definePebble({ name: "plugins", schema: { table }, plugins: [extension] })).toThrow(expect.objectContaining({ code: "PLUGIN_COLLISION" }));
  expect(() => definePebble({ name: "plugins", routes: extension.routes, plugins: [extension] })).toThrow();
  expect(() => definePebble({ name: "plugins", jobs: extension.jobs, plugins: [extension] })).toThrow();
  expect(() => definePebble({ name: "plugins", plugins: [extension, extension] })).toThrow();
  expect(() => definePebble({ name: "plugins", schema: { other: sqliteTable("extra", { id: text("id") }) }, plugins: [extension] })).toThrow();
});

test("db generate includes plugin tables even when not exported by pebble.ts", async () => {
  const temp = tempDirectory();
  try {
    const bedrock = join(import.meta.dir, "../index.ts");
    await Bun.write(join(temp.dir, "pebble.ts"), `import { definePebble, plugin, sqliteTable, text } from ${JSON.stringify(bedrock)};
export default definePebble({ name: "plugin-schema", plugins: [plugin({ name: "extra", schema: { extra: sqliteTable("plugin_table", { id: text("id").primaryKey() }) } })] });`);
    await dbCommand("generate", temp.dir);
    const { readdir } = await import("node:fs/promises");
    const sql = (await readdir(join(temp.dir, "migrations"))).find(name => name.endsWith(".sql"))!;
    expect(await Bun.file(join(temp.dir, "migrations", sql)).text()).toContain("plugin_table");
    const database = openDatabase(join(temp.dir, "data"));
    try { const { applyMigrations } = await import("../db"); await applyMigrations(database.sqlite, join(temp.dir, "migrations")); expect(database.sqlite.query("SELECT * FROM plugin_table").all()).toEqual([]); }
    finally { database.close(); }
  } finally { temp.cleanup(); }
});
