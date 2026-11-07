import { BedrockError } from "../../error";
import { validateName } from "../../config";
import { duration } from "../telemetry/api";
import type { Alerts } from "./index";
export async function alertsApi(request: Request, alerts: Alerts | undefined) {
  const url = new URL(request.url);
  const history = /^\/api\/jobs\/([^/]+)\/history$/.exec(url.pathname);
  if (!url.pathname.startsWith("/api/alerts") && !history) return null;
  if (!alerts) throw new BedrockError("ALERTS_UNAVAILABLE", "Alert monitoring is unavailable.", "Restart an updated daemon and inspect its logs.");
  let value: unknown;
  if (history && request.method === "GET") { validateName(history[1]!); value = await alerts.history(history[1]!); }
  else if (url.pathname === "/api/alerts" && request.method === "GET") value = await alerts.view();
  else if (url.pathname === "/api/alerts/test" && request.method === "POST") value = await alerts.test();
  else if (url.pathname === "/api/alerts/silence" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (typeof body?.fingerprint !== "string" || !body.fingerprint || body.fingerprint.length > 1024 || typeof body.for !== "string") throw new BedrockError("INVALID_ARGS", "Invalid silence.", "Send { fingerprint, for: '2h' } from bedrock alerts output.");
    value = await alerts.silence(body.fingerprint, Date.now() + duration(body.for));
  } else throw new BedrockError("NOT_FOUND", "Unknown alerts operation.", "Use GET /api/alerts, POST /api/alerts/test|silence or GET /api/jobs/:pebble/history.");
  return Response.json({ ok: true, value }, { headers: { "cache-control": "no-store" } });
}
