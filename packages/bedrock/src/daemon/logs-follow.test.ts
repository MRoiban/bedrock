import { expect, test } from "bun:test";
import { join } from "node:path";
import { PebbleLogs } from "./logs";
import { TelemetryStore } from "./telemetry/store";
import type { Telemetry } from "./telemetry";
import type { Query, Record } from "./telemetry/model";
import { tempDirectory } from "../../test/helpers";

for (const [historyFails, snapshotAtCutoff] of [[false, true], [false, false], [true, false]]) test(`follow subscribes before delayed history, without gaps or duplicates (failure=${historyFails}, snapshot=${snapshotAtCutoff})`, async () => {
  const temp = tempDirectory(), store = new TelemetryStore(join(temp.dir, "observability.sqlite"));
  const now = Date.now();
  let sequence = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const records: Record[] = [];
  const adapter = {
    log: (pebble: string, text: string, stream: string, run: string) => {
      records.push({ kind: "logs", pebble, text, stream, run, time: now, boot: "test", sequence: ++sequence }); return text;
    },
    logWatermark: () => ({ boot: "test", sequence }),
    query: async (query: Query) => {
      const snapshot = [...records];
      await gate;
      if (historyFails) throw new Error("storage unavailable");
      store.write(snapshotAtCutoff ? snapshot : records, now);
      return store.query(query);
    },
  } as unknown as Telemetry;
  const logs = new PebbleLogs(temp.dir, "test", undefined, undefined, undefined, undefined, undefined, () => now, { store: adapter, name: "test" });
  const write = (text: string) => logs.write(new TextEncoder().encode(text + "\n"));
  try {
    write("before history");
    const abort = new AbortController(), responsePromise = logs.response(true, abort.signal);
    // All lines share a millisecond: timestamp-only deduplication would lose or repeat these.
    write("between cutoff and subscription"); write("between cutoff and subscription");
    release();
    const response = await responsePromise;
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let text = "";
    const expected = historyFails ? 2 : 3;
    while (text.split("\n").length - 1 < expected) text += decoder.decode((await reader.read()).value);
    write("after history");
    text += decoder.decode((await reader.read()).value);
    abort.abort(); expect((await reader.read()).done).toBe(true);
    expect(text.split("\n").filter(Boolean).map(line => line.slice(25))).toEqual([
      ...historyFails ? [] : ["before history"], "between cutoff and subscription", "between cutoff and subscription", "after history",
    ]);
  } finally { release(); logs.close(); store.close(); temp.cleanup(); }
});

test("follow closes a bounded initialization buffer and removes its listener", async () => {
  const temp = tempDirectory();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const adapter = { log: (_: string, text: string) => text, logWatermark: () => ({ boot: "test", sequence: 0 }), query: async () => { await gate; return { rows: [] }; } } as unknown as Telemetry;
  const logs = new PebbleLogs(temp.dir, "test", undefined, undefined, undefined, undefined, undefined, undefined, { store: adapter, name: "test" });
  try {
    const response = await logs.response(true, new AbortController().signal);
    for (let i = 0; i < 80; i++) logs.write(new TextEncoder().encode("x".repeat(16384) + "\n"));
    release();
    expect(await response.text()).toBe("");
    logs.write(new TextEncoder().encode("after close\n"));
  } finally { release(); logs.close(); temp.cleanup(); }
});
