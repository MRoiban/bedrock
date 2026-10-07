import { expect, test } from "bun:test";
import { releaseTracker } from "./release";
import { fakeBrowser } from "./browser-fake";

test("release uses navigation timing or first observation, and ignores absent identity", () => {
  const env = fakeBrowser("page");
  const tracker = releaseTracker({ autoReload: false }, env.browser, () => false);
  expect(tracker.release()).toEqual({ page: "page", server: null, stale: false });
  tracker.observe(null); tracker.observe(5); tracker.observe("");
  expect(tracker.release().stale).toBe(false);
  const changes: unknown[] = [];
  const unsubscribe = tracker.onRelease(value => changes.push(value));
  tracker.observe("server");
  expect(tracker.release()).toEqual({ page: "page", server: "server", stale: true });
  tracker.observe(undefined);
  expect(tracker.release().stale).toBe(true);
  unsubscribe(); tracker.observe("page");
  expect(changes).toHaveLength(1);
  expect(tracker.release().stale).toBe(false);
  tracker.close();
  const first = releaseTracker({ autoReload: false }, fakeBrowser().browser, () => false);
  expect(first.release()).toEqual({ page: null, server: null, stale: false });
  first.observe("first"); expect(first.release()).toEqual({ page: "first", server: "first", stale: false });
  first.observe("second"); expect(first.release().stale).toBe(true);
  first.close();
});

test("safe reload waits for work and editable focus, accepts hidden tabs, and rechecks veto", () => {
  const env = fakeBrowser("old");
  let busy = true, veto = true, asks = 0;
  const tracker = releaseTracker({ beforeReload: () => { asks++; return !veto; } }, env.browser, () => busy);
  tracker.observe("new"); expect(env.reloads()).toBe(0);
  busy = false; env.document.activeElement = { closest: () => ({}) };
  tracker.check(); expect(asks).toBe(0);
  env.document.hidden = true; env.document.emit("visibilitychange");
  expect(asks).toBe(1); expect(env.reloads()).toBe(0);
  veto = false; env.document.emit("focusout"); env.clock.advance(0);
  expect(asks).toBe(2); expect(env.reloads()).toBe(1);
  expect(env.values.has("bedrock:restore")).toBe(true);
  tracker.check(); expect(env.reloads()).toBe(1);
  tracker.close(); expect(env.document.listenerCount()).toBe(0);
});

test("reload throttle survives a new client and expires at ten seconds", () => {
  const env = fakeBrowser("old");
  let tracker = releaseTracker({}, env.browser, () => false);
  tracker.observe("new"); expect(env.reloads()).toBe(1); tracker.close();
  env.clock.advance(100);
  tracker = releaseTracker({}, env.browser, () => false);
  tracker.observe("new"); expect(env.reloads()).toBe(1);
  env.clock.advance(9899); expect(env.reloads()).toBe(1);
  env.clock.advance(1); expect(env.reloads()).toBe(2);
  tracker.close();
});

test("token, disabled, non-browser, and unavailable storage never auto-reload", () => {
  for (const options of [{ token: "brk_test" }, { autoReload: false }]) {
    const env = fakeBrowser("old");
    const tracker = releaseTracker(options, env.browser, () => false);
    tracker.observe("new"); expect(env.reloads()).toBe(0); tracker.close();
  }
  const tracker = releaseTracker({}, undefined, () => false);
  tracker.observe("old"); tracker.observe("new"); expect(tracker.release().stale).toBe(true); tracker.close();
  const env = fakeBrowser("old");
  env.browser.storage.getItem = () => { throw new Error("Storage blocked"); };
  const blocked = releaseTracker({}, env.browser, () => false);
  blocked.observe("new"); expect(env.reloads()).toBe(0); blocked.close();
});

test("focusout rechecks after focus moves away from the old field", () => {
  const env = fakeBrowser("old");
  env.document.activeElement = { closest: () => ({}) };
  const tracker = releaseTracker({}, env.browser, () => false);
  tracker.observe("new"); env.document.emit("focusout");
  env.document.activeElement = null;
  env.clock.advance(0); expect(env.reloads()).toBe(1); tracker.close();
});

test("dirty application state can veto reload indefinitely even while hidden", () => {
  const env = fakeBrowser("old");
  env.document.hidden = true;
  let dirty = true;
  const tracker = releaseTracker({ beforeReload: () => !dirty }, env.browser, () => false);
  tracker.observe("new");
  for (let day = 0; day < 365; day++) {
    env.clock.advance(86400000);
    env.document.emit("visibilitychange");
    tracker.check();
  }
  expect(env.reloads()).toBe(0);
  expect(env.values.has("bedrock:reload")).toBe(false);
  dirty = false;
  tracker.check(); expect(env.reloads()).toBe(1);
  tracker.close();
});
