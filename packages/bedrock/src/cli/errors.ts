import type { Parsed } from "./spec";
import { BedrockError } from "../error";
import { call } from "./daemon";
export async function errorsCommand(parsed: Parsed, _json: boolean) {
  const { flags, positionals: [pebble, issue, target] } = parsed;
  const action = parsed.path[1] === "ls" ? "list" : parsed.path[1]!;
  const yes = flags["--yes"] === true;
  const write = !["list", "show"].includes(action!);
  if (action === "merge" && !yes) throw new BedrockError("CONFIRM_REQUIRED", "Merging error issues requires confirmation.", "Repeat with --yes.");
  const url = new URL(`http://local/api/pebbles/${encodeURIComponent(pebble!)}/errors${issue ? `/${encodeURIComponent(issue)}` : ""}${write ? `/${action}` : ""}`);
  if (flags["--cursor"]) url.searchParams.set("cursor", flags["--cursor"] as string);
  if (target) url.searchParams.set("target", target);
  if (yes) url.searchParams.set("confirm", "true");
  return { command: `errors ${action}`, ...await (await call(flags, url.pathname + url.search, { method: write ? "POST" : "GET" })).json() };
}
