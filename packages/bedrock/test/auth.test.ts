import { linkDependencies } from "./helpers";
import { expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startDaemon } from "../src/daemon";
import { createClient } from "../src/client";
import { tempDirectory, HeaderWebSocket } from "./helpers";
import { sessionSockets } from "../src/auth/sockets";
import { DAY, SESSION_LIFETIME, createSessions } from "../src/auth/sessions";
import { openDaemonDatabase } from "../src/daemon/db";
import type { Relay } from "../src/daemon/proxy";

async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) throw new Error("Timed out waiting for proxied sync"); await Bun.sleep(10); }
}
test("dev auth refuses a production domain before creating state", async () => {
  const temp = tempDirectory();
  try { await expect(startDaemon({ home: temp.dir, dev: true, domain: "example.test" })).rejects.toMatchObject({ code: "INVALID_DEV_DOMAIN" }); }
  finally { temp.cleanup(); }
});
test("notes through daemon: local login, signed identity, two isolated live users, CSRF and logout", async () => {
  const temp = tempDirectory();
  const dir = join(temp.dir, "notes");
  await cp(resolve(import.meta.dir, "../../../examples/notes"), dir, { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ["node_modules", ".bedrock"].includes(part)) });
  linkDependencies(resolve(import.meta.dir, "../../../examples/notes/node_modules"), join(dir, "node_modules"));
  const daemon = await startDaemon({ home: join(temp.dir, "home"), port: 0, domain: "localhost", dev: true, devPebble: { name: "notes", dir } });
  const origin = `http://notes.localhost:${daemon.server.port}`;
  const host = new URL(origin).host;
  const request = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, redirect: "manual", headers: { origin, host, ...init.headers } });
  const sockets: WebSocket[] = [];
  const login = async (email: string) => {
    const response = await request("/_bedrock/dev-login", { method: "POST", body: new URLSearchParams({ email }) });
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
    expect(response.headers.get("set-cookie")).not.toContain("Domain=");
    return response.headers.get("set-cookie")!.split(";")[0]!;
  };
  const connect = async (cookie: string) => {
    const url = new URL("/_bedrock/ws", daemon.server.url); url.protocol = "ws:";
    const ws = new HeaderWebSocket(url, { headers: { host, origin, cookie } });
    sockets.push(ws);
    const messages: any[] = [];
    ws.onmessage = event => messages.push(JSON.parse(String(event.data)));
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("Proxy upgrade failed")); });
    ws.send(JSON.stringify({ op: "sub", id: "mine", query: "mine", args: null }));
    return { ws, messages };
  };
  try {
    const page = await request("/", { headers: { accept: "text/html" } });
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toContain(`${origin}/_bedrock/dev-login`);
    const authLogin = await request("/login?return=" + encodeURIComponent(origin + "/"), { headers: { host: `auth.localhost:${daemon.server.port}` } });
    expect(authLogin.headers.get("location")).toContain(`${origin}/_bedrock/dev-login`);
    expect((await request("/_bedrock/q/mine", { method: "POST", body: "null" })).status).toBe(401);
    const aliceCookie = await login("alice@example.test");
    const bobCookie = await login("bob@example.test");
    const alice = (await (await request("/_bedrock/me", { headers: { cookie: aliceCookie } })).json()).user;
    const bob = (await (await request("/_bedrock/me", { headers: { cookie: bobCookie } })).json()).user;
    expect(alice.id).not.toBe(bob.id);
    const db = await openDaemonDatabase(join(temp.dir, "home"));
    try {
      db.db.query("UPDATE sessions SET expires_at=? WHERE user_id=?").run(Date.now() + SESSION_LIFETIME - DAY, alice.id);
      const renewed = await request("/_bedrock/me", { headers: { cookie: aliceCookie } });
      expect(renewed.headers.get("set-cookie")).toContain("bedrock_session=");
      expect((await request("/_bedrock/me", { headers: { cookie: aliceCookie } })).headers.get("set-cookie")).toBeNull();
    } finally { db.close(); }
    const a = await connect(aliceCookie);
    const b = await connect(bobCookie);
    await until(() => a.messages.length === 1 && b.messages.length === 1);
    a.ws.send(JSON.stringify({ op: "mut", id: "add", mutation: "add", args: { body: "Alice private" } }));
    await until(() => a.messages.filter(message => message.op === "data").length === 2);
    expect(a.messages.at(-1).result[0]).toMatchObject({ ownerId: alice.id, body: "Alice private" });
    const added = await request("/_bedrock/m/add", { method: "POST", body: JSON.stringify({ body: "Bob private" }), headers: { cookie: bobCookie } });
    expect(added.status).toBe(200);
    await until(() => b.messages.length === 2);
    expect(b.messages.at(-1).result).toHaveLength(1);
    expect(b.messages.at(-1).result[0]).toMatchObject({ ownerId: bob.id, body: "Bob private" });
    expect(a.messages.filter(message => message.op === "data")).toHaveLength(2);
    expect((await request("/_bedrock/m/add", { method: "POST", body: '{"body":"attack"}', headers: { cookie: aliceCookie, origin: `http://sibling.localhost:${daemon.server.port}` } })).status).toBe(403);
    expect((await request("/_bedrock/ws", { headers: { cookie: aliceCookie, origin: `http://sibling.localhost:${daemon.server.port}`, upgrade: "websocket" } })).status).toBe(403);
    expect((await request("/_bedrock/logout", { method: "POST", headers: { cookie: aliceCookie, origin: `http://sibling.localhost:${daemon.server.port}` } })).status).toBe(403);
    const closed = new Promise<number>(resolve => { a.ws.onclose = event => resolve(event.code); });
    expect((await request("/_bedrock/logout", { method: "POST", headers: { cookie: aliceCookie } })).status).toBe(200);
    expect(await closed).toBe(4001);
    expect((await (await request("/_bedrock/me", { headers: { cookie: aliceCookie } })).json()).user).toBeNull();
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
    const expired = await openDaemonDatabase(join(temp.dir, "home"));
    try { expired.db.query("UPDATE sessions SET expires_at=0 WHERE user_id=?").run(bob.id); }
    finally { expired.close(); }
    const bobClosed = new Promise<number>(resolve => { b.ws.onclose = event => resolve(event.code); });
    expect((await request("/_bedrock/logout", { method: "POST", headers: { cookie: bobCookie } })).status).toBe(200);
    expect(await bobClosed).toBe(4001);
    const sdk = createClient({ url: origin, sync: false });
    expect(sdk.loginUrl()).toContain(`${origin}/_bedrock/dev-login?return=`);
    sdk.close();
  } finally { for (const socket of sockets) socket.close(); await daemon.stop(); temp.cleanup(); }
}, 15000);

test("socket revalidation closes expired and independently revoked sessions", async () => {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(temp.dir);
  const sessions = createSessions(db.db);
  const registry = sessionSockets(sessions);
  try {
    const user = sessions.user("test@example.test", "Test");
    for (const reason of ["expired", "revoked"]) {
      const token = sessions.create(user.id);
      const session = sessions.resolve(token)!;
      const closes: number[] = [];
      const relay = { upstream: { close(code: number) { closes.push(code); } }, downstream: { close(code: number) { closes.push(code); } } } as unknown as Relay;
      registry.register(relay, token, session.hash);
      if (reason === "expired") db.db.query("UPDATE sessions SET expires_at=0 WHERE id_hash=?").run(session.hash);
      else sessions.revoke(session.hash);
      registry.revalidate();
      expect(closes).toEqual([4001, 4001]);
    }
  } finally { registry.stop(); db.close(); temp.cleanup(); }
});
