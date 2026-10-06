import { chmod, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BedrockError, asBedrockError } from "../error";

export interface DaemonConfig { domain: string; creators: string[]; port: number }
export const bedrockHome = () => resolve(process.env.BEDROCK_HOME ?? join(homedir(), ".bedrock"));

export function validateConfig(config: DaemonConfig) {
  if (!config || typeof config.domain !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(config.domain) ||
      !Array.isArray(config.creators) || config.creators.some(email => typeof email !== "string" || !email.includes("@")) ||
      !Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new BedrockError("INVALID_DAEMON_CONFIG", "Invalid daemon domain, creators, or port.", "Use a lowercase hostname, creator emails, and a port from 0 to 65535.");
  }
  return config;
}

export async function atomicWrite(path: string, value: string, mode = 0o600) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, value);
  await chmod(temporary, mode);
  await rename(temporary, path);
}

export async function readConfig(home: string): Promise<DaemonConfig> {
  try { return validateConfig(await Bun.file(join(home, "config.json")).json()); }
  catch (error) { throw asBedrockError(error, "CONFIG_MISSING", "Run bedrock setup --domain <domain> --creator <email> first."); }
}

export async function setup(home: string, domain: string, creator?: string, port = 3000) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const path = join(home, "config.json");
  if (await Bun.file(path).exists()) return { home, config: await readConfig(home), created: false };
  const config = validateConfig({ domain, creators: creator ? [creator] : [], port });
  await atomicWrite(path, JSON.stringify(config, null, 2) + "\n");
  return { home, config, created: true };
}
