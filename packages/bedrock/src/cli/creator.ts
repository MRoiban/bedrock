import { call } from "./daemon";
import { validateName } from "../config";
import { BedrockError } from "../error";
import { sessionTtl } from "../auth/session-links";

export const creatorUsage = {
  "pebble-token": "create <pebble> --name <name> --permissions <a,b> | revoke <pebble> <id> --yes [--as <email>] [--url <url>] [--token <token>]",
  session: "create <pebble> [--ttl 15m] [--as <email>] [--url <url>] [--token <token>]",
};

export async function creatorCommand(command: keyof typeof creatorUsage, args: string[]) {
  const hint = `Use bedrock ${command} ${creatorUsage[command]} [--json].`;
  const invalid = () => { throw new BedrockError("INVALID_ARGS", `Invalid ${command} arguments.`, hint); };
  const positions: string[] = [];
  const flags: Record<string, string> = {};
  const allowed = ["--url", "--token", "--as", ...(command === "session" ? ["--ttl"] : ["--name", "--permissions", "--yes"])];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("-")) positions.push(arg);
    else if (!allowed.includes(arg) || flags[arg] !== undefined) invalid();
    else if (arg === "--yes") flags[arg] = "true";
    else if (!args[i + 1] || args[i + 1]!.startsWith("-")) invalid();
    else flags[arg] = args[++i]!;
  }
  const [action, pebble, id] = positions;
  if (!pebble) invalid();
  validateName(pebble!);
  const revoke = command === "pebble-token" && action === "revoke";
  if (action !== "create" && !revoke || positions.length !== (revoke ? 3 : 2)) invalid();
  if (revoke && (flags["--name"] || flags["--permissions"])) invalid();
  if (!revoke && flags["--yes"]) invalid();
  if (revoke && !flags["--yes"]) throw new BedrockError("CONFIRM_REQUIRED", "Revoking a pebble token removes its access.", "Run bedrock pebble-token revoke <pebble> <id> --yes to confirm.");
  if (command === "pebble-token" && !revoke && (!flags["--name"]?.trim() || !flags["--permissions"]?.trim())) invalid();
  if (command === "session") sessionTtl(flags["--ttl"]);
  const query = flags["--as"] === undefined ? "" : `?${new URLSearchParams({ as: flags["--as"] })}`;
  const path = `/api/pebbles/${pebble}/${command === "session" ? "sessions" : "service-tokens"}${revoke ? `/${encodeURIComponent(id!)}` : ""}${query}`;
  const input = command === "session" ? { ttl: flags["--ttl"] ?? "15m" } : { name: flags["--name"], permissions: flags["--permissions"]?.split(",").map(value => value.trim()) };
  return { command: `${command} ${action}`, ...await (await call(flags, path, { method: revoke ? "DELETE" : "POST", ...(!revoke ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input) } : {}) })).json() };
}
