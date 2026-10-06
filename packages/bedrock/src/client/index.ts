import { storageClient } from "./storage";
export type { UploadOptions } from "./storage";
import type { PebbleConfig } from "../config/types";
import { BedrockError, asBedrockError } from "../error";
import type { Client, ClientOptions } from "./types";
export type { Client, ClientOptions, ClientResult, JsonResult } from "./types";
export { BedrockError } from "../error";

interface Subscription {
  query: string;
  args: unknown;
  onData: (data: any) => void;
  onError?: ((error: BedrockError) => void) | undefined;
}
interface Pending {
  message: { op: "mut"; id: string; mutation: string; args: unknown };
  sent: boolean;
  resolve: (value: any) => void;
  reject: (error: BedrockError) => void;
}
function remoteError(error: any) {
  return new BedrockError(error?.code ?? "REQUEST_FAILED", error?.message ?? "The request failed.", error?.hint ?? "Check the server and retry.");
}
const disconnected = () => new BedrockError("CONNECTION_LOST", "The connection closed before the mutation result arrived.", "Check whether the mutation committed before retrying; mutations are never replayed automatically.");

function wireArgs(args: unknown) {
  try { return JSON.parse(JSON.stringify(args ?? null)); }
  catch (error) { throw asBedrockError(error, "INVALID_ARGS", "Send JSON-serializable function arguments."); }
}

