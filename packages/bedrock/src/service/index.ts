import { mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { atomicWrite } from "../daemon/config";
import { BedrockError } from "../error";

export interface ServiceOptions {
  home: string;
  platform?: string;
  target?: string;
  bun?: string;
  cli?: string;
  uid?: number;
  run?: (args: string[]) => Promise<void>;
}
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const systemd = (s: string) => '"' + s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", () => "$$") + '"';
export function serviceFile(options: ServiceOptions) {
  const platform = options.platform ?? process.platform;
  const bun = options.bun ?? process.execPath;
  const cli = options.cli ?? join(import.meta.dir, "../cli/index.ts");
  if (![bun, cli, options.home].every(path => isAbsolute(path) && !/[\r\n\0]/.test(path))) throw new BedrockError("INVALID_SERVICE_PATH", "Service paths must be absolute and contain no line breaks.", "Use absolute paths for Bun, the CLI, and BEDROCK_HOME.");
  if (platform === "darwin") {
    return { path: options.target ?? join(homedir(), "Library/LaunchAgents/dev.bedrock.daemon.plist"), platform,
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>dev.bedrock.daemon</string>\n<key>ProgramArguments</key><array><string>${xml(bun)}</string><string>${xml(cli)}</string><string>daemon</string></array>\n<key>EnvironmentVariables</key><dict><key>BEDROCK_HOME</key><string>${xml(options.home)}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n</dict></plist>\n` };
  }
  if (platform === "linux") return { path: options.target ?? join(homedir(), ".config/systemd/user/bedrock.service"), platform,
    content: `[Unit]\nDescription=Bedrock personal cloud\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${systemd(bun)} ${systemd(cli)} daemon\nEnvironment="BEDROCK_HOME=${options.home.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"\nEnvironment="PATH=/usr/local/bin:/usr/bin:/bin"\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n` };
  throw new BedrockError("UNSUPPORTED_PLATFORM", "Services support macOS and Linux.", "Run bedrock daemon directly on this operating system.");
}
async function run(args: string[]) {
  try {
    const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (await child.exited !== 0) throw new Error("service command failed");
  } catch { throw new BedrockError("SERVICE_FAILED", `Could not run ${args[0]}.`, "Run this command as your login user in an active launchd/systemd user session; inspect the service manager logs."); }
}
export async function service(action: string, options: ServiceOptions, dryRun = false) {
  const file = serviceFile(options);
  const runner = options.run ?? run;
  const uid = options.uid ?? process.getuid?.() ?? 0;
  const exists = await Bun.file(file.path).exists();
  const hint = file.platform === "linux" ? "For startup without login, run: loginctl enable-linger $USER" : "The LaunchAgent runs while your user is logged in.";
  if (action === "status") {
    let running = false;
    if (exists) {
      try { await runner(file.platform === "darwin" ? ["launchctl", "print", `gui/${uid}/dev.bedrock.daemon`] : ["systemctl", "--user", "is-active", "--quiet", "bedrock.service"]); running = true; } catch { /* An inactive service is a status, not a command failure. */ }
    }
    return { installed: exists, running, path: file.path, hint };
  }
  if (!["install", "uninstall"].includes(action)) throw new BedrockError("INVALID_ARGS", "Unknown service action.", "Use bedrock service install|uninstall|status [--dry-run].");
  if (dryRun) return { action, dryRun: true, ...file, hint };
  if (action === "install") {
    const unchanged = exists && await Bun.file(file.path).text() === file.content;
    await mkdir(dirname(file.path), { recursive: true });
    await atomicWrite(file.path, file.content);
    if (file.platform === "darwin") {
      let loaded = false;
      try { await runner(["launchctl", "print", `gui/${uid}/dev.bedrock.daemon`]); loaded = true; } catch {}
      if (loaded && !unchanged) await runner(["launchctl", "bootout", `gui/${uid}/dev.bedrock.daemon`]);
      if (!loaded || !unchanged) await runner(["launchctl", "bootstrap", `gui/${uid}`, file.path]);
    } else { await runner(["systemctl", "--user", "daemon-reload"]); await runner(["systemctl", "--user", "enable", "--now", "bedrock.service"]); }
  } else if (exists) {
    if (file.platform === "darwin") {
      let loaded = false;
      try { await runner(["launchctl", "print", `gui/${uid}/dev.bedrock.daemon`]); loaded = true; } catch {}
      if (loaded) await runner(["launchctl", "bootout", `gui/${uid}/dev.bedrock.daemon`]);
    } else await runner(["systemctl", "--user", "disable", "--now", "bedrock.service"]);
    await rm(file.path, { force: true });
    if (file.platform === "linux") await runner(["systemctl", "--user", "daemon-reload"]);
  }
  return { action, installed: action === "install", path: file.path, hint };
}
