import { AsyncLocalStorage } from "node:async_hooks";
import { BedrockError } from "../error";

export interface SlotOptions {
  pebble: string;
  /** Warn when one slot holds the write queue longer than this. */
  slowMs: number;
  /** Throw NETWORK_IN_SLOT for fetch calls made inside a slot. */
  strict: boolean;
  /** After a slow-slot warning, further slow slots of the same name are summarized once per window. */
  windowMs?: number;
}

export interface SlotInfo { kind: string; name: string }

interface SlotState { strict: boolean; open: boolean; commitMs: number }

// Shared through a global symbol so duplicate copies of this module (linked
// pebbles can load their own bedrock) still wrap fetch once and agree on slots.
interface SlotGlobals { slots: AsyncLocalStorage<SlotState>; fetch?: typeof fetch }
const key = Symbol.for("bedrock.slots");
const shared = ((globalThis as any)[key] ??= { slots: new AsyncLocalStorage<SlotState>() }) as SlotGlobals;

const DEFAULT_SLOW_MS = 200;
const SLOW_HINT = "Move slow work to a service, a detached route, or job(..., { transaction: false }), and keep only the database part in ctx.read/ctx.write.";
const COMMIT_HINT = "Most of it was the commit waiting on the disk; batch writes into fewer slots or keep pebble data on a faster disk.";
const WINDOW_MS = 60000;
// One noisy handler must not bury every other log line, so repeats are counted per window.
const repeats = new Map<string, { count: number; max: number }>();

/** Called right after COMMIT so the warning can tell disk time from handler time. */
export function recordCommit(ms: number) {
  const state = shared.slots.getStore();
  if (state) state.commitMs += ms;
}

function warnSlow(options: SlotOptions, info: SlotInfo, elapsed: number, commitMs: number) {
  const key = `${options.pebble}\0${info.kind}\0${info.name}`;
  const label = `[${options.pebble}] Slow slot: ${info.kind} ${JSON.stringify(info.name)}`;
  const repeat = repeats.get(key);
  if (repeat) { repeat.count++; repeat.max = Math.max(repeat.max, elapsed); return; }
  const commit = commitMs >= elapsed / 2 ? ` (commit ${commitMs} ms)` : "";
  console.warn(`${label} held the write queue for ${elapsed} ms${commit} (BEDROCK_SLOW_SLOT_MS=${options.slowMs}). ${commit ? COMMIT_HINT : SLOW_HINT}`);
  repeats.set(key, { count: 0, max: 0 });
  setTimeout(() => {
    const summary = repeats.get(key)!;
    repeats.delete(key);
    if (summary.count) console.warn(`${label} was slow ${summary.count} more time(s) in the last ${Math.round((options.windowMs ?? WINDOW_MS) / 1000)} s (max ${summary.max} ms).`);
  }, options.windowMs ?? WINDOW_MS).unref();
}

export function slotOptions(pebble: string, strict: boolean, env: Record<string, string | undefined> = process.env): SlotOptions {
  const raw = env.BEDROCK_SLOW_SLOT_MS?.trim();
  const slowMs = raw ? Number(raw) : DEFAULT_SLOW_MS;
  if (!Number.isFinite(slowMs) || slowMs < 0) throw new BedrockError("INVALID_SLOW_SLOT_MS", `BEDROCK_SLOW_SLOT_MS must be a non-negative number of milliseconds, got ${JSON.stringify(raw)}.`, `Unset it to use the ${DEFAULT_SLOW_MS} ms default, or set a number such as 500.`);
  if (strict) guardFetch();
  return { pebble, slowMs, strict };
}

/** Production enables strict slots only on request; dev always does. */
export function strictSlotsFromEnv(env: Record<string, string | undefined> = process.env) {
  return env.BEDROCK_DEV === "1" || env.BEDROCK_STRICT_SLOTS === "1";
}

export function slotInfo(kind: "query" | "mutation", name: string, internal: boolean, label?: string): SlotInfo {
  if (!internal) return { kind, name };
  const mode = kind === "query" ? "read" : "write";
  if (name === "detached" || name === "storage") return { kind: `${name} ${mode}`, name: label ?? name };
  return { kind: name, name: label ?? name };
}

export async function runSlot<T>(options: SlotOptions, info: SlotInfo, run: () => Promise<T>): Promise<T> {
  const state: SlotState = { strict: options.strict, open: true, commitMs: 0 };
  const started = performance.now();
  try { return await shared.slots.run(state, run); }
  finally {
    // Work the handler left running after the slot is outside the queue.
    state.open = false;
    const elapsed = Math.round(performance.now() - started);
    if (elapsed > options.slowMs) warnSlow(options, info, elapsed, Math.round(state.commitMs));
  }
}

function guardFetch() {
  if (shared.fetch) return;
  const original = shared.fetch = globalThis.fetch;
  const guarded = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const slot = shared.slots.getStore();
    // Thrown synchronously so even an unawaited fetch fails the slot.
    if (slot?.strict && slot.open) throw new BedrockError("NETWORK_IN_SLOT", "fetch() was called inside a query, mutation, job, or route slot, which would block every other write to this pebble.",
      "Move the fetch to a detached route or a service, then use ctx.read/ctx.write only for the database part.");
    return original(input, init);
  }) as typeof fetch;
  globalThis.fetch = Object.assign(guarded, { preconnect: original.preconnect });
}
