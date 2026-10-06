import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Cloudflare } from "../src/tunnel/client";
import { run } from "../src/cli/terminal";
import type { SetupOptions } from "../src/cli/setup";

export async function wizardHarness(directory: string, answers: string[] = []) {
  const home = join(directory, "home");
  const bin = join(directory, "bin");
  await mkdir(bin, { recursive: true });
  const binary = join(bin, "cloudflared");
  await Bun.write(binary, `#!${process.execPath}
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
const args = process.argv.slice(2);
const cert = args[args.indexOf("--origincert") + 1];
if (args.includes("login")) {
  await mkdir(join(process.env.HOME, ".cloudflared"), { recursive: true });
  await Bun.write(join(process.env.HOME, ".cloudflared/cert.pem"), "fake origin cert");
} else if (args.includes("--help")) console.log("cloudflared tunnel route dns [TUNNEL] [HOSTNAME]");
else if (args.includes("list")) {
  const state = await Bun.file(join(dirname(cert), "fake-tunnel.json")).json().catch(() => null);
  console.log(JSON.stringify(state));
} else if (args.includes("create")) {
  const id = "11111111-1111-1111-1111-111111111111";
  await Bun.write(args[args.indexOf("--credentials-file") + 1], JSON.stringify({ TunnelID: id, TunnelSecret: "fake-secret" }));
  await Bun.write(join(dirname(cert), "fake-tunnel.json"), JSON.stringify([{ id, name: args.at(-1) }]));
} else if (args.includes("route") && args.at(-1) !== "*.example.com") process.exit(1);
`);
  await chmod(binary, 0o700);
  const output: string[] = [];
  const calls: string[][] = [];
  const urls: string[] = [];
  const prompts: { label: string; secret: boolean }[] = [];
  let healthyCalls = 0;
  const options: SetupOptions = {
    home, tty: true, version: "1.2.0", platform: "darwin", portFree: async () => true,
    binary: () => Bun.which("cloudflared", { PATH: bin })!,
    disk: (async () => ({ bavail: 10 * 1024 ** 3, bsize: 1 })) as unknown as NonNullable<SetupOptions["disk"]>,
    installService: async () => { calls.push(["service", "install"]); },
    restart: async () => { calls.push(["service", "restart"]); },
    status: async () => { healthyCalls++; return { creatorSignedIn: healthyCalls >= 3 }; },
    checks: async () => [{ name: "daemon", status: "pass", message: "Healthy", hint: "" }],
    terminal: {
      write: line => output.push(line.replace(/\x1b\[[0-9;]*m/g, "")),
      prompt: async (label, fallback, secret) => { prompts.push({ label, secret: !!secret }); const value = answers.shift() || fallback || ""; output.push(`${label}${fallback ? ` [${fallback}]` : ""}: ${secret ? "[hidden]" : value}`); return value; },
      run: async (args, opts) => { calls.push(args); if (args[0] === "git") return "creator@example.com"; if (args[0] === "loginctl") return ""; return run(args, { ...opts, env: { ...process.env, ...opts?.env, PATH: bin } }); },
      open: async url => { urls.push(url); }, clipboard: async () => true, sleep: async () => {},
    },
  };
  return { home, options, output, calls, urls, prompts };
}
export function fakeCloudflare() {
  const requests: { path: string; method: string; body: unknown }[] = [];
  let tunnel: unknown;
  let records: unknown[] = [];
  const account = "a".repeat(32);
  const zone = "b".repeat(32);
  const api = new Cloudflare("fake-api-secret", "https://mock.invalid", (async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path: url.pathname + url.search, method, body });
    let result: unknown = [];
    if (url.pathname === "/zones") result = [{ id: zone, account: { id: account }, name: "example.com" }];
    else if (url.pathname.endsWith("/cfd_tunnel")) {
      if (method === "POST") tunnel = { id: "remote-id", name: body.name, config_src: "cloudflare" };
      result = method === "POST" ? tunnel : tunnel ? [tunnel] : [];
    } else if (url.pathname.endsWith("/token")) result = "fake-run-secret";
    else if (url.pathname.includes("/dns_records")) {
      if (method === "POST" || method === "PUT") records = [{ id: "dns-id", ...body }];
      if (method === "DELETE") records = [];
      result = method === "GET" ? records : records[0];
    }
    return Response.json({ success: true, result, result_info: { total_pages: 1 } });
  }) as typeof fetch);
  return { api, requests, account, zone };
}
