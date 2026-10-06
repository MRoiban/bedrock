import { createHmac, timingSafeEqual } from "node:crypto";
import type { User } from "../config";
import { BedrockError } from "../error";

export function deriveIdentitySecret(master: string, pebbleName: string) {
  return createHmac("sha256", master).update(`identity:${pebbleName}`).digest("hex");
}

const signature = (json: string, timestamp: string, secret: string) => createHmac("sha256", secret).update(`${json}\n${timestamp}`).digest("hex");
export function signIdentity(user: User, secret: string, now = Date.now()) {
  const json = JSON.stringify(user);
  const timestamp = String(now);
  return { "x-bedrock-user": json, "x-bedrock-user-ts": timestamp, "x-bedrock-signature": signature(json, timestamp, secret) };
}
export function verifyIdentity(request: Request, secret: string | undefined, now = Date.now()): User | null {
  const json = request.headers.get("x-bedrock-user");
  const timestamp = request.headers.get("x-bedrock-user-ts");
  const supplied = request.headers.get("x-bedrock-signature");
  if (!json && !timestamp && !supplied) return null;
  const invalid = () => new BedrockError("INVALID_IDENTITY", "The daemon identity is invalid or expired.", "Access the pebble through the Bedrock daemon and sign in again.");
  if (!secret || !json || !timestamp || !supplied || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(supplied)) throw invalid();
  // Reject future timestamps too: a clock error must not create replayable identity.
  const age = now - Number(timestamp);
  if (age < 0 || age > 60_000 || !timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(json, timestamp, secret), "hex"))) throw invalid();
  try {
    const user = JSON.parse(json);
    if (!user || typeof user.id !== "string" || !user.id || typeof user.email !== "string" || !user.email ||
        typeof user.name !== "string" || (user.avatarUrl != null && typeof user.avatarUrl !== "string")) throw invalid();
    return user;
  } catch { throw invalid(); }
}
