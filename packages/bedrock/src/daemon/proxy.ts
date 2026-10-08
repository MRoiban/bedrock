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
    if ((name.startsWith("x-bedrock-") && name !== "x-bedrock-file-name" && name !== "x-bedrock-file-meta") || [...connection, "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"].includes(name)) headers.delete(name);
  }
  const cookies = (headers.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part && part.split("=", 1)[0]!.trim() !== "bedrock_session");
  if (cookies.length) headers.set("cookie", cookies.join("; ")); else headers.delete("cookie");
  headers.set("x-forwarded-host", request.headers.get("host") ?? new URL(request.url).host);
  headers.set("x-forwarded-proto", new URL(request.url).protocol.replace(":", ""));
  return headers;
}

export async function proxyHttp(request: Request, port: number, release: string, complete = () => {}, identity: HeadersInit = {}) {
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
    headers.set("x-bedrock-release", release);
    const timing = timingEntries(headers.get("server-timing") ?? "").filter(entry => !/^bedrock-release\s*(?:;|$)/i.test(entry));
    timing.push(`bedrock-release;desc="${release}"`);
    headers.set("server-timing", timing.join(", "));
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

function timingEntries(value: string) {
  const entries: string[] = [];
  let start = 0, quoted = false, escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) { entries.push(value.slice(start, index).trim()); start = index + 1; }
  }
  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
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
  pendingBytes?: number;
  overloaded?: boolean;
  closed?: { code: number; reason: string };
}
export const RELAY_BUFFER_LIMIT = 64 * 1024 ** 2;
const messageBytes = (message: string | ArrayBuffer | Buffer) => typeof message === "string" ? Buffer.byteLength(message) : message.byteLength;
function overload(relay: Relay) {
  if (relay.overloaded) return;
  relay.overloaded = true;
  relay.pending.length = 0;
  relay.pendingBytes = 0;
  relay.closed = { code: 1013, reason: "Slow consumer" };
  relay.downstream?.close(1013, "Slow consumer");
  relay.upstream.close(1013, "Slow consumer");
}
function sendDownstream(relay: Relay, message: string | ArrayBuffer) {
  if (relay.overloaded) return;
  const downstream = relay.downstream!;
  if (downstream.getBufferedAmount() + messageBytes(message) > RELAY_BUFFER_LIMIT) { overload(relay); return; }
  const sent = downstream.send(message);
  if (sent === 0) { overload(relay); return; }
  if (sent === -1 || downstream.getBufferedAmount() > 1024 * 1024) {
    // Older Bun versions lack pause/resume; the byte ceiling still bounds their relay.
    (relay.upstream as WebSocket & { pause?: () => boolean }).pause?.();
  }
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
    if (relay.overloaded) return;
    if (relay.downstream) sendDownstream(relay, event.data);
    else {
      const bytes = (relay.pendingBytes ?? 0) + messageBytes(event.data);
      if (bytes > RELAY_BUFFER_LIMIT || relay.pending.length >= 100) { overload(relay); return; }
      relay.pendingBytes = bytes;
      relay.pending.push(event.data);
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
  } catch (error) {
    upstream.close();
    // Bun's WebSocket error hides the rejected upgrade's HTTP status. A plain
    // GET on a registered socket performs the same admission check without
    // opening a socket, preserving bearer denial for native reconnect clients.
    if (headers.get("authorization")?.startsWith("Bearer brk_")) {
      try {
        const check = new URL(url); check.protocol = "http:";
        const response = await fetch(check, { headers, signal: AbortSignal.timeout(2500), redirect: "manual" });
        if (response.status === 401 || response.status === 403) return response;
        await response.body?.cancel();
      } catch { /* Preserve the original connection failure when admission is unavailable. */ }
    }
    throw error;
  }
  finally { clearTimeout(timer); }
}

export const relayWebSocket: Bun.WebSocketHandler<Relay> = {
  maxPayloadLength: RELAY_BUFFER_LIMIT,
  backpressureLimit: RELAY_BUFFER_LIMIT, closeOnBackpressureLimit: false,
  open(socket) {
    socket.data.downstream = socket;
    for (const message of socket.data.pending) sendDownstream(socket.data, message);
    socket.data.pending.length = 0;
    socket.data.pendingBytes = 0;
    if (socket.data.closed) socket.close(socket.data.closed.code, socket.data.closed.reason);
  },
  message(socket, message) {
    const relay = socket.data;
    if (relay.overloaded) return;
    if (relay.upstream.bufferedAmount + messageBytes(message) > RELAY_BUFFER_LIMIT) { overload(relay); return; }
    if (relay.upstream.readyState === WebSocket.OPEN) relay.upstream.send(message);
  },
  drain(socket) { (socket.data.upstream as WebSocket & { resume?: () => boolean }).resume?.(); },
  close(socket, code, reason) { socket.data.onClose?.(); socket.data.upstream.close(closeCode(code), reason); },
};
