import { expect, test } from "bun:test";
import { FakeClock } from "./browser-fake";
import { httpClient } from "./http";

async function setup(run: (http: ReturnType<typeof httpClient>["http"], clock: FakeClock) => Promise<void>) {
  const original = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const clock = new FakeClock();
  globalThis.setTimeout = clock.setTimeout;
  globalThis.clearTimeout = clock.clearTimeout;
  const client = httpClient(new URL("https://pebble.test"), {}, { closed: () => false, received() {}, offline() {} });
  try { await run(client.http, clock); }
  finally { Object.assign(globalThis, original); }
}
const drain = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };

for (const failure of ["network", "abort", "parse", "body"] as const) {
  test(`HTTP mutation retries ${failure} failures with the same key and increasing delay`, async () => setup(async (http, clock) => {
    const requests: RequestInit[] = [];
    const key = crypto.randomUUID();
    globalThis.fetch = (async (_input: unknown, init: RequestInit) => {
      requests.push(init);
      if (requests.length === 3) return Response.json({ ok: true, value: "saved" });
      if (failure === "network") throw new TypeError("Network lost");
      if (failure === "abort") throw new DOMException("Timed out", "TimeoutError");
      if (failure === "parse") return new Response("{truncated");
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error("Body lost")); } }));
    }) as unknown as typeof fetch;
    const mutation = http("m", "save", { body: "once" }, key);
    await drain(); expect(requests).toHaveLength(1);
    clock.advance(249); await drain(); expect(requests).toHaveLength(1);
    clock.advance(1); await drain(); expect(requests).toHaveLength(2);
    clock.advance(499); await drain(); expect(requests).toHaveLength(2);
    clock.advance(1); expect(await mutation).toBe("saved");
    expect(requests).toHaveLength(3);
    expect(requests.map(init => new Headers(init.headers).get("Idempotency-Key"))).toEqual([key, key, key]);
    expect(requests.map(init => init.body)).toEqual(Array(3).fill('{"body":"once"}'));
    expect(new Set(requests.map(init => init.signal)).size).toBe(3);
    expect(clock.timers.size).toBe(0);
  }));
}

test("HTTP mutation surfaces the final network error after three attempts", async () => setup(async (http, clock) => {
  let attempts = 0;
  globalThis.fetch = (async () => { throw new Error(`Network failure ${++attempts}`); }) as unknown as typeof fetch;
  const mutation = http("m", "save", null, crypto.randomUUID()).catch(error => error);
  await drain(); clock.advance(250); await drain(); clock.advance(500);
  expect(await mutation).toMatchObject({ code: "REQUEST_FAILED", message: "Network failure 3" });
  clock.advance(30_000); expect(attempts).toBe(3);
}));

test("HTTP mutation surfaces the final body error after three attempts", async () => setup(async (http, clock) => {
  let attempts = 0;
  globalThis.fetch = (async () => new Response(new ReadableStream({ start(controller) {
    controller.error(new Error(`Body failure ${++attempts}`));
  } }))) as unknown as typeof fetch;
  const mutation = http("m", "save", null, crypto.randomUUID()).catch(error => error);
  await drain(); clock.advance(250); await drain(); clock.advance(500);
  expect(await mutation).toMatchObject({ code: "REQUEST_FAILED", message: "Body failure 3" });
  expect(attempts).toBe(3); expect(clock.timers.size).toBe(0);
}));

test("HTTP mutation never retries a received error envelope", async () => setup(async (http, clock) => {
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts++;
    return Response.json({ ok: false, error: { code: "PEBBLE_STOPPED", message: "Stopped", hint: "Wait" } }, { status: 503 });
  }) as unknown as typeof fetch;
  await expect(http("m", "save", null, crypto.randomUUID())).rejects.toMatchObject({ code: "PEBBLE_STOPPED", status: 503 });
  clock.advance(30_000); expect(attempts).toBe(1);
}));

for (const kind of ["q", "m"] as const) {
  test(`HTTP ${kind} without a mutation key does not retry`, async () => setup(async (http, clock) => {
    let attempts = 0;
    globalThis.fetch = (async (_input: unknown, init: RequestInit) => {
      attempts++; expect(new Headers(init.headers).has("Idempotency-Key")).toBe(false);
      throw new TypeError("Network lost");
    }) as unknown as typeof fetch;
    await expect(http(kind, "notes", null)).rejects.toMatchObject({ code: "REQUEST_FAILED" });
    clock.advance(30_000); expect(attempts).toBe(1);
  }));
}

test("HTTP mutations do not retry invalid arguments", async () => setup(async (http, clock) => {
  let attempts = 0;
  globalThis.fetch = (async () => { attempts++; return Response.json({ ok: true }); }) as unknown as typeof fetch;
  await expect(http("m", "save", 1n, crypto.randomUUID())).rejects.toMatchObject({ code: "INVALID_ARGS" });
  clock.advance(30_000); expect(attempts).toBe(0);
}));
