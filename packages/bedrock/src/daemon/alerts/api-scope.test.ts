import { expect, test } from "bun:test";
import { alertsApi } from "./api";
import type { Alerts } from "./index";

const view = {
  incidents: [
    { fingerprint: "tunnel", pebble: "", rule: "tunnel" },
    { fingerprint: "bot", pebble: "bot-one", rule: "readiness" },
    { fingerprint: "other", pebble: "private", rule: "readiness" },
  ],
  silences: [{ fingerprint: "tunnel", until: 1 }],
  checks: [{ name: "bot-one" }, { name: "private" }],
  outbox: [{ id: "x" }],
  pending: 0,
};
const alerts = { view: async () => view, silence: async (fingerprint: string) => ({ fingerprint }) } as unknown as Alerts;
const call = async (path: string, pebbles: string[], body?: unknown) => {
  const request = new Request("http://bedrock.localhost" + path, body ? { method: "POST", body: JSON.stringify(body) } : {});
  const response = await alertsApi(request, alerts, { pebbles, actions: ["monitor"] });
  return (await response!.json() as { value: any }).value;
};

test("a monitor token scoped to every pebble sees host-wide incidents and delivery state", async () => {
  const all = await call("/api/alerts", ["*"]);
  expect(all.incidents.map((incident: any) => incident.fingerprint)).toEqual(["tunnel", "bot", "other"]);
  expect(all.outbox).toEqual([{ id: "x" }]);
  expect(await call("/api/alerts/silence", ["*"], { fingerprint: "tunnel", for: "2h" })).toEqual({ fingerprint: "tunnel" });
});

test("a narrower monitor token still sees only its own pebbles", async () => {
  const some = await call("/api/alerts", ["bot-*"]);
  expect(some.incidents.map((incident: any) => incident.fingerprint)).toEqual(["bot"]);
  expect(some.outbox).toBeUndefined();
  await expect(call("/api/alerts/silence", ["bot-*"], { fingerprint: "tunnel", for: "2h" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
