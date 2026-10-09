import type { PebbleConfig } from "./config";
import { BedrockError } from "./error";

export const daemonFeatures = ["sockets", "services", "directory-backups", "chunked-uploads", "chunked-uploads-cancel", "access-allow-creators", "pebble-secrets", "scoped-deploy-tokens", "service-tokens"];
export function requiredFeatures(pebble: PebbleConfig): string[] {
  const required = new Set<string>();
  if (Object.keys(pebble.sockets ?? {}).length) required.add("sockets");
  if (Object.keys(pebble.services ?? {}).length) required.add("services");
  if (pebble.backup?.directories?.length) required.add("directory-backups");
  if (typeof pebble.access === "object" && pebble.access.allow.includes("creators")) required.add("access-allow-creators");
  return [...required];
}
export function checkDaemonFeatures(pebble: PebbleConfig, status: { features?: string[] }) {
  const missing = requiredFeatures(pebble).filter(feature => !status.features?.includes(feature));
  if (missing.length) throw new BedrockError("DAEMON_UPDATE_REQUIRED", `The daemon lacks required features: ${missing.join(", ")}.`, "Run bedrock self-update --remote, then deploy again.");
}
