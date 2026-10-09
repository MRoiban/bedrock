import { expect, test } from "bun:test";
import { initialTransport, isPolling, socketOf, transition } from "./connection-state";

const socket = { readyState: 1 } as WebSocket;

test("temporary HTTP freshness survives retries until a socket opens", () => {
  let state = initialTransport(false, false);
  state = transition(state, { type: "fallback", permanent: false }, false);
  state = transition(state, { type: "retry", restarting: false }, false);
  state = transition(state, { type: "connect" }, false);
  state = transition(state, { type: "socket", socket }, false);
  expect(state.phase.kind).toBe("opening");
  expect(isPolling(state)).toBe(true);
  expect(state.connection).toMatchObject({ state: "polling", attempt: 1 });
  state = transition(state, { type: "open", socket }, false);
  expect(state.phase.kind).toBe("live");
  expect(isPolling(state)).toBe(false);
  expect(state.connection).toMatchObject({ state: "live", attempt: 0 });
});

test("1012 preserves failure count and unchanged reports preserve since", () => {
  let state = initialTransport(false, false);
  state = transition(state, { type: "retry", restarting: false }, false);
  const since = state.connection.since;
  state = transition(state, { type: "retry", restarting: true }, false);
  expect(state.connection).toEqual({ state: "reconnecting", attempt: 1, since });
  state = transition(state, { type: "retry", restarting: false }, false);
  expect(state.connection).toEqual({ state: "reconnecting", attempt: 2, since });
});

test("offline reports keep the socket and browser health gates response recovery", () => {
  let state = transition(initialTransport(false, false), { type: "open", socket }, false);
  state = transition(state, { type: "offline" }, false);
  expect(socketOf(state)).toBe(socket);
  state = transition(state, { type: "response", busy: true }, true);
  expect(state.connection.state).toBe("offline");
  state = transition(state, { type: "response", busy: true }, false);
  expect(state.connection.state).toBe("live");
});

test("late probe completion cannot detach a socket created after resume", () => {
  let state = transition(initialTransport(false, false), { type: "probe" }, false);
  const generation = state.generation;
  state = transition(state, { type: "hide" }, false);
  expect(state.lifecycle).toBe("suspended");
  expect(state.generation).toBeGreaterThan(generation);
  state = transition(state, { type: "resume" }, false);
  state = transition(state, { type: "socket", socket }, false);
  state = transition(state, { type: "probed", generation }, false);
  expect(state.phase.kind).toBe("opening");
  expect(socketOf(state)).toBe(socket);
});

test("idle linger keeps permanent HTTP choice but resets socket attempt history", () => {
  let state = initialTransport(false, false);
  state = transition(state, { type: "connect" }, false);
  state = transition(state, { type: "refused" }, false);
  state = transition(state, { type: "retry", restarting: false }, false);
  state = transition(state, { type: "fallback", permanent: true }, false);
  state = transition(state, { type: "idle" }, false);
  expect(state.freshness).toBe("permanent");
  expect(state.attempted).toBe(false);
  expect(state.refused).toBe(0);
  expect(state.connection).toMatchObject({ state: "idle", attempt: 0 });
});

test("auth denial stops temporary polling and HTTP errors still recover offline", () => {
  let state = transition(initialTransport(false, false), { type: "fallback", permanent: false }, false);
  state = transition(state, { type: "denied" }, false);
  expect(isPolling(state)).toBe(false);
  expect(state.connection.state).toBe("reconnecting");
  state = transition(state, { type: "offline" }, false);
  state = transition(state, { type: "response", busy: true }, false);
  expect(state.connection.state).toBe("reconnecting");
});

test("closed clients retain idle reports despite late network failures", () => {
  let state = transition(initialTransport(false, false), { type: "open", socket }, false);
  state = transition(state, { type: "close" }, true);
  state = transition(state, { type: "offline" }, false);
  expect(state.lifecycle).toBe("closed");
  expect(state.phase.kind).toBe("idle");
  expect(state.connection.state).toBe("idle");
});
