import type { Parsed } from "./spec";
import { usageError } from "./args";
import { call } from "./daemon";
import { validateName } from "../config";
import { BedrockError } from "../error";
import { sessionTtl } from "../auth/session-links";

export async function creatorCommand(parsed: Parsed, _json: boolean) {
  const { flags, positionals: [pebble, id] } = parsed;
  const [command, action] = parsed.path;
  validateName(pebble!);
  const revoke = command === "pebble-token" && action === "revoke";
  if (revoke && !flags["--yes"]) throw new BedrockError("CONFIRM_REQUIRED", "Revoking a pebble token removes its access.", "Run bedrock pebble-token revoke <pebble> <id> --yes to confirm.");
  if (command === "pebble-token" && !revoke) {
    for (const key of ["--name", "--permissions"]) {
      if (!(flags[key] as string | undefined)?.trim()) throw usageError(parsed.path, `pebble-token create requires a non-empty ${key}.`);
    }
  }
  if (command === "session") {
    try { sessionTtl(flags["--ttl"] as string | undefined); }
    catch (error) {
      if (error instanceof BedrockError) throw usageError(parsed.path, `Invalid --ttl '${flags["--ttl"]}': ${error.message}`);
      throw error;
    }
  }
  const query = flags["--as"] === undefined ? "" : `?${new URLSearchParams({ as: flags["--as"] as string })}`;
  const path = `/api/pebbles/${pebble}/${command === "session" ? "sessions" : "service-tokens"}${revoke ? `/${encodeURIComponent(id!)}` : ""}${query}`;
  const input = command === "session" ? { ttl: flags["--ttl"] ?? "15m" } : { name: flags["--name"], permissions: (flags["--permissions"] as string | undefined)?.split(",").map(value => value.trim()) };
  return { command: `${command} ${action}`, ...await (await call(flags, path, { method: revoke ? "DELETE" : "POST", ...(!revoke ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input) } : {}) })).json() };
}
