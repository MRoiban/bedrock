import { expect, test } from "bun:test";
import * as React from "react";
import { remoteError } from "../client/wire";
import { useMutation, useQuery } from "./index";

// Bedrock has no DOM renderer; a minimal hook dispatcher runs the real hooks once with their effects.
function renderHook<T>(client: unknown, hook: () => T) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const slots: unknown[] = [];
  let index = 0;
  const effects: (() => unknown)[] = [];
  const dispatcher = {
    useContext: () => client,
    useRef: (current: unknown) => (slots[index] ??= { current }, slots[index++]),
    useEffect: (effect: () => unknown) => { effects.push(effect); },
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], (next: unknown) => { slots[slot] = typeof next === "function" ? next(slots[slot]) : next; }];
    },
  };
  const render = () => {
    const previous = internals.H;
    internals.H = dispatcher; index = 0;
    try { return hook(); } finally { internals.H = previous; }
  };
  render();
  for (const effect of effects.splice(0)) effect();
  return render;
}

const conflict = () => remoteError({ code: "TIME_CONFLICT", message: "Ambiguous.", hint: "Choose.", data: { candidates: ["early", "late"] } }, 409);

test("hook errors expose structured data and status", async () => {
  const client = {
    connection: () => "online", onConnection: () => () => {},
    subscribe: (_name: string, _args: unknown, _data: unknown, onError: (error: unknown) => void) => { onError(conflict()); return () => {}; },
    mutate: async () => { throw conflict(); },
  };
  const query = renderHook(client, () => useQuery("ambiguous" as never, undefined as never));
  expect(query().error).toMatchObject({ code: "TIME_CONFLICT", status: 409, data: { candidates: ["early", "late"] } });
  const mutation = renderHook(client, () => useMutation("schedule" as never));
  await expect(mutation().mutate(undefined as never)).rejects.toMatchObject({ status: 409 });
  expect(mutation().error).toMatchObject({ code: "TIME_CONFLICT", status: 409, data: { candidates: ["early", "late"] } });
});
