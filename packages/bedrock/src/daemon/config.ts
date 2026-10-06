import { mkdir, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BedrockError, asBedrockError } from "../error";

export interface LocalTunnel { mode: "local"; tunnelId: string; name: string; credentialsFile: string; configFile: string }
export interface RemoteTunnel { mode?: "remote"; accountId: string; zoneId: string; tunnelId: string; dnsRecordId: string; name: string }
export interface DaemonConfig { backup?: import("../backup").BackupConfig; domain: string; creators: string[]; port: number; google?: { clientId: string; clientSecret: string }; cloudflare?: LocalTunnel | RemoteTunnel }
export const bedrockHome = () => resolve(process.env.BEDROCK_HOME ?? join(homedir(), ".bedrock"));

export function validateConfig(config: DaemonConfig) {
  if (!config || typeof config.domain !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(config.domain) ||
      !Array.isArray(config.creators) || config.creators.some(email => typeof email !== "string" || !email.includes("@")) ||
      !Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new BedrockError("INVALID_DAEMON_CONFIG", "Invalid daemon domain, creators, or port.", "Use a lowercase hostname, creator emails, and a port from 0 to 65535.");
  }
  if (config.google && (typeof config.google.clientId !== "string" || !config.google.clientId || typeof config.google.clientSecret !== "string" || !config.google.clientSecret)) throw new BedrockError("INVALID_DAEMON_CONFIG", "Both Google credentials are required.", "Pass --google-client-id and --google-client-secret together.");
  if (config.cloudflare && (config.cloudflare.mode === "local" ? [config.cloudflare.tunnelId, config.cloudflare.name, config.cloudflare.credentialsFile, config.cloudflare.configFile] : [config.cloudflare.accountId, config.cloudflare.zoneId, config.cloudflare.tunnelId, config.cloudflare.dnsRecordId, config.cloudflare.name]).some(value => typeof value !== "string" || !value)) throw new BedrockError("INVALID_DAEMON_CONFIG", "Invalid Cloudflare configuration.", "Run bedrock tunnel setup again.");
  return config;
}

export async function atomicWrite(path: string, value: string, mode = 0o600) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  const file = await open(temporary, "wx", mode);
  try {
    await file.writeFile(value);
    await file.close();
    await rename(temporary, path);
  } catch (error) {
    await file.close().catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function readConfig(home: string): Promise<DaemonConfig> {
  try { return validateConfig(await Bun.file(join(home, "config.json")).json()); }
  catch (error) { throw asBedrockError(error, "CONFIG_MISSING", "Run bedrock setup --domain <domain> --creator <email> first."); }
}

export async function setup(home: string, domain: string, creator?: string, port = 3000, google?: DaemonConfig["google"]) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const path = join(home, "config.json");
  if (await Bun.file(path).exists()) {
    const config = await readConfig(home);
    if (google) { config.google = google; validateConfig(config); await atomicWrite(path, JSON.stringify(config, null, 2) + "\n"); }
    return { home, config, created: false };
  }
  const config = validateConfig({ domain, creators: creator ? [creator] : [], port, ...(google ? { google } : {}) });
  await atomicWrite(path, JSON.stringify(config, null, 2) + "\n");
  return { home, config, created: true };
}
