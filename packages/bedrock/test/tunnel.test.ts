import { expect, test } from "bun:test";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { tempDirectory } from "./helpers";
import { setup, readConfig } from "../src/daemon/config";
import { Cloudflare, type Tunnel, type DnsRecord } from "../src/tunnel/client";
import { tunnelSetup, tunnelStatus, tunnelTeardown, tunnelTokenPath } from "../src/tunnel";

function mockCloudflare() {
  let tunnel: Tunnel | undefined;
  let record: DnsRecord | undefined;
  let configuration: unknown;
  let creates = 0;
  let puts = 0;
  const requests: { path: string; method: string; body: any }[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(request.headers.get("authorization")).toBe("Bearer api-secret");
    const url = new URL(request.url);
    const path = url.pathname;
    const body = ["POST", "PUT"].includes(request.method) ? await request.json() : null;
    requests.push({ path, method: request.method, body });
    let result: unknown;
    if (path.endsWith("/token")) result = "run-secret";
    else if (path.endsWith("/configurations")) {
      if (request.method === "PUT") { configuration = body.config; puts++; }
      result = { config: configuration };
    } else if (path.includes("/dns_records")) {
      if (request.method === "DELETE") { record = undefined; result = {}; }
      else if (request.method === "POST" || request.method === "PUT") { record = { id: "dns1", ...body }; result = record; }
      else result = record ? [record] : [];
    } else if (path.endsWith("/cfd_tunnel")) {
      if (request.method === "POST") { creates++; tunnel = { id: "tunnel1", ...body }; result = tunnel; }
      else result = tunnel ? [tunnel] : [];
    } else if (request.method === "DELETE") { tunnel = undefined; result = {}; }
    else result = tunnel;
    return Response.json({ success: true, result, result_info: { total_pages: 1 } });
  } });
  return { api: new Cloudflare("api-secret", server.url.origin), server, requests, get creates() { return creates; }, get puts() { return puts; }, drift() { configuration = { ingress: [] }; } };
}
test("tunnel reconciles idempotently, stores only run token privately, detects drift and tears down", async () => {
  const temp = tempDirectory();
  const mock = mockCloudflare();
  try {
    await setup(temp.dir, "example.com", "creator@example.com", 3000);
    await expect(tunnelTeardown(temp.dir, mock.api, false)).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
    for (let i = 0; i < 2; i++) await tunnelSetup(temp.dir, "account", "zone", mock.api, "home");
    expect(mock.creates).toBe(1);
    expect(mock.puts).toBe(2);
    expect(mock.requests.find(request => request.method === "POST" && request.path.endsWith("/cfd_tunnel"))?.body).toMatchObject({ name: "bedrock-home", config_src: "cloudflare" });
    expect(await Bun.file(join(temp.dir, "config.json")).text()).not.toContain("secret");
    expect((await stat(tunnelTokenPath(temp.dir))).mode & 0o777).toBe(0o600);
    expect(await tunnelStatus(temp.dir, mock.api)).toMatchObject({ matches: true, tokenStored: true });
    mock.drift();
    expect(await tunnelStatus(temp.dir, mock.api)).toMatchObject({ matches: false });
    expect(await tunnelTeardown(temp.dir, mock.api, true)).toMatchObject({ removed: true });
    expect(await tunnelTeardown(temp.dir, mock.api, true)).toMatchObject({ removed: false });
    expect((await readConfig(temp.dir)).cloudflare).toBeUndefined();
    expect(await Bun.file(tunnelTokenPath(temp.dir)).exists()).toBe(false);
  } finally { await mock.server.stop(true); temp.cleanup(); }
});
test("Cloudflare errors carry permission hints without reflecting secrets", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ success: false, errors: [{ code: 10000, message: "api-secret" }] }, { status: 403 }) });
  try {
    const api = new Cloudflare("api-secret", server.url.origin);
    await expect(api.tunnels("account")).rejects.toMatchObject({ code: "CLOUDFLARE_PERMISSION", hint: expect.stringContaining("DNS: Edit") });
    try { await api.tunnels("account"); } catch (error) { expect(String(error)).not.toContain("api-secret"); }
  } finally { await server.stop(true); }
});
test("Cloudflare lists follow pagination", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const page = new URL(request.url).searchParams.get("page");
    return Response.json({ success: true, result: [{ id: page }], result_info: { total_pages: 2 } });
  } });
  try { expect(await new Cloudflare("token", server.url.origin).tunnels("account")).toHaveLength(2); }
  finally { await server.stop(true); }
});

test("doctor verifies tunnel via injected API, flags unhealthy pebbles and low disk, and resolves wildcard via DoH", async () => {
  const { doctor } = await import("../src/cli/doctor");
  const temp = tempDirectory();
  const mock = mockCloudflare();
  try {
    await setup(temp.dir, "example.com", "creator@example.com", 3000);
    await tunnelSetup(temp.dir, "account", "zone", mock.api, "home");
    await Bun.write(join(temp.dir, "admin-token"), "admin-token");
    const checks = await doctor(temp.dir, { cloudflare: mock.api, binary: () => "/cloudflared", version: "1.1.0",
      disk: (async () => ({ bavail: 1, bsize: 4096 })) as unknown as typeof import("node:fs/promises").statfs,
      fetch: (async (url: string | URL, init: RequestInit) => {
        if (String(url).startsWith("https:")) {
          expect(new URL(url).hostname).toBe("cloudflare-dns.com");
          expect(new Headers(init.headers).get("accept")).toBe("application/dns-json");
          return Response.json({ Status: 0, Answer: [{ type: 1, data: "192.0.2.1" }] });
        }
        return Response.json({ value: { tunnel: { running: true }, pebbles: [{ name: "broken", status: "crashed", healthy: false }] } });
      }) as typeof fetch });
    for (const name of ["dns", "tunnel", "cloudflared-running"]) expect(checks.find(check => check.name === name)?.status).toBe("pass");
    for (const name of ["bun", "pebble:broken"]) expect(checks.find(check => check.name === name)?.status).toBe("fail");
    expect(checks.find(check => check.name === "disk")?.status).toBe("warn");
  } finally { await mock.server.stop(true); temp.cleanup(); }
});

test("tunnel setup rejects conflicting wildcard records and locally managed tunnels", async () => {
  const temp = tempDirectory();
  let conflict = "tunnel";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    const result = path.includes("dns_records") ? [{ id: "dns", type: "A", content: "192.0.2.1" }]
      : path.includes("configurations") ? {} : [{ id: "tunnel", name: "bedrock-home", config_src: conflict === "tunnel" ? "local" : "cloudflare" }];
    return Response.json({ success: true, result });
  } });
  try {
    await setup(temp.dir, "example.com", "creator@example.com", 3000);
    const api = new Cloudflare("token", server.url.origin);
    await expect(tunnelSetup(temp.dir, "account", "zone", api, "home")).rejects.toMatchObject({ code: "TUNNEL_CONFLICT" });
    conflict = "dns";
    await expect(tunnelSetup(temp.dir, "account", "zone", api, "home")).rejects.toMatchObject({ code: "DNS_CONFLICT" });
  } finally { await server.stop(true); temp.cleanup(); }
});
