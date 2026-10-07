import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { startPebble } from "../src/runtime";
import { createClient } from "../src/client";
import { tempDirectory, identityHeaders } from "./helpers";
import { proxyWebSocket, relayWebSocket, type Relay } from "../src/daemon/proxy";

async function until(predicate: () => boolean) {
  for (let n = 0; n < 400; n++) { if (predicate()) return; await Bun.sleep(10); }
  throw new Error("Timed out waiting for client transport recovery");
}

test("SDK saves land over WS and degraded HTTP, then recover to live sync", async () => {
  const temp = tempDirectory();
  const running = await startPebble({ dir: resolve(import.meta.dir, "../../../examples/notes"), dataDir: temp.dir, port: 0 });
  const headers = identityHeaders("sdk-trust");
  let blocked = false;
  const relays = new Set<Relay>();
  const proxy = Bun.serve<Relay>({
    hostname: "127.0.0.1", port: 0, websocket: relayWebSocket,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === "/_bedrock/ws") {
        if (blocked) return new Response("Socket path blocked", { status: 502 });
        if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return proxyWebSocket(request, server, running.server.port!, headers, relay => {
          relays.add(relay); return () => { relays.delete(relay); };
        });
      }
      return fetch(new URL(url.pathname, running.server.url), { method: request.method, headers, body: request.body });
    },
  });
  const client = createClient({ url: proxy.url.origin, headers, pollInterval: 30, autoReload: false });
  let data: { body: string }[] = [];
  try {
    client.subscribe("mine", undefined, value => { data = value as { body: string }[]; });
    await until(() => client.connection().state === "live");
    await client.mutate("add", { body: "ws" }); expect(data.some(row => row.body === "ws")).toBe(true);
    blocked = true;
    for (const relay of relays) relay.downstream?.close(1011, "Blocked");
    await until(() => client.connection().state === "polling");
    await client.mutate("add", { body: "http" }).then(() => { expect(data.some(row => row.body === "http")).toBe(true); });
    blocked = false;
    await until(() => client.connection().state === "live");
    await client.mutate("add", { body: "restored" }); expect(data.some(row => row.body === "restored")).toBe(true);
  } finally { client.close(); await proxy.stop(true); await running.stop(); temp.cleanup(); }
});
