import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { definePebble, mutation, query, type PebbleConfig } from "../config";
import { openDatabase } from "../db";
import { createExecutor } from "./functions";
import { tempDirectory } from "../../test/helpers";

const user = { id: "alice", email: "alice@example.test", name: "Alice" };
const request = (token?: string) => new Request("http://localhost", { headers: token ? { authorization: `Bearer ${token}` } : {} });
const functions = {
  queries: { list: query(ctx => ctx.tokens.list()), who: query(ctx => ctx.token), notes: query(() => "notes"), stats: query(() => "stats") },
  mutations: { create: mutation((ctx, input: any) => ctx.tokens.create(input)), mint: mutation(ctx => ctx.tokens.create({ name: "child", permissions: ["profile:reader"] })) },
};
const release = (profiles?: Record<string, string[]>) => definePebble({ name: "profiles", tokens: profiles ? { profiles } : true, ...functions });
// Each release opens the same data directory, as a redeploy restarts the pebble process.
function opener(dir: string) {
  return (pebble: PebbleConfig) => {
    const db = openDatabase(dir, {}, true);
    const execute = createExecutor(pebble, db);
    const call = async (kind: "query" | "mutation", name: string, args: unknown, token?: string) =>
      (await execute(kind, name, args, request(token), token ? undefined : { user })).value;
    return { db, execute, call, async close() { await execute.close(); db.close(); } };
  };
}

