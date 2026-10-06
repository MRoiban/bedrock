import { mkdir, type statfs } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { atomicWrite, bedrockHome, readConfig } from "../daemon/config";
import { Cloudflare } from "../tunnel/client";
import { type Check } from "./doctor";
import { BedrockError, asBedrockError } from "../error";
import { stepActions } from "./setup-steps";
import { terminal, marker, type Terminal } from "./terminal";

export const setupSteps = ["prereqs", "identity", "cloudflare", "google", "backups", "service", "verify"] as const;
type Step = typeof setupSteps[number];
interface State { version: 1; steps: Partial<Record<Step, { completedAt: string; skipped?: boolean }>> }
const booleans = ["--yes", "--status", "--install-cloudflared", "--skip-google", "--skip-backups", "--enable-linger", "--skip-sign-in"];
const values = ["--domain", "--creator", "--port", "--api-token", "--google-client-id", "--google-client-secret", "--dir", "--r2-account", "--r2-bucket", "--r2-access-key-id", "--r2-secret-access-key"];
export interface SetupOptions {
  home?: string; tty?: boolean; terminal?: Partial<Terminal>; binary?: () => string; api?: Cloudflare;
  platform?: string; version?: string; disk?: typeof statfs; portFree?: (port: number) => Promise<boolean>;
  installService?: (home: string) => Promise<unknown>; restart?: (home: string) => Promise<unknown>;
  checks?: (home: string) => Promise<Check[]>; status?: (home: string) => Promise<{ creatorSignedIn: boolean }>;
}
export async function localStatus(home: string) {
  const config = await readConfig(home);
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const response = await fetch(`http://127.0.0.1:${config.port}/api/status`, { headers: { host: `bedrock.${config.domain}`, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
  if (!response.ok) throw new BedrockError("DAEMON_UNREACHABLE", "Daemon is not ready.", "Inspect bedrock service status and daemon logs.");
  return (await response.json()).value as { creatorSignedIn: boolean };
}
export async function portFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
export async function setupWizard(args: string[], json = false, options: SetupOptions = {}) {
  const flags: Record<string, string> = {};
  let step: Step | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (setupSteps.includes(arg as Step) && !step) { step = arg as Step; continue; }
    if (![...booleans, ...values].includes(arg) || flags[arg]) throw new BedrockError("INVALID_ARGS", `Unknown or repeated setup argument: ${arg}`, "Use bedrock setup [prereqs|identity|cloudflare|google|backups|service|verify] [--status] [--json].");
    if (booleans.includes(arg)) flags[arg] = "true";
    else { const value = args[++i]; if (!value || value.startsWith("--")) throw new BedrockError("INVALID_ARGS", `Missing ${arg} value.`, `Pass ${arg} <value>.`); flags[arg] = value; }
  }
  const home = options.home ?? bedrockHome();
  const io = { ...terminal, ...options.terminal };
  const tty = options.tty ?? !!process.stdin.isTTY;
  const interactive = tty && !json && !flags["--yes"];
  const write = (line: string) => { if (!json) io.write(line); };
  const action = (line: string) => write(`${marker("✓", tty)} ${line}`);
  const warning = (line: string) => write(`${marker("!", tty)} ${line}`);
  const statePath = join(home, "setup.json");
  const state: State = await Bun.file(statePath).json().catch(() => ({ version: 1, steps: {} }));
  if (state.version !== 1 || !state.steps || typeof state.steps !== "object") throw new BedrockError("INVALID_SETUP_STATE", "Setup state is invalid.", "Restore setup.json or remove it to start the checklist again.");
  const checklist = () => setupSteps.map((name, i) => ({ number: i + 1, step: name, done: !!state.steps[name], skipped: !!state.steps[name]?.skipped }));
  if (flags["--status"]) {
    if (!json) checklist().forEach(item => write(`${item.number}. ${item.done ? marker("✓", tty) : "·"} ${item.step}${item.skipped ? " (skipped)" : ""}`));
    return { command: "setup status", steps: checklist() };
  }
  const pending = step ? [step] : setupSteps.filter(name => !state.steps[name]);
  let config = await readConfig(home).catch(() => null);
  const token = flags["--api-token"] ?? process.env.CLOUDFLARE_API_TOKEN;
  const api = options.api ?? (token ? new Cloudflare(token) : undefined);
  if (!interactive) {
    const missing: string[] = [];
    if (pending.includes("identity")) {
      if (!flags["--domain"] && !config?.domain) missing.push("--domain <domain>");
      if (!flags["--creator"] && !config?.creators.length) missing.push("--creator <email>");
    }
    if (pending.includes("cloudflare") && !api && !await Bun.file(join(home, "cloudflared/cert.pem")).exists()) missing.push("--api-token <token>");
    if (pending.includes("google") && (!config?.google || step === "google" || flags["--google-client-id"] || flags["--google-client-secret"]) && !flags["--skip-google"]) {
      if (!flags["--google-client-id"] && !config?.google) missing.push("--google-client-id <id>");
      if (!flags["--google-client-secret"]) missing.push("--google-client-secret <secret>");
    }
    if (pending.includes("backups") && (!config?.backup || step === "backups") && !flags["--skip-backups"] && !flags["--dir"]) {
      if (!flags["--r2-bucket"]) missing.push("--dir <path> OR --skip-backups OR --r2-bucket <bucket>");
      if (!flags["--r2-access-key-id"]) missing.push("--r2-access-key-id <key>");
      if (!flags["--r2-secret-access-key"]) missing.push("--r2-secret-access-key <secret>");
      if (!flags["--r2-account"] && !api) missing.push("--r2-account <id> OR --api-token <token>");
    }
    if (pending.includes("verify") && (config?.google || flags["--google-client-id"]) && !flags["--skip-sign-in"]) missing.push("--skip-sign-in (browser verification later)");
    if (missing.length) throw new BedrockError("SETUP_FLAGS_MISSING", "Unattended setup needs explicit choices.", `Missing flags: ${missing.join(", ")}. Google and backups may be deferred with --skip-google --skip-backups.`);
  }
  const ask = async (flag: string, label: string, fallback = "", secret = false) => flags[flag] ?? (interactive ? io.prompt(label, fallback, secret) : fallback);
  const confirm = async (flag: string, label: string) => !!flags[flag] || interactive && /^(y|yes)$/i.test(await io.prompt(label, "n"));
  await mkdir(home, { recursive: true, mode: 0o700 });
  checklist().forEach(item => write(`${item.number}. ${item.done ? marker("✓", tty) : "·"} ${item.step}`));
  for (const current of step ? [step] : setupSteps) {
    if (!step && state.steps[current]) continue;
    // A redo must remain incomplete if its replacement fails.
    delete state.steps[current];
    if (current === "service") delete state.steps.verify;
    if (current === "identity") delete state.steps.cloudflare;
    if (current !== "service" && current !== "verify") { delete state.steps.service; delete state.steps.verify; }
    await atomicWrite(statePath, JSON.stringify(state, null, 2) + "\n");
    let skipped = false;
    try {
      skipped = await stepActions[current]({ home, flags, options, io, interactive, redo: !!step, api, action, warning, write, ask, confirm });
      state.steps[current] = { completedAt: new Date().toISOString(), ...(skipped ? { skipped: true } : {}) };
      await atomicWrite(statePath, JSON.stringify(state, null, 2) + "\n");
    } catch (error) { write(`${marker("✗", tty)} ${current} incomplete; rerun bedrock setup to resume.`); throw asBedrockError(error, "SETUP_FAILED", `Rerun bedrock setup ${current}.`); }
  }
  config = await readConfig(home).catch(() => null);
  if (config && setupSteps.every(name => state.steps[name])) write(`\n┌ You're live\n│ https://bedrock.${config.domain}\n│ https://<pebble>.${config.domain}\n│ On your laptop:\n│ bedrock login ${config.domain}\n│ bedrock new my-app && cd my-app && bedrock dev\n│ bedrock deploy\n└`);
  return { command: "setup", steps: checklist(), domain: config?.domain };
}
