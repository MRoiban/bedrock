import { call } from "./daemon";
import { promptSecret } from "./terminal";
import { validateSecretName } from "../daemon/secrets";
import { validateName } from "../config";
import { BedrockError } from "../error";

export async function secretsCommand(args: string[], options: { stdin?: () => Promise<string>; prompt?: typeof promptSecret; tty?: boolean; request?: typeof call } = {}) {
  const positions: string[] = [];
  const flags: Record<string, string> = {};
  const hint = "Use bedrock secrets ls <pebble>, set <pebble> <NAME> (stdin or hidden prompt), or unset <pebble> <NAME>... [--restart] [--url <url>] [--token <token>] [--json].";
  const invalid = () => { throw new BedrockError("INVALID_ARGS", "Invalid secrets arguments.", hint); };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--restart" && !flags[arg]) flags[arg] = "true";
    else if (["--url", "--token"].includes(arg) && !flags[arg] && args[i + 1] && !args[i + 1]!.startsWith("--")) flags[arg] = args[++i]!;
    else if (arg.startsWith("--")) invalid();
    else positions.push(arg);
  }
  const [action, name, ...keys] = positions;
  if (!name || action === "ls" && (keys.length || flags["--restart"]) || action === "set" && keys.length !== 1 || action === "unset" && !keys.length || !["ls", "set", "unset"].includes(action ?? "")) invalid();
  validateName(name!); keys.forEach(validateSecretName);
  const body: { set?: Record<string, string>; unset?: string[]; restart?: boolean } = {};
  if (action === "set") {
    const value = (options.tty ?? process.stdin.isTTY) ? await (options.prompt ?? promptSecret)(keys[0]!, false) : await (options.stdin ?? (() => Bun.stdin.text()))();
    body.set = { [keys[0]!]: value };
  }
  if (action === "unset") body.unset = keys;
  if (flags["--restart"]) body.restart = true;
  const response = await (options.request ?? call)(flags, `/api/pebbles/${name}/secrets`, action === "ls" ? {} : { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { command: `secrets ${action}`, ...(await response.json()).value };
}
