import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";
import { HeaderWebSocket, tempDirectory } from "./helpers";

function connect(url: URL) {
  const endpoint = new URL("/_bedrock/ws", url); endpoint.protocol = "ws:";
  const socket = new HeaderWebSocket(endpoint, { headers: { host: "seamless.localhost", origin: "http://seamless.localhost" } });
  const hello = new Promise<unknown>((resolve, reject) => {
    socket.onmessage = event => resolve(JSON.parse(String(event.data)));
    socket.onerror = reject;
  });
  return { socket, hello };
}

for (const dev of [false, true]) {
  test(`daemon redeploy stamps the serving release, sends hello, falls back to previous assets, and relays 1012 (dev=${dev})`, async () => {
    const temp = tempDirectory();
    const home = join(temp.dir, "home"), source = join(temp.dir, "source");
    await setup(home, "localhost", "creator@example.test", 0);
    await Bun.write(join(source, "pebble.ts"), `import { definePebble } from "bedrock";
export default definePebble({ name: "seamless", sync: true, web: "./web", routes: {
  "GET /slow": async () => { await Bun.sleep(200); return new Response("slow"); },
} });`);
    await Bun.write(join(source, "web/index.html"), "first");
    await Bun.write(join(source, "web/old-abcdef12.js"), "old chunk");
    await Bun.write(join(source, "web/old-abcdef12.html"), "old html");
    const daemon = await startDaemon({ home, domain: "localhost", dev });
    const token = (await Bun.file(join(home, "admin-token")).text()).trim();
    const api = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "bedrock.localhost", authorization: `Bearer ${token}` } });
    const request = (path: string) => fetch(new URL(path, daemon.server.url), { headers: { host: "seamless.localhost" } });
    const deploy = async () => {
      const archive = join(temp.dir, `${crypto.randomUUID()}.tar.gz`);
      await createArchive(source, archive);
      const response = await api("/api/deploy?name=seamless", { method: "POST", body: Bun.file(archive) });
      const body = await response.json();
      expect(body.ok).toBe(true);
      return body.value.release as string;
    };
    const sockets: WebSocket[] = [];
    try {
      const first = await deploy();
      const firstPage = await request("/");
      const firstId = firstPage.headers.get("x-bedrock-release")!;
      expect(dev ? firstId.startsWith(basename(first) + "-") : firstId === basename(first)).toBe(true);
      if (dev) expect(firstId.slice(basename(first).length + 1)).toMatch(/^\d+$/);
      expect(firstPage.headers.get("server-timing")).toBe(`bedrock-release;desc="${firstId}"`);
      expect(await firstPage.text()).toBe("first");
      const a = connect(daemon.server.url); sockets.push(a.socket);
      expect(await a.hello).toEqual({ op: "hello", release: firstId });
      const oldClosed = new Promise<CloseEvent>(resolve => { a.socket.onclose = resolve; });
      await Bun.write(join(source, "web/index.html"), "second");
      await rm(join(source, "web/old-abcdef12.js"));
      await rm(join(source, "web/old-abcdef12.html"));
      const slow = request("/slow");
      await Bun.sleep(20);
      const second = await deploy();
      const slowResponse = await slow;
      expect(slowResponse.headers.get("x-bedrock-release")).toBe(firstId);
      expect(await slowResponse.text()).toBe("slow");
      expect(await oldClosed).toMatchObject({ code: 1012, reason: "Service restart" });
      const secondPage = await request("/");
      const secondId = secondPage.headers.get("x-bedrock-release")!;
      expect(secondId).not.toBe(firstId);
      expect(dev ? secondId.startsWith(basename(second) + "-") : secondId === basename(second)).toBe(true);
      expect(await secondPage.text()).toBe("second");
      const b = connect(daemon.server.url); sockets.push(b.socket);
      expect(await b.hello).toEqual({ op: "hello", release: secondId });
      const chunk = await request("/old-abcdef12.js");
      expect(chunk.headers.get("x-bedrock-release")).toBe(secondId);
      expect(await chunk.text()).toBe("old chunk");
      expect((await request("/old-abcdef12.html")).status).toBe(404);
      const stopped = new Promise<CloseEvent>(resolve => { b.socket.onclose = resolve; });
      expect((await api("/api/pebbles/seamless/stop", { method: "POST" })).status).toBe(200);
      expect(await stopped).toMatchObject({ code: 1012, reason: "Service restart" });
      expect((await api("/api/pebbles/seamless/start", { method: "POST" })).status).toBe(200);
      expect(await (await request("/old-abcdef12.js")).text()).toBe("old chunk");
    } finally { for (const socket of sockets) socket.close(); await daemon.stop(); temp.cleanup(); }
  }, 30000);
}
