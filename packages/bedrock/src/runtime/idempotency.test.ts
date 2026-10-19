import { afterEach, expect, setSystemTime, test } from "bun:test";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import * as v from "valibot";
import { definePebble, mutation, query, type FunctionMap, type TokenIdentity } from "../config";
import { openDatabase } from "../db";
import { BedrockError, errorStatus } from "../error";
import { tempDirectory } from "../../test/helpers";
import { createExecutor } from "./functions";
import { checkIdempotencyKey } from "./idempotency";
import type { RequestIdentity } from "./tokens";

const items = sqliteTable("items", { id: text("id").primaryKey() });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  setSystemTime();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function fixture(mutations: FunctionMap) {
  const temp = tempDirectory();
  const database = openDatabase(temp.dir, { items });
  database.sqlite.exec("CREATE TABLE items (id TEXT PRIMARY KEY)");
  const execute = createExecutor(definePebble({ name: "idempotency", schema: { items }, mutations, queries: { read: query(() => 1) } }), database);
  const request = new Request("http://localhost");
  cleanups.push(async () => { await execute.close(); database.close(); temp.cleanup(); });
  return {
    ...database, execute, request,
    call(name: string, args: unknown = null, key?: string, identity: RequestIdentity = { user: null, token: null }) {
      return execute("mutation", name, args, request, identity, undefined, undefined, key === undefined ? undefined : { idempotencyKey: key });
    },
    rows() { return database.sqlite.query("SELECT * FROM _bedrock_idempotency").all(); },
  };
}

test("replays serialize concurrent mutations, preserve the value, and notify with empty writes", async () => {
  let runs = 0;
  const f = fixture({ add: mutation(async ({ db }) => {
    runs++;
    await Bun.sleep(5);
    const value = { id: crypto.randomUUID(), nested: [1, { ok: true }] };
    db.insert(items).values({ id: value.id }).run();
    return value;
  }) });
  const commits: string[][] = [];
  f.execute.onCommit(writes => commits.push([...writes]));
  const [first, replay] = await Promise.all([f.call("add", null, "same"), f.call("add", null, "same")]);
  expect(replay.value).toEqual(first.value);
  expect(runs).toBe(1);
  expect([...first.writes]).toEqual(["items"]);
  expect([...replay.writes]).toEqual([]);
  expect([...replay.reads]).toEqual([]);
  expect(commits).toEqual([["items"], []]);
  expect(f.sqlite.query("SELECT * FROM items").all()).toHaveLength(1);
  expect(f.rows()).toHaveLength(1);
  expect(f.tableNames.has("_bedrock_idempotency")).toBe(false);
});

test("keys reject different arguments with 409 and are independent per mutation name", async () => {
  let runs = 0;
  const definition = mutation(v.object({ value: v.number() }), () => ++runs);
  const f = fixture({ first: definition, second: definition });
  expect((await f.call("first", { value: 1 }, "same")).value).toBe(1);
  const error = await f.call("first", { value: 2 }, "same").catch(error => error);
  expect(error).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  expect(errorStatus(error)).toBe(409);
  expect((await f.call("second", { value: 2 }, "same")).value).toBe(2);
  expect((await f.call("first", { value: 1 }, "same")).value).toBe(1);
  expect(f.rows()).toHaveLength(2);
});

test("canonical hashes sort nested object keys, preserve array order, and use validated args", async () => {
  let runs = 0;
  const f = fixture({
    nested: mutation(v.unknown(), () => ++runs),
    normalized: mutation(v.pipe(v.string(), v.transform(Number)), (_ctx, value) => ({ value, run: ++runs })),
  });
  const first = { z: [{ b: 2, a: 1 }], a: { y: 2, x: 1 } };
  const reordered = { a: { x: 1, y: 2 }, z: [{ a: 1, b: 2 }] };
  expect((await f.call("nested", reordered, "nested")).value).toBe((await f.call("nested", first, "nested")).value);
  await f.call("nested", [1, 2], "array");
  await expect(f.call("nested", [2, 1], "array")).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  const normalized = await f.call("normalized", "01", "normalized");
  expect((await f.call("normalized", "1", "normalized")).value).toEqual(normalized.value);
  expect(runs).toBe(3);
});

