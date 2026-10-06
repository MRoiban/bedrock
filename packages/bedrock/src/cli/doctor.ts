import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { readConfig } from "../daemon/config";
import { Cloudflare } from "../tunnel/client";
import { tunnelStatus } from "../tunnel";
import { cloudflaredBinary } from "../tunnel/supervisor";
import { BedrockError } from "../error";

export interface Check { name: string; status: "pass" | "warn" | "fail"; message: string; hint: string; skipped?: boolean }
export async function doctor(home: string, options: { fetch?: typeof fetch; apiToken?: string; cloudflare?: Cloudflare; binary?: () => string; disk?: typeof statfs; version?: string } = {}): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], message: string, hint: string, skipped = false) => { checks.push({ name, status, message, hint, ...(skipped ? { skipped } : {}) }); };
  const fetcher = options.fetch ?? fetch;
  const version = options.version ?? Bun.version;
  const [major = 0, minor = 0] = version.split(".").map(Number);
  add("bun", major > 1 || major === 1 && minor >= 2 ? "pass" : "fail", `Bun ${version}`, "Install Bun >= 1.2.");
  const config = await readConfig(home).catch(error => { add("config", "fail", "Configuration is missing or invalid.", error.hint ?? "Run bedrock setup."); return null; });
  if (config) {
    add("config", "pass", "Configuration is valid.", "Use bedrock setup to update configuration.");
    add("domain", config.domain !== "localhost" && config.domain.includes(".") ? "pass" : "fail", `Domain: ${config.domain}`, "Set a public domain before tunnel setup.");
    add("creators", config.creators.length ? "pass" : "fail", `${config.creators.length} creator(s).`, "Set at least one creator email in config.json.");
    add("google", config.google ? "pass" : "warn", config.google ? "Google OAuth configured." : "Google OAuth is not configured.", "Run setup with --google-client-id and --google-client-secret.");
  } else for (const name of ["domain", "creators", "google"]) add(name, "warn", "Skipped: configuration unavailable.", "Repair config.json and retry doctor.", true);
  let status: { tunnel: { running: boolean }; pebbles: { name: string; status: string; healthy: boolean }[] } | null = null;
  try {
    const state = await Bun.file(join(home, "daemon.json")).json().catch(() => null);
    const port = state?.port ?? config?.port;
    const token = (await Bun.file(join(home, "admin-token")).text()).trim();
    const response = await fetcher(`http://127.0.0.1:${port}/api/status`, { headers: { host: `bedrock.localhost:${port}`, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("daemon unreachable");
    status = (await response.json()).value;
    if (!status || !Array.isArray(status.pebbles)) throw new Error("invalid status");
    add("daemon", "pass", "Local daemon is reachable.", "Use bedrock service status to inspect automatic startup.");
  } catch { add("daemon", "fail", "Local daemon is unreachable.", "Run bedrock daemon or bedrock service install."); }
  if (config?.backup) {
    const state = await Bun.file(join(home, "backup-state.json")).json().catch(() => null);
    const successes = [state?.daemon ?? 0, ...(status?.pebbles ?? []).map(pebble => state?.pebbles?.[pebble.name] ?? 0)];
    const oldest = Math.min(...successes);
    const age = oldest ? Date.now() - oldest : Infinity;
    add("backup", age <= 2 * (config.backup.intervalMinutes ?? 60) * 60000 ? "pass" : "warn", Number.isFinite(age) ? `Oldest latest backup: ${Math.floor(age / 60000)} minutes ago.` : "Some data has no successful backup recorded.", "Run bedrock backup run; check the daemon logs and backup target.");
  } else add("backup", "warn", "Backups are not configured.", "Run bedrock backup setup --dir <path> or configure R2.");
  try { add("cloudflared-installed", "pass", (options.binary ?? cloudflaredBinary)(), "Keep cloudflared updated with your OS package manager."); }
  catch (error) { add("cloudflared-installed", "fail", "cloudflared is missing.", error instanceof BedrockError ? error.hint : "Install cloudflared."); }
  add("cloudflared-running", status?.tunnel.running ? "pass" : "warn", status?.tunnel.running ? "cloudflared is running." : "cloudflared is not running.", "Run tunnel setup, then restart the daemon; inspect logs/cloudflared.log.");
  const apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
  if (config && (apiToken || options.cloudflare)) {
    try {
      const tunnel = await tunnelStatus(home, options.cloudflare ?? new Cloudflare(apiToken!));
      add("tunnel", "matches" in tunnel && tunnel.matches && tunnel.tokenStored ? "pass" : "fail", "matches" in tunnel && tunnel.matches ? "Remote tunnel configuration matches." : "Remote tunnel configuration is missing or differs.", "Repeat bedrock tunnel setup with the correct account and zone IDs.");
    } catch (error) { add("tunnel", error instanceof BedrockError && error.code === "CLOUDFLARE_OFFLINE" ? "warn" : "fail", "Could not verify remote tunnel configuration.", error instanceof BedrockError ? error.hint : "Check your API token and internet connection."); }
  } else add("tunnel", "warn", "Skipped: no Cloudflare API token or valid configuration.", "Set CLOUDFLARE_API_TOKEN to verify remote configuration.", true);
  if (config && config.domain !== "localhost") {
    try {
      const url = new URL("https://cloudflare-dns.com/dns-query");
      url.searchParams.set("name", `bedrock-doctor-${crypto.randomUUID()}.${config.domain}`);
      url.searchParams.set("type", "A");
      const response = await fetcher(url, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error("DoH unavailable");
      const answer = await response.json();
      add("dns", answer.Status === 0 && answer.Answer?.some((record: { type: number }) => record.type === 1) ? "pass" : "fail", answer.Answer?.length ? "Wildcard DNS resolves." : "Wildcard DNS does not resolve.", "Repeat tunnel setup and allow DNS propagation.");
    } catch { add("dns", "warn", "Skipped: DNS-over-HTTPS is unavailable (offline).", "Check internet connectivity and retry doctor.", true); }
  } else add("dns", "warn", "Skipped: no public domain.", "Configure a public domain and tunnel.", true);
  try {
    const space = await (options.disk ?? statfs)(home);
    const bytes = Number(space.bavail) * Number(space.bsize);
    add("disk", bytes < 5 * 1024 ** 3 ? "warn" : "pass", `${(bytes / 1024 ** 3).toFixed(1)} GiB free.`, "Keep at least 5 GiB free for deployments and databases.");
  } catch { add("disk", "warn", "Could not inspect free disk space.", "Check BEDROCK_HOME exists and is readable."); }
  if (status) for (const pebble of status.pebbles) add(`pebble:${pebble.name}`, pebble.healthy ? "pass" : "fail", `${pebble.name}: ${pebble.status}${pebble.healthy ? ", healthy" : ", unhealthy"}`, `Inspect bedrock logs ${pebble.name}; restart or redeploy it.`);
  else add("pebbles", "warn", "Skipped: daemon unavailable.", "Start the daemon and retry doctor.", true);
  return checks;
}
