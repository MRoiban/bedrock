import { hostname } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { atomicWrite, readConfig } from "../daemon/config";
import { BedrockError } from "../error";
import { Cloudflare, ingress, type DnsRecord, type Tunnel } from "./client";

export const tunnelTokenPath = (home: string) => join(home, "tunnel-token");
export async function tunnelSetup(home: string, accountId: string, zoneId: string, api: Cloudflare, host = hostname()) {
  const config = await readConfig(home);
  if (!accountId || !zoneId || config.port === 0 || config.domain === "localhost") throw new BedrockError("INVALID_TUNNEL_CONFIG", "Tunnel setup needs account/zone IDs, a public domain, and a fixed daemon port.", "Run setup with your public --domain and --port 3000; pass --account-id and --zone-id.");
  const name = `bedrock-${host}`;
  const path = `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel`;
  const matches = (await api.tunnels(accountId, name)).filter(tunnel => tunnel.name === name);
  if (matches.length > 1) throw new BedrockError("TUNNEL_CONFLICT", "Multiple tunnels have this server's name.", "Remove the duplicate tunnels in Cloudflare and retry.");
  const tunnel = matches[0] ?? await api.call<Tunnel>(path, "POST", { name, config_src: "cloudflare" });
  if (tunnel.config_src !== "cloudflare") throw new BedrockError("TUNNEL_CONFLICT", "The existing tunnel is locally managed.", "Rename or remove that tunnel before setting up Bedrock's remotely managed tunnel.");
  await api.call(`${path}/${tunnel.id}/configurations`, "PUT", { config: ingress(config.domain, config.port) });
  const recordName = `*.${config.domain}`;
  const records = await api.dns(zoneId, recordName);
  if (records.length > 1 || records.some(record => record.type !== "CNAME")) throw new BedrockError("DNS_CONFLICT", "The wildcard has conflicting DNS records.", "Remove the conflicting wildcard records in Cloudflare and retry.");
  const record = await api.call<DnsRecord>(`/zones/${encodeURIComponent(zoneId)}/dns_records${records[0] ? `/${records[0].id}` : ""}`, records[0] ? "PUT" : "POST",
    { type: "CNAME", name: recordName, content: `${tunnel.id}.cfargotunnel.com`, proxied: true, ttl: 1 });
  const token = await api.call<string>(`${path}/${tunnel.id}/token`);
  if (typeof token !== "string" || !token) throw new BedrockError("TUNNEL_TOKEN_MISSING", "Cloudflare returned no run token.", "Check Cloudflare Tunnel: Edit permission and repeat tunnel setup.");
  await atomicWrite(tunnelTokenPath(home), token + "\n");
  config.cloudflare = { accountId, zoneId, tunnelId: tunnel.id, dnsRecordId: record.id, name };
  await atomicWrite(join(home, "config.json"), JSON.stringify(config, null, 2) + "\n");
  return { tunnelId: tunnel.id, name, hostname: recordName, configured: true, hint: "Restart the daemon to connect cloudflared." };
}
export async function tunnelStatus(home: string, api?: Cloudflare) {
  const config = await readConfig(home);
  const cf = config.cloudflare;
  if (!cf) return { configured: false };
  const tokenStored = !!(await Bun.file(tunnelTokenPath(home)).text().catch(() => "")).trim();
  if (!api) return { configured: true, ...cf, tokenStored, remote: "skipped", hint: "Set CLOUDFLARE_API_TOKEN to inspect Cloudflare." };
  const tunnel = await api.call<Tunnel>(`/accounts/${encodeURIComponent(cf.accountId)}/cfd_tunnel/${cf.tunnelId}`);
  const remote = await api.call<{ config: ReturnType<typeof ingress> }>(`/accounts/${encodeURIComponent(cf.accountId)}/cfd_tunnel/${cf.tunnelId}/configurations`);
  const records = await api.dns(cf.zoneId, `*.${config.domain}`);
  const rules = remote.config?.ingress;
  const expected = ingress(config.domain, config.port).ingress;
  const matches = rules?.length === 2 && rules.every((rule, i) => rule.hostname === expected[i]!.hostname && rule.service === expected[i]!.service)
    && records.length === 1 && records[0]!.type === "CNAME" && records[0]!.proxied && records[0]!.content === `${cf.tunnelId}.cfargotunnel.com`;
  return { configured: true, ...cf, tokenStored, status: tunnel.status, matches };
}
export async function tunnelTeardown(home: string, api: Cloudflare | undefined, yes: boolean) {
  if (!yes) throw new BedrockError("CONFIRM_REQUIRED", "Teardown removes the tunnel and its wildcard DNS record.", "Stop the daemon, then run bedrock tunnel teardown --yes.");
  const config = await readConfig(home);
  const cf = config.cloudflare;
  if (!cf) { await rm(tunnelTokenPath(home), { force: true }); return { removed: false }; }
  if (!api) throw new BedrockError("CLOUDFLARE_TOKEN_MISSING", "Teardown requires a Cloudflare API token.", "Set CLOUDFLARE_API_TOKEN or pass --api-token.");
  const records = await api.dns(cf.zoneId, `*.${config.domain}`);
  for (const record of records.filter(record => record.type === "CNAME" && record.content === `${cf.tunnelId}.cfargotunnel.com`)) {
    await api.call(`/zones/${encodeURIComponent(cf.zoneId)}/dns_records/${record.id}`, "DELETE");
  }
  if ((await api.tunnels(cf.accountId)).some(tunnel => tunnel.id === cf.tunnelId)) await api.call(`/accounts/${encodeURIComponent(cf.accountId)}/cfd_tunnel/${cf.tunnelId}`, "DELETE");
  delete config.cloudflare;
  await atomicWrite(join(home, "config.json"), JSON.stringify(config, null, 2) + "\n");
  await rm(tunnelTokenPath(home), { force: true });
  return { removed: true };
}
