import { expect, spyOn, test } from "bun:test";
import { daemonCommand, warnExclusive } from "./daemon";
import { parse } from "./args";
import { secretsCommand } from "./secrets";

test("CLI warns on exclusive failures without changing lifecycle result envelopes", async () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true, value: { exclusive_services: "failed" } }) });
  try {
    for (const command of ["rollback", "restart"]) {
      const result = await daemonCommand(parse([command], ["fixture", "--url", server.url.href, "--token", "fixture-token"]), true);
      expect(result).toMatchObject({ ok: true, value: { exclusive_services: "failed" } });
    }
    await secretsCommand(parse(["secrets"], ["unset", "fixture", "OLD", "--restart"]), true, { request: async () => Response.json({ ok: true, value: { secrets: [], exclusive_services: "failed" } }) });
    expect(warning).toHaveBeenCalledTimes(3);
    expect(warning.mock.calls.every(call => String(call[0]).includes("bedrock logs fixture"))).toBe(true);
    warnExclusive("fixture", { value: { exclusive_services: "none" } });
    warnExclusive("fixture", { value: { exclusive_services: "running" } });
    expect(warning).toHaveBeenCalledTimes(3);
  } finally { warning.mockRestore(); await server.stop(true); }
});