test("profiles expand from the running config, so existing tokens gain and lose operations", async () => {
  const temp = tempDirectory();
  const open = opener(temp.dir);
  try {
    let r = open(release({ reader: ["query:notes", "query:who"] }));
    const created = await r.call("mutation", "create", { name: "chrono", permissions: ["profile:reader"] });
    expect(created).toMatchObject({ permissions: ["profile:reader"], effective: ["query:notes", "query:who"], profiles: ["reader"], metadata: {} });
    expect(await r.call("query", "notes", null, created.token)).toBe("notes");
    await expect(r.call("query", "stats", null, created.token)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await r.close();

    r = open(release({ reader: ["query:notes", "query:who", "query:stats"] }));
    expect(await r.call("query", "stats", null, created.token)).toBe("stats");
    expect(await r.call("query", "who", null, created.token)).toMatchObject({ permissions: ["profile:reader"], effective: ["query:notes", "query:who", "query:stats"], profiles: ["reader"] });
    await r.close();

    r = open(release({ writer: ["query:notes"] }));
    await expect(r.call("query", "notes", null, created.token)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await r.call("query", "list", null)).toEqual([expect.objectContaining({ id: created.id, effective: [], profiles: [], unknownProfiles: ["reader"] })]);
    await expect(r.call("mutation", "create", { name: "stale", permissions: ["profile:reader"] })).rejects.toMatchObject({ code: "INVALID_TOKEN_PERMISSION" });
    await r.close();

    r = open(release());
    await expect(r.call("query", "notes", null, created.token)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await r.close();
  } finally { temp.cleanup(); }
});

test("profiles mix with explicit grants, * is unchanged, and tokens cannot mint tokens", async () => {
  const temp = tempDirectory();
  const r = opener(temp.dir)(release({ reader: ["query:notes"], "self-check": ["query:who", "query:notes"] }));
  try {
    const mixed = await r.call("mutation", "create", { name: "mixed", permissions: ["profile:reader", "query:stats", "profile:self-check"] });
    expect(mixed.effective).toEqual(["query:notes", "query:stats", "query:who"]);
    expect(mixed.profiles).toEqual(["reader", "self-check"]);
    for (const name of ["notes", "stats", "who"]) await r.call("query", name, null, mixed.token);
    const all = await r.call("mutation", "create", { name: "all", permissions: ["*"] });
    expect(all).toMatchObject({ effective: ["*"], profiles: [] });
    expect(await r.call("query", "stats", null, all.token)).toBe("stats");
    await expect(r.call("mutation", "mint", null, all.token)).rejects.toMatchObject({ code: "FORBIDDEN", message: "Tokens cannot mint tokens." });
    await expect(r.call("mutation", "create", { name: "proto", permissions: ["profile:constructor"] })).rejects.toMatchObject({ code: "INVALID_TOKEN_PERMISSION" });
  } finally { await r.close(); temp.cleanup(); }
});

test("invalid profile configuration fails at load", () => {
  const bad: [unknown, string][] = [
    [{ Reader: ["query:notes"] }, "Invalid token profile name: Reader"],
    [{ "1st": ["query:notes"] }, "Invalid token profile name"],
    [{ ["a".repeat(49)]: ["query:notes"] }, "Invalid token profile name"],
    [{ reader: ["query:absent"] }, "Token profile reader grants an unknown operation: query:absent"],
    [{ reader: ["*"] }, "Token profile reader has an invalid entry: *"],
    [{ reader: ["query:notes"], admin: ["profile:reader"] }, "Token profile admin has an invalid entry: profile:reader"],
    [{ reader: "query:notes" }, "Token profile reader is not a list."],
    [[], "Invalid tokens configuration."],
  ];
  for (const [profiles, message] of bad)
    expect(() => definePebble({ name: "profiles", tokens: { profiles } as never, ...functions })).toThrow(expect.objectContaining({ code: "INVALID_TOKEN_PROFILE", message: expect.stringContaining(message) }));
  expect(() => definePebble({ name: "profiles", tokens: { profiles: { reader: ["query:absent"] } }, ...functions })).toThrow(expect.objectContaining({ hint: expect.stringContaining("tokens.profiles.reader") }));
  expect(definePebble({ name: "profiles", tokens: {}, ...functions }).tokens).toEqual({});
});

test("metadata round-trips through create, list, and ctx.token within limits", async () => {
  const temp = tempDirectory();
  const r = opener(temp.dir)(release({ reader: ["query:who"] }));
  try {
    const metadata = { kind: "device", platform: "ios" };
    const created = await r.call("mutation", "create", { name: "phone", permissions: ["profile:reader"], metadata });
    expect(created.metadata).toEqual(metadata);
    expect((await r.call("query", "list", null))[0].metadata).toEqual(metadata);
    expect((await r.call("query", "who", null, created.token)).metadata).toEqual(metadata);
    const limit = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`k${i}`, "v"]));
    await r.call("mutation", "create", { name: "limit", permissions: [], metadata: limit });
    for (const invalid of [{ ...limit, k32: "v" }, { big: "x".repeat(4096) }, { count: 3 }, ["kind"], null, "kind"])
      await expect(r.call("mutation", "create", { name: "bad", permissions: [], metadata: invalid })).rejects.toMatchObject({ code: "INVALID_TOKEN_METADATA" });
  } finally { await r.close(); temp.cleanup(); }
});

test("token tables created before metadata gain the column on open", async () => {
  const temp = tempDirectory();
  try {
    const old = new Database(join(temp.dir, "db.sqlite"), { create: true });
    old.exec(`CREATE TABLE _bedrock_tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, user_json TEXT NOT NULL,
      name TEXT NOT NULL, permissions TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER, revoked_at INTEGER)`);
    const hash = new Bun.CryptoHasher("sha256").update("brk_legacy").digest("hex");
    old.query("INSERT INTO _bedrock_tokens (id, hash, user_id, user_json, name, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("legacy", hash, user.id, JSON.stringify(user), "legacy", '["query:who"]', Date.now());
    old.close();
    const open = opener(temp.dir);
    for (let i = 0; i < 2; i++) {
      const r = open(release());
      expect(await r.call("query", "who", null, "brk_legacy")).toEqual({ id: "legacy", name: "legacy", permissions: ["query:who"], effective: ["query:who"], profiles: [], metadata: {} });
      await r.close();
    }
  } finally { temp.cleanup(); }
});
