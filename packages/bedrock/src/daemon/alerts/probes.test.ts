import { expect, test } from "bun:test";
import { tempDirectory } from "../../../test/helpers";
import { setup } from "../config";
import type { DaemonDatabase } from "../db";
import type { Supervisor } from "../supervisor";
import { Alerts } from "./index";
test("probe sweep bounds concurrency, skips idle/stopped targets and known crashes override cached ready", async () => {
  const temp = tempDirectory();
  const { config } = await setup(temp.dir, "example.test", undefined, 0);
  const alerts = new Alerts(temp.dir);
  const records = Array.from({ length: 24 }, (_, i) => ({ name: `p-${i}`, status: "running", release: "r1" }));
  records.push({ name: "idle", status: "idle", release: "r1" }, { name: "stopped", status: "stopped", release: "r1" });
  let inflight = 0, peak = 0, calls = 0;
  const supervisor = {
    child: (name: string) => name.startsWith("p-") ? child : undefined,
    async readiness(name: string) {
      expect(name.startsWith("p-")).toBe(true); calls++; inflight++; peak = Math.max(peak, inflight);
      await Promise.resolve(); inflight--; return { state: "ready" };
    },
  };
  const child = {};
  try {
    alerts.start({ list: () => records } as unknown as DaemonDatabase, supervisor as unknown as Supervisor, config, () => null);
    await alerts.pause();
    expect(calls).toBe(24); expect(peak).toBe(2);
    expect(alerts.status("p-0", "running").state).toBe("ready");
    expect(alerts.status("p-0", "crashed").state).toBe("failed");
    expect(alerts.status("p-0", "restarting").state).toBe("starting");
    expect(alerts.status("idle", "idle")).toMatchObject({ state: "idle", available_on_demand: true });
    expect(alerts.status("stopped", "stopped").state).toBe("stopped");
  } finally { await alerts.close(); temp.cleanup(); }
});
