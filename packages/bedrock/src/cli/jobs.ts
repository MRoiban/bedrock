import { BedrockError } from "../error";
import { call } from "./daemon";

export async function jobsCommand(args: string[]) {
  const flags: Record<string, string> = {};
  const positions: string[] = [];
  const invalid = () => { throw new BedrockError("INVALID_ARGS", "Invalid jobs arguments.", "Use jobs ls <pebble> or run <pebble> <job>, optionally with --url <url> and --token <token>."); };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) positions.push(arg);
    else {
      if (!["--url", "--token"].includes(arg) || flags[arg]) invalid();
      const value = args[++i];
      if (!value || value.startsWith("--")) invalid();
      flags[arg] = value!;
    }
  }
  const [action, name, jobName] = positions;
  if (!name || !["ls", "run"].includes(action!) || positions.length !== (action === "run" ? 3 : 2)) invalid();
  return { command: `jobs ${action}`, ...await (await call(flags, `/api/jobs/${encodeURIComponent(name!)}${jobName ? `?job=${encodeURIComponent(jobName)}` : ""}`, { method: action === "run" ? "POST" : "GET" })).json() };
}
