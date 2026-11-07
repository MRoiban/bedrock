import { BedrockError } from "../../error";
import { cleanEvent, type ErrorEvent } from "../../errors/model";
import type { ErrorTracking } from "./index";
const invalid = (status: number, message: string) => Response.json({ ok: false, error: new BedrockError("INVALID_ERROR_REPORT", message, "Send v:1 and one to five bounded browser error events from the pebble origin.").toJSON() }, { status });
export async function ingestErrors(request: Request, pebble: string, errors: ErrorTracking) {
  if (request.method !== "POST") return invalid(405, "Error reports require POST.");
  if (request.headers.has("content-encoding")) return invalid(415, "Compressed reports are not accepted.");
  if (!/^(?:application\/json|text\/plain)(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return invalid(415, "Use JSON or a text/plain beacon.");
  if (Number(request.headers.get("content-length")) > 48 * 1024) return invalid(413, "Report exceeds 48 KiB.");
  const release = errors.body();
  if (!release) return Response.json({ ok: false, error: new BedrockError("RATE_LIMITED", "Too many pending error bodies.", "Retry after five seconds.").toJSON() }, { status: 429, headers: { "retry-after": "5" } });
  const reader = request.body?.getReader(); if (!reader) { release(); return invalid(400, "Missing report body."); }
  const parts: Uint8Array[] = []; let size = 0;
  let expired = false;
  const deadline = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 48 * 1024) { void reader.cancel().catch(() => {}); return invalid(413, "Report exceeds 48 KiB."); }
      parts.push(value);
    }
    if (expired) return invalid(408, "Report body deadline exceeded.");
    const input = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (input?.v !== 1 || !Array.isArray(input.events) || !input.events.length || input.events.length > 5) return invalid(400, "Invalid report shape.");
    const events: ErrorEvent[] = [];
    for (const raw of input.events) {
      if (Buffer.byteLength(JSON.stringify(raw)) > 16384) return invalid(413, "Event exceeds 16 KiB.");
      const event = cleanEvent(raw, "browser"); if (!event) return invalid(400, "Invalid error event."); events.push(event);
    }
    const rejected = errors.accept(pebble, events);
    if (rejected) return Response.json({ ok: false, error: new BedrockError("RATE_LIMITED", "Error report capacity reached.", "Honor Retry-After before sending more reports.").toJSON() }, { status: 429, headers: { "retry-after": String(60 - Math.floor(Date.now() / 1000) % 60) } });
    return Response.json({ ok: true, value: { accepted: events.length } }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch { return invalid(400, "Malformed error report."); }
  finally { clearTimeout(deadline); reader.releaseLock(); release(); }
}
