import { expect, test } from "bun:test";
import { BedrockError } from "../error";
import { fakeBrowser } from "../client/browser-fake";
import { watchUser, type UserState } from "./user";

const drain = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
const user = { id: "me", name: "Me", email: "me@test" };
const offline = new BedrockError("OFFLINE", "Offline", "Retry.");

test("user retries use bounded backoff, retain identity and reset after success", async () => {
  const env = fakeBrowser();
  const states: UserState[] = [];
  let failure = false, calls = 0;
  const watcher = watchUser(async () => { calls++; if (failure) throw offline; return user; }, state => states.push(state), env.browser);
  await drain(); expect(states.at(-1)).toEqual({ user, isLoading: false, error: undefined });
  failure = true; watcher.retry(); await drain();
  expect(states.at(-1)).toEqual({ user, isLoading: false, error: offline });
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const before = calls;
    env.clock.advance(delay - 1); await drain(); expect(calls).toBe(before);
    env.clock.advance(1); await drain(); expect(calls).toBe(before + 1);
  }
  failure = false; watcher.retry(); await drain(); expect(states.at(-1)?.error).toBeUndefined(); expect(env.clock.timers.size).toBe(0);
  failure = true; watcher.retry(); await drain(); expect([...env.clock.timers.values()][0]?.delay).toBe(1000);
  watcher.close(); expect(env.clock.timers.size).toBe(0); expect(env.window.listenerCount() + env.document.listenerCount()).toBe(0);
});

test("first user error ends loading, online and visible retry immediately, null is definitive", async () => {
  const env = fakeBrowser();
  let calls = 0, failure = true;
  const states: UserState[] = [];
  const watcher = watchUser(async () => { calls++; if (failure) throw offline; return null; }, state => states.push(state), env.browser);
  await drain(); expect(states.at(-1)).toEqual({ user: null, isLoading: false, error: offline });
  env.window.emit("online"); await drain(); expect(calls).toBe(2);
  env.document.hidden = true; env.document.emit("visibilitychange"); await drain(); expect(calls).toBe(2);
  failure = false; env.document.hidden = false; env.document.emit("visibilitychange"); await drain(); expect(calls).toBe(3);
  expect(states.at(-1)).toEqual({ user: null, isLoading: false, error: undefined }); watcher.close();
});

test("user retry queues one immediate attempt while a request is in flight and cleanup ignores late answers", async () => {
  let resolve!: (value: typeof user | null) => void;
  let calls = 0;
  const states: UserState[] = [];
  const watcher = watchUser(() => { calls++; return new Promise(done => { resolve = done; }); }, state => states.push(state));
  watcher.retry(); watcher.retry(); expect(calls).toBe(1);
  resolve(user); await drain(); expect(calls).toBe(2);
  watcher.close(); resolve(null); await drain(); expect(states).toHaveLength(1);
});
