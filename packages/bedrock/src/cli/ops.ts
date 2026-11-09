import { usageError } from "./args";
import type { Handler } from "./spec";
import { plain, promptSecret } from "./terminal";
import { bedrockHome, readConfig } from "../daemon/config";
import { BedrockError } from "../error";
import { Cloudflare } from "../tunnel/client";
import { tunnelSetup, tunnelStatus, tunnelTeardown } from "../tunnel";
import { service } from "../service";
import { connection } from "./daemon";
import { loginUrl, login, logout } from "./credentials";
import { doctor, type Check } from "./doctor";

export { promptSecret } from "./terminal";
export const opsCommands = ["tunnel", "service", "doctor", "login", "logout"];
export const opsCommand: Handler = async (parsed, json) => {
  const { positionals: positions, flags } = parsed;
  const command = parsed.path[0];
  const home = bedrockHome();
  if (command === "doctor") {
    const checks = await doctor(home);
    if (checks.some(check => check.status === "fail")) process.exitCode = 1;
    console.log(json ? JSON.stringify(checks) : formatDoctor(checks));
    return undefined;
  }
  if (command === "login") {
    if (positions.length && flags["--url"]) throw usageError(parsed.path, `Domain '${positions[0]}' cannot be combined with --url.`);
    if (!positions[0] && !flags["--url"]) throw usageError(parsed.path, "bedrock login needs <domain> or --url <url>.");
    const url = loginUrl(positions[0] ?? (flags["--url"] as string));
    const local = await connection({}, { credentials: async () => null }).catch(() => null);
    const config = local ? await readConfig(home).catch(() => null) : null;
    if (local && config && url === `https://bedrock.${config.domain}`) {
      const hint = "The local admin token has no user identity. To act as an existing creator, use bedrock pebble-token create <pebble> --name <name> --permissions <grants> --as <creator-email>, or bedrock session create <pebble> --as <creator-email>. The creator must already have signed in with Google. For a creator login token, run bedrock login <domain> on the computer with your browser; its callback uses that computer’s 127.0.0.1.";
      if (!json) { console.log(`✓ Using the server’s local admin token.\n${hint}`); return; }
      return { command: "login", url: local.url, authenticated: true, hint };
    }
    const result = await login(url);
    if (!json) { console.log(`✓ Signed in to ${url}`); return; }
    return result;
  }
  if (command === "logout") return logout();
  const action = parsed.path[1]!;
  if (command === "service") {
    const result = await service(action, { home }, !!flags["--dry-run"]);
    if (!json && "content" in result) { console.log(result.content); return undefined; }
    return { command: `service ${action}`, ...result };
  }
  if (action === "teardown" && !flags["--yes"]) throw new BedrockError("CONFIRM_REQUIRED", "Tunnel teardown disconnects your public server.", "Stop the daemon, then run bedrock tunnel teardown --yes.");
  if (action === "teardown" && !(await readConfig(home)).cloudflare) return { command: "tunnel teardown", ...await tunnelTeardown(home, undefined, true) };
  const token = (flags["--api-token"] as string | undefined) ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!token && action !== "status" && json) throw new BedrockError("CLOUDFLARE_TOKEN_MISSING", "A Cloudflare API token is required.", "Pass --api-token <token> or set CLOUDFLARE_API_TOKEN.");
  const api = token ? new Cloudflare(token) : action === "status" ? undefined : new Cloudflare(await promptSecret());
  const discovered = action === "setup" && (!flags["--account-id"] || !flags["--zone-id"]) ? await api!.discover((await readConfig(home)).domain) : undefined;
  const value = action === "setup" ? await tunnelSetup(home, (flags["--account-id"] as string | undefined) ?? discovered!.accountId, (flags["--zone-id"] as string | undefined) ?? discovered!.zoneId, api!) : action === "status" ? await tunnelStatus(home, api) : await tunnelTeardown(home, api!, true);
  return { command: `tunnel ${action}`, ...value };
};

export function formatDoctor(checks: Check[]) {
  return checks.map(check => `${plain(check.status.toUpperCase())} ${plain(check.name)}: ${plain(check.message)}${check.status === "pass" ? "" : `\n  Hint: ${plain(check.hint)}`}`).join("\n");
}
