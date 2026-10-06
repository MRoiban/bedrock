import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { startPebble } from "../src/runtime";
import { createClient, BedrockError } from "../src/client";
import type notes from "../../../examples/notes/pebble";
import { tempDirectory, identityHeaders, HeaderWebSocket } from "./helpers";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for sync");
    await Bun.sleep(10);
  }
}
async function socket(url: URL, user: string) {
  const messages: any[] = [];
  const endpoint = new URL("/_bedrock/ws", url);
  endpoint.protocol = "ws:";
  const ws = new HeaderWebSocket(endpoint, { headers: identityHeaders(user) });
  ws.onmessage = event => messages.push(JSON.parse(String(event.data)));
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = reject; });
  return { ws, messages, send: (message: object) => ws.send(JSON.stringify(message)) };
}

test("WS invalidation uses each subscriber's user, suppresses unchanged results, and covers HTTP/direct commits", async () => {
  const temp = tempDirectory();
  const running = await startPebble({ dir: resolve(import.meta.dir, "../../../examples/notes"), dataDir: temp.dir, port: 0 });
  const a = await socket(running.server.url, "a");
  const b = await socket(running.server.url, "b");
  try {
    a.send({ op: "sub", id: "mine", query: "mine", args: null });
    a.send({ op: "sub", id: "other", query: "mine", args: null });
    b.send({ op: "sub", id: "mine", query: "mine", args: null });
    await until(() => a.messages.length === 2 && b.messages.length === 1);
    expect(b.messages[0].result).toEqual([]);
    a.send({ op: "mut", id: "add", mutation: "add", args: { body: "first" } });
    await until(() => a.messages.filter(m => m.op === "data").length === 4);
    expect(a.messages.find(m => m.op === "result").ok).toBe(true);
    expect(a.messages.filter(m => m.op === "data").slice(-2).every(m => m.result[0].ownerId === "a")).toBe(true);
    await Bun.sleep(50);
    expect(b.messages).toHaveLength(1);
    const request = new Request(running.server.url, { headers: { ...identityHeaders("a") } });
    await fetch(new URL("/_bedrock/m/add", running.server.url), { method: "POST", headers: { "Content-Type": "application/json", ...identityHeaders("a") }, body: JSON.stringify({ body: "http" }) });
    await until(() => a.messages.filter(m => m.op === "data").length === 6);
    await running.execute("mutation", "add", { body: "direct" }, request);
    await until(() => a.messages.filter(m => m.op === "data").length === 8);
    expect(b.messages).toHaveLength(1);
    a.send({ op: "unsub", id: "other" });
    await running.execute("mutation", "add", { body: "unsubscribed" }, request);
    await until(() => a.messages.filter(m => m.op === "data").length === 9);
    a.send({ op: "mut", id: "invalid", mutation: "add", args: { body: "" } });
    await until(() => a.messages.some(m => m.id === "invalid"));
    expect(a.messages.find(m => m.id === "invalid").error.code).toBe("INVALID_ARGS");
    a.send({ op: "wat", id: "bad" });
    await until(() => a.messages.some(m => m.id === "bad"));
    expect(a.messages.find(m => m.id === "bad").error.code).toBe("INVALID_MESSAGE");
  } finally {
    a.ws.close(); b.ws.close(); await running.stop(); temp.cleanup();
  }
});

test("client queues connecting mutations, reconnects and resubscribes after server restart", async () => {
  const temp = tempDirectory();
  const options = { dir: resolve(import.meta.dir, "../../../examples/notes"), dataDir: temp.dir };
  let running = await startPebble({ ...options, port: 0 });
  const port = running.server.port!;
  const client = createClient<typeof notes>({ url: running.server.url.href, headers: identityHeaders("sdk") });
  const values: any[] = [];
  const unsubscribe = client.subscribe("mine", undefined, value => values.push(value));
  try {
    await client.mutate("add", { body: "queued" });
    await until(() => values.some(rows => rows.length === 1));
    expect((await client.query("mine", undefined))[0]!.body).toBe("queued");
    await running.stop();
    running = await startPebble({ ...options, port });
    const before = values.length;
    await until(() => values.length > before);
    await client.mutate("add", { body: "reconnected" });
    await until(() => values.at(-1)?.length === 2);
    unsubscribe();
    const count = values.length;
    await client.mutate("add", { body: "after unsubscribe" });
    await Bun.sleep(60);
    expect(values.length).toBe(count);
    const httpClient = createClient<typeof notes>({ url: running.server.url.href, sync: false, headers: identityHeaders("sdk") });
    expect(await httpClient.query("mine", undefined)).toHaveLength(3);
    await expect(httpClient.mutate("add", { body: "" })).rejects.toBeInstanceOf(BedrockError);
    httpClient.close();
  } finally {
    client.close(); await running.stop(); temp.cleanup();
  }
});
