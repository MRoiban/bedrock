import { BedrockError, errorStatus } from "../error";
import { errorEvent } from "../errors/model";
export const reportedServerErrors = new WeakSet<object>();
const seen = reportedServerErrors;
let minute = 0, count = 0;
export function reportServerError(error: unknown, mechanism: string) {
  if (!process.send || !process.env.BEDROCK_RELEASE_ID || error instanceof BedrockError && errorStatus(error) < 500) return;
  if (error && typeof error === "object") { if (seen.has(error)) return; seen.add(error); }
  const now = Math.floor(Date.now() / 60000);
  if (now !== minute) { minute = now; count = 0; }
  if (count++ >= 120) return;
  try { process.send({ op: "error.capture", event: errorEvent(error, "server", mechanism, process.env.BEDROCK_RELEASE_ID) }); } catch {}
}
