import { browserEnvironment } from "./browser";
import { releaseTracker } from "./release";
import { restorePlace } from "./restore";
import type { User } from "../config/types";
import { storageClient } from "./storage";
export type { UploadOptions } from "./storage";
import type { PebbleConfig } from "../config/types";
import { BedrockError, asBedrockError } from "../error";
import type { Client, ClientOptions, Connection } from "./types";
export type { Client, ClientOptions, Connection, ClientResult, JsonResult } from "./types";
export type { Release } from "./release";
export { BedrockError } from "../error";

interface Subscription {
  lastJson?: string;
  errorCode?: string | undefined;
  query: string;
  args: unknown;
  onData: (data: any) => void;
  onError?: ((error: BedrockError) => void) | undefined;
}
interface Pending {
  message: { op: "mut"; id: string; mutation: string; args: unknown };
  sent: boolean;
  cancelTimeout: () => void;
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
  let attempted = false;
  let probing = false;
  let probeGeneration = 0;
  let unavailable = (!!options.token && typeof Bun === "undefined") || options.sync === false || typeof WebSocket === "undefined";
  let polling = unavailable;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let ticking = false;
  const pollInterval = options.pollInterval ?? 5000;
  let connection: Connection = { state: "idle", since: Date.now(), attempt: 0 };
  const listeners = new Set<(connection: Connection) => void>();
  let closed = false;
  let suspended = false;
  let mutations = 0, uploads = 0;
  const browser = browserEnvironment();
  const release = releaseTracker(options, browser, () => suspended || pending.size > 0 || mutations > 0 || uploads > 0);
  const restore = restorePlace(options.token ? undefined : browser);
  if (browser?.window.navigator?.onLine === false) connection = { ...connection, state: "offline" };
  function state(next: Connection["state"]) {
    if (closed && next !== "idle") return;
    if (browser?.window.navigator?.onLine === false && next !== "idle") next = "offline";
    const changed = connection.state !== next;
    connection = { state: next, since: changed ? Date.now() : connection.since, attempt };
    if (changed) for (const fn of listeners) fn(connection);
  }
  const quiet = () => !subscriptions.size && !pending.size && !mutations;
  // Linger briefly so an unsubscribe followed by a resubscribe (a React re-render) keeps the socket.
  function settled() {
    clearTimeout(idleTimer); idleTimer = undefined;
    if (!quiet() || closed) return;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (!quiet() || closed) return;
      probeGeneration++; probing = false;
      clearTimeout(timer); timer = undefined;
      clearTimeout(pollTimer); pollTimer = undefined;
      const ws = socket; socket = undefined; ws?.close();
      attempt = 0; attempted = false; if (connection.state !== "offline") state("idle");
    }, 1000);
  }
  function received(response: Response) {
    if (connection.state === "offline") state(socket?.readyState === 1 ? "live" : polling ? "polling" : subscriptions.size || pending.size ? "reconnecting" : "idle");
    release.observe(response.headers.get("x-bedrock-release"));
  }
  async function request(path: string | URL, init: RequestInit = {}, code = "REQUEST_FAILED") {
    if (closed) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
    const headers = new Headers(options.headers);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (options.token) { headers.set("authorization", `Bearer ${options.token}`); headers.delete("cookie"); }
    headers.set("origin", base.origin);
    let response: Response;
    try { response = await fetch(new URL(path, base), { ...init, headers, credentials: options.token ? "omit" : "include", signal: init.signal ?? AbortSignal.timeout(30_000) }); }
    catch (error) { state("offline"); throw asBedrockError(error, code, "Check your network connection and pebble URL."); }
    received(response);
    return response;
  }
  async function refresh(id: string, sub: Subscription) {
    try {
      const value = await http("q", sub.query, sub.args);
      if (subscriptions.get(id) !== sub || closed) return;
      sub.errorCode = undefined;
      const json = JSON.stringify(value);
      if (json !== sub.lastJson) { sub.lastJson = json; delivered(id, value); }
    } catch (error) {
      const typed = asBedrockError(error);
      if (subscriptions.get(id) !== sub || closed) return;
      if (sub.errorCode !== typed.code) { sub.errorCode = typed.code; sub.onError?.(typed); }
    }
  }
  async function refreshAll() { await Promise.allSettled([...subscriptions].map(([id, sub]) => refresh(id, sub))); }
  function schedulePoll() {
    clearTimeout(pollTimer); pollTimer = undefined;
    if (closed || suspended || !polling || !subscriptions.size || pollInterval <= 0 || browser?.document.hidden || ticking) return;
    pollTimer = setTimeout(() => { pollTimer = undefined; void poll(); }, pollInterval);
  }
  async function poll() {
    if (ticking || closed || suspended || !polling || browser?.document.hidden) return;
    ticking = true;
    try { for (const [id, sub] of subscriptions) { if (!polling || closed || browser?.document.hidden) break; await refresh(id, sub); } }
    finally { ticking = false; schedulePoll(); }
  }
  function delivered(id: string, value: unknown) {
    const sub = subscriptions.get(id);
    if (!sub) return;
    sub.onData(value);
    restore.data(id);
  }
  async function trackedMutation(name: string, args: unknown) {
    mutations++;
    if (!socket && connection.state !== "offline") state("polling");
    try { const value = await http("m", name, args); await refreshAll(); return value; }
    finally { mutations--; settled(); release.check(); }
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
    clearTimeout(pollTimer); pollTimer = undefined;
    const ws = socket;
    socket = undefined;
    ws?.close(1000, "Page hidden");
    rejectSent();
    if ((subscriptions.size || pending.size) && !polling && connection.state !== "offline") state("reconnecting");
    settled();
  }
  function resume() {
    if (closed) return;
    suspended = false;
    probeGeneration++; probing = false;
    clearTimeout(timer); timer = undefined;
    attempt = 0;
    if (subscriptions.size || pending.size) { if (polling) { if (connection.state !== "offline") state("polling"); if (pollInterval > 0) void poll(); } connect(); }
    release.check();
  }
  function visible() { if (!browser?.document.hidden) resume(); else { clearTimeout(pollTimer); pollTimer = undefined; } }
  function offline() { state("offline"); }
  browser?.window.addEventListener("offline", offline);
  browser?.window.addEventListener("pagehide", hide);
  browser?.window.addEventListener("pageshow", resume);
  browser?.window.addEventListener("online", resume);
  browser?.document.addEventListener("visibilitychange", visible);

  async function http(kind: "q" | "m", name: string, args: unknown) {
    if (closed) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
    try {
      const response = await request(`/_bedrock/${kind}/${encodeURIComponent(name)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wireArgs(args)),
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
  function fallback(permanent = false) {
    unavailable ||= permanent;
    const starting = !polling;
    polling = true;
    if (connection.state !== "offline") state("polling");
    for (const [id, item] of pending) {
      if (item.sent) continue;
      pending.delete(id); item.cancelTimeout();
      void trackedMutation(item.message.mutation, item.message.args).then(item.resolve, item.reject);
    }
    if (starting) void poll();
  }
  function reconnect(restarting = false) {
    if (suspended || closed || !subscriptions.size && !pending.size) return;
    if (unavailable) return;
    const delay = restarting ? 100 + Math.random() * 900 : Math.min(30_000, 250 * 2 ** Math.min(attempt++, 7) * (0.75 + Math.random() * 0.5));
    if (!polling && connection.state !== "offline") state("reconnecting");
    else state(connection.state);
    timer = setTimeout(() => { timer = undefined; connect(); }, delay);
  }
  async function discover() {
    probing = true;
    const generation = ++probeGeneration;
    try {
      const response = await request("/_bedrock/ws", { signal: AbortSignal.timeout(5000) });
      if (closed || suspended || generation !== probeGeneration || quiet()) return;
      if (response.status !== 426) {
        const body = await response.json().catch(() => null);
        if (closed || suspended || generation !== probeGeneration) return;
        if (response.status === 404 && body?.error?.code === "NOT_FOUND") { fallback(true); return; }
        if (response.status === 401 || response.status === 403) {
          polling = false; clearTimeout(pollTimer); pollTimer = undefined;
          state("reconnecting");
          const error = remoteError(body?.error);
          for (const sub of subscriptions.values()) if (sub.errorCode !== error.code) { sub.errorCode = error.code; sub.onError?.(error); }
        } else fallback();
      }
    } catch {
      if (!closed && !suspended && generation === probeGeneration && !quiet()) { fallback(); state("offline"); }
    } finally { if (generation === probeGeneration) probing = false; }
    if (generation === probeGeneration) reconnect();
  }
  function connect() {
    if (closed || suspended || unavailable || probing || socket || timer) return;
    if (!polling && connection.state !== "offline") state(attempted ? "reconnecting" : "connecting");
    attempted = true;
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
    } catch { void discover(); return; }
    socket = ws;
    let opened = false;
    const timeout = setTimeout(() => ws.close(), 5000);
    ws.onopen = () => {
      clearTimeout(timeout);
      if (closed || socket !== ws) { ws.close(); return; }
      opened = true;
      attempt = 0;
      polling = false; clearTimeout(pollTimer); pollTimer = undefined; state("live");
      for (const [id, sub] of subscriptions) send({ op: "sub", id, query: sub.query, args: sub.args ?? null });
      flush();
    };
    ws.onmessage = event => {
      if (closed || socket !== ws) return;
      let message: any;
      try { message = JSON.parse(String(event.data)); }
      catch { ws.close(1002, "Invalid server message"); return; }
      if (message.op === "hello") release.observe(message.release);
      else if (message.op === "data") { const sub = subscriptions.get(message.id); if (sub) { sub.lastJson = JSON.stringify(message.result); sub.errorCode = undefined; } delivered(message.id, message.result); }
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
      settled();
    };
    ws.onerror = () => {};
    ws.onclose = event => {
      clearTimeout(timeout);
      if (socket !== ws) return;
      socket = undefined;
      rejectSent();
      settled();
      if (closed || suspended || !subscriptions.size && !pending.size) return;
      if (event.code === 1012) { reconnect(true); return; }
      if (!opened) { void discover(); return; }
      reconnect();
    };
  }
  async function authRequest(path: string, method = "GET", networkCode = "REQUEST_FAILED") {
    if (closed) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
    try {
      const response = await request(path, { method }, networkCode);
      const result = await response.json();
      if (!response.ok) throw remoteError(result.error);
      return result;
    } catch (error) { throw asBedrockError(error, "REQUEST_FAILED", "Check your network connection and pebble URL."); }
  }
  return {
    connection: () => connection,
    onConnection(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async fetch(path, init = {}) {
      let url: URL;
      try { url = new URL(path, base); }
      catch (error) { throw asBedrockError(error, "INVALID_ARGS", "Use a same-origin route URL."); }
      if (url.origin !== base.origin) throw new BedrockError("INVALID_ARGS", "Custom requests must use the client origin.", "Use a same-origin route URL.");
      mutations++;
      try {
        const response = await request(url, init);
        if (response.ok && !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase()) && polling) await refreshAll();
        return response;
      } finally { mutations--; settled(); release.check(); }
    },
    async user(): Promise<User | null> { return (await authRequest("/_bedrock/me", "GET", "OFFLINE")).user; },
    loginUrl(returnTo = typeof location !== "undefined" ? location.href : base.href) {
      const dev = base.hostname.endsWith(".localhost");
      const login = dev ? new URL("/_bedrock/dev-login", base) : new URL(`https://auth.${base.hostname.split(".").slice(1).join(".")}/login`);
      login.searchParams.set("return", returnTo);
      return login.href;
    },
    async logout() { await authRequest("/_bedrock/logout", "POST"); },
    release: release.release,
    onRelease: release.onRelease,
    ...storageClient(base, options, () => closed, received, change => { uploads += change; release.check(); }, () => state("offline")),
    query: (name, args) => http("q", name, args),
    mutate(name, args) {
      if (closed) return Promise.reject(new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client."));
      if (polling) return trackedMutation(name, args);
      if (pending.size >= 1000) return Promise.reject(new BedrockError("MUTATION_LIMIT", "Too many pending mutations.", "Wait for earlier mutations to finish."));
      let serialized: unknown;
      try { serialized = wireArgs(args); } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        const id = `m${++sequence}`;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new BedrockError("MUTATION_TIMEOUT", "No mutation result arrived within 30 seconds.", "Check whether the mutation committed before retrying."));
          settled(); release.check();
        }, 30_000);
        pending.set(id, {
          message: { op: "mut", id, mutation: name, args: serialized }, sent: false,
          cancelTimeout: () => clearTimeout(timeout),
          resolve(value) { clearTimeout(timeout); resolve(value); release.check(); },
          reject(error) { clearTimeout(timeout); reject(error); release.check(); },
        });
        if (socket?.readyState === 1) flush(); else connect();
      });
    },
    subscribe(query, args, onData, onError) {
      if (closed) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
      const id = `s${++sequence}`;
      args = wireArgs(args);
      subscriptions.set(id, { query, args, onData, onError });
      restore.subscribe(id);
      if (polling) {
        if (connection.state !== "offline") state("polling");
        void refresh(id, subscriptions.get(id)!).finally(schedulePoll);
        if (!unavailable) connect();
      } else if (socket?.readyState === 1) send({ op: "sub", id, query, args: args ?? null });
      else connect();
      return () => {
        subscriptions.delete(id);
        restore.unsubscribe(id);
        if (socket?.readyState === 1) send({ op: "unsub", id });
        settled();
      };
    },
    close() {
      closed = true;
      release.close(); restore.close();
      browser?.window.removeEventListener("pagehide", hide);
      browser?.window.removeEventListener("pageshow", resume);
      browser?.window.removeEventListener("online", resume);
      browser?.window.removeEventListener("offline", offline);
      browser?.document.removeEventListener("visibilitychange", visible);
      clearTimeout(timer); clearTimeout(pollTimer); clearTimeout(idleTimer);
      listeners.clear(); state("idle");
      subscriptions.clear();
      for (const item of pending.values()) item.reject(disconnected());
      pending.clear();
      socket?.close(1000, "Client closed");
      socket = undefined;
    },
  };
}