export function createClient<P extends PebbleConfig>(options: ClientOptions = {}): Client<P> {
  const origin = options.url ?? (typeof location !== "undefined" ? location.origin : undefined);
  if (!origin) throw new BedrockError("CLIENT_URL_REQUIRED", "A client URL is required outside a browser.", "Pass createClient({ url: 'http://localhost:3000' }).");
  let base: URL;
  try {
    base = new URL(origin);
    if (!["http:", "https:"].includes(base.protocol)) throw new Error("Expected HTTP or HTTPS");
  } catch (error) { throw asBedrockError(error, "INVALID_CLIENT_URL", "Pass an absolute HTTP or HTTPS pebble URL."); }
  const subscriptions = new Map<string, Subscription>();
  const pending = new Map<string, Pending>();
  let sequence = 0;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let probing = false;
  let unavailable = options.sync === false || typeof WebSocket === "undefined";
  let closed = false;

  async function http(kind: "q" | "m", name: string, args: unknown) {
    if (closed) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
    try {
      const headers = new Headers(options.headers);
      headers.set("Content-Type", "application/json");
      if (options.devUser) headers.set("x-bedrock-user", JSON.stringify(options.devUser));
      const response = await fetch(new URL(`/_bedrock/${kind}/${encodeURIComponent(name)}`, base), {
        method: "POST", headers, credentials: "include", signal: AbortSignal.timeout(30_000), body: JSON.stringify(wireArgs(args)),
      });
      const result = await response.json();
      if (!result.ok) throw remoteError(result.error);
      return result.value;
    } catch (error) { throw asBedrockError(error, "REQUEST_FAILED", "Check your network connection and pebble URL."); }
  }
  function send(message: object) { socket!.send(JSON.stringify(message)); }
  function flush() {
    for (const item of pending.values()) {
      if (!item.sent) { send(item.message); item.sent = true; }
    }
  }
  function fallback() {
    unavailable = true;
    for (const [id, item] of pending) {
      pending.delete(id);
      void http("m", item.message.mutation, item.message.args).then(item.resolve, item.reject);
    }
    for (const [id, sub] of subscriptions) {
      void http("q", sub.query, sub.args).then(value => {
        if (subscriptions.has(id)) sub.onData(value);
      }, error => { if (subscriptions.has(id)) sub.onError?.(error); });
    }
  }
  function reconnect() {
    if (closed || !subscriptions.size && !pending.size) return;
    const delay = Math.min(30_000, 250 * 2 ** Math.min(attempt++, 7)) * (0.75 + Math.random() * 0.5);
    timer = setTimeout(() => { timer = undefined; connect(); }, delay);
  }
  async function discover() {
    probing = true;
    try {
      const headers = new Headers(options.headers);
      if (options.devUser) headers.set("x-bedrock-user", JSON.stringify(options.devUser));
      const response = await fetch(new URL("/_bedrock/ws", base), { headers, credentials: "include", signal: AbortSignal.timeout(5000) });
      if (closed) return;
      // A plain request gets 426 only when sync is enabled and access permits it.
      if (response.status !== 426) { fallback(); return; }
    } catch {
      // A temporary network failure does not establish that sync is unavailable.
    } finally { probing = false; }
    reconnect();
  }
  function connect() {
    if (closed || unavailable || probing || socket || timer) return;
    const url = new URL("/_bedrock/ws", base);
    url.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    if (options.devUser) url.searchParams.set("devUser", JSON.stringify(options.devUser));
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { fallback(); return; }
    socket = ws;
    let opened = false;
    const timeout = setTimeout(() => ws.close(), 5000);
    ws.onopen = () => {
      clearTimeout(timeout);
      if (closed || socket !== ws) { ws.close(); return; }
      opened = true;
      attempt = 0;
      for (const [id, sub] of subscriptions) send({ op: "sub", id, query: sub.query, args: sub.args ?? null });
      flush();
    };
    ws.onmessage = event => {
      if (closed || socket !== ws) return;
      let message: any;
      try { message = JSON.parse(String(event.data)); }
      catch { ws.close(1002, "Invalid server message"); return; }
      if (message.op === "data") subscriptions.get(message.id)?.onData(message.result);
      else if (message.op === "result") {
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        if (message.ok) item.resolve(message.value); else item.reject(remoteError(message.error));
      } else if (message.op === "error") {
        const item = pending.get(message.id);
        if (item) { pending.delete(message.id); item.reject(remoteError(message.error)); }
        subscriptions.get(message.id)?.onError?.(remoteError(message.error));
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(timeout);
      if (socket !== ws) return;
      socket = undefined;
      for (const [id, item] of pending) {
        if (item.sent) { pending.delete(id); item.reject(disconnected()); }
      }
      if (closed) return;
      if (!opened) { void discover(); return; }
      reconnect();
    };
  }
  return {
    ...storageClient(base, options, () => closed),
    query: (name, args) => http("q", name, args),
    mutate(name, args) {
      if (closed) return Promise.reject(new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client."));
      if (unavailable) return http("m", name, args);
      if (pending.size >= 1000) return Promise.reject(new BedrockError("MUTATION_LIMIT", "Too many pending mutations.", "Wait for earlier mutations to finish."));
      let serialized: unknown;
      try { serialized = wireArgs(args); } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        const id = `m${++sequence}`;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new BedrockError("MUTATION_TIMEOUT", "No mutation result arrived within 30 seconds.", "Check whether the mutation committed before retrying."));
        }, 30_000);
        pending.set(id, {
          message: { op: "mut", id, mutation: name, args: serialized }, sent: false,
          resolve(value) { clearTimeout(timeout); resolve(value); },
          reject(error) { clearTimeout(timeout); reject(error); },
        });
        if (socket?.readyState === WebSocket.OPEN) flush(); else connect();
      });
    },
    subscribe(query, args, onData, onError) {
      if (closed) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
      const id = `s${++sequence}`;
      args = wireArgs(args);
      subscriptions.set(id, { query, args, onData, onError });
      if (unavailable) {
        void http("q", query, args).then(value => { if (subscriptions.has(id)) onData(value); }, error => { if (subscriptions.has(id)) onError?.(error); });
      } else if (socket?.readyState === WebSocket.OPEN) send({ op: "sub", id, query, args: args ?? null });
      else connect();
      return () => {
        subscriptions.delete(id);
        if (socket?.readyState === WebSocket.OPEN) send({ op: "unsub", id });
      };
    },
    close() {
      closed = true;
      clearTimeout(timer);
      subscriptions.clear();
      for (const item of pending.values()) item.reject(disconnected());
      pending.clear();
      socket?.close(1000, "Client closed");
      socket = undefined;
    },
  };
}
