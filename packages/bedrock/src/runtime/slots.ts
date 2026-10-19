import { AsyncLocalStorage } from "node:async_hooks";
import { BedrockError } from "../error";

export interface SlotOptions {
  pebble: string;
  /** Warn when one slot holds the write queue longer than this. */
  slowMs: number;
  /** Throw NETWORK_IN_SLOT for fetch calls made inside a slot. */
  strict: boolean;
}

export interface SlotInfo { kind: string; name: string }

interface SlotState { strict: boolean; open: boolean }

// Shared through a global symbol so duplicate copies of this module (linked
// pebbles can load their own bedrock) still wrap fetch once and agree on slots.
interface SlotGlobals { slots: AsyncLocalStorage<SlotState>; fetch?: typeof fetch }
const key = Symbol.for("bedrock.slots");
const shared = ((globalThis as any)[key] ??= { slots: new AsyncLocalStorage<SlotState>() }) as SlotGlobals;

const DEFAULT_SLOW_MS = 200;
const SLOW_HINT = "Move slow work to a service, a detached route, or job(..., { transaction: false }), and keep only the database part in ctx.read/ctx.write.";

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
  const state: SlotState = { strict: options.strict, open: true };
  const started = performance.now();
  try { return await shared.slots.run(state, run); }
  finally {
    // Work the handler left running after the slot is outside the queue.
    state.open = false;
    const elapsed = Math.round(performance.now() - started);
    if (elapsed > options.slowMs) console.warn(`[${options.pebble}] Slow slot: ${info.kind} ${JSON.stringify(info.name)} held the write queue for ${elapsed} ms (BEDROCK_SLOW_SLOT_MS=${options.slowMs}). ${SLOW_HINT}`);
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
