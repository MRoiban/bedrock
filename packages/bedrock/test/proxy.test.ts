import { expect, test } from "bun:test";
import { proxyHttp, proxyWebSocket, relayWebSocket, type Relay } from "../src/daemon/proxy";
import { daemonError } from "../src/daemon/api";

const BunWebSocket = WebSocket as unknown as new (url: URL, options: Bun.WebSocketOptions) => WebSocket;

test("proxy streams HTTP and relays WebSocket text, binary, headers, protocols, and close in both directions", async () => {
  let upstreamHeaders: Record<string, string> = {};
  let upstreamClose: { code: number; reason: string } | undefined;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request, server) {
      if (request.headers.get("upgrade") === "websocket") {
        upstreamHeaders = Object.fromEntries(request.headers);
        if (server.upgrade(request, { headers: { "sec-websocket-protocol": "echo" } })) return;
      }
      if (new URL(request.url).pathname === "/stream") {
        return new Response(new ReadableStream({ async start(controller) {
          controller.enqueue(new TextEncoder().encode("first"));
          await gate;
          controller.enqueue(new TextEncoder().encode("second"));
          controller.close();
        } }), { status: 202, headers: { "x-stream": "yes" } });
      }
      return new Response(request.body, { status: 201, headers: { "x-method": request.method } });
    },
    websocket: {
      message(socket, message) {
        if (message === "close") socket.close(4001, "upstream closed");
        else socket.send(message);
      },
      close(_socket, code, reason) { upstreamClose = { code, reason }; },
    },
  });
  const proxy = Bun.serve<Relay>({
    hostname: "127.0.0.1", port: 0, websocket: relayWebSocket,
    async fetch(request, server) {
      try {
        if (request.headers.get("upgrade") === "websocket") return await proxyWebSocket(request, server, upstream.port!);
        return await proxyHttp(request, upstream.port!);
      } catch (error) { return daemonError(error); }
    },
  });
  const sockets: WebSocket[] = [];
  const connect = async () => {
    const url = new URL("/echo", proxy.url);
    url.protocol = "ws:";
    const socket = new BunWebSocket(url, { protocols: ["echo"], headers: { host: "raw.localhost", "x-bedrock-user": "spoofed", "x-bedrock-other": "spoofed", "x-custom": "retained" } });
    socket.binaryType = "arraybuffer";
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("WebSocket failed")); });
    return socket;
  };
  const message = (socket: WebSocket, data: string | Uint8Array) => new Promise<string | ArrayBuffer>((resolve, reject) => {
    socket.onmessage = event => resolve(event.data);
    socket.onerror = () => reject(new Error("relay failed"));
    socket.send(data);
  });
  try {
    const stream = await fetch(new URL("/stream", proxy.url));
    expect(stream.status).toBe(202);
    expect(stream.headers.get("x-stream")).toBe("yes");
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    release();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("second");
    expect((await reader.read()).done).toBe(true);
    const upload = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("one"));
      controller.enqueue(new TextEncoder().encode("two"));
      controller.close();
    } });
    const echoed = await fetch(proxy.url, { method: "PATCH", body: upload });
    expect(echoed.status).toBe(201);
    expect(echoed.headers.get("x-method")).toBe("PATCH");
    expect(await echoed.text()).toBe("onetwo");
    const socket = await connect();
    expect(socket.protocol).toBe("echo");
    expect(Object.keys(upstreamHeaders).some(name => name.startsWith("x-bedrock-"))).toBe(false);
    expect(upstreamHeaders["x-custom"]).toBe("retained");
    expect(upstreamHeaders["x-forwarded-host"]).toBe("raw.localhost");
    expect(upstreamHeaders["x-forwarded-proto"]).toBe("http");
    expect(await message(socket, "hello")).toBe("hello");
    expect(new Uint8Array(await message(socket, new Uint8Array([0, 1, 255])) as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 255]));
    const closed = new Promise<CloseEvent>(resolve => { socket.onclose = resolve; });
    socket.send("close");
    expect(await closed).toMatchObject({ code: 4001, reason: "upstream closed" });
    const second = await connect();
    const downstreamClosed = new Promise<void>(resolve => { second.onclose = () => resolve(); });
    second.close(4002, "client closed");
    await downstreamClosed;
    const deadline = Date.now() + 2000;
    while (upstreamClose?.code !== 4002 && Date.now() < deadline) await Bun.sleep(10);
    expect(upstreamClose).toEqual({ code: 4002, reason: "client closed" });
  } finally {
    release();
    for (const socket of sockets) socket.close();
    await proxy.stop(true);
    await upstream.stop(true);
  }
}, 15000);
