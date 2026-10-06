import { BedrockError } from "../error";

export function hostTarget(host: string, domain: string) {
  const hostname = host.toLowerCase().split(":")[0]!;
  for (const suffix of new Set([domain, "localhost"])) {
    if (!hostname.endsWith(`.${suffix}`)) continue;
    const name = hostname.slice(0, -suffix.length - 1);
    if (/^[a-z0-9-]{1,32}$/.test(name)) return name;
  }
  return null;
}

export function proxyHeaders(request: Request) {
  const headers = new Headers(request.headers);
  const connection = headers.get("connection")?.split(",").map(name => name.trim().toLowerCase()) ?? [];
  for (const name of [...headers.keys()]) {
    if ((name.startsWith("x-bedrock-") && name !== "x-bedrock-file-name") || [...connection, "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"].includes(name)) headers.delete(name);
  }
  const cookies = (headers.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part && part.split("=", 1)[0]!.trim() !== "bedrock_session");
  if (cookies.length) headers.set("cookie", cookies.join("; ")); else headers.delete("cookie");
  headers.set("x-forwarded-host", request.headers.get("host") ?? new URL(request.url).host);
  headers.set("x-forwarded-proto", new URL(request.url).protocol.replace(":", ""));
  return headers;
}

export async function proxyHttp(request: Request, port: number, complete = () => {}, identity: HeadersInit = {}) {
  let completed = false;
  const finish = () => { if (!completed) { completed = true; complete(); } };
  try {
    const url = new URL(request.url);
    url.hostname = "127.0.0.1";
    url.port = String(port);
    const response = await fetch(url, {
      method: request.method, headers: forwardHeaders(request, identity),
      body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
      redirect: "manual", signal: request.signal, decompress: false,
    });
    const headers = new Headers(response.headers);
    const connection = headers.get("connection")?.split(",").map(name => name.trim().toLowerCase()) ?? [];
    for (const name of [...connection, "connection", "keep-alive", "transfer-encoding", "upgrade", "trailer"]) headers.delete(name);
    // A pebble must not overwrite the daemon's parent-domain session cookie.
    const cookies = headers.getSetCookie().filter(value => !/^bedrock_session\s*=/i.test(value));
    headers.delete("set-cookie");
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    if (!response.body) { finish(); return new Response(null, { status: response.status, statusText: response.statusText, headers }); }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { finish(); controller.close(); }
          else controller.enqueue(value);
        } catch (error) { finish(); controller.error(error); }
      },
      async cancel(reason) { finish(); await reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) { finish(); throw error; }
}

function forwardHeaders(request: Request, identity: HeadersInit) {
  const headers = proxyHeaders(request);
  new Headers(identity).forEach((value, key) => headers.set(key, value));
  return headers;
}

export interface Relay {
  upstream: WebSocket;
  onClose?: (() => void) | undefined;
  downstream?: Bun.ServerWebSocket<Relay>;
  pending: (string | ArrayBuffer)[];
  closed?: { code: number; reason: string };
}
const closeCode = (code: number) => code === 1005 || code === 1006 || code === 1015 ? 1011 : code;

export async function proxyWebSocket(request: Request, server: Bun.Server<Relay>, port: number, identity: HeadersInit = {}, register?: (relay: Relay) => (() => void)) {
  const url = new URL(request.url);
  url.protocol = "ws:";
  url.hostname = "127.0.0.1";
  url.port = String(port);
  const headers = forwardHeaders(request, identity);
  for (const name of [...headers.keys()]) if (name.startsWith("sec-websocket-")) headers.delete(name);
  const protocols = request.headers.get("sec-websocket-protocol")?.split(",").map(value => value.trim());
  // DOM declarations omit Bun's header-capable WebSocket constructor.
  const BunWebSocket = WebSocket as unknown as new (url: URL, options: Bun.WebSocketOptions) => WebSocket;
  const upstream = new BunWebSocket(url, { headers: Object.fromEntries(headers), ...(protocols ? { protocols } : {}) });
  upstream.binaryType = "arraybuffer";
  const relay: Relay = { upstream, pending: [] };
  relay.onClose = register?.(relay);
  upstream.onmessage = event => {
    if (relay.downstream) relay.downstream.send(event.data);
    else {
      relay.pending.push(event.data);
      if (relay.pending.length > 100) upstream.close(1009, "Too many messages before upgrade");
    }
  };
  upstream.onclose = event => {
    relay.onClose?.();
    relay.closed = { code: closeCode(event.code), reason: event.reason };
    relay.downstream?.close(relay.closed.code, relay.closed.reason);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new BedrockError("UPSTREAM_UNAVAILABLE", "The pebble rejected the WebSocket connection.", "Check the pebble's WebSocket route and logs."));
      upstream.onopen = () => resolve();
      upstream.onerror = fail;
      upstream.addEventListener("close", fail, { once: true });
      timer = setTimeout(fail, 5000);
    });
    const upgraded = server.upgrade(request, {
      data: relay,
      ...(upstream.protocol ? { headers: { "sec-websocket-protocol": upstream.protocol } } : {}),
    });
    if (!upgraded) { upstream.close(); return new Response("WebSocket upgrade failed", { status: 400 }); }
    return undefined;
  } catch (error) { upstream.close(); throw error; }
  finally { clearTimeout(timer); }
}

export const relayWebSocket: Bun.WebSocketHandler<Relay> = {
  open(socket) {
    socket.data.downstream = socket;
    for (const message of socket.data.pending) socket.send(message);
    socket.data.pending.length = 0;
    if (socket.data.closed) socket.close(socket.data.closed.code, socket.data.closed.reason);
  },
  message(socket, message) {
    if (socket.data.upstream.readyState === WebSocket.OPEN) socket.data.upstream.send(message);
  },
  close(socket, code, reason) { socket.data.onClose?.(); socket.data.upstream.close(closeCode(code), reason); },
};
