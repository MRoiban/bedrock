import { BedrockError } from "../error";
export function testOptions(args: string[]) {
  const options = { path: "", grep: "", project: "", headed: false, list: false, repeat: 1, diagnosticRetry: false, updateSnapshots: false };
  const invalid = (): never => { throw new BedrockError("INVALID_ARGS", "Invalid test arguments.", "Use bedrock test --help."); };
  let yes = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--yes") yes = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--diagnostic-retry") options.diagnosticRetry = true;
    else if (arg === "--update-snapshots") options.updateSnapshots = true;
    else if (["--grep", "--project", "--repeat"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) invalid();
      if (arg === "--grep") { try { new RegExp(value!); } catch { invalid(); } options.grep = value!; }
      if (arg === "--project") { if (!["desktop", "phone"].includes(value!)) invalid(); options.project = value!; }
      if (arg === "--repeat") { options.repeat = Number(value); if (!Number.isSafeInteger(options.repeat) || options.repeat < 1 || options.repeat > 100) invalid(); }
    } else if (!arg.startsWith("-") && !options.path) options.path = arg;
    else invalid();
  }
  if (options.updateSnapshots && !yes) throw new BedrockError("CONFIRM_REQUIRED", "Updating visual baselines requires --yes.", "Review selected states, then run bedrock test --update-snapshots --yes.");
  return options;
}
