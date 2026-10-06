import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { atomicWrite, readConfig } from "../daemon/config";
import { BedrockError } from "../error";
import { cloudflaredBinary } from "./supervisor";
import type { Cloudflare } from "./client";
import { run, type RunOptions } from "../cli/terminal";

export interface LocalOptions { binary?: () => string; run?: (args: string[], options?: RunOptions) => Promise<string>; host?: string; interactive?: boolean; api?: Cloudflare }
export function localConfig(domain: string, port: number, id: string, credentials: string) {
  return `tunnel: ${JSON.stringify(id)}\ncredentials-file: ${JSON.stringify(credentials)}\ningress:\n  - hostname: ${JSON.stringify(`*.${domain}`)}\n    service: http://127.0.0.1:${port}\n  - service: http_status:404\n`;
}
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
    await execute([binary, "tunnel", "login"], { env: { ...process.env, HOME: loginHome }, inherit: true });
    await copyFile(join(loginHome, ".cloudflared/cert.pem"), cert);
    await chmod(cert, 0o600);
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
  const credentialsFile = config.cloudflare?.credentialsFile ?? join(directory, "credentials.json");
  if (!matches.length) await execute([...prefix, "create", "--credentials-file", credentialsFile, name]);
  const credentials = await Bun.file(credentialsFile).json().catch(() => null);
  const id = matches[0]?.id ?? credentials?.TunnelID;
  if (!id || credentials?.TunnelID !== id) throw new BedrockError("TUNNEL_CREDENTIALS_MISSING", "Local tunnel credentials are missing or do not match.", "Restore cloudflared/credentials.json from this server, or delete the unused tunnel and repeat setup.");
  await chmod(credentialsFile, 0o600);
  const configFile = join(directory, "config.yml");
  await atomicWrite(configFile, localConfig(config.domain, config.port, id, credentialsFile));
  config.cloudflare = { mode: "local", tunnelId: id, name, credentialsFile, configFile };
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
