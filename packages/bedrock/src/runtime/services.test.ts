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
