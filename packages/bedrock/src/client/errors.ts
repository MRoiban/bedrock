import type { Browser } from "./browser";
import { cleanEvent, errorEvent, type ErrorEvent } from "../errors/model";
const observed = new WeakSet<object>();
export interface ErrorCaptureOptions {
  console?: boolean;
  fetch?: boolean;
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
}
export function browserErrors(browser: Browser | undefined, base: URL, release: () => string | null, options: false | ErrorCaptureOptions | undefined) {
  const disabled = !browser || options === false || base.origin !== browser.window.location.origin;
  const seen = new WeakSet<object>();
  let queue: ErrorEvent[] = [], minute = 0, count = 0, pause = 0, inflight = false, closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const originalConsole = console.error;
  async function flush(beacon = false) {
    if (closed || inflight && !beacon || !queue.length || Date.now() < pause) return;
    const events = queue.splice(0, 5), body = JSON.stringify({ v: 1, events });
    try { if (beacon && browser?.window.navigator.sendBeacon(new URL("/_bedrock/errors", base).href, body)) return; } catch {}
    if (inflight) return;
    inflight = true;
    try {
      const result = await nativeFetch(new URL("/_bedrock/errors", base), { method: "POST", body, headers: { "content-type": "text/plain" }, credentials: "same-origin", keepalive: true, signal: AbortSignal.timeout(5000) });
      if (result.status === 429) { pause = Date.now() + Math.min(3600, Math.max(1, Number(result.headers.get("retry-after")) || 60)) * 1000; queue = []; }
    } catch { /* Reporting failure must never become another captured exception. */ }
    finally { inflight = false; }
  }
  function capture(error: unknown, mechanism = "manual") {
    if (disabled || closed || Date.now() < pause) return;
    if (error && typeof error === "object") { if (seen.has(error)) return; seen.add(error); }
    const now = Math.floor(Date.now() / 60000);
    if (now !== minute) { minute = now; count = 0; }
    if (count >= 20 || queue.length >= 20) return;
    let event: ErrorEvent | null = errorEvent(error, "browser", mechanism, release() ?? "unknown");
    const ua = browser!.window.navigator.userAgent;
    event.browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "unknown";
    event.bot = /bot|crawler|spider|headless/i.test(ua);
    try { event = options && options.beforeSend ? options.beforeSend(event) : event; } catch { return; }
    event = cleanEvent(event, "browser");
    if (!event || new TextEncoder().encode(JSON.stringify(event)).length > 9000) return;
    count++; queue.push(event);
    if (queue.length >= 5) void flush();
    if (!timer) timer = setTimeout(function tick() { timer = undefined; void flush(); if (queue.length && !closed) timer = setTimeout(tick, 2000); }, 2000);
  }
  const onError = (event: globalThis.ErrorEvent) => {
    if (observed.has(event) || !event.error && !event.message) return;
    observed.add(event);
    if (event.error) capture(event.error, "unhandled-error");
    else {
      const error = new Error(event.message);
      error.stack = event.filename ? `Error\n at ${event.filename}:${event.lineno || 1}:${event.colno || 1}` : "";
      capture(error, "unhandled-error");
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => { if (!observed.has(event)) { observed.add(event); capture(event.reason, "unhandled-rejection"); } };
  const hide = () => { if (browser?.document.hidden) void flush(true); };
  const pagehide = () => { void flush(true); };
  if (!disabled) {
    browser!.window.addEventListener("error", onError);
    browser!.window.addEventListener("unhandledrejection", onRejection);
    browser!.window.addEventListener("pagehide", pagehide);
    browser!.document.addEventListener("visibilitychange", hide);
    if (options?.console) console.error = (...args) => { originalConsole(...args); capture(args.find(arg => arg instanceof Error) ?? (typeof args[0] === "string" ? args[0] : "console.error"), "console"); };
  }
  return {
    capture,
    response(response: Response) { if (options && options.fetch && response.status >= 500) capture(new Error(`Bedrock HTTP ${response.status}`), "fetch"); },
    close() {
      if (disabled) return;
      void flush(true); closed = true; clearTimeout(timer); queue = [];
      browser!.window.removeEventListener("error", onError); browser!.window.removeEventListener("unhandledrejection", onRejection);
      browser!.window.removeEventListener("pagehide", pagehide); browser!.document.removeEventListener("visibilitychange", hide);
      if (options?.console) console.error = originalConsole;
    },
  };
}
