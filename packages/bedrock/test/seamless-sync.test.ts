import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { startPebble } from "../src/runtime";
import { tempDirectory, identityHeaders, HeaderWebSocket } from "./helpers";

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 400; attempt++) { if (predicate()) return; await Bun.sleep(10); }
  throw new Error("Timed out waiting for seamless sync");
}
function connect(url: URL) {
  const endpoint = new URL("/_bedrock/ws", url); endpoint.protocol = "ws:";
  const ws = new HeaderWebSocket(endpoint, { headers: identityHeaders("same-user") });
  const messages: any[] = [];
  ws.onmessage = event => messages.push(JSON.parse(String(event.data)));
  return { ws, messages, send: (message: object) => ws.send(JSON.stringify(message)) };
}

test("WS hello is first, mutation data precedes result without duplicates, and other sockets update", async () => {
  const temp = tempDirectory();
  const running = await startPebble({ dir: resolve(import.meta.dir, "../../../examples/notes"), dataDir: temp.dir, port: 0 });
  const a = connect(running.server.url), b = connect(running.server.url);
  try {
    await until(() => a.messages.length === 1 && b.messages.length === 1);
    expect(a.messages[0]).toEqual({ op: "hello", release: expect.stringMatching(/^local-[a-f0-9]{8}$/) });
    expect(b.messages[0]).toEqual(a.messages[0]);
    for (const socket of [a, b]) socket.send({ op: "sub", id: "mine", query: "mine", args: null });
    a.send({ op: "sub", id: "also", query: "mine", args: null });
    await until(() => a.messages.length === 3 && b.messages.length === 2);
    a.send({ op: "mut", id: "save", mutation: "add", args: { body: "landed" } });
    await until(() => a.messages.some(message => message.op === "result"));
    expect(a.messages.slice(3).map(message => message.op)).toEqual(["data", "data", "result"]);
    expect(a.messages.slice(3, 5).every(message => message.result[0].body === "landed")).toBe(true);
    expect(a.messages.at(-1)).toMatchObject({ op: "result", id: "save", ok: true });
    await until(() => b.messages.length === 3);
    expect(b.messages.at(-1).result[0].body).toBe("landed");
    await Bun.sleep(80);
    expect(a.messages).toHaveLength(6);
    expect(b.messages).toHaveLength(3);
    const closed = new Promise<CloseEvent>(resolve => { a.ws.onclose = resolve; });
    await running.stop();
    expect(await closed).toMatchObject({ code: 1012, reason: "Service restart" });
  } finally { a.ws.close(); b.ws.close(); await running.stop(); temp.cleanup(); }
});
