import { BedrockError } from "../../error";
import type { ErrorTracking } from "./index";
export async function errorApi(request: Request, errors: ErrorTracking, pebble: string, issue?: string, action?: string) {
  const url = new URL(request.url);
  const number = (name: string) => {
    const value = Number(url.searchParams.get(name) ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) throw new BedrockError("INVALID_ARGS", "Invalid error cursor.", "Pass the nonnegative cursor returned by the previous page.");
    return value;
  };
  let value: unknown;
  if (request.method === "GET" && issue === "transitions") value = await errors.transitions(pebble, number("after"));
  else if (request.method === "GET" && !action) value = await errors.query(pebble, issue, number("cursor"));
  else if (request.method === "POST" && issue && ["resolve", "ignore", "merge"].includes(action ?? "")) {
    if (action === "merge" && url.searchParams.get("confirm") !== "true") throw new BedrockError("CONFIRM_REQUIRED", "Merging error issues requires confirmation.", "Pass --yes, or confirm=true to the API.");
    value = await errors.change(pebble, issue, action!, url.searchParams.get("target") ?? undefined);
  } else throw new BedrockError("INVALID_ARGS", "Unknown error operation.", "Use errors <pebble> or errors show|resolve|ignore|merge <pebble> <issue>.");
  return Response.json({ ok: true, value }, { headers: { "cache-control": "no-store" } });
}
