import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { startDaemon } from "../src/daemon";
import { openDaemonDatabase } from "../src/daemon/db";
import { createSessions } from "../src/auth/sessions";
import { sessionSockets } from "../src/auth/sockets";
import { proxyWebSocket, relayWebSocket, type Relay } from "../src/daemon/proxy";
import { startPebble } from "../src/runtime";
import { socket } from "../src/config";
import { tempDirectory, HeaderWebSocket } from "./helpers";

async function connect(url: URL, headers: Record<string, string>) {
  url.protocol = "ws:";
  const ws = new HeaderWebSocket(url, { headers }); ws.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("upgrade failed")); });
  return ws;
}
function echo(ws: WebSocket, bytes: string | Uint8Array) { return new Promise<any>(resolve => { ws.onmessage = event => resolve(event.data); ws.send(bytes); }); }

test("real daemon relays application bearer sockets and runs child service stop", async () => {
  const temp = tempDirectory();
  const dir = join(temp.dir, "pebble");
  await Bun.write(join(dir, "pebble.ts"), `
    import { definePebble, socket, service, mutation } from ${JSON.stringify(resolve(import.meta.dir, "../src/config/index.ts"))};
    export default definePebble({ name: "hosting", access: "users", tokens: true,
      services: { host: service({ start() { return 42; }, async stop() { await Bun.write(${JSON.stringify(join(temp.dir, "stopped"))}, "stopped"); } }) },
      mutations: { mint: mutation(ctx => ctx.tokens.create({ name: "host", permissions: ["socket:/host"] })) },
      sockets: { "/host": socket({ message(ws, data) { ws.send(data); } }) }
    });
  `);
  const daemon = await startDaemon({ home: join(temp.dir, "home"), domain: "localhost", dev: true, port: 0, devPebble: { name: "hosting", dir } });
  const origin = `http://hosting.localhost:${daemon.server.port}`;
  const host = new URL(origin).host;
  const request = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, redirect: "manual", headers: { origin, host, ...init.headers } });
  try {
    const login = await request("/_bedrock/dev-login", { method: "POST", body: new URLSearchParams({ email: "alice@example.test" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await request("/_bedrock/m/mint", { method: "POST", body: "null", headers: { cookie } });
    const token = (await response.json()).value.token;
    const bearer = await connect(new URL("/host", daemon.server.url), { host, authorization: `Bearer ${token}` });
    expect(await echo(bearer, "bearer")).toBe("bearer");
    expect(new Uint8Array(await echo(bearer, new Uint8Array([1, 0, 255])))).toEqual(new Uint8Array([1, 0, 255]));
    const session = await connect(new URL("/host", daemon.server.url), { host, origin, cookie });
    const ended = new Promise<CloseEvent>(resolve => { session.onclose = resolve; });
    await request("/_bedrock/logout", { method: "POST", headers: { cookie } });
    expect((await ended).code).toBe(4001);
    const restarted = new Promise<CloseEvent>(resolve => { bearer.onclose = resolve; });
    await daemon.stop();
    expect(await restarted).toMatchObject({ code: 1012, reason: "Service restart" });
    expect(await Bun.file(join(temp.dir, "stopped")).text()).toBe("stopped");
  } finally { await daemon.stop(); temp.cleanup(); }
}, 15000);

test("real application socket relays close on session expiry and independent revocation", async () => {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(join(temp.dir, "home"));
  const sessions = createSessions(db.db);
  const registry = sessionSockets(sessions);
  const user = sessions.user("socket@example.test", "Socket");
  let current = sessions.create(user.id);
  const runtime = await startPebble({ dir: temp.dir, dataDir: join(temp.dir, "data"), port: 0, pebble: { name: "relay", sockets: { "/host": socket({ message(ws, data) { ws.send(data); } }) } } });
  const proxy = Bun.serve<Relay>({ port: 0, hostname: "127.0.0.1", websocket: relayWebSocket,
    fetch: (request, server) => proxyWebSocket(request, server, runtime.server.port!, {}, relay => registry.register(relay, current, sessions.resolve(current)!.hash)),
  });
  try {
    for (const reason of ["expiry", "revocation"]) {
      current = sessions.create(user.id);
      const identity = sessions.resolve(current)!;
      const ws = await connect(new URL("/host", proxy.url), {});
      expect(await echo(ws, "echo")).toBe("echo");
      const ended = new Promise<CloseEvent>(resolve => { ws.onclose = resolve; });
      if (reason === "expiry") db.db.query("UPDATE sessions SET expires_at=0 WHERE id_hash=?").run(identity.hash);
      else sessions.revoke(identity.hash);
      registry.revalidate();
      expect(await ended).toMatchObject({ code: 4001, reason: "Session ended" });
    }
  } finally { registry.stop(); await proxy.stop(true); await runtime.stop(); db.close(); temp.cleanup(); }
});
