import { BedrockError } from "../error";

export interface Tunnel { id: string; name: string; config_src: string; status?: string }
export interface DnsRecord { id: string; name: string; type: string; content: string; proxied: boolean }
interface Envelope<T> { success: boolean; result: T; result_info?: { total_pages?: number }; errors?: { code: number; message: string }[] }

export class Cloudflare {
  constructor(private token: string, private baseUrl = "https://api.cloudflare.com/client/v4", private fetcher: typeof fetch = fetch) {
    if (!token.trim()) throw new BedrockError("CLOUDFLARE_TOKEN_MISSING", "A Cloudflare API token is required.", "Set CLOUDFLARE_API_TOKEN or pass --api-token with Cloudflare Tunnel: Edit and DNS: Edit permissions.");
  }
  private async request<T>(path: string, method = "GET", body?: unknown): Promise<Envelope<T>> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000), redirect: "error" });
    } catch { throw new BedrockError("CLOUDFLARE_OFFLINE", "Could not reach the Cloudflare API.", "Check the server's internet connection and retry."); }
    const value = await response.json().catch(() => null) as Envelope<T> | null;
    if (!response.ok || !value?.success) {
      // Never echo remote error text: it may contain request credentials.
      const permission = response.status === 401 || response.status === 403 || value?.errors?.some(error => [10000, 10001, 9109].includes(error.code));
      throw new BedrockError(permission ? "CLOUDFLARE_PERMISSION" : "CLOUDFLARE_API_FAILED", `Cloudflare returned HTTP ${response.status}${value?.errors?.length ? ` (code ${value.errors[0]!.code})` : ""}.`,
        permission ? "Grant this API token Cloudflare Tunnel: Edit on the account and DNS: Edit on the zone." : "Check the account/zone IDs and tunnel state in Cloudflare; retry after resolving conflicts.");
    }
    return value;
  }
  async call<T>(path: string, method = "GET", body?: unknown) { return (await this.request<T>(path, method, body)).result; }
  async list<T>(path: string) {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const value = await this.request<T[]>(`${path}${path.includes("?") ? "&" : "?"}page=${page}&per_page=100`);
      items.push(...value.result);
      if (page >= (value.result_info?.total_pages ?? 1)) return items;
    }
  }
  async discover(domain: string) {
    const zones = await this.list<{ id: string; name: string; account: { id: string } }>(`/zones?name=${encodeURIComponent(domain)}`);
    if (zones.length !== 1 || !zones[0]?.account?.id) throw new BedrockError("CLOUDFLARE_ZONE_MISSING", "No unique Cloudflare zone matches the domain.", "Grant Zone: Read permission for this domain, and check it is a Cloudflare zone.");
    return { zoneId: zones[0].id, accountId: zones[0].account.id };
  }
  async wildcard(zone: string, domain: string, tunnel: string) {
    const name = `*.${domain}`;
    const records = await this.dns(zone, name);
    if (records.length > 1 || records.some(record => record.type !== "CNAME" || record.content !== `${tunnel}.cfargotunnel.com`)) throw new BedrockError("DNS_CONFLICT", "The wildcard has conflicting DNS records.", "Remove the conflicting wildcard record in Cloudflare and retry.");
    return this.call<DnsRecord>(`/zones/${encodeURIComponent(zone)}/dns_records${records[0] ? `/${records[0].id}` : ""}`, records[0] ? "PUT" : "POST", { type: "CNAME", name, content: `${tunnel}.cfargotunnel.com`, proxied: true, ttl: 1 });
  }
  tunnels(account: string, name?: string) { return this.list<Tunnel>(`/accounts/${encodeURIComponent(account)}/cfd_tunnel?is_deleted=false${name ? `&name=${encodeURIComponent(name)}` : ""}`); }
  dns(zone: string, name: string) { return this.list<DnsRecord>(`/zones/${encodeURIComponent(zone)}/dns_records?name=${encodeURIComponent(name)}`); }
}

export const ingress = (domain: string, port: number) => ({ ingress: [{ hostname: `*.${domain}`, service: `http://127.0.0.1:${port}` }, { service: "http_status:404" }] });
