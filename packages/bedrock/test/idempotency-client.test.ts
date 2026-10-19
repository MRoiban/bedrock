import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import { startPebble } from "../src/runtime";
import { createClient } from "../src/client";
import type notes from "../../../examples/notes/pebble";
import { tempDirectory, identityHeaders, HeaderWebSocket } from "./helpers";

interface Relay {
  upstream: WebSocket;
  client?: ServerWebSocket<Relay>;
  buffered: string[];
}

test("client replays a committed mutation after losing its first WebSocket result", async () => {
  const temp = tempDirectory();
  const running = await startPebble({ dir: resolve(import.meta.dir, "../../../examples/notes"), dataDir: temp.dir, port: 0 });
  const messages: { id: string; idempotencyKey: string }[] = [];
  const upstreams = new Set<WebSocket>();
  let dropped = false;
  const proxy = Bun.serve<Relay>({
    hostname: "127.0.0.1", port: 0,
    async fetch(request, server) {
      const url = new URL(new URL(request.url).pathname, running.server.url);
      if (request.headers.get("upgrade") !== "websocket") return fetch(new Request(url, request));
      url.protocol = "ws:";
      const upstream = new HeaderWebSocket(url, { headers: Object.fromEntries(request.headers) });
      upstreams.add(upstream);
      const relay: Relay = { upstream, buffered: [] };
      upstream.onmessage = event => {
        const text = String(event.data);
        if (!dropped && JSON.parse(text).op === "result") {
          dropped = true;
          relay.client!.close(1011, "Result lost");
        } else if (relay.client) relay.client.send(text);
        else relay.buffered.push(text);
      };
      upstream.onclose = event => { upstreams.delete(upstream); relay.client?.close(event.code, event.reason); };
      return new Promise<Response | undefined>(resolve => {
        upstream.onopen = () => {
          if (server.upgrade(request, { data: relay })) resolve(undefined);
          else { upstream.close(); resolve(new Response("Upgrade failed", { status: 502 })); }
        };
        upstream.onerror = () => { upstream.close(); resolve(new Response("Upstream unavailable", { status: 502 })); };
      });
    },
    websocket: {
      open(ws) {
        ws.data.client = ws;
        for (const text of ws.data.buffered) ws.send(text);
        ws.data.buffered.length = 0;
      },
      message(ws, data) {
        const text = String(data), message = JSON.parse(text);
        if (message.op === "mut") messages.push(message);
        ws.data.upstream.send(text);
      },
      close(ws) { ws.data.upstream.close(); },
    },
  });
  const client = createClient<typeof notes>({ url: proxy.url.href, headers: identityHeaders("idempotency-client"), autoReload: false });
  try {
    const value = await client.mutate("add", { body: "committed once" });
    expect(dropped).toBe(true);
    expect(value).toHaveLength(1);
    expect(value[0]!.body).toBe("committed once");
    const rows = await client.query("mine", undefined);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(value[0]!.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(messages[1]!.idempotencyKey).toBe(messages[0]!.idempotencyKey);
    expect(messages[1]!.id).toBe(messages[0]!.id);
  } finally {
    client.close();
    for (const upstream of upstreams) upstream.close();
    await proxy.stop(true); await running.stop(); temp.cleanup();
  }
});
