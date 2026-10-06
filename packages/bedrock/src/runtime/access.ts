import type { PebbleConfig, User } from "../config";
import { enforceAccess } from "../auth/policy";

export function checkAccess(pebble: PebbleConfig, user: User | null) {
  enforceAccess(pebble.access, user, JSON.parse(process.env.BEDROCK_CREATORS ?? "[]"));
}
