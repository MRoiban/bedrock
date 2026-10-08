import { BedrockError } from "./error";
import { buildInfo, checkoutRoot } from "./version";
import type { RunOptions } from "./cli/terminal";

export function redactOutput(output: string) {
  for (const [name, value] of Object.entries(process.env)) {
    if (/(token|secret|password|credential|api_key)/i.test(name) && value && value.length >= 8) output = output.replaceAll(value, "[redacted]");
  }
  return output.replace(/\b(?:brk?_[A-Za-z0-9_-]+)\b/g, "[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+@/g, "$1[redacted]@")
    .replace(/([?&](?:token|key|secret|password|access_token)=)[^\s&]+/gi, "$1[redacted]");
}
export async function updateRun(args: string[], options: RunOptions = {}) {
  try {
    const child = Bun.spawn(args, { ...(options.cwd ? { cwd: options.cwd } : {}), env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const output = redactOutput(stdout + stderr).trim();
    if (code !== 0) throw new BedrockError("UPDATE_PROCESS_FAILED", `Self-update command failed: ${args[1] ?? args[0]}. ${output}`, "Inspect the checkout and dependencies on the server, then retry.");
    return output;
  } catch (error) {
    if (error instanceof BedrockError) throw error;
    throw new BedrockError("UPDATE_PROCESS_FAILED", "Could not start the self-update command.", "Install Git and Bun and check the server checkout permissions.");
  }
}
export async function updateCheckout(options: { checkout?: string; run?: typeof updateRun; platform?: NodeJS.Platform } = {}) {
  const checkout = options.checkout ?? checkoutRoot;
  const execute = options.run ?? updateRun;
  const platform = options.platform ?? process.platform;
  const before = await buildInfo(checkout, execute, platform);
  if (!before.commit) throw new BedrockError("CHECKOUT_REQUIRED", "Self-update needs Bedrock's own git checkout.", "Install from a stable git checkout using install.ps1 or install.sh.");
  if (before.dirty) throw new BedrockError("CHECKOUT_DIRTY", "The Bedrock checkout has uncommitted changes.", "Commit or remove server checkout changes before self-update.");
  let output: string;
  try { output = await execute([platform === "win32" ? "git.exe" : "git", "pull", "--ff-only"], { cwd: checkout }); }
  catch (error) { throw new BedrockError("UPDATE_PULL_FAILED", `Could not fast-forward Bedrock. ${error instanceof Error ? redactOutput(error.message) : ""}`, "Resolve divergent history or Git connectivity on the server, then retry self-update."); }
  output += "\n" + await execute([process.execPath, "install"], { cwd: checkout });
  const after = await buildInfo(checkout, execute, platform);
  if (!after.commit) throw new BedrockError("CHECKOUT_REQUIRED", "Could not read the updated commit.", "Inspect the server checkout before restarting.");
  return { from: before.commit, to: after.commit, updated: before.commit !== after.commit, output: redactOutput(output.trim()) };
}