test("two tokens, two users, and anonymous callers have independent key scopes", async () => {
  let runs = 0;
  const f = fixture({ add: mutation(() => ++runs) });
  const token = (id: string): TokenIdentity => ({ id, name: id, permissions: ["*"], effective: ["*"], profiles: [], metadata: {} });
  const identities: RequestIdentity[] = [
    { user: { id: "alice" }, token: token("a") },
    { user: { id: "alice" }, token: token("b") },
    { user: { id: "alice" }, token: null },
    { user: { id: "bob" }, token: null },
    { user: null, token: null },
  ];
  for (const [index, identity] of identities.entries()) {
    expect((await f.call("add", null, "same", identity)).value).toBe(index + 1);
    expect((await f.call("add", null, "same", identity)).value).toBe(index + 1);
  }
  expect(runs).toBe(5);
  expect(f.sqlite.query("SELECT scope FROM _bedrock_idempotency ORDER BY scope").all()).toEqual([
    { scope: "anon" }, { scope: "token:a" }, { scope: "token:b" }, { scope: "user:alice" }, { scope: "user:bob" },
  ]);
});

test("failed mutations roll back their writes and leave the key available for a retry", async () => {
  let runs = 0;
  const f = fixture({ add: mutation(({ db }) => {
    runs++;
    db.insert(items).values({ id: "item" }).run();
    if (runs === 1) throw new BedrockError("TRY_AGAIN", "Try again.", "Retry the mutation.");
    return { runs };
  }) });
  await expect(f.call("add", null, "retry")).rejects.toMatchObject({ code: "TRY_AGAIN" });
  expect(f.sqlite.query("SELECT * FROM items").all()).toEqual([]);
  expect(f.rows()).toEqual([]);
  expect((await f.call("add", null, "retry")).value).toEqual({ runs: 2 });
  expect((await f.call("add", null, "retry")).value).toEqual({ runs: 2 });
  expect(runs).toBe(2);
  expect(f.rows()).toHaveLength(1);
});

test("unserializable mutation results do not store keys or commit writes", async () => {
  let runs = 0;
  const f = fixture({ add: mutation(({ db }) => {
    db.insert(items).values({ id: "item" }).run();
    return ++runs === 1 ? 1n : "ok";
  }) });
  await expect(f.call("add", null, "retry")).rejects.toMatchObject({ code: "FUNCTION_FAILED" });
  expect(f.rows()).toEqual([]);
  expect(f.sqlite.query("SELECT * FROM items").all()).toEqual([]);
  expect((await f.call("add", null, "retry")).value).toBe("ok");
  expect((await f.call("add", null, "retry")).value).toBe("ok");
  expect(runs).toBe(2);
});

test("keys expire exactly after 24 hours and replace expired rows before the next purge", async () => {
  const start = Date.UTC(2026, 0, 1), day = 24 * 60 * 60_000;
  setSystemTime(start);
  let runs = 0;
  const f = fixture({ add: mutation(() => ++runs) });
  expect((await f.call("add", null, "expires")).value).toBe(1);
  setSystemTime(start + day - 5 * 60_000);
  await f.call("add");
  expect((await f.call("add", null, "expires")).value).toBe(1);
  setSystemTime(start + day);
  expect(f.rows()).toHaveLength(1);
  expect((await f.call("add", null, "expires")).value).toBe(3);
  expect((await f.call("add", null, "expires")).value).toBe(3);
  expect(f.rows()).toHaveLength(1);
  expect(f.sqlite.query("SELECT created_at FROM _bedrock_idempotency").get()).toEqual({ created_at: start + day });
});

