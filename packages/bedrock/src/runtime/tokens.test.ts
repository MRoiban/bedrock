import { expect, test } from "bun:test";
import * as v from "valibot";
import { definePebble, mutation, query } from "../config";
import { openDatabase } from "../db";
import { createExecutor } from "./functions";
import { tempDirectory } from "../../test/helpers";

const user = { id: "alice", email: "alice@example.test", name: "Alice" };
const request = (token?: string) => new Request("http://localhost", { headers: token ? { authorization: `Bearer ${token}` } : {} });
function fixture(enabled = true) {
  const temp = tempDirectory();
  const db = openDatabase(temp.dir, {}, enabled);
  const pebble = definePebble({ name: "tokens", tokens: enabled,
    queries: { list: query(ctx => ctx.tokens.list()), who: query(ctx => ({ user: ctx.user, token: ctx.token })) },
    mutations: { create: mutation((ctx, input: any) => ctx.tokens.create(input)), revoke: mutation(v.string(), (ctx, id) => ctx.tokens.revoke(id)), fail: mutation(ctx => { ctx.tokens.create({ name: "rollback", permissions: [] }); throw new Error("rollback"); }) },
  });
  const execute = createExecutor(pebble, db);
  const call = async (kind: "query" | "mutation", name: string, args: unknown, identity = user) => (await execute(kind, name, args, request(), { user: identity })).value;
  return { db, pebble, execute, call, async close() { await execute.close(); db.close(); temp.cleanup(); } };
}
test("tokens create/list/revoke return metadata, store hashes, and roll back with mutations", async () => {
  const f = fixture();
  try {
    const created = await f.call("mutation", "create", { name: "script", permissions: ["query:who"] });
    expect(created.token).toMatch(/^brk_[A-Za-z0-9_-]{43}$/);
    const rows = f.db.sqlite.query("SELECT * FROM _bedrock_tokens").all();
    expect(JSON.stringify(rows)).not.toContain(created.token);
    expect(rows[0]).toMatchObject({ hash: new Bun.CryptoHasher("sha256").update(created.token).digest("hex"), user_id: user.id });
    const listed = await f.call("query", "list", null);
    expect(listed).toHaveLength(1);
    expect([...(await f.execute("query", "list", null, request(), { user })).reads]).toContain("_bedrock_tokens");
    expect(listed[0].token).toBeUndefined();
    expect(listed[0].hash).toBeUndefined();
    expect((await f.execute("query", "who", null, request(created.token))).value.user).toEqual(user);
    await expect(f.call("mutation", "fail", null)).rejects.toThrow("rollback");
    expect(await f.call("query", "list", null)).toHaveLength(1);
    await f.call("mutation", "revoke", created.id);
    await f.call("mutation", "revoke", created.id);
    expect(await f.call("query", "list", null)).toEqual([]);
    await expect(f.execute("query", "who", null, request(created.token))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  } finally { await f.close(); }
});
test("expiry, unknown tokens, validation, read-only and ownership restrictions", async () => {
  const f = fixture();
  try {
    for (const permission of ["wat", "query:absent", "mutation:absent", "route:POST /absent", "files:absent:upload", "query:who:extra"]) {
      await expect(f.call("mutation", "create", { name: "bad", permissions: [permission] })).rejects.toMatchObject({ code: "INVALID_TOKEN_PERMISSION" });
    }
    const created = await f.call("mutation", "create", { name: "all", permissions: ["*"], expiresAt: Date.now() + 60_000 });
    await expect(f.execute("mutation", "create", { name: "child", permissions: [] }, request(created.token))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.call("mutation", "revoke", created.id, { ...user, id: "bob" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const bobs = await f.call("mutation", "create", { name: "bob", permissions: [] }, { ...user, id: "bob" });
    await expect(f.execute("mutation", "revoke", bobs.id, request(created.token))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await f.execute.job(ctx => ctx.token)).value).toBeNull();
    await expect(f.execute("query", "slot", null, request(), { user }, ctx => ctx.tokens.create({ name: "bad", permissions: [] }))).rejects.toMatchObject({ code: "READ_ONLY" });
    await f.execute.job(() => f.db.sqlite.query("UPDATE _bedrock_tokens SET expires_at = 0").run());
    for (const token of [created.token, "brk_unknown"]) await expect(f.execute("query", "who", null, request(token))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  } finally { await f.close(); }
});
test("disabled tokens are ignored and API methods fail with TOKENS_DISABLED", async () => {
  const f = fixture(false);
  try {
    expect((await f.execute("query", "who", null, request("brk_unknown"))).value).toEqual({ user: null, token: null });
    Object.assign(f.pebble, { access: "users" });
    await expect(f.execute.route(request("brk_unknown"), () => new Response("private"), "route:GET /private")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    for (const [kind, name, args] of [["query", "list", null], ["mutation", "create", {}], ["mutation", "revoke", "id"]] as const)
      await expect(f.call(kind, name, args)).rejects.toMatchObject({ code: "TOKENS_DISABLED" });
  } finally { await f.close(); }
});
test("last-used writes wait for mutation slots, survive rollback, and are throttled", async () => {
  const f = fixture();
  try {
    const created = await f.call("mutation", "create", { name: "read", permissions: ["query:who"] });
    await f.execute("query", "who", null, request(created.token));
    const used = () => f.db.sqlite.query<{ last_used_at: number | null }, []>("SELECT last_used_at FROM _bedrock_tokens").get()!.last_used_at;
    expect(used()).toBeNull();
    await expect(f.execute.job(() => { throw new Error("rollback"); })).rejects.toThrow();
    expect(used()).toBeNull();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = f.execute.job(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); });
    await started;
    let resolved = false;
    const lookup = f.execute.identify(request(created.token)).then(value => { resolved = true; return value; });
    await Bun.sleep(1);
    expect(resolved).toBe(false);
    const flush = f.execute.flushTokens();
    release();
    await Promise.all([held, lookup, flush]);
    const first = used();
    expect(first).toBeNumber();
    await f.execute("query", "who", null, request(created.token));
    await f.execute.flushTokens();
    expect(used()).toBe(first);
  } finally { await f.close(); }
});
