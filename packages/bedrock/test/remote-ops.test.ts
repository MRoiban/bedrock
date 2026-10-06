import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "./helpers";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { openDaemonDatabase } from "../src/daemon/db";
import { createSessions } from "../src/auth/sessions";
import { login, readCredentials } from "../src/cli/credentials";
import { doctor } from "../src/cli/doctor";
import { TunnelSupervisor } from "../src/tunnel/supervisor";
import { chmod } from "node:fs/promises";

async function waitFor(check: () => Promise<boolean> | boolean, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(20); }
}
test("remote creator authorization redirects to login, rejects users and CSRF, confirms once, and token revocation takes effect", async () => {
  const temp = tempDirectory();
  await setup(temp.dir, "localhost", "creator@example.com", 0);
  const daemon = await startDaemon({ home: temp.dir, dev: true, domain: "localhost", port: 0 });
  const db = await openDaemonDatabase(temp.dir);
  try {
    const sessions = createSessions(db.db);
    const creator = sessions.create(sessions.user("creator@example.com", "Creator").id);
    const other = sessions.create(sessions.user("user@example.com", "User").id);
    const origin = `http://bedrock.localhost:${daemon.server.port}`;
    const authorize = `/cli-login?port=43210&state=${"a".repeat(64)}&hostname=home`;
    const call = (path: string, init: RequestInit = {}, session = creator) => fetch(`${daemon.server.url.origin}${path}`, { ...init, redirect: "manual", headers: { host: `bedrock.localhost:${daemon.server.port}`, cookie: `bedrock_session=${session}`, ...init.headers } });
    expect((await call(authorize, {}, "")).status).toBe(302);
    expect((await call(authorize, {}, other)).status).toBe(403);
    const page = await (await call(authorize)).text();
    expect(page).toContain("Authorize CLI on home?");
    const nonce = /name="nonce" value="([a-f0-9]+)"/.exec(page)![1]!;
    const post = { method: "POST", body: new URLSearchParams({ nonce }), headers: { origin } };
    expect((await call("/cli-login", { ...post, headers: { origin: "https://evil.example.com" } })).status).toBe(403);
    const response = await call("/cli-login", post);
    expect(response.status).toBe(302);
    const callback = new URL(response.headers.get("location")!);
    expect(callback.origin).toBe("http://127.0.0.1:43210");
    expect(callback.searchParams.get("state")).toBe("a".repeat(64));
    const token = callback.searchParams.get("token")!;
    expect(db.accepts(token)).toBe(true);
    expect((await call("/cli-login", post)).status).toBe(400);
    const api = (path: string, method = "GET") => call(path, { method, headers: { authorization: `Bearer ${token}` } }, "");
    expect((await api("/api/pebbles")).status).toBe(200);
    const tokens = (await (await api("/api/tokens")).json()).value;
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(tokens)).not.toContain(token);
    expect((await api("/api/tokens/current", "DELETE")).status).toBe(200);
    expect((await api("/api/pebbles")).status).toBe(401);
  } finally { db.close(); await daemon.stop(); temp.cleanup(); }
});
test("CLI one-shot random-port server saves successful callback without exposing the deploy token", async () => {
  const temp = tempDirectory();
  const path = join(temp.dir, "credentials.json");
  const token = `br_${"b".repeat(64)}`;
  try {
    const result = await login("https://bedrock.example.com", { path, timeout: 1000, async open(authorize) {
      const params = new URL(authorize).searchParams;
      const callback = `http://127.0.0.1:${params.get("port")}/callback`;
      expect((await fetch(`${callback}?state=wrong&token=${token}`)).status).toBe(400);
      expect((await fetch(`${callback}?state=${params.get("state")}&token=${token}`)).status).toBe(200);
    } });
    expect(result).toMatchObject({ authenticated: true });
    expect(JSON.stringify(result)).not.toContain(token);
    expect((await readCredentials(path))?.token).toBe(token);
  } finally { temp.cleanup(); }
});
test("doctor checks the real local daemon and skips offline remote checks", async () => {
  const temp = tempDirectory();
  await setup(temp.dir, "example.com", "creator@example.com", 0);
  const daemon = await startDaemon({ home: temp.dir, port: 0 });
  try {
    const checks = await doctor(temp.dir, { fetch: (async (url: string | URL, init: RequestInit) => {
      if (String(url).startsWith("https:")) throw new Error("offline");
      return fetch(url, init);
    }) as typeof fetch, binary: () => "/fake/cloudflared" });
    expect(checks.find(check => check.name === "daemon")?.status).toBe("pass");
    expect(checks.find(check => check.name === "creators")?.status).toBe("pass");
    expect(checks.find(check => check.name === "google")?.status).toBe("warn");
    expect(checks.find(check => check.name === "dns")?.skipped).toBe(true);
    expect(checks.find(check => check.name === "tunnel")?.skipped).toBe(true);
    expect(checks.every(check => !!check.hint)).toBe(true);
  } finally { await daemon.stop(); temp.cleanup(); }
});
test("cloudflared gets its token in env, redacts logs, restarts with backoff and stops", async () => {
  const temp = tempDirectory();
  const script = join(temp.dir, "cloudflared");
  const capture = join(temp.dir, "capture.json");
  const token = "secret-run-token";
  await Bun.write(script, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2), token:process.env.TUNNEL_TOKEN, api:process.env.CLOUDFLARE_API_TOKEN}));\nprocess.stdout.write("secret-run-");\nawait Bun.sleep(20);\nprocess.stdout.write("token\\n");\n`);
  await chmod(script, 0o700);
  let starts = 0;
  const supervisor = new TunnelSupervisor(temp.dir, token, () => { starts++; return script; });
  try {
    supervisor.start();
    await waitFor(async () => await Bun.file(capture).exists());
    const value = await Bun.file(capture).json();
    expect(value.token).toBe(token);
    expect(value.args).toEqual(["tunnel", "--no-autoupdate", "run"]);
    expect(value.api).toBeUndefined();
    await waitFor(() => starts >= 2);
    await supervisor.stop();
    const count = starts;
    await Bun.sleep(600);
    expect(starts).toBe(count);
    const logs = await Bun.file(join(temp.dir, "logs/cloudflared.log")).text();
    expect(logs).toContain("[redacted]");
    expect(logs).not.toContain(token);
  } finally { await supervisor.stop(); temp.cleanup(); }
});
test("a missing cloudflared binary leaves local serving available", async () => {
  const temp = tempDirectory();
  const { config } = await setup(temp.dir, "example.com", "creator@example.com", 0);
  config.cloudflare = { accountId: "account", zoneId: "zone", tunnelId: "tunnel", dnsRecordId: "record", name: "bedrock-test" };
  await Bun.write(join(temp.dir, "config.json"), JSON.stringify(config));
  await Bun.write(join(temp.dir, "tunnel-token"), "invalid-test-token");
  const daemon = await startDaemon({ home: temp.dir, port: 0, tunnelBinary: () => { throw new Error("missing"); } });
  try {
    const token = (await Bun.file(join(temp.dir, "admin-token")).text()).trim();
    const response = await fetch(`${daemon.server.url.origin}/api/status`, { headers: { host: `bedrock.localhost:${daemon.server.port}`, authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect((await response.json()).value.tunnel.running).toBeFalsy();
    expect(await Bun.file(join(temp.dir, "logs/cloudflared.log")).text()).toContain("local serving continues");
  } finally { await daemon.stop(); temp.cleanup(); }
});
