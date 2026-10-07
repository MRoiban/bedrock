import { expect, test } from "bun:test";
import * as v from "valibot";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bucket, definePebble, detached, mutation, query } from "../src/config";
import { startPebble } from "../src/runtime";
import { startDaemon } from "../src/daemon";
import { signIdentity } from "../src/auth/identity";
import { createClient } from "../src/client";
import { tempDirectory, HeaderWebSocket } from "./helpers";
const alice = { id: "alice", email: "alice@example.test", name: "Alice" };

test("pebble tokens enforce every runtime entry point and current access policy", async () => {
  const temp = tempDirectory();
  const uploads = bucket("uploads", { access: "owner", maxSize: "1mb" });
  const runtime = await startPebble({ dir: temp.dir, dataDir: join(temp.dir, "data"), port: 0, pebble: definePebble({
    name: "tokens", tokens: true, sync: true, access: { allow: [alice.email] }, storage: [uploads],
    queries: { who: query(ctx => ({ user: ctx.user, token: ctx.token })), list: query(ctx => ctx.tokens.list()) },
    mutations: { mint: mutation(v.array(v.string()), (ctx, permissions) => ctx.tokens.create({ name: "test", permissions })), who: mutation(ctx => ctx.token) },
    routes: {
      "POST /api/upload": (_req, _server, ctx) => Response.json(ctx.token),
      "POST /api/detached": detached(async (_req, _server, ctx) => Response.json({ token: ctx.token, nested: await ctx.read(slot => slot.token) })),
    },
  }) });
  const mint = async (permissions: string[]) => (await runtime.execute("mutation", "mint", permissions, new Request(runtime.server.url), { user: alice })).value;
  const call = (path: string, token: string, method = "POST", body?: string) => fetch(new URL(path, runtime.server.url), { method, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body }) });
  try {
    const none = await mint([]);
    const all = await mint(["*"]);
    for (const [path, permission, method, body] of [
      ["/_bedrock/q/who", "query:who", "POST", "null"],
      ["/_bedrock/m/who", "mutation:who", "POST", "null"],
      ["/api/upload", "route:POST /api/upload", "POST", ""],
      ["/api/detached", "route:POST /api/detached", "POST", ""],
      ["/_bedrock/files/uploads", "files:uploads:upload", "POST", "hello"],
    ]) {
      const allowed = await mint([permission!]);
      expect((await call(path!, allowed.token, method, body)).status).toBe(path!.includes("files") ? 201 : 200);
      const denied = await call(path!, none.token, method, body);
      expect(denied.status).toBe(403);
      expect((await denied.json()).error.hint).toContain(permission);
    }
    const uploaded = await (await call("/_bedrock/files/uploads", all.token, "POST", "hello")).json();
    const path = `/_bedrock/files/uploads/${uploaded.id}`;
    const read = await mint(["files:uploads:read"]);
    for (const method of ["GET", "HEAD"]) {
      expect((await call(path, read.token, method)).status).toBe(200);
      expect((await call(path, none.token, method)).status).toBe(403);
    }
    expect((await call(path, none.token, "DELETE")).status).toBe(403);
    const del = await mint(["files:uploads:delete"]);
    expect((await call(path, del.token, "DELETE")).status).toBe(204);
    for (const [path, method, body] of [["/_bedrock/files/uploads/uploads", "POST", "{}"], ["/_bedrock/files/uploads/uploads/absent/0", "PUT", "chunk"], ["/_bedrock/files/uploads/uploads/absent/complete", "POST", "" ]]) {
      expect((await call(path!, none.token, method, body)).status).toBe(403);
      const grant = await mint(["files:uploads:upload"]);
      expect((await call(path!, grant.token, method, body)).status).not.toBe(403);
    }
    expect((await call("/_bedrock/ws", none.token, "GET")).status).toBe(403);
    expect((await call("/_bedrock/ws", all.token, "GET")).status).toBe(426);
    const url = new URL("/_bedrock/ws", runtime.server.url); url.protocol = "ws:";
    const ws = new HeaderWebSocket(url, { headers: { authorization: `Bearer ${all.token}` } });
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("Token WS rejected")); });
    const result = new Promise<any>(resolve => { ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.op === "result") resolve(message);
    }; });
    ws.send(JSON.stringify({ op: "mut", id: "one", mutation: "who", args: null }));
    expect((await result).value.id).toBe(all.id);
    ws.close();
    const client = createClient<typeof runtime.pebble>({ url: runtime.server.url.toString(), token: all.token, sync: false, headers: { cookie: "bedrock_session=unwanted" } });
    expect((await client.query("who", undefined)).token?.id).toBe(all.id);
    const sdkFile = await client.upload("uploads", new File(["sdk"], "sdk.txt"));
    await client.deleteFile("uploads", sdkFile.id);
    client.close();
    const liveClient = createClient<typeof runtime.pebble>({ url: runtime.server.url.toString(), token: all.token });
    try { expect((await liveClient.mutate("who", undefined))?.id).toBe(all.id); }
    finally { liveClient.close(); }
    runtime.pebble.access = { allow: [] };
    for (const endpoint of ["/_bedrock/q/who", "/api/upload", "/api/detached", "/_bedrock/files/uploads"])
      expect((await call(endpoint, all.token, "POST", endpoint.includes("/q/") ? "null" : "hello")).status).toBe(403);
    expect((await call("/_bedrock/ws", all.token, "GET")).status).toBe(403);
  } finally { await runtime.stop(); temp.cleanup(); }
});

