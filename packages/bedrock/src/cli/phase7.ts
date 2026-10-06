import { backupSetup } from "../backup";
import { bedrockHome } from "../daemon/config";
import { BedrockError } from "../error";
import { call } from "./daemon";
import { promptSecret } from "./ops";

export async function phase7Command(command: "backup" | "jobs", args: string[]) {
  const flags: Record<string, string> = {};
  const positions: string[] = [];
  const invalid = () => { throw new BedrockError("INVALID_ARGS", `Invalid ${command} arguments.`, "Use backup setup --dir <path> or --r2-account <id> --r2-bucket <bucket> --r2-access-key-id <key> [--r2-secret-access-key <secret>]; backup run [pebble], ls <pebble>, restore <pebble> [--at <ts>] --yes; jobs ls <pebble> or run <pebble> <job>."); };
  const accepted = ["--yes", "--at", "--dir", "--r2-account", "--r2-bucket", "--r2-access-key-id", "--r2-secret-access-key", "--interval-minutes", "--keep-hourly", "--keep-daily", "--url", "--token"];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) positions.push(arg);
    else {
      if (!accepted.includes(arg) || flags[arg]) invalid();
      if (arg === "--yes") flags[arg] = "true";
      else { const value = args[++i]; if (!value || value.startsWith("--")) invalid(); flags[arg] = value!; }
    }
  }
  const [action, name, jobName] = positions;
  const keys = Object.keys(flags);
  if (command === "backup" && action === "setup") {
    if (positions.length !== 1 || keys.some(key => ["--at", "--yes", "--url", "--token"].includes(key))) invalid();
    if (flags["--dir"] && keys.some(key => key.startsWith("--r2"))) invalid();
    const retention = { intervalMinutes: Number(flags["--interval-minutes"] ?? 60), hourly: Number(flags["--keep-hourly"] ?? 24), daily: Number(flags["--keep-daily"] ?? 30) };
    if (flags["--dir"]) return { command: "backup setup", ...await backupSetup(bedrockHome(), { type: "fs", directory: flags["--dir"], ...retention }) };
    if (!flags["--r2-account"] || !flags["--r2-bucket"] || !flags["--r2-access-key-id"]) invalid();
    return { command: "backup setup", ...await backupSetup(bedrockHome(), { type: "r2", account: flags["--r2-account"]!, bucket: flags["--r2-bucket"]!, ...retention }, { accessKeyId: flags["--r2-access-key-id"]!, secretAccessKey: flags["--r2-secret-access-key"] ?? await promptSecret("R2 secret access key") }) };
  }
  const allowed = command === "backup" && action === "restore" ? ["--url", "--token", "--at", "--yes"] : ["--url", "--token"];
  if (keys.some(key => !allowed.includes(key))) invalid();
  if (command === "jobs") {
    if (!name || !["ls", "run"].includes(action!) || positions.length !== (action === "run" ? 3 : 2)) invalid();
    return { command: `jobs ${action}`, ...await (await call(flags, `/api/jobs/${encodeURIComponent(name!)}${jobName ? `?job=${encodeURIComponent(jobName)}` : ""}`, { method: action === "run" ? "POST" : "GET" })).json() };
  }
  if (!["run", "ls", "restore"].includes(action!) || positions.length > 2 || action !== "run" && !name) invalid();
  if (action === "restore" && !flags["--yes"]) throw new BedrockError("CONFIRM_REQUIRED", "Restore replaces pebble data and restarts the pebble.", "Run bedrock backup restore <pebble> --yes.");
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (flags["--at"]) params.set("at", flags["--at"]);
  if (flags["--yes"]) params.set("confirm", "true");
  return { command: `backup ${action}`, ...await (await call(flags, `/api/backup/${action}?${params}`, { method: action === "ls" ? "GET" : "POST" })).json() };
}
