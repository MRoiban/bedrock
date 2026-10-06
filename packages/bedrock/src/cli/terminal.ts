import { createInterface } from "node:readline/promises";
import { openBrowser } from "./credentials";
import { BedrockError } from "../error";

export async function promptSecret(label = "Cloudflare API token") {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new BedrockError("SECRET_MISSING", `No ${label} was provided.`, "Pass the secret explicitly; noninteractive commands cannot prompt.");
  process.stderr.write(`${label} (hidden): `);
  return new Promise<string>((resolve, reject) => {
    let token = "";
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", data); process.stderr.write("\n"); };
    const data = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === "\r" || char === "\n") { cleanup(); resolve(token.trim()); return; }
        if (char === "\x03" || char === "\x04") { cleanup(); reject(new BedrockError("CANCELLED", "Token entry cancelled.", `Retry when you have the ${label}.`)); return; }
        if (char === "\x7f" || char === "\b") token = token.slice(0, -1);
        else if (char >= " ") token += char;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", data);
  });
}

export interface RunOptions { cwd?: string; env?: NodeJS.ProcessEnv; inherit?: boolean }
export async function run(args: string[], options: RunOptions = {}) {
  try {
    const child = Bun.spawn(args, { ...(options.cwd ? { cwd: options.cwd } : {}), env: options.env ?? process.env,
      stdin: options.inherit ? "inherit" : "ignore", stdout: options.inherit ? 2 : "pipe", stderr: options.inherit ? "inherit" : "pipe" });
    const [output, , code] = await Promise.all([
      options.inherit ? "" : new Response(child.stdout as ReadableStream<Uint8Array>).text(),
      options.inherit ? "" : new Response(child.stderr as ReadableStream<Uint8Array>).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error();
    return output.trim();
  } catch { throw new BedrockError("PROCESS_FAILED", `Could not run ${args[0]} ${args[1] ?? ""}.`, "Check the command's installation, permissions and logs, then retry the step."); }
}
export async function prompt(label: string, fallback = "", secret = false, signal?: AbortSignal) {
  if (secret) return promptSecret(label);
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try { return (await reader.question(`${label}${fallback ? ` [${fallback}]` : ""}: `, signal ? { signal } : {})).trim() || fallback; }
  finally { reader.close(); }
}
export async function clipboard(value: string) {
  const command = (process.platform === "win32" ? ["clip.exe"] : ["pbcopy", "wl-copy", "xclip"]).find(name => Bun.which(name));
  if (!command) return false;
  try {
    const child = Bun.spawn(command === "xclip" ? [command, "-selection", "clipboard"] : [command], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    child.stdin.write(value); child.stdin.end();
    return await child.exited === 0;
  } catch { return false; }
}
export const terminal = { prompt, run, open: openBrowser, clipboard,
  write: (line: string) => console.log(line), which: (name: string) => Bun.which(name),
  sleep: (ms: number) => Bun.sleep(ms) };
export type Terminal = typeof terminal;
export function marker(kind: "✓" | "✗" | "!", tty: boolean) {
  return tty && process.env.NO_COLOR === undefined ? `\x1b[${kind === "✓" ? 32 : kind === "✗" ? 31 : 33}m${kind}\x1b[0m` : kind;
}