test("signed identity wins over bearer identity", async () => {
  const temp = tempDirectory();
  const previous = process.env.BEDROCK_IDENTITY_SECRET;
  process.env.BEDROCK_IDENTITY_SECRET = "test-secret";
  const runtime = await startPebble({ dir: temp.dir, dataDir: temp.dir, port: 0, pebble: definePebble({ name: "signed", tokens: true, queries: { who: query(ctx => ({ user: ctx.user, token: ctx.token })) } }) });
  try {
    const response = await fetch(new URL("/_bedrock/q/who", runtime.server.url), { method: "POST", body: "null", headers: { ...signIdentity(alice, "test-secret"), authorization: "Bearer brk_invalid" } });
    expect(await response.json()).toEqual({ ok: true, value: { user: alice, token: null } });
  } finally { await runtime.stop(); if (previous === undefined) delete process.env.BEDROCK_IDENTITY_SECRET; else process.env.BEDROCK_IDENTITY_SECRET = previous; temp.cleanup(); }
});

test("daemon bearer requests omit Origin and session, retain runtime identity, and reject cookie CSRF", async () => {
  const temp = tempDirectory();
  const dir = join(temp.dir, "pebble");
  await mkdir(dir);
  await mkdir(join(dir, "node_modules"), { recursive: true });
  const { symlink } = await import("node:fs/promises");
  await symlink(resolve(import.meta.dir, ".."), join(dir, "node_modules/bedrock"));
  await Bun.write(join(dir, "pebble.ts"), `import { definePebble, mutation, bucket } from "bedrock";
const stored = [];
export default definePebble({ name: "tokens", access: "users", tokens: true,
 storage: [bucket("assets", { access: "owner", maxSize: 100,
   admit: (ctx) => { if (!ctx.token) throw new Error("Missing upload token"); },
   onStored: (ctx, file, meta) => { stored.push({ token: ctx.token.id, owner: file.ownerId, meta }); }
 })],
 mutations: { mint: mutation(ctx => ctx.tokens.create({ name: "native", permissions: ["route:POST /api/upload", "route:GET /private", "route:GET /stored", "files:assets:upload"] })) },
 routes: { "GET /stored": () => Response.json(stored), "POST /api/upload": (_r, _s, ctx) => Response.json({ user: ctx.user, token: ctx.token }), "GET /private": (_r, _s, ctx) => Response.json(ctx.user) }
});`);
  const daemon = await startDaemon({ home: join(temp.dir, "home"), port: 0, domain: "localhost", dev: true, devPebble: { name: "tokens", dir } });
  const origin = `http://tokens.localhost:${daemon.server.port}`;
  const host = new URL(origin).host;
  const call = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, redirect: "manual", headers: { host, ...init.headers } });
  try {
    const login = await call("/_bedrock/dev-login", { method: "POST", body: new URLSearchParams({ email: alice.email }), headers: { origin } });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const created = await (await call("/_bedrock/m/mint", { method: "POST", body: "null", headers: { origin, cookie } })).json();
    const authorization = `Bearer ${created.value.token}`;
    const response = await call("/api/upload", { method: "POST", headers: { authorization, "x-bedrock-user": JSON.stringify({ ...alice, id: "spoof" }), "x-bedrock-user-ts": "1", "x-bedrock-signature": "spoof" } });
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.token.id).toBe(created.value.id);
    expect(value.user.id).not.toBe("spoof");
    const meta = { label: "été", via: "daemon" };
    const single = await call("/_bedrock/files/assets", { method: "POST", body: "hello", headers: { authorization, "x-bedrock-file-meta": encodeURIComponent(JSON.stringify(meta)) } });
    expect(single.status).toBe(201);
    const start = await call("/_bedrock/files/assets/uploads", { method: "POST", body: JSON.stringify({ name: "chunk", size: 5, meta }), headers: { authorization } });
    expect(start.status).toBe(201);
    const { uploadId } = await start.json();
    const path = `/_bedrock/files/assets/uploads/${uploadId}`;
    expect((await call(path + "/0", { method: "PUT", body: "hello", headers: { authorization } })).status).toBe(204);
    expect((await (await call(path, { headers: { authorization } })).json()).received).toEqual([0]);
    expect((await call(path + "/complete", { method: "POST", body: JSON.stringify({ sha256: new Bun.CryptoHasher("sha256").update("hello").digest("hex") }), headers: { authorization } })).status).toBe(201);
    const stored = await (await call("/stored", { headers: { authorization } })).json();
    expect(stored).toEqual(Array(2).fill({ token: created.value.id, owner: value.user.id, meta }));

    expect((await call("/api/upload", { method: "POST", headers: { authorization, cookie, origin: "http://wrong.localhost" } })).status).toBe(403);
    expect((await call("/api/upload", { method: "POST", headers: { authorization, cookie: "bedrock_session=", origin: "http://wrong.localhost" } })).status).toBe(403);
    const browser = await call("/api/upload", { method: "POST", headers: { authorization: "Bearer brk_invalid", cookie, origin } });
    expect((await browser.json()).token).toBeNull();
    const invalid = await call("/private", { headers: { authorization: "Bearer brk_invalid", accept: "text/html" } });
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("content-type")).toContain("application/json");
    expect((await invalid.json()).error.code).toBe("UNAUTHENTICATED");
    expect(invalid.headers.get("location")).toBeNull();
  } finally { await daemon.stop(); temp.cleanup(); }
}, 15000);
