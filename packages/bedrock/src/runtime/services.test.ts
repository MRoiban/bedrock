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
