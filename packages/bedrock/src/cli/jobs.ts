import type { Parsed } from "./spec";
import { call } from "./daemon";

export async function jobsCommand(parsed: Parsed, _json: boolean) {
  const { flags, positionals: [name, jobName] } = parsed;
  const action = parsed.path[1]!;
  return { command: `jobs ${action}`, ...await (await call(flags, `/api/jobs/${encodeURIComponent(name!)}${action === "history" ? "/history" : ""}${jobName ? `?job=${encodeURIComponent(jobName)}` : ""}`, { method: action === "run" ? "POST" : "GET" })).json() };
}
