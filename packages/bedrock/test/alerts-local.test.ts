import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { tempDirectory } from "./helpers";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { setupAlerts } from "../src/daemon/alerts/config";
import { openDaemonDatabase } from "../src/daemon/db";

test("R2-2 default webhook wakes a local pebble through the daemon proxy without a tunnel", async () => {
  const temp = tempDirectory(), home = join(temp.dir, "home"), release = join(home, "pebbles/comms/releases/r1");
  let now = Date.parse("2026-11-03T12:00:00Z");
  const { config } = await setup(home, "example.test", undefined, 0);
  await setupAlerts(home, "brk_test-only");
  await Bun.write(join(release, "pebble.ts"), `import {definePebble, detached} from ${JSON.stringify(resolve(import.meta.dir, "../src/index.ts"))};
export default definePebble({name:"comms",access:"public",routes:{"POST /api/v1/messages":detached(async (request, _server, ctx)=>{
  const payload=await request.json();
  await Bun.write(${JSON.stringify(join(home, "pebbles/comms/data/received-"))}+payload.metadata.rule+".json", JSON.stringify({host:request.headers.get("host"),authorization:request.headers.get("authorization"),path:new URL(request.url).pathname,payload}));
  return new Response(null,{status:202});
})}});`);
  const db = await openDaemonDatabase(home);
  db.save({ name: "comms", release, status: "idle", previous_release: null }); db.close();
  const daemon = await startDaemon({ home, telemetryForTests: false, alertsClockForTests: () => now });
  try {
    await daemon.alerts.snapshotForTests({ pebbles: [{ name: "comms", status: "idle", readiness: "idle", release }], tunnel: false });
    now += 30000; await daemon.alerts.dispatchForTests();
    expect((await daemon.alerts.view()).outbox.filter((r: any) => r.transition === "opened").map((r: any) => r.state)).toEqual(["accepted"]);
    const received = await Bun.file(join(home, "pebbles/comms/data/received-tunnel.json")).json();
    expect(received).toMatchObject({ host: "comms.example.test", authorization: "Bearer brk_test-only", path: "/api/v1/messages" });
    expect(received.payload.metadata.rule).toBe("tunnel");
    // The same loopback route still enforces the normal Origin/access checks.
    const denied = await fetch(new URL("/api/v1/messages", daemon.server.url), { method: "POST", headers: { host: `comms.${config.domain}` }, body: "{}" });
    expect(denied.status).toBe(403);
  } finally { await daemon.stop(); temp.cleanup(); }
});
