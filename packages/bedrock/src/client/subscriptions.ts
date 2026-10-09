import { asBedrockError, type BedrockError } from "../error";
import type { Browser } from "./browser";

export interface Subscription {
  lastJson?: string;
  errorCode?: string | undefined;
  query: string;
  args: unknown;
  onData: (data: any) => void;
  onError?: ((error: BedrockError) => void) | undefined;
}

export function subscriptionStore(browser: Browser | undefined, pollInterval: number, hooks: {
  closed: () => boolean;
  suspended: () => boolean;
  polling: () => boolean;
  query: (name: string, args: unknown) => Promise<any>;
  data: (id: string) => void;
}) {
  const subscriptions = new Map<string, Subscription>();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let ticking = false;
  async function refresh(id: string, sub: Subscription) {
    try {
      const value = await hooks.query(sub.query, sub.args);
      if (subscriptions.get(id) !== sub || hooks.closed()) return;
      sub.errorCode = undefined;
      const json = JSON.stringify(value);
      if (json !== sub.lastJson) { sub.lastJson = json; delivered(id, value); }
    } catch (error) {
      const typed = asBedrockError(error);
      if (subscriptions.get(id) !== sub || hooks.closed()) return;
      if (sub.errorCode !== typed.code) { sub.errorCode = typed.code; sub.onError?.(typed); }
    }
  }
  async function refreshAll() { await Promise.allSettled([...subscriptions].map(([id, sub]) => refresh(id, sub))); }
  function schedulePoll() {
    clearTimeout(pollTimer); pollTimer = undefined;
    if (hooks.closed() || hooks.suspended() || !hooks.polling() || !subscriptions.size || pollInterval <= 0 || browser?.document.hidden || ticking) return;
    pollTimer = setTimeout(() => { pollTimer = undefined; void poll(); }, pollInterval);
  }
  async function poll() {
    if (ticking || hooks.closed() || hooks.suspended() || !hooks.polling() || browser?.document.hidden) return;
    ticking = true;
    try { for (const [id, sub] of subscriptions) { if (!hooks.polling() || hooks.closed() || browser?.document.hidden) break; await refresh(id, sub); } }
    finally { ticking = false; schedulePoll(); }
  }
  function delivered(id: string, value: unknown) {
    const sub = subscriptions.get(id);
    if (!sub) return;
    sub.onData(value);
    hooks.data(id);
  }
  function stopPoll() { clearTimeout(pollTimer); pollTimer = undefined; }
  function report(error: BedrockError) {
    for (const sub of subscriptions.values()) {
      if (sub.errorCode !== error.code) { sub.errorCode = error.code; sub.onError?.(error); }
    }
  }
  function socketData(id: string, value: unknown) {
    const sub = subscriptions.get(id);
    if (sub) { sub.lastJson = JSON.stringify(value); sub.errorCode = undefined; }
    delivered(id, value);
  }
  return { entries: subscriptions, refresh, refreshAll, schedulePoll, poll, stopPoll, report, socketData };
}
