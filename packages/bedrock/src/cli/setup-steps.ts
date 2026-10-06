import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite, readConfig, validateConfig } from "../daemon/config";
import { backupSetup } from "../backup";
import type { Cloudflare } from "../tunnel/client";
import { tunnelSetup } from "../tunnel";
import { localTunnelSetup } from "../tunnel/local";
import { cloudflaredBinary } from "../tunnel/supervisor";
import { service, restartService } from "../service";
import { doctor } from "./doctor";
import { BedrockError } from "../error";
import type { Terminal } from "./terminal";
import type { SetupOptions } from "./setup";
import { localStatus, portFree } from "./setup";

export interface StepContext {
  home: string; flags: Record<string, string>; options: SetupOptions; io: Terminal;
  interactive: boolean; redo: boolean; api: Cloudflare | undefined;
  action: (line: string) => void; warning: (line: string) => void; write: (line: string) => void;
  ask: (flag: string, label: string, fallback?: string, secret?: boolean) => Promise<string>;
  confirm: (flag: string, label: string) => Promise<boolean>;
}

async function prereqs(context: StepContext) {
  const { home, options, io, interactive, action, warning, write, confirm } = context;
  const version = options.version ?? Bun.version;
  const [major = 0, minor = 0] = version.split(".").map(Number);
  if (major < 1 || major === 1 && minor < 2) throw new BedrockError("BUN_TOO_OLD", "Bun >= 1.2 is required.", "Run bun upgrade.");
  action(`Bun ${version}`);
  try { (options.binary ?? cloudflaredBinary)(); }
  catch {
    const platform = options.platform ?? process.platform;
    const instructions = "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/";
    const linuxInstall = "sudo mkdir -p --mode=0755 /usr/share/keyrings && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list && sudo apt-get update && sudo apt-get install -y cloudflared";
    if (platform === "darwin") write("Install: brew install cloudflared");
    else write(`Official packages: ${instructions}\nDebian/Ubuntu: ${linuxInstall}`);
    if (!await confirm("--install-cloudflared", "Install cloudflared?")) throw new BedrockError("CLOUDFLARED_MISSING", "cloudflared is required.", `Install it from ${instructions}, or pass --install-cloudflared.`);
    if (platform === "darwin") await io.run(["brew", "install", "cloudflared"], { inherit: true });
    else {
      if (!io.which("apt-get")) throw new BedrockError("CLOUDFLARED_MISSING", "Automatic installation supports Debian/Ubuntu on Linux.", `Install your distribution’s official package from ${instructions}, then rerun setup.`);
      await io.run(["sh", "-c", interactive ? linuxInstall : linuxInstall.replaceAll("sudo ", "sudo -n ")], { inherit: interactive });
    }
    (options.binary ?? cloudflaredBinary)();
  }
  action("cloudflared installed");
  try {
    const space = await (options.disk ?? statfs)(home);
    if (Number(space.bavail) * Number(space.bsize) < 5 * 1024 ** 3) warning("Less than 5 GiB free; make room for pebbles and backups.");
  } catch { warning("Could not inspect free disk space."); }
  return false;
}

async function identity(context: StepContext) {
  const { home, options, io, interactive, action, ask } = context;
  let config = await readConfig(home).catch(() => null);
  const gitEmail = interactive ? await io.run(["git", "config", "user.email"]).catch(() => "") : "";
  const domain = (await ask("--domain", "Cloudflare domain", config?.domain ?? "")).toLowerCase();
  const creator = (await ask("--creator", "Your creator email", config?.creators[0] ?? gitEmail)).toLowerCase();
  const port = Number(await ask("--port", "Daemon port", String(config?.port ?? 3000)));
  if (domain.length > 253 || !domain.includes(".") || domain.split(".").some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(creator) || !Number.isInteger(port) || port < 1 || port > 65535) throw new BedrockError("INVALID_IDENTITY", "Use a public domain, creator email and fixed port.", "Pass --domain example.com --creator you@example.com --port 3000.");
  if (!(await (options.portFree ?? portFree)(port)) && (!config || config.port !== port || !await (options.status ?? localStatus)(home).catch(() => null))) throw new BedrockError("PORT_IN_USE", `Port ${port} is already in use.`, "Choose another --port or stop the other server.");
  config = validateConfig({ ...config, domain, port, creators: [...new Set([creator, ...(config?.creators ?? [])])] });
  await atomicWrite(join(home, "config.json"), JSON.stringify(config, null, 2) + "\n");
  action(`Identity: ${domain} · ${creator} · port ${port}`);
  return false;
}

async function cloudflare(context: StepContext) {
  const { home, options, io, interactive, api, action, write } = context;
  const config = await readConfig(home);
  if (api && config.cloudflare?.mode !== "local") { const ids = await api.discover(config.domain); await tunnelSetup(home, ids.accountId, ids.zoneId, api); }
  else { write("Authorize Cloudflare in your browser; select your domain's zone."); await localTunnelSetup(home, { run: io.run, binary: options.binary ?? cloudflaredBinary, interactive, ...(api ? { api } : {}) }); }
  action(`Tunnel: *.${config.domain} → localhost:${config.port}`);
  return false;
}

