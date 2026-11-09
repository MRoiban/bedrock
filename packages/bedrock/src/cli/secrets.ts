import type { Parsed } from "./spec";
import { usageError } from "./args";
import { call, warnExclusive } from "./daemon";
import { promptSecret } from "./terminal";
import { validateSecretName } from "../daemon/secrets";
import { validateName } from "../config";
import { BedrockError } from "../error";

export async function secretsCommand(parsed: Parsed, _json: boolean, options: { stdin?: () => Promise<string>; prompt?: typeof promptSecret; tty?: boolean; request?: typeof call } = {}) {
  const { flags, positionals: [name, ...keys] } = parsed;
  const action = parsed.path[1]!;
  validateName(name!);
  for (const key of keys) {
    try { validateSecretName(key); }
    catch (error) {
      if (error instanceof BedrockError) throw usageError(parsed.path, `Invalid secret name '${key}': ${error.message}`);
      throw error;
    }
  }
  const body: { set?: Record<string, string>; unset?: string[]; restart?: boolean } = {};
  if (action === "set") {
    const value = (options.tty ?? process.stdin.isTTY) ? await (options.prompt ?? promptSecret)(keys[0]!, false) : await (options.stdin ?? (() => Bun.stdin.text()))();
    body.set = { [keys[0]!]: value };
  }
  if (action === "unset") body.unset = keys;
  if (flags["--restart"]) body.restart = true;
  const response = await (options.request ?? call)(flags, `/api/pebbles/${name}/secrets`, action === "ls" ? {} : { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const reply = await response.json();
  warnExclusive(name!, reply);
  // Daemons before the unified envelope answered with bare metadata; accept both until servers self-update.
  return { command: `secrets ${action}`, ...(reply?.ok === true && "value" in reply ? reply.value : reply) };
}
