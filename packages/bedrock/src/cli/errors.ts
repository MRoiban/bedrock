import { BedrockError } from "../error";
import { call } from "./daemon";
export async function errorsCommand(args: string[]) {
  const flags: Record<string, string> = {}, positions: string[] = [];
  let yes = false;
  const invalid = () => { throw new BedrockError("INVALID_ARGS", "Invalid errors arguments.", "Use errors <pebble>, errors show <pebble> <issue>, or errors resolve|ignore|merge <pebble> <issue> [target] --yes; add --cursor, --url, --token or --json."); };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--yes") yes = true;
    else if (!arg.startsWith("--")) positions.push(arg);
    else { if (!["--url", "--token", "--cursor"].includes(arg) || flags[arg] || !args[i + 1] || args[i + 1]!.startsWith("--")) invalid(); flags[arg] = args[++i]!; }
  }
  const action = positions.length === 1 ? "list" : positions.shift();
  const [pebble, issue, target] = positions;
  if (!pebble || !["list", "show", "resolve", "ignore", "merge"].includes(action!) || positions.length !== (action === "list" ? 1 : action === "merge" ? 3 : 2)) invalid();
  const write = !["list", "show"].includes(action!);
  if (action === "merge" && !yes) throw new BedrockError("CONFIRM_REQUIRED", "Merging error issues requires confirmation.", "Repeat with --yes.");
  const url = new URL(`http://local/api/pebbles/${encodeURIComponent(pebble!)}/errors${issue ? `/${encodeURIComponent(issue)}` : ""}${write ? `/${action}` : ""}`);
  if (flags["--cursor"]) url.searchParams.set("cursor", flags["--cursor"]);
  if (target) url.searchParams.set("target", target);
  if (yes) url.searchParams.set("confirm", "true");
  return { command: `errors ${action}`, ...await (await call(flags, url.pathname + url.search, { method: write ? "POST" : "GET" })).json() };
}