async function google(context: StepContext) {
  const { home, flags, io, interactive, redo, action, warning, write, ask } = context;
  let skipped = false;
  const config = await readConfig(home);
  if (flags["--skip-google"]) skipped = true;
  else if (!config.google || redo || flags["--google-client-id"]) {
    if (interactive && !flags["--google-client-id"]) {
      write("Google sign-in identifies your users and creators.\nCreate a Web application OAuth client.\nPublic pebbles work without Google; you can set it up later.");
      const url = "https://console.cloud.google.com/auth/clients/create";
      write(url); await io.open(url);
      write(`Application type: Web application\nAuthorized redirect URI: https://auth.${config.domain}/callback`);
      if (await io.clipboard(`https://auth.${config.domain}/callback`)) action("Redirect URI copied");
      write("Consent screen: External; add yourself as a test user, or publish.\nhttps://console.cloud.google.com/auth/audience");
    }
    const clientId = await ask("--google-client-id", "Google client ID (or skip)", config.google?.clientId ?? "skip");
    if (clientId === "skip") skipped = true;
    else {
      const clientSecret = await ask("--google-client-secret", "Google client secret", "", true);
      if (!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) || !clientSecret) throw new BedrockError("INVALID_GOOGLE_CONFIG", "Google credentials are invalid.", "Pass --google-client-id <id>.apps.googleusercontent.com and --google-client-secret <secret>, or --skip-google.");
      config.google = { clientId, clientSecret };
      await atomicWrite(join(home, "config.json"), JSON.stringify(config, null, 2) + "\n");
    }
  }
  if (skipped) warning("Google deferred: bedrock setup google"); else action("Google sign-in configured");
  return skipped;
}

async function backups(context: StepContext) {
  const { home, flags, io, interactive, redo, api, action, warning, ask } = context;
  let skipped = false;
  const config = await readConfig(home);
  const choice = flags["--skip-backups"] ? "skip" : flags["--dir"] ? "disk" : flags["--r2-bucket"] ? "r2" : config.backup && !redo ? "existing" : interactive ? await io.prompt("Backups: disk / r2 / skip", "skip") : "skip";
  if (choice === "disk") await backupSetup(home, { type: "fs", directory: await ask("--dir", "External disk backup path") });
  else if (choice === "r2") await backupSetup(home, { type: "r2", account: flags["--r2-account"] ?? (api ? (await api.discover(config.domain)).accountId : await ask("--r2-account", "Cloudflare account ID")), bucket: await ask("--r2-bucket", "R2 bucket") }, { accessKeyId: await ask("--r2-access-key-id", "R2 access key ID"), secretAccessKey: await ask("--r2-secret-access-key", "R2 secret key", "", true) });
  else if (choice === "skip") skipped = true;
  else if (choice !== "existing") throw new BedrockError("INVALID_BACKUP_CHOICE", "Choose disk, r2 or skip.", "Pass --dir <path>, R2 flags, or --skip-backups.");
  if (skipped) warning("Backups deferred: bedrock setup backups"); else action("Backups configured");
  return skipped;
}

async function installService(context: StepContext) {
  const { home, options, io, interactive, action, warning, confirm } = context;
  if ((options.platform ?? process.platform) === "linux") {
    if (await confirm("--enable-linger", "Enable startup without login (loginctl enable-linger)?")) await io.run(["loginctl", ...(interactive ? [] : ["--no-ask-password"]), "enable-linger", process.env.USER ?? ""], { inherit: interactive });
    else warning("Startup without login: loginctl enable-linger $USER (or --enable-linger)");
  }
  await (options.installService ?? (home => service("install", { home })))(home);
  await (options.restart ?? (home => restartService({ home })))(home);
  const status = options.status ?? localStatus;
  let healthy = false;
  for (let i = 0; i < 60; i++) { if (await status(home).catch(() => null)) { healthy = true; break; } await io.sleep(500); }
  if (!healthy) throw new BedrockError("DAEMON_UNREACHABLE", "Service did not become healthy.", "Inspect bedrock service status and daemon logs, then rerun bedrock setup service.");
  action("Service started · daemon healthy");
  return false;
}

async function verify(context: StepContext) {
  const { home, flags, options, io, action, warning, write } = context;
  let skipped = false;
  const checks = await (options.checks ?? (home => doctor(home)))(home);
  checks.forEach(check => { if (check.status !== "pass") write(`${check.status === "fail" ? "✗" : "!"} ${check.name}: ${check.message}`); });
  if (checks.some(check => check.status === "fail")) throw new BedrockError("SETUP_VERIFY_FAILED", "Doctor found a failing check.", "Run bedrock doctor, repair failed checks, then rerun bedrock setup verify.");
  action("Doctor passed");
  const config = await readConfig(home);
  if (config.google && !flags["--skip-sign-in"]) {
    const url = `https://bedrock.${config.domain}`;
    write(`Sign in once as ${config.creators[0]}: ${url}`); await io.open(url);
    let signedIn = false;
    let deferred = false;
    const controller = new AbortController();
    const input = io.prompt("Type skip to defer sign-in; setup checks automatically", "", false, controller.signal)
      .then(value => { deferred = value === "skip"; }).catch(() => {});
    try {
      for (let i = 0; i < 300 && !deferred; i++) {
        if ((await (options.status ?? localStatus)(home).catch(() => null))?.creatorSignedIn) { signedIn = true; break; }
        await io.sleep(1000);
      }
    } finally { controller.abort(); await input; }
    if (!signedIn) { skipped = true; warning("Creator sign-in deferred: bedrock setup verify"); } else action("Creator sign-in verified");
  } else if (config.google) { skipped = true; warning("Creator sign-in deferred: bedrock setup verify"); }
  return skipped;
}

export const stepActions = { prereqs, identity, cloudflare, google, backups, service: installService, verify };
