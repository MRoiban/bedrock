import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "./helpers";
import { setup } from "../src/daemon/config";
import { service, serviceFile, restartService } from "../src/service";
import { BedrockError } from "../src/error";
import { cleanupWindowsTestServices, watchWindowsTestService } from "./service-cleanup";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.(), 30000);

test.skipIf(process.platform !== "win32" || process.env.BEDROCK_REAL_SERVICE_TESTS !== "1")("Windows Scheduled Task hosts, restarts and reaps a real daemon in an isolated home", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "service & café");
  let stopped = false;
  const deadline = Date.now() + 30000;
  const options = { home, run: async (args: string[]) => {
    if (stopped || Date.now() >= deadline) throw new BedrockError("TEST_SERVICE_STOPPED", "Service test has finished.", "Do not register tasks after test teardown.");
    // A synchronous, bounded runner cannot finish registering after timeout cleanup.
    const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", timeout: 10000 });
    if (result.exitCode !== 0) throw new BedrockError("SERVICE_FAILED", result.stderr.toString() || "Service command failed.", "Inspect Task Scheduler.");
    return result.stdout.toString();
  } };
  const path = serviceFile(options).path;
  let watchdog: Awaited<ReturnType<typeof watchWindowsTestService>> | undefined;
  cleanup = () => {
    stopped = true;
    cleanupWindowsTestServices(path);
    if (watchdog?.exitCode === null) watchdog.kill();
    watchdog = undefined;
    temp.cleanup();
  };
  let port = 0;
  const ready = async (previous = 0) => {
    const deadline = Date.now() + 10000;
    while (!stopped && Date.now() < deadline) {
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
    watchdog = await watchWindowsTestService(path);
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
  } finally { cleanup(); }
}, 60000);
