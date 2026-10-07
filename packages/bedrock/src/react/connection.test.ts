import { expect, test } from "bun:test";
import type { Connection } from "../client";
import { watchConnection } from "./connection";

test("useConnection controller reads current state, observes updates and unsubscribes", () => {
  let current: Connection = { state: "idle", since: 1, attempt: 0 };
  const listeners = new Set<(connection: Connection) => void>();
  const states: Connection[] = [];
  const stop = watchConnection({ connection: () => current, onConnection(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; } }, value => states.push(value));
  expect(states).toEqual([current]);
  current = { state: "polling", since: 2, attempt: 1 };
  for (const listener of listeners) listener(current);
  expect(states).toEqual([{ state: "idle", since: 1, attempt: 0 }, current]);
  stop(); expect(listeners.size).toBe(0);
});
