import { bedrockHome } from "../daemon/config";
import { setupAlerts } from "../daemon/alerts/config";
import { BedrockError } from "../error";
import { call } from "./daemon";
import { promptSecret } from "./ops";
export async function alertsCommand(args: string[]) {
  const flags: Record<string, string> = {}, positions: string[] = [];
  const invalid = () => { throw new BedrockError("INVALID_ARGS", "Invalid alerts arguments.", "Use alerts [ls], silence <fingerprint> --for 2h, test, or setup [--webhook <url>] (bearer secret on stdin/hidden prompt); all accept --json."); };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) positions.push(arg);
    else {
      if (!["--url", "--token", "--for", "--webhook"].includes(arg) || flags[arg]) invalid();
      const value = args[++i]; if (!value || value.startsWith("--")) invalid(); flags[arg] = value!;
    }
  }
  const [action = "ls", fingerprint] = positions;
  if (action === "setup") {
    if (positions.length !== 1 || Object.keys(flags).some(k => k !== "--webhook")) invalid();
    return { command: "alerts setup", ...await setupAlerts(bedrockHome(), process.stdin.isTTY ? await promptSecret("Alert webhook bearer token") : await Bun.stdin.text(), flags["--webhook"]) };
  }
  if (!["ls", "test", "silence"].includes(action) || positions.length > (action === "silence" ? 2 : 1) || Object.keys(flags).some(k => !["--url", "--token", ...(action === "silence" ? ["--for"] : [])].includes(k)) || action === "silence" && (!fingerprint || !flags["--for"])) invalid();
  const path = `/api/alerts${action === "ls" ? "" : `/${action}`}`;
  return { command: `alerts ${action}`, ...await (await call(flags, path, action === "ls" ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fingerprint, for: flags["--for"] }) })).json() };
}
