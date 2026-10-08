import { expect, test } from "bun:test";
import { join } from "node:path";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { tempDirectory } from "./helpers";
import { buildInfo } from "../src/version";

test("daemon exposes boot-time identity and authorizes self-update only for deploy tokens", async () => {
  const temp = tempDirectory();
  await setup(temp.dir, "localhost", "creator@example.test", 0);
  let updates = 0;
  const info = { ...await buildInfo(temp.dir), commit: "a".repeat(40), branch: "main", dirty: false };
  const daemon = await startDaemon({ home: temp.dir, dev: true, domain: "localhost", port: 0, maintenance: { info, async update() { updates++; return { from: info.commit, to: "b".repeat(40), updated: true, output: "redacted output" }; } } });
  try {
    const token = (await Bun.file(join(temp.dir, "admin-token")).text()).trim();
    const call = (path: string, method: string, bearer = token) => fetch(new URL(path, daemon.server.url), { method, headers: { host: `bedrock.localhost:${daemon.server.port}`, authorization: `Bearer ${bearer}` } });
    const status = (await (await call("/api/status", "GET")).json()).value;
    expect(status).toMatchObject(info);
    expect(status.features).toContain("sockets");
    expect(status.features).toContain("services");
    expect(status.instanceId).toBeString();
    expect((await call("/api/self-update", "POST", "brk_pebble-token")).status).toBe(401);
    expect((await call("/api/self-update", "POST", "invalid")).status).toBe(401);
    expect(updates).toBe(0);
    expect((await call("/api/self-update", "GET")).status).toBe(404);
    expect((await (await call("/api/self-update", "POST")).json()).value).toMatchObject({ from: info.commit, to: "b".repeat(40), updated: true });
    expect(updates).toBe(1);
    expect((await (await call("/api/status", "GET")).json()).value.commit).toBe(info.commit);
  } finally { await daemon.stop(); temp.cleanup(); }
});
