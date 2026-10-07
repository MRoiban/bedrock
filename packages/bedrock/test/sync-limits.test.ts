import { expect, test } from "bun:test";
import { definePebble, query } from "../src/config";
import { startPebble } from "../src/runtime";
import { tempDirectory, identityHeaders } from "./helpers";

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 300; attempt++) { if (predicate()) return; await Bun.sleep(10); }
  throw new Error("Timed out");
}
test("upgrade enforces access with signed identity", async () => {
  const temp = tempDirectory();
  const running = await startPebble({ pebble: definePebble({ name: "protected", access: { allow: ["@allowed.test"] }, sync: true }), dir: temp.dir, dataDir: temp.dir, port: 0 });
  try {
    const url = new URL("/_bedrock/ws", running.server.url);
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: identityHeaders("a", "a@allowed.test") })).status).toBe(426);
    expect((await fetch(url, { headers: identityHeaders("b", "b@other.test") })).status).toBe(403);
    expect((await fetch(url, { headers: { "x-bedrock-user": "garbage" } })).status).toBe(403);
  } finally { await running.stop(); temp.cleanup(); }
});

test("subscription limits, duplicate IDs, malformed JSON, and oversized messages are bounded", async () => {
  const temp = tempDirectory();
  const running = await startPebble({ pebble: definePebble({ name: "limits", access: "public", sync: true, queries: { one: query(() => 1) } }), dir: temp.dir, dataDir: temp.dir, port: 0 });
  const endpoint = new URL("/_bedrock/ws", running.server.url); endpoint.protocol = "ws:";
  const ws = new WebSocket(endpoint);
  const messages: any[] = [];
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.op !== "hello") messages.push(message);
  };
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = reject; });
  try {
    for (let i = 0; i <= 100; i++) ws.send(JSON.stringify({ op: "sub", id: String(i), query: "one", args: null }));
    await until(() => messages.length === 101);
    expect(messages.filter(message => message.op === "data")).toHaveLength(100);
    expect(messages.find(message => message.id === "100").error.code).toBe("SUBSCRIPTION_LIMIT");
    ws.send(JSON.stringify({ op: "sub", id: "0", query: "one" }));
    await until(() => messages.length === 102);
    expect(messages.at(-1).error.code).toBe("DUPLICATE_SUBSCRIPTION");
    ws.send("not json");
    await until(() => messages.length === 103);
    expect(messages.at(-1).error.code).toBe("INVALID_MESSAGE");
    const close = new Promise<number>(resolve => { ws.onclose = event => resolve(event.code); });
    ws.send("x".repeat(70 * 1024));
    // Bun may terminate an oversized frame before sending a close frame.
    expect([1006, 1009]).toContain(await close);
  } finally { ws.close(); await running.stop(); temp.cleanup(); }
});
