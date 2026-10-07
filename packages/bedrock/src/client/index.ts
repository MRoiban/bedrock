import { browserEnvironment } from "./browser";
import { releaseTracker } from "./release";
import { restorePlace } from "./restore";
import type { User } from "../config/types";
import { storageClient } from "./storage";
export type { UploadOptions } from "./storage";
import type { PebbleConfig } from "../config/types";
import { BedrockError, asBedrockError } from "../error";
import type { Client, ClientOptions } from "./types";
export type { Client, ClientOptions, ClientResult, JsonResult } from "./types";
export type { Release } from "./release";
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
  let probeGeneration = 0;
  let unavailable = (!!options.token && typeof Bun === "undefined") || options.sync === false || typeof WebSocket === "undefined";
  let closed = false;
  let suspended = false;
  let mutations = 0, uploads = 0;
  const browser = browserEnvironment();
  const release = releaseTracker(options, browser, () => suspended || pending.size > 0 || mutations > 0 || uploads > 0);
  const restore = restorePlace(options.token ? undefined : browser);
  function received(response: Response) { release.observe(response.headers.get("x-bedrock-release")); }
  function delivered(id: string, value: unknown) {
    const sub = subscriptions.get(id);
    if (!sub) return;
    sub.onData(value);
    restore.data(id);
  }
  async function trackedMutation(name: string, args: unknown) {
    mutations++;
    try { return await http("m", name, args); }
    finally { mutations--; release.check(); }
  }
  function rejectSent() {
    for (const [id, item] of pending) {
      if (item.sent) { pending.delete(id); item.reject(disconnected()); }
    }
    release.check();
  }
  function hide() {
    suspended = true;
    probeGeneration++; probing = false;
    clearTimeout(timer); timer = undefined;
    const ws = socket;
    socket = undefined;
    ws?.close(1000, "Page hidden");
    rejectSent();
  }
  function resume() {
    if (closed) return;
    suspended = false;
    probeGeneration++; probing = false;
    clearTimeout(timer); timer = undefined;
    attempt = 0;
    if (subscriptions.size || pending.size) connect();
    release.check();
  }
  function visible() { if (!browser?.document.hidden) resume(); }
  browser?.window.addEventListener("pagehide", hide);
  browser?.window.addEventListener("pageshow", resume);
  browser?.window.addEventListener("online", resume);
  browser?.document.addEventListener("visibilitychange", visible);

  async function http(kind: "q" | "m", name: string, args: unknown) {
    if (closed) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
    try {
      const headers = new Headers(options.headers);
      if (options.token) { headers.set("authorization", `Bearer ${options.token}`); headers.delete("cookie"); }
      headers.set("Content-Type", "application/json");
      headers.set("origin", base.origin);
      const response = await fetch(new URL(`/_bedrock/${kind}/${encodeURIComponent(name)}`, base), {
        method: "POST", headers, credentials: options.token ? "omit" : "include", signal: AbortSignal.timeout(30_000), body: JSON.stringify(wireArgs(args)),
      });
      received(response);
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
      void trackedMutation(item.message.mutation, item.message.args).then(item.resolve, item.reject);
    }
    for (const [id, sub] of subscriptions) {
      void http("q", sub.query, sub.args).then(value => {
        delivered(id, value);
      }, error => { if (subscriptions.has(id)) sub.onError?.(error); });
    }
  }
  function reconnect(restarting = false) {
    if (suspended || closed || !subscriptions.size && !pending.size) return;
    const delay = restarting ? 100 + Math.random() * 900 : Math.min(30_000, 250 * 2 ** Math.min(attempt++, 7)) * (0.75 + Math.random() * 0.5);
    timer = setTimeout(() => { timer = undefined; connect(); }, delay);
  }
  async function discover() {
    probing = true;
    const generation = ++probeGeneration;
    try {
      const headers = new Headers(options.headers);
      if (options.token) { headers.set("authorization", `Bearer ${options.token}`); headers.delete("cookie"); }
      headers.set("origin", base.origin);
      const response = await fetch(new URL("/_bedrock/ws", base), { headers, credentials: options.token ? "omit" : "include", signal: AbortSignal.timeout(5000) });
      received(response);
      if (closed || suspended || generation !== probeGeneration) return;
      // A plain request gets 426 only when sync is enabled and access permits it.
      if (response.status !== 426) { fallback(); return; }
    } catch {
      // A temporary network failure does not establish that sync is unavailable.
    } finally { if (generation === probeGeneration) probing = false; }
    if (generation === probeGeneration) reconnect();
  }
  function connect() {
    if (closed || suspended || unavailable || probing || socket || timer) return;
    const url = new URL("/_bedrock/ws", base);
    url.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    let ws: WebSocket;
    try {
      // Bun callers can supply cookies; browsers authenticate with their cookie jar.
      if (typeof Bun !== "undefined") {
        const Constructor = WebSocket as unknown as new (url: URL, options: Bun.WebSocketOptions) => WebSocket;
        const headers = new Headers(options.headers);
        if (options.token) { headers.set("authorization", `Bearer ${options.token}`); headers.delete("cookie"); }
        headers.set("origin", base.origin);
        ws = new Constructor(url, { headers: Object.fromEntries(headers) });
      } else ws = new WebSocket(url);
    } catch { fallback(); return; }
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
      if (message.op === "hello") release.observe(message.release);
      else if (message.op === "data") delivered(message.id, message.result);
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
    ws.onclose = event => {
      clearTimeout(timeout);
      if (socket !== ws) return;
      socket = undefined;
      rejectSent();
      if (closed || suspended) return;
      if (event.code === 1012) { reconnect(true); return; }
      if (!opened) { void discover(); return; }
      reconnect();
    };
  }
  async function authRequest(path: string, method = "GET") {
    if (closed) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
    try {
      const headers = new Headers(options.headers);
      if (options.token) { headers.set("authorization", `Bearer ${options.token}`); headers.delete("cookie"); }
      headers.set("origin", base.origin);
      const response = await fetch(new URL(path, base), { method, headers, credentials: options.token ? "omit" : "include", signal: AbortSignal.timeout(30_000) });
      received(response);
      const result = await response.json();
      if (!response.ok) throw remoteError(result.error);
      return result;
    } catch (error) { throw asBedrockError(error, "REQUEST_FAILED", "Check your network connection and pebble URL."); }
  }
  return {
    async user(): Promise<User | null> { return (await authRequest("/_bedrock/me")).user; },
    loginUrl(returnTo = typeof location !== "undefined" ? location.href : base.href) {
      const dev = base.hostname.endsWith(".localhost");
      const login = dev ? new URL("/_bedrock/dev-login", base) : new URL(`https://auth.${base.hostname.split(".").slice(1).join(".")}/login`);
      login.searchParams.set("return", returnTo);
      return login.href;
    },
    async logout() { await authRequest("/_bedrock/logout", "POST"); },
    release: release.release,
    onRelease: release.onRelease,
    ...storageClient(base, options, () => closed, received, change => { uploads += change; release.check(); }),
    query: (name, args) => http("q", name, args),
    mutate(name, args) {
      if (closed) return Promise.reject(new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client."));
      if (unavailable) return trackedMutation(name, args);
      if (pending.size >= 1000) return Promise.reject(new BedrockError("MUTATION_LIMIT", "Too many pending mutations.", "Wait for earlier mutations to finish."));
      let serialized: unknown;
      try { serialized = wireArgs(args); } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        const id = `m${++sequence}`;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new BedrockError("MUTATION_TIMEOUT", "No mutation result arrived within 30 seconds.", "Check whether the mutation committed before retrying."));
          release.check();
        }, 30_000);
        pending.set(id, {
          message: { op: "mut", id, mutation: name, args: serialized }, sent: false,
          resolve(value) { clearTimeout(timeout); resolve(value); release.check(); },
          reject(error) { clearTimeout(timeout); reject(error); release.check(); },
        });
        if (socket?.readyState === WebSocket.OPEN) flush(); else connect();
      });
    },
    subscribe(query, args, onData, onError) {
      if (closed) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
      const id = `s${++sequence}`;
      args = wireArgs(args);
      subscriptions.set(id, { query, args, onData, onError });
      restore.subscribe(id);
      if (unavailable) {
        void http("q", query, args).then(value => { delivered(id, value); }, error => { if (subscriptions.has(id)) onError?.(error); });
      } else if (socket?.readyState === WebSocket.OPEN) send({ op: "sub", id, query, args: args ?? null });
      else connect();
      return () => {
        subscriptions.delete(id);
        restore.unsubscribe(id);
        if (socket?.readyState === WebSocket.OPEN) send({ op: "unsub", id });
      };
    },
    close() {
      closed = true;
      release.close(); restore.close();
      browser?.window.removeEventListener("pagehide", hide);
      browser?.window.removeEventListener("pageshow", resume);
      browser?.window.removeEventListener("online", resume);
      browser?.document.removeEventListener("visibilitychange", visible);
      clearTimeout(timer);
      subscriptions.clear();
      for (const item of pending.values()) item.reject(disconnected());
      pending.clear();
      socket?.close(1000, "Client closed");
      socket = undefined;
    },
  };
}
