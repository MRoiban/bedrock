import type { Browser } from "./browser";
import type { ClientOptions, Connection } from "./types";
import { initialTransport, isPolling, socketOf, transition, type TransportEvent } from "./connection-state";
import { remoteError } from "./wire";
import type { BedrockError } from "../error";

interface TransportHooks {
  busy: () => boolean;
  quiet: () => boolean;
  request: (path: string, init: RequestInit) => Promise<Response>;
  stopPoll: () => void;
  poll: () => Promise<void>;
  fallback: () => void;
  report: (error: BedrockError) => void;
  rejectSent: () => void;
  opened: (send: (message: object) => void) => void;
  message: (data: unknown, ws: WebSocket) => void;
  checkRelease: () => void;
}
export function clientTransport(base: URL, options: ClientOptions, browser: Browser | undefined, hooks: TransportHooks) {
  const browserOffline = () => browser?.window.navigator?.onLine === false;
  const permanent = (!!options.token && typeof Bun === "undefined") || options.sync === false || typeof WebSocket === "undefined";
  let current = initialTransport(permanent, browserOffline());
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(connection: Connection) => void>();
  const closed = () => current.lifecycle === "closed";
  const suspended = () => current.lifecycle === "suspended";
  const polling = () => isPolling(current);
  const unavailable = () => current.freshness === "permanent";
  const socket = () => socketOf(current);
  function dispatch(event: TransportEvent) {
    const previous = current.connection.state;
    current = transition(current, event, browserOffline());
    if (current.connection.state !== previous) for (const fn of listeners) fn(current.connection);
  }
  function cancelBackoff() {
    if (current.phase.kind === "backoff") clearTimeout(current.phase.timer);
  }
  // React may replace a subscription during a render; keep its socket briefly.
  function settled() {
    clearTimeout(idleTimer); idleTimer = undefined;
    if (!hooks.quiet() || closed()) return;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (!hooks.quiet() || closed()) return;
      cancelBackoff(); hooks.stopPoll();
      const ws = socket();
      // Detach before closing so an old socket cannot schedule another retry.
      dispatch({ type: "disconnect" }); ws?.close();
      dispatch({ type: "idle" });
    }, 1000);
  }
  function send(message: object) { socket()!.send(JSON.stringify(message)); }
  function fallback(permanent = false) {
    const starting = !polling();
    dispatch({ type: "fallback", permanent });
    hooks.fallback();
    if (starting) void hooks.poll();
  }
  function reconnect(restarting = false) {
    if (suspended() || closed() || !hooks.busy() || unavailable()) return;
    const delay = restarting ? 100 + Math.random() * 900 : Math.min(30_000, 250 * 2 ** Math.min(current.attempt, 7) * (0.75 + Math.random() * 0.5));
    dispatch({ type: "retry", restarting });
    const timer = setTimeout(() => { dispatch({ type: "disconnect" }); connect(); }, delay);
    dispatch({ type: "backoff", timer });
  }
  const validProbe = (generation: number) => !closed() && !suspended() && generation === current.generation;
  async function discover() {
    dispatch({ type: "probe" });
    const generation = current.generation;
    try {
      const response = await hooks.request("/_bedrock/ws", { signal: AbortSignal.timeout(5000) });
      if (!validProbe(generation) || hooks.quiet()) return;
      // Repeated refusal despite enabled sync needs HTTP freshness while retrying.
      if (response.status === 426) { if (current.refused >= 2 && !polling()) fallback(); }
      else {
        const body = await response.json().catch(() => null);
        if (!validProbe(generation)) return;
        if (response.status === 404 && body?.error?.code === "NOT_FOUND") { fallback(true); return; }
        if (response.status === 401 || response.status === 403) {
          hooks.stopPoll(); dispatch({ type: "denied" });
          hooks.report(remoteError(body?.error));
        } else fallback();
      }
    } catch {
      if (validProbe(generation) && !hooks.quiet()) { fallback(); dispatch({ type: "offline" }); }
    } finally { dispatch({ type: "probed", generation }); }
    if (generation === current.generation) reconnect();
  }
  function connect() {
    if (closed() || suspended() || unavailable() || current.phase.kind === "probing" || socket() || current.phase.kind === "backoff") return;
    dispatch({ type: "connect" });
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
    dispatch({ type: "socket", socket: ws });
    const timeout = setTimeout(() => ws.close(), 5000);
    ws.onopen = () => {
      clearTimeout(timeout);
      if (closed() || socket() !== ws) { ws.close(); return; }
      hooks.stopPoll();
      dispatch({ type: "open", socket: ws });
      hooks.opened(send);
    };
    ws.onmessage = event => {
      if (closed() || socket() !== ws) return;
      hooks.message(event.data, ws);
    };
    ws.onerror = () => {};
    ws.onclose = event => {
      clearTimeout(timeout);
      if (socket() !== ws) return;
      const opened = current.phase.kind === "live";
      dispatch({ type: "disconnect" });
      hooks.rejectSent();
      settled();
      if (closed() || suspended() || !hooks.busy()) return;
      if (event.code === 1012) { reconnect(true); return; }
      if (!opened) { dispatch({ type: "refused" }); void discover(); return; }
      reconnect();
    };
  }
  function hide() {
    const ws = socket();
    cancelBackoff(); hooks.stopPoll();
    // Reject sent work before publishing reconnecting, as on ordinary disconnect.
    dispatch({ type: "hide" });
    ws?.close(1000, "Page hidden");
    hooks.rejectSent();
    dispatch({ type: "hidden", busy: hooks.busy() });
    settled();
  }
  function resume() {
    if (closed()) return;
    cancelBackoff(); dispatch({ type: "resume" });
    if (hooks.busy()) {
      if (polling()) { dispatch({ type: "polling" }); if ((options.pollInterval ?? 5000) > 0) void hooks.poll(); }
      connect();
    }
    // An offline browser event need not have closed an otherwise healthy socket.
    if (socket()?.readyState === 1) dispatch({ type: "survived" });
    hooks.checkRelease();
  }
  function visible() { if (!browser?.document.hidden) resume(); else hooks.stopPoll(); }
  function offline() { dispatch({ type: "offline" }); }
  browser?.window.addEventListener("offline", offline);
  browser?.window.addEventListener("pagehide", hide);
  browser?.window.addEventListener("pageshow", resume);
  browser?.window.addEventListener("online", resume);
  browser?.document.addEventListener("visibilitychange", visible);
  function close() {
    browser?.window.removeEventListener("pagehide", hide);
    browser?.window.removeEventListener("pageshow", resume);
    browser?.window.removeEventListener("online", resume);
    browser?.window.removeEventListener("offline", offline);
    browser?.document.removeEventListener("visibilitychange", visible);
    cancelBackoff(); hooks.stopPoll(); clearTimeout(idleTimer);
    const ws = socket();
    listeners.clear(); dispatch({ type: "close" });
    return ws;
  }
  return {
    closed, suspended, polling, unavailable, socket, send, connect, settled, offline, close,
    connection: () => current.connection,
    onConnection(fn: (connection: Connection) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    received() { dispatch({ type: "response", busy: hooks.busy() }); },
    httpMutation() { if (!socket()) dispatch({ type: "polling" }); },
    subscription() { dispatch({ type: "polling" }); },
  };
}
