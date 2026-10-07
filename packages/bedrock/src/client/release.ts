import type { Browser } from "./browser";
import type { ClientOptions } from "./types";
import { savePlace } from "./restore";

export interface Release { page: string | null; server: string | null; stale: boolean }
const RELOAD_KEY = "bedrock:reload";
export function releaseTracker(options: ClientOptions, browser: Browser | undefined, busy: () => boolean) {
  const navigation = browser?.window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  let page = navigation?.serverTiming?.find(entry => entry.name === "bedrock-release")?.description || null;
  let state: Release = { page, server: null, stale: false };
  const listeners = new Set<(release: Release) => void>();
  let closed = false, reloading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  function check() {
    if (closed || reloading || !browser || options.token || options.autoReload === false || !state.stale || busy()) return;
    const { window, document, storage, now } = browser;
    if (!document.hidden && document.activeElement?.closest('input, textarea, select, [contenteditable]')) return;
    try {
      const last = storage.getItem(RELOAD_KEY);
      const remaining = last === null ? 0 : 10_000 - (now() - Number(last));
      if (remaining > 0) {
        if (!timer) timer = browser.setTimeout(() => { timer = undefined; check(); }, remaining);
        return;
      }
      if (options.beforeReload?.() === false || closed || busy()) return;
      // Persisting the guard is necessary to avoid a reload loop across page loads.
      storage.setItem(RELOAD_KEY, String(now()));
      savePlace(browser);
      reloading = true;
      window.location.reload();
    } catch { /* A blocked storage API or veto callback must not cause a reload loop. */ }
  }
  function observe(release: unknown) {
    if (closed || typeof release !== "string" || !release) return;
    page ??= release;
    if (state.page !== page || state.server !== release) {
      state = { page, server: release, stale: page !== release };
      for (const listener of listeners) listener({ ...state });
    }
    check();
  }
  function focusout() {
    if (!browser || closed) return;
    if (focusTimer) browser.clearTimeout(focusTimer);
    // Focus may still refer to the old field during focusout dispatch.
    focusTimer = browser.setTimeout(() => { focusTimer = undefined; check(); }, 0);
  }
  browser?.document.addEventListener("focusout", focusout);
  browser?.document.addEventListener("visibilitychange", check);
  return {
    observe, check,
    release: () => ({ ...state }),
    onRelease(fn: (release: Release) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    close() {
      closed = true;
      if (timer) browser?.clearTimeout(timer);
      if (focusTimer) browser?.clearTimeout(focusTimer);
      listeners.clear();
      browser?.document.removeEventListener("focusout", focusout);
      browser?.document.removeEventListener("visibilitychange", check);
    },
  };
}
