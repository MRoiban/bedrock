import { bedrockHome, readConfig } from "../daemon/config";
import { BedrockError } from "../error";
import { Cloudflare } from "../tunnel/client";
import { tunnelSetup, tunnelStatus, tunnelTeardown } from "../tunnel";
import { service } from "../service";
import { login, logout } from "./credentials";
import { doctor } from "./doctor";

async function promptToken() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new BedrockError("CLOUDFLARE_TOKEN_MISSING", "No Cloudflare API token was provided.", "Set CLOUDFLARE_API_TOKEN or pass --api-token; noninteractive commands cannot prompt.");
  process.stderr.write("Cloudflare API token (hidden): ");
  return new Promise<string>((resolve, reject) => {
    let token = "";
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", data); process.stderr.write("\n"); };
    const data = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === "\r" || char === "\n") { cleanup(); resolve(token.trim()); return; }
        if (char === "\x03" || char === "\x04") { cleanup(); reject(new BedrockError("CANCELLED", "Token entry cancelled.", "Retry when you have a Cloudflare API token.")); return; }
        if (char === "\x7f" || char === "\b") token = token.slice(0, -1);
        else if (char >= " ") token += char;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", data);
  });
}
export const opsCommands = ["tunnel", "service", "doctor", "login", "logout"];
export async function opsCommand(command: string, args: string[], json: boolean) {
  const flags: Record<string, string> = {};
  const positions: string[] = [];
  const allowed = command === "tunnel" ? ["--account-id", "--zone-id", "--api-token", "--yes"] : command === "service" ? ["--dry-run"] : command === "login" ? ["--url"] : [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) { positions.push(arg); continue; }
    if (!allowed.includes(arg) || flags[arg]) throw new BedrockError("INVALID_ARGS", "Unknown or repeated option.", "Use tunnel setup|status|teardown, service install|uninstall|status, doctor, login --url <url>, or logout.");
    if (["--yes", "--dry-run"].includes(arg)) flags[arg] = "true";
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new BedrockError("INVALID_ARGS", `Missing value for ${arg}.`, "Provide the option value.");
      flags[arg] = value;
    }
  }
  const invalid = () => { throw new BedrockError("INVALID_ARGS", `Invalid ${command} arguments.`, "Use tunnel setup --account-id <id> --zone-id <id>, tunnel status, tunnel teardown --yes, service install|uninstall|status [--dry-run], doctor, login --url <url>, or logout."); };
  const home = bedrockHome();
  if (command === "doctor") {
    if (positions.length) invalid();
    const checks = await doctor(home);
    if (checks.some(check => check.status === "fail")) process.exitCode = 1;
    console.log(json ? JSON.stringify(checks) : checks.map(check => `${check.status.toUpperCase()} ${check.name}: ${check.message}\n  Hint: ${check.hint}`).join("\n"));
    return undefined;
  }
  if (command === "login") { if (positions.length || !flags["--url"]) invalid(); return login(flags["--url"]!); }
  if (command === "logout") { if (positions.length) invalid(); return logout(); }
  const action = positions[0];
  if (positions.length !== 1) invalid();
  if (command === "service") {
    if (!["install", "uninstall", "status"].includes(action!)) invalid();
    const result = await service(action!, { home }, !!flags["--dry-run"]);
    if (!json && "content" in result) { console.log(result.content); return undefined; }
    return { command: `service ${action}`, ...result };
  }
  if (!["setup", "status", "teardown"].includes(action!)) invalid();
  const keys = Object.keys(flags);
  if (action === "setup" && (!flags["--account-id"] || !flags["--zone-id"] || keys.includes("--yes"))) invalid();
  if (action !== "setup" && keys.some(key => ["--account-id", "--zone-id"].includes(key)) || action === "status" && flags["--yes"]) invalid();
  if (action === "teardown" && !flags["--yes"]) throw new BedrockError("CONFIRM_REQUIRED", "Tunnel teardown disconnects your public server.", "Stop the daemon, then run bedrock tunnel teardown --yes.");
  if (action === "teardown" && !(await readConfig(home)).cloudflare) return { command: "tunnel teardown", ...await tunnelTeardown(home, undefined, true) };
  const token = flags["--api-token"] ?? process.env.CLOUDFLARE_API_TOKEN;
  const api = token ? new Cloudflare(token) : action === "status" ? undefined : new Cloudflare(await promptToken());
  const value = action === "setup" ? await tunnelSetup(home, flags["--account-id"]!, flags["--zone-id"]!, api!) : action === "status" ? await tunnelStatus(home, api) : await tunnelTeardown(home, api!, true);
  return { command: `tunnel ${action}`, ...value };
}
