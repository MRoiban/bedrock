import type { Parsed } from "./spec";
import { usageError } from "./args";
import { backupSetup } from "../backup";
import { DEFAULT_KEEP } from "../backup/snapshot";
import { bedrockHome } from "../daemon/config";
import { BedrockError } from "../error";
import { call } from "./daemon";
import { promptSecret } from "./ops";

export async function backupCommand(parsed: Parsed, _json: boolean) {
  const { flags, positionals: [name] } = parsed;
  const action = parsed.path[1]!;
  if (action === "setup") {
    const r2 = Object.keys(flags).find(key => key.startsWith("--r2-"));
    if (flags["--dir"] && r2) throw usageError(parsed.path, `--dir cannot be combined with ${r2}.`);
    const retention = { intervalMinutes: Number(flags["--interval-minutes"] ?? 60), keep: Number(flags["--keep"] ?? DEFAULT_KEEP) };
    if (flags["--dir"]) return { command: "backup setup", ...await backupSetup(bedrockHome(), { type: "fs", directory: flags["--dir"] as string, ...retention }) };
    for (const key of ["--r2-account", "--r2-bucket", "--r2-access-key-id"]) {
      if (!flags[key]) throw usageError(parsed.path, `backup setup requires ${key} when --dir is absent.`);
    }
    return { command: "backup setup", ...await backupSetup(bedrockHome(), { type: "r2", account: flags["--r2-account"] as string, bucket: flags["--r2-bucket"] as string, ...retention }, { accessKeyId: flags["--r2-access-key-id"] as string, secretAccessKey: (flags["--r2-secret-access-key"] as string | undefined) ?? await promptSecret("R2 secret access key") }) };
  }
  if (action === "restore" && !flags["--yes"]) throw new BedrockError("CONFIRM_REQUIRED", "Restore replaces pebble data and restarts the pebble.", "Run bedrock backup restore <pebble> --yes.");
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (flags["--at"]) params.set("at", flags["--at"] as string);
  if (flags["--yes"]) params.set("confirm", "true");
  return { command: `backup ${action}`, ...await (await call(flags, `/api/backup/${action}?${params}`, { method: action === "ls" ? "GET" : "POST" })).json() };
}
