import { expect, test } from "bun:test";
import { createServices, SERVICE_STOP_TIMEOUT } from "./services";

test("service shutdown shares a bounded deadline and still invokes later stop handlers", async () => {
  const stopped: string[] = [];
  const services = createServices({
    first: { start: () => 1, stop() { stopped.push("first"); } },
    stuck: { start: () => 2, stop() { stopped.push("stuck"); return new Promise<void>(() => {}); } },
  });
  await services.start({ pebble: { name: "bounded" }, dataDir: "/unused", read: async () => { throw new Error("Unused test slot"); }, write: async () => { throw new Error("Unused test slot"); }, log() {} });
  const start = Date.now();
  await services.stop();
  expect(Date.now() - start).toBeLessThan(SERVICE_STOP_TIMEOUT + 500);
  expect(stopped).toEqual(["stuck", "first"]);
  await services.stop(); expect(stopped).toEqual(["stuck", "first"]);
});

test("service stop budgets share the maximum declaration, retain the default, and cap at 30 seconds", () => {
  expect(createServices({}).stopTimeout).toBe(2000);
  expect(createServices({ short: { stopTimeout: 100, start() {} } }).stopTimeout).toBe(2000);
  expect(createServices({ a: { stopTimeout: 5000, start() {} }, b: { stopTimeout: 7000, start() {} } }).stopTimeout).toBe(7000);
  expect(createServices({ long: { stopTimeout: 60000, start() {} } }).stopTimeout).toBe(30000);
});

const ctx = { pebble: { name: "exclusive" }, dataDir: "/unused", read: async () => { throw new Error("Unused test slot"); }, write: async () => { throw new Error("Unused test slot"); }, log() {} };

test("exclusive services are guarded, start last once, and stop in reverse actual-start order", async () => {
  const events: string[] = [];
  const definition = (name: string, exclusive = false) => ({ exclusive, async start() { events.push(`start ${name}`); await Bun.sleep(1); return name; }, stop() { events.push(`stop ${name}`); } });
  const services = createServices({ a: definition("a", true), b: definition("b"), c: definition("c", true), d: definition("d") });
  await services.start(ctx);
  expect(events).toEqual(["start b", "start d"]);
  expect(() => services.values.a).toThrow(expect.objectContaining({ code: "SERVICE_NOT_STARTED", hint: expect.stringContaining("Retry shortly") }));
  const first = services.startExclusive(ctx);
  expect(services.startExclusive(ctx)).toBe(first);
  expect(await first).toEqual({ started: ["a", "c"] });
  expect(services.values.a).toBe("a");
  await services.startExclusive(ctx);
  await services.stop();
  expect(events).toEqual(["start b", "start d", "start a", "start c", "stop c", "stop a", "stop d", "stop b"]);
});

test("failed exclusive startup unwinds only exclusive services and stays failed on retry", async () => {
  const events: string[] = [];
  const services = createServices({
    normal: { start() { return 1; }, stop() { events.push("normal"); } },
    first: { exclusive: true, start() { return 2; }, stop() { events.push("first"); } },
    broken: { exclusive: true, start() { throw new Error("occupied"); } },
  });
  await services.start(ctx);
  const first = services.startExclusive(ctx);
  await expect(first).rejects.toMatchObject({ code: "SERVICE_START_FAILED", message: expect.stringContaining("occupied") });
  expect(services.startExclusive(ctx)).toBe(first);
  expect(events).toEqual(["first"]);
  expect(services.values.normal).toBe(1);
  expect(() => services.values.first).toThrow(expect.objectContaining({ code: "SERVICE_NOT_STARTED" }));
  await services.stop();
  expect(events).toEqual(["first", "normal"]);
});

test("shutdown waits for an in-progress exclusive start and cleans up its acquired value", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let stopped = false;
  const services = createServices({ host: { exclusive: true, async start() { await gate; return 42; }, stop(value) { expect(value).toBe(42); stopped = true; } } });
  await services.start(ctx);
  const starting = services.startExclusive(ctx);
  const stopping = services.stop();
  release();
  await starting; await stopping;
  expect(stopped).toBe(true);
});
