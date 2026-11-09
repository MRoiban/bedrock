import { expect, test } from "bun:test";
import { tempDirectory } from "../../test/helpers";
import { startPebble } from "./index";
import { service } from "../config";
import { handleControl } from "./control";
test("readiness over IPC checks the readable database and all services, while health stays liveness", async () => {
  const temp = tempDirectory();
  const app = await startPebble({ pebble: { name: "probe", services: { exclusive: service({ exclusive: true, start: () => 1 }) } }, dir: temp.dir, dataDir: temp.dir, deferExclusive: true, cron: false, port: 0 });
  try {
    expect((await handleControl(app, { op: "readiness", requestId: "1" })).value).toEqual({ state: "degraded" });
    expect((await fetch(new URL("/_bedrock/health", app.server.url))).status).toBe(200);
    await app.startExclusive();
    expect((await handleControl(app, { op: "readiness", requestId: "2" })).value).toEqual({ state: "ready" });
  } finally { await app.stop(); temp.cleanup(); }
  expect(app.readiness()).toEqual({ state: "stopped" });
});
