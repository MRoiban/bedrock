import { expect, test } from "bun:test";
import { relayWebSocket, RELAY_BUFFER_LIMIT, type Relay } from "./proxy";

function relayFixture() {
  let buffered = 0, sent = 0, paused = 0, resumed = 0;
  const closed: [number, string][] = [];
  const upstream = {
    readyState: WebSocket.OPEN, bufferedAmount: 0,
    send() { sent++; },
    pause() { paused++; return true; }, resume() { resumed++; return true; },
    close(code: number, reason: string) { closed.push([code, reason]); },
  };
  const data: Relay = { upstream: upstream as unknown as WebSocket, pending: [] };
  const socket = {
    data,
    getBufferedAmount() { return buffered; },
    send(body: string | ArrayBuffer) { buffered += typeof body === "string" ? Buffer.byteLength(body) : body.byteLength; sent++; return -1; },
    close(code: number, reason: string) { closed.push([code, reason]); },
  } as unknown as Bun.ServerWebSocket<Relay>;
  return { socket, upstream, data, closed, stats: () => ({ sent, paused, resumed }), buffer: (bytes: number) => { buffered = bytes; } };
}

test("relay pauses backpressured upstream reads and resumes on downstream drain", () => {
  const fixture = relayFixture();
  fixture.data.pending = ["burst"];
  relayWebSocket.open!(fixture.socket);
  expect(fixture.stats()).toEqual({ sent: 1, paused: 1, resumed: 0 });
  expect(fixture.closed).toEqual([]);
  fixture.buffer(0);
  relayWebSocket.drain!(fixture.socket);
  expect(fixture.stats().resumed).toBe(1);
});

test("relay closes both sides before downstream or upstream queues exceed their byte budget", () => {
  const downstream = relayFixture();
  downstream.buffer(RELAY_BUFFER_LIMIT);
  downstream.data.pending = ["x"];
  relayWebSocket.open!(downstream.socket);
  expect(downstream.stats().sent).toBe(0);
  expect(downstream.data.pending).toEqual([]);
  expect(downstream.closed.every(([code]) => code === 1013)).toBe(true);
  expect(downstream.closed.length).toBeGreaterThanOrEqual(2);

  const upstream = relayFixture();
  upstream.upstream.bufferedAmount = RELAY_BUFFER_LIMIT;
  relayWebSocket.open!(upstream.socket);
  relayWebSocket.message(upstream.socket, "x");
  expect(upstream.stats().sent).toBe(0);
  expect(upstream.closed).toEqual([[1013, "Slow consumer"], [1013, "Slow consumer"]]);
});