test("only named mutation slots purge expired rows and purge at most once per ten minutes", async () => {
  const start = Date.UTC(2026, 0, 1), day = 24 * 60 * 60_000;
  setSystemTime(start);
  const f = fixture({ add: mutation(() => null) });
  const seed = () => f.sqlite.query("INSERT INTO _bedrock_idempotency VALUES ('anon', 'add', 'old', 'hash', 'null', ?)").run(start - day);
  seed();
  await f.execute("query", "read", null, f.request);
  await f.execute.job(() => {});
  expect(f.rows()).toHaveLength(1);
  await f.call("add");
  expect(f.rows()).toHaveLength(0);
  seed();
  setSystemTime(start + 10 * 60_000 - 1);
  await f.call("add");
  expect(f.rows()).toHaveLength(1);
  setSystemTime(start + 10 * 60_000);
  await f.call("add");
  expect(f.rows()).toHaveLength(0);
});

test("args key functions dedupe validated args and transport keys take precedence", async () => {
  let runs = 0, keys = 0;
  const f = fixture({ add: mutation({
    args: v.object({ key: v.pipe(v.string(), v.transform(value => value.trim())) }),
    idempotencyKey: args => { keys++; return args.key; },
    run: (_ctx, args) => ({ key: args.key, run: ++runs }),
  }) });
  const first = await f.call("add", { key: " args " });
  expect((await f.call("add", { key: "args" })).value).toEqual(first.value);
  expect(keys).toBe(2);
  expect((await f.call("add", { key: "args" }, "transport")).value).toEqual({ key: "args", run: 2 });
  expect((await f.call("add", { key: "args" }, "transport")).value).toEqual({ key: "args", run: 2 });
  expect(keys).toBe(2);
  expect(f.sqlite.query("SELECT key FROM _bedrock_idempotency ORDER BY key").all()).toEqual([{ key: "args" }, { key: "transport" }]);
});

test("args key functions reject invalid results, allow absent keys, and roll back throws", async () => {
  let key: unknown, runs = 0;
  const f = fixture({ add: mutation({
    args: v.null(),
    idempotencyKey: (() => {
      if (key instanceof Error) throw key;
      return key;
    }) as () => string | null | undefined,
    run: () => ++runs,
  }) });
  for (key of [1, "bad key", "", "é"]) {
    await expect(f.call("add")).rejects.toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
    expect(f.sqlite.inTransaction).toBe(false);
  }
  key = new Error("broken key function");
  await expect(f.call("add")).rejects.toMatchObject({ code: "FUNCTION_FAILED", message: "broken key function" });
  expect(f.sqlite.inTransaction).toBe(false);
  for (key of [undefined, null]) {
    await f.call("add");
    await f.call("add");
  }
  expect(runs).toBe(4);
  expect(f.rows()).toEqual([]);
  key = "bad key";
  expect((await f.call("add", null, "transport")).value).toBe(5);
});

test("queries and handler-based calls ignore execute idempotency options", async () => {
  const f = fixture({ add: mutation(() => null) });
  const options = { idempotencyKey: "bad key" };
  await f.execute("query", "read", null, f.request, undefined, undefined, undefined, options);
  let runs = 0;
  for (let i = 0; i < 2; i++) {
    await f.execute("mutation", "route", null, f.request, { user: null }, () => ++runs, undefined, options);
  }
  expect(runs).toBe(2);
  expect(f.rows()).toEqual([]);
});

test("idempotency keys accept only one to 255 visible ASCII characters", () => {
  for (const key of ["!", "~".repeat(255), crypto.randomUUID()]) expect(checkIdempotencyKey(key)).toBe(key);
  for (const key of ["", "a".repeat(256), " ", "a b", "é", "\x00", "\x1f", "\x7f", "a\n", null, undefined, 1]) {
    expect(() => checkIdempotencyKey(key)).toThrow(expect.objectContaining({ code: "INVALID_IDEMPOTENCY_KEY" }));
  }
});
