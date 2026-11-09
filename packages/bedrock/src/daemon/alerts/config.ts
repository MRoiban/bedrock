import { join } from "node:path";
import { BedrockError } from "../../error";
import { atomicWrite, readConfig, validateConfig } from "../config";
export interface AlertsConfig { webhook?: string; criticalJobs?: { [pebble: string]: string[] } }
export function validateAlerts(config: AlertsConfig) {
  const invalid = () => { throw new BedrockError("INVALID_DAEMON_CONFIG", "Invalid alerts configuration.", "Use alerts.webhook with an HTTPS URL (HTTP only on loopback) and criticalJobs as { pebble: [jobNames] }."); };
  if (!config || typeof config !== "object" || Array.isArray(config)) invalid();
  if (config.webhook !== undefined) {
    let url: URL;
    try { url = new URL(config.webhook); } catch { return invalid(); }
    if (url.username || url.password || url.hash || url.search || url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) invalid();
  }
  if (config.criticalJobs !== undefined && (!config.criticalJobs || typeof config.criticalJobs !== "object" || Array.isArray(config.criticalJobs) || Object.entries(config.criticalJobs).some(([name, jobs]) => !/^[a-z0-9][a-z0-9-]*$/.test(name) || !Array.isArray(jobs) || jobs.some(job => typeof job !== "string" || !job || job.length > 128)))) invalid();
}
export async function setupAlerts(home: string, secret: string, webhook?: string) {
  const config = await readConfig(home);
  config.alerts = { ...config.alerts, webhook: webhook ?? `https://comms.${config.domain}/api/v1/messages` };
  validateConfig(config);
  if (!secret.trim() || /[\r\n\0]/.test(secret.trim())) throw new BedrockError("INVALID_ARGS", "A bearer secret is required.", "Pipe the dedicated bedrock-monitor token to alerts setup, or use the hidden prompt.");
  await atomicWrite(join(home, "alerts-secret"), secret.trim() + "\n");
  await atomicWrite(join(home, "config.json"), JSON.stringify(config, null, 2) + "\n");
  return { webhook: config.alerts.webhook, restart_required: true };
}
