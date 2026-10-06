import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "./helpers";
import { setup } from "../src/daemon/config";
import { service, restartService } from "../src/service";

test.skipIf(process.platform !== "win32" || !!process.env.CI)("Windows Scheduled Task hosts, restarts and reaps a real daemon in an isolated home", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "service & café");
  const options = { home };
  let port = 0;
  const ready = async (previous = 0) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = await Bun.file(join(home, "daemon.json")).json().catch(() => null);
      if (state?.port && state.port !== previous) {
        try {
          const response = await fetch(`http://127.0.0.1:${state.port}/api/status`, { headers: { host: "bedrock.localhost", authorization: `Bearer ${(await Bun.file(join(home, "admin-token")).text()).trim()}` }, signal: AbortSignal.timeout(500) });
          if (response.ok) return state.port as number;
        } catch {}
      }
      await Bun.sleep(50);
    }
    throw new Error("Scheduled daemon did not become healthy");
  };
  const reachable = async (target: number) => {
    try { await fetch(`http://127.0.0.1:${target}/`, { signal: AbortSignal.timeout(500) }); return true; } catch { return false; }
  };
  try {
    await setup(home, "localhost", "creator@example.test", 0);
    await service("install", options);
    port = await ready();
    expect(await service("status", options)).toMatchObject({ installed: true, running: true });
    await restartService(options);
    const old = port;
    port = await ready(old);
    expect(await reachable(old)).toBe(false);
    await service("uninstall", options);
    expect(await reachable(port)).toBe(false);
    expect(await service("status", options)).toMatchObject({ installed: false, running: false });
  } finally { await service("uninstall", options); temp.cleanup(); }
}, 30000);
