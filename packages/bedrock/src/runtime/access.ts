import type { PebbleConfig, User } from "../config";
import { BedrockError } from "../error";

export function checkAccess(pebble: PebbleConfig, user: User | null) {
  if (!pebble.access || pebble.access === "public") return;
  if (!user) throw new BedrockError("UNAUTHENTICATED", "Sign-in is required.", "In local development enable BEDROCK_INSECURE_DEV_USER=1 and send x-bedrock-user.");
  if (pebble.access === "creators") throw new BedrockError("ACCESS_UNAVAILABLE", "Creator access requires the daemon.", "Use public or users access during local development.");
  if (typeof pebble.access === "object" && !pebble.access.allow.some(entry => user.email &&
    (entry.startsWith("@") ? user.email.toLowerCase().endsWith(entry.toLowerCase()) : user.email.toLowerCase() === entry.toLowerCase()))) {
    throw new BedrockError("FORBIDDEN", "This user is not allowed to access the pebble.", "Use an email permitted by the pebble's access.allow list.");
  }
}
