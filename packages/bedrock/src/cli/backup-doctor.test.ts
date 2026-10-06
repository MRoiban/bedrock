import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { atomicWrite } from "../daemon/config";
import { doctor } from "./doctor";

// Every I/O boundary is local or injected; doctor must never query real Cloudflare here.
test("doctor reports freshness across all pebbles and identity, not just the last manual run", async () => {
  const temp = tempDirectory();
  const options = {
    binary: () => "/test/cloudflared",
    fetch: (async () => Response.json({ value: { tunnel: { running: false }, pebbles: [{ name: "one", status: "running", healthy: true }, { name: "two", status: "running", healthy: true }] } })) as unknown as typeof fetch,
  };
  try {
    await atomicWrite(join(temp.dir, "config.json"), JSON.stringify({ domain: "localhost", creators: [], port: 3000, backup: { type: "fs", directory: join(temp.dir, "backups"), intervalMinutes: 60 } }));
    await atomicWrite(join(temp.dir, "admin-token"), "local");
    const backup = async () => (await doctor(temp.dir, options)).find(check => check.name === "backup")!;
    expect((await backup()).status).toBe("warn");
    await atomicWrite(join(temp.dir, "backup-state.json"), JSON.stringify({ daemon: Date.now(), pebbles: { one: Date.now(), two: Date.now() } }));
    expect((await backup()).status).toBe("pass");
    await atomicWrite(join(temp.dir, "backup-state.json"), JSON.stringify({ daemon: Date.now(), pebbles: { one: Date.now(), two: Date.now() - 121 * 60000 } }));
    expect((await backup()).status).toBe("warn");
  } finally { temp.cleanup(); }
});
