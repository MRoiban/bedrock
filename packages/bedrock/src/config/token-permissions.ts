import type { PebbleConfig } from "./types";
import { BedrockError } from "../error";

const profileName = /^[a-z][a-z0-9-]{0,47}$/;

export function tokenProfiles(pebble: PebbleConfig): Record<string, readonly string[]> {
  return pebble.tokens && typeof pebble.tokens === "object" ? pebble.tokens.profiles ?? {} : {};
}

export function hasProfile(pebble: PebbleConfig, name: string) {
  return Object.hasOwn(tokenProfiles(pebble), name);
}

export function validatePermission(pebble: PebbleConfig, permission: string) {
  if (permission === "*") return;
  if (permission.startsWith("profile:") && hasProfile(pebble, permission.slice(8))) return;
  const [kind, name] = permission.split(":");
  if ((kind === "query" || kind === "mutation") && permission === `${kind}:${name}` && Object.hasOwn((kind === "query" ? pebble.queries : pebble.mutations) ?? {}, name!)) return;
  if (permission.startsWith("route:") && Object.hasOwn(pebble.routes ?? {}, permission.slice(6))) return;
  if (permission.startsWith("socket:") && Object.hasOwn(pebble.sockets ?? {}, permission.slice(7))) return;
  const file = /^files:([^:]+):(upload|read|delete)$/.exec(permission);
  if (file && pebble.storage?.some(bucket => bucket.name === file[1])) return;
  throw new BedrockError("INVALID_TOKEN_PERMISSION", `Unknown token permission: ${permission}`, "Use *, profile:<configured profile>, query:<registered name>, mutation:<registered name>, route:<registered METHOD /path>, socket:<registered /path>, or files:<registered bucket>:upload|read|delete.");
}

export function validateTokenProfiles(pebble: PebbleConfig) {
  const tokens = pebble.tokens;
  if (tokens === undefined || typeof tokens === "boolean") return;
  const plainObject = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value);
  const profiles = plainObject(tokens) ? (tokens as { profiles?: unknown }).profiles : null;
  if (!plainObject(tokens) || profiles !== undefined && !plainObject(profiles))
    throw new BedrockError("INVALID_TOKEN_PROFILE", "Invalid tokens configuration.", "Use tokens: true or tokens: { profiles: { name: [\"query:list\", ...] } }.");
  for (const [name, entries] of Object.entries((profiles ?? {}) as Record<string, unknown>)) {
    if (!profileName.test(name)) throw new BedrockError("INVALID_TOKEN_PROFILE", `Invalid token profile name: ${name}`, "Use 1–48 lowercase letters, digits, or hyphens, starting with a letter.");
    if (!Array.isArray(entries)) throw new BedrockError("INVALID_TOKEN_PROFILE", `Token profile ${name} is not a list.`, `Set tokens.profiles.${name} to an array of permission strings.`);
    for (const entry of entries) {
      if (typeof entry !== "string" || entry === "*" || entry.startsWith("profile:"))
        throw new BedrockError("INVALID_TOKEN_PROFILE", `Token profile ${name} has an invalid entry: ${String(entry)}`, `Remove ${String(entry)} from tokens.profiles.${name}; profiles list explicit operations, not * or other profiles.`);
      try { validatePermission(pebble, entry); }
      catch { throw new BedrockError("INVALID_TOKEN_PROFILE", `Token profile ${name} grants an unknown operation: ${entry}`, `Register ${entry} in definePebble or remove it from tokens.profiles.${name}.`); }
    }
  }
}
