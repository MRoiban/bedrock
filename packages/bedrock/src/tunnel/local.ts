import { copyFile, mkdir, rm } from "node:fs/promises";
import { privateFile } from "../private-file";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { atomicWrite, readConfig, type LocalTunnel } from "../daemon/config";
import { BedrockError } from "../error";
import { cloudflaredBinary } from "./supervisor";
import type { Cloudflare } from "./client";
import { run, type RunOptions } from "../cli/terminal";

export interface LocalOptions { binary?: () => string; run?: (args: string[], options?: RunOptions) => Promise<string>; host?: string; interactive?: boolean; api?: Cloudflare }
export interface IngressRule { hostname?: string; service: string }
// Extra hostname rules come first: cloudflared uses the first match, so they must precede the wildcard.
export function localConfig(domain: string, port: number, id: string, credentials: string, extra: IngressRule[] = []) {
  // Quoted so a preserved service keeps characters YAML would otherwise read as a comment.
  const rules = extra.map(rule => `  - hostname: ${JSON.stringify(rule.hostname)}\n    service: ${JSON.stringify(rule.service)}\n`).join("");
  return `tunnel: ${JSON.stringify(id)}\ncredentials-file: ${JSON.stringify(credentials)}\ningress:\n${rules}  - hostname: ${JSON.stringify(`*.${domain}`)}\n    service: http://127.0.0.1:${port}\n  - service: http_status:404\n`;
}
// Reads only the shape localConfig writes; anything else is reported as unrecognized rather than guessed at.
export function parseLocalConfig(yaml: string) {
  const parsed: { tunnel?: string; credentialsFile?: string; rules: IngressRule[]; unrecognized: string[] } = { rules: [], unrecognized: [] };
  // Only JSON-quoted or plain scalars round-trip; other YAML quoting is left for a human.
  const scalar = (raw: string) => {
    if (!raw.startsWith('"')) return /^[^\s'"#]+$/.test(raw) ? raw : undefined;
    try { const decoded = JSON.parse(raw); return typeof decoded === "string" ? decoded : undefined; } catch { return undefined; }
  };
  const value = (raw: string) => scalar(raw)!;
  for (const line of yaml.split("\n")) {
    let match: RegExpExecArray | null;
    if (!line.trim() || line.trim().startsWith("#") || line === "ingress:") continue;
    const raw = /: (.+)$/.exec(line)?.[1];
    if (raw !== undefined && scalar(raw) === undefined) { parsed.unrecognized.push(line); continue; }
    if ((match = /^tunnel: (.+)$/.exec(line))) parsed.tunnel = value(match[1]!);
    else if ((match = /^credentials-file: (.+)$/.exec(line))) parsed.credentialsFile = value(match[1]!);
    else if ((match = /^  - hostname: (.+)$/.exec(line))) parsed.rules.push({ hostname: value(match[1]!), service: "" });
    else if ((match = /^    service: (.+)$/.exec(line)) && parsed.rules.at(-1)?.service === "") parsed.rules.at(-1)!.service = value(match[1]!);
    else if ((match = /^  - service: (.+)$/.exec(line))) parsed.rules.push({ service: value(match[1]!) });
    else parsed.unrecognized.push(line);
  }
  return parsed;
}
// Setup may rewrite the wildcard's port, but anything beyond extra hostname rules, one wildcard and the final 404 catch-all is a hand edit it must not drop.
export function unmanagedEdits(parsed: ReturnType<typeof parseLocalConfig>, domain: string) {
  const problems = [...parsed.unrecognized];
  if (parsed.rules.filter(rule => rule.hostname === `*.${domain}`).length > 1) problems.push(`more than one *.${domain} rule`);
  const catchAlls = parsed.rules.filter(rule => !rule.hostname);
  if (parsed.rules.length && (catchAlls.length !== 1 || parsed.rules.at(-1) !== catchAlls[0] || catchAlls[0]!.service !== "http_status:404")) problems.push("a catch-all other than one final http_status:404");
  return problems;
}
// config.json keeps these relative to home so it can move; cloudflared needs absolute paths.
export const localTunnelFiles = (home: string, tunnel: Pick<LocalTunnel, "credentialsFile" | "configFile">) =>
  ({ credentialsFile: resolve(home, tunnel.credentialsFile), configFile: resolve(home, tunnel.configFile) });
export async function localTunnelSetup(home: string, options: LocalOptions = {}) {
  const config = await readConfig(home);
  if (config.cloudflare && config.cloudflare.mode !== "local") throw new BedrockError("TUNNEL_CONFLICT", "This server already uses an API-managed tunnel.", "Use --api-token to update it, or tear it down before changing modes.");
  if (config.port === 0 || !config.domain.includes(".")) throw new BedrockError("INVALID_TUNNEL_CONFIG", "A public domain and fixed port are required.", "Run bedrock setup identity with --domain example.com --port 3000.");
  const binary = (options.binary ?? cloudflaredBinary)();
  const execute = options.run ?? run;
  const directory = join(home, "cloudflared");
  const cert = join(directory, "cert.pem");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!await Bun.file(cert).exists()) {
    if (!options.interactive) throw new BedrockError("SETUP_FLAGS_MISSING", "Cloudflare browser authorization is required.", "Use --api-token <token> for unattended setup, or rerun bedrock setup cloudflare in a terminal.");
    // Login ignores --origincert and writes to ~/.cloudflared; isolate its HOME.
    const loginHome = join(directory, "login-home");
    await mkdir(join(loginHome, ".cloudflared"), { recursive: true, mode: 0o700 });
    await execute([binary, "tunnel", "login"], { env: { ...process.env, HOME: loginHome, USERPROFILE: loginHome }, inherit: true });
    await copyFile(join(loginHome, ".cloudflared/cert.pem"), cert);
    await privateFile(cert);
    await rm(loginHome, { recursive: true, force: true });
  }
  const prefix = [binary, "tunnel", "--origincert", cert];
  const name = config.cloudflare?.name ?? `bedrock-${options.host ?? hostname()}`;
  const output = await execute([...prefix, "list", "--output", "json", "--name", name]);
  // cloudflared serializes an empty Go slice as null, not [].
  const tunnels = (output.trim() ? JSON.parse(output) : null) ?? [];
  if (!Array.isArray(tunnels) || tunnels.some(t => !t || typeof t.id !== "string" || typeof t.name !== "string")) throw new BedrockError("CLOUDFLARED_OUTPUT_INVALID", "cloudflared tunnel list returned an invalid tunnel list.", "Check cloudflared's version and retry bedrock setup cloudflare.");
  const matches = tunnels.filter(t => t.name === name);
  if (matches.length > 1) throw new BedrockError("TUNNEL_CONFLICT", "Multiple tunnels match this hostname.", "Remove duplicate tunnels in Cloudflare and retry.");
  const stored = { credentialsFile: config.cloudflare?.credentialsFile ?? join("cloudflared", "credentials.json"), configFile: join("cloudflared", "config.yml") };
  const { credentialsFile, configFile } = localTunnelFiles(home, stored);
  if (!matches.length) await execute([...prefix, "create", "--credentials-file", credentialsFile, name]);
  const credentials = await Bun.file(credentialsFile).json().catch(() => null);
  const id = matches[0]?.id ?? credentials?.TunnelID;
  if (!id || credentials?.TunnelID !== id) throw new BedrockError("TUNNEL_CREDENTIALS_MISSING", "Local tunnel credentials are missing or do not match.", "Restore cloudflared/credentials.json from this server, or delete the unused tunnel and repeat setup.");
  await privateFile(credentialsFile);
  // Hand-added hostname rules (e.g. a pebble's own game port) survive a rerun; other edits cannot be kept safely.
  const existing = parseLocalConfig(await Bun.file(configFile).text().catch(() => ""));
  const edits = unmanagedEdits(existing, config.domain);
  if (edits.length) throw new BedrockError("TUNNEL_CONFIG_CUSTOM", `${configFile} has settings Bedrock cannot preserve: ${edits.join(" | ")}`, "Move config.yml aside, rerun bedrock setup cloudflare, then re-add your settings by hand.");
  const extra = existing.rules.filter(rule => rule.hostname && rule.hostname !== `*.${config.domain}`);
  await atomicWrite(configFile, localConfig(config.domain, config.port, id, credentialsFile, extra));
  config.cloudflare = { mode: "local", tunnelId: id, name, ...stored };
  await atomicWrite(join(home, "config.json"), JSON.stringify(config, null, 2) + "\n");
  try {
    await execute([...prefix, "route", "dns", "--help"]);
    await execute([...prefix, "route", "dns", id, `*.${config.domain}`]);
  } catch {
    if (!options.api) throw new BedrockError("LOCAL_DNS_FAILED", "cloudflared could not create the wildcard DNS route.", "Check DNS conflicts and cloudflared's version, or rerun bedrock setup cloudflare --api-token <token> to use the DNS API fallback.");
    const { zoneId } = await options.api.discover(config.domain);
    await options.api.wildcard(zoneId, config.domain, id);
  }
  return { configured: true, tunnelId: id, hostname: `*.${config.domain}` };
}
