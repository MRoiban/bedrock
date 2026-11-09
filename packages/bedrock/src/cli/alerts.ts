import type { Parsed } from "./spec";
import { usageError } from "./args";
import { bedrockHome } from "../daemon/config";
import { setupAlerts } from "../daemon/alerts/config";
import { call } from "./daemon";
import { promptSecret } from "./ops";
export async function alertsCommand(parsed: Parsed, _json: boolean) {
  const { flags, positionals: [fingerprint] } = parsed;
  const action = parsed.path[1]!;
  if (action === "setup") {
    return { command: "alerts setup", ...await setupAlerts(bedrockHome(), process.stdin.isTTY ? await promptSecret("Alert webhook bearer token") : await Bun.stdin.text(), flags["--webhook"] as string | undefined) };
  }
  if (action === "silence" && !flags["--for"]) throw usageError(parsed.path, "alerts silence requires --for <age>, e.g. --for 2h.");
  const path = `/api/alerts${action === "ls" ? "" : `/${action}`}`;
  return { command: `alerts ${action}`, ...await (await call(flags, path, action === "ls" ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fingerprint, for: flags["--for"] }) })).json() };
}
