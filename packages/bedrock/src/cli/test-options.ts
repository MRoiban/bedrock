import { BedrockError } from "../error";
import { usageError } from "./args";
import type { Parsed } from "./spec";

export function testOptions(parsed: Parsed) {
  const { flags, positionals } = parsed;
  const grep = flags["--grep"] as string | undefined;
  if (grep !== undefined) {
    try { new RegExp(grep); }
    catch { throw usageError(parsed.path, `Invalid regular expression '${grep}' for --grep.`); }
  }
  const repeat = flags["--repeat"] === undefined ? 1 : Number(flags["--repeat"]);
  if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 100) {
    throw usageError(parsed.path, `Invalid value '${flags["--repeat"]}' for --repeat; use an integer from 1 to 100.`);
  }
  if (flags["--update-snapshots"] && !flags["--yes"]) {
    throw new BedrockError("CONFIRM_REQUIRED", "Updating visual baselines requires --yes.", "Review selected states, then run bedrock test --update-snapshots --yes.");
  }
  return {
    path: positionals[0] ?? "", grep: grep ?? "", project: flags["--project"] as string | undefined ?? "",
    headed: !!flags["--headed"], list: !!flags["--list"], repeat,
    diagnosticRetry: !!flags["--diagnostic-retry"], updateSnapshots: !!flags["--update-snapshots"],
  };
}
