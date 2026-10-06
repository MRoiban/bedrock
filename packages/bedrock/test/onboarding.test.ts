import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { symlink, stat } from "node:fs/promises";
import { tempDirectory } from "./helpers";
import { wizardHarness, fakeCloudflare } from "./onboarding-harness";
import { setupWizard } from "../src/cli/setup";
import { readConfig } from "../src/daemon/config";
import { tunnelStatus, tunnelTeardown } from "../src/tunnel";
import { newPebble } from "../src/cli/new";
import { daemonCommand } from "../src/cli/daemon";
import { run } from "../src/cli/terminal";
import { login, loginUrl } from "../src/cli/credentials";

const client = "123-test.apps.googleusercontent.com";
const flags = ["--yes", "--domain", "example.com", "--creator", "creator@example.com", "--api-token", "fake-secret", "--skip-google", "--skip-backups"];

test("scripted full wizard uses fake cloudflared, private local config and real resumable state", async () => {
  const temp = tempDirectory();
  try {
    const fixture = await wizardHarness(temp.dir, ["example.com", "", "", client, "google-secret", "disk", "/mnt/backup/bedrock"]);
    await setupWizard([], false, fixture.options);
    const config = await readConfig(fixture.home);
    expect(config.cloudflare?.mode).toBe("local");
    const yaml = await Bun.file(join(fixture.home, "cloudflared/config.yml")).text();
    expect(yaml).toContain('hostname: "*.example.com"');
    expect(yaml).toContain("service: http://127.0.0.1:3000");
    expect(yaml).toContain("service: http_status:404");
    expect(yaml).toContain(`credentials-file: "${fixture.home}/cloudflared/credentials.json"`);
    expect((await stat(join(fixture.home, "cloudflared/cert.pem"))).mode & 0o777).toBe(0o600);
    expect(await tunnelStatus(fixture.home)).toMatchObject({ tokenStored: true });
    expect(fixture.prompts.find(p => p.label === "Google client secret")?.secret).toBe(true);
    expect(fixture.output.join("\n")).not.toContain("google-secret");
    expect(fixture.calls.some(args => args.includes("--help"))).toBe(true);
    expect(fixture.urls).toEqual(["https://console.cloud.google.com/auth/clients/create", "https://bedrock.example.com"]);
    const transcript = fixture.output.join("\n") + "\n";
    if (process.env.UPDATE_ONBOARDING_TRANSCRIPT) await Bun.write(join(import.meta.dir, "fixtures/wizard-transcript.txt"), transcript);
    expect(transcript).toBe(await Bun.file(join(import.meta.dir, "fixtures/wizard-transcript.txt")).text());
    fixture.calls.length = 0;
    await setupWizard([], false, fixture.options);
    expect(fixture.calls).toHaveLength(0);
  } finally { temp.cleanup(); }
});

test("wizard resumes after cloudflare failure and redo rewrites one step, invalidating service verification", async () => {
  const temp = tempDirectory();
  try {
    const fixture = await wizardHarness(temp.dir, ["example.com", "creator@example.com", "", "skip", "skip"]);
    const execute = fixture.options.terminal!.run!;
    fixture.options.terminal!.run = async (args, opts) => { if (args.includes("route") && !args.includes("--help")) throw new Error("simulated DNS failure"); return execute(args, opts); };
    await expect(setupWizard([], false, fixture.options)).rejects.toMatchObject({ code: "LOCAL_DNS_FAILED" });
    let status = await setupWizard(["--status"], true, fixture.options);
    expect(status.steps.filter(s => s.done).map(s => s.step)).toEqual(["prereqs", "identity"]);
    fixture.options.terminal!.run = execute;
    await setupWizard([], false, fixture.options);
    expect(fixture.calls.filter(args => args.includes("create"))).toHaveLength(1);
    fixture.calls.length = 0;
    await setupWizard(["identity", "--domain", "example.com", "--creator", "new@example.com", "--port", "4000", "--yes"], false, fixture.options);
    expect((await readConfig(fixture.home)).port).toBe(4000);
    status = await setupWizard(["--status"], true, fixture.options);
    expect(status.steps.find(s => s.step === "service")?.done).toBe(false);
    expect(fixture.calls).toHaveLength(0);
  } finally { temp.cleanup(); }
});

test("noninteractive missing flags are collected before changes and JSON never prompts", async () => {
  const temp = tempDirectory();
  try {
    const fixture = await wizardHarness(temp.dir);
    try { await setupWizard([], true, fixture.options); throw new Error("expected error"); }
    catch (error) { expect(error).toMatchObject({ code: "SETUP_FLAGS_MISSING" }); const hint = (error as { hint: string }).hint; for (const flag of ["--domain", "--creator", "--api-token", "--google-client-id", "--google-client-secret", "--dir"]) expect(hint).toContain(flag); }
    expect(fixture.prompts).toHaveLength(0);
    expect(await Bun.file(join(fixture.home, "setup.json")).exists()).toBe(false);
    expect(fixture.output).toHaveLength(0);
  } finally { temp.cleanup(); }
});

test("noninteractive complete flags discover zone/account and use remote tunnel without prompting", async () => {
  const temp = tempDirectory();
  try {
    const fixture = await wizardHarness(temp.dir);
    const cf = fakeCloudflare();
    await setupWizard(flags, true, { ...fixture.options, tty: false, api: cf.api });
    const config = await readConfig(fixture.home);
    expect(config.cloudflare).toMatchObject({ accountId: cf.account, zoneId: cf.zone, tunnelId: "remote-id" });
    expect(cf.requests[0]?.path).toContain("/zones?name=example.com");
    expect(fixture.prompts).toHaveLength(0);
    expect(fixture.output).toHaveLength(0);
    expect(await Bun.file(join(fixture.home, "config.json")).text()).not.toContain("fake-secret");
    expect((await setupWizard(["--status"], true, fixture.options)).steps.every(step => step.done)).toBe(true);
  } finally { temp.cleanup(); }
});

test("R2 setup discovers account and saves secret separately; local teardown uses discovered zone", async () => {
  const temp = tempDirectory();
  try {
    const fixture = await wizardHarness(temp.dir, ["example.com", "creator@example.com", "", "skip", "skip"]);
    await setupWizard([], false, fixture.options);
    const cf = fakeCloudflare();
    await setupWizard(["backups", "--yes", "--r2-bucket", "bedrock-backups", "--r2-access-key-id", "key", "--r2-secret-access-key", "secret"], true, { ...fixture.options, api: cf.api });
    expect((await readConfig(fixture.home)).backup).toMatchObject({ type: "r2", account: cf.account });
    expect(await Bun.file(join(fixture.home, "config.json")).text()).not.toContain('"secret"');
    expect((await stat(join(fixture.home, "backup-credentials"))).mode & 0o777).toBe(0o600);
    await tunnelTeardown(fixture.home, cf.api, true);
    expect((await readConfig(fixture.home)).cloudflare).toBeUndefined();
    expect(await Bun.file(join(fixture.home, "cloudflared/config.yml")).exists()).toBe(false);
  } finally { temp.cleanup(); }
});

test("bare-domain login runs existing callback flow and stores credentials privately", async () => {
  const temp = tempDirectory();
  try {
    for (const domain of ["example.com", "bedrock.example.com", "https://example.com", "https://bedrock.example.com/"]) expect(loginUrl(domain)).toBe("https://bedrock.example.com");
    await login("example.com", { path: join(temp.dir, "credentials.json"), open: async url => {
      const authorize = new URL(url);
      expect(authorize.origin).toBe("https://bedrock.example.com");
      const callback = new URL(`http://127.0.0.1:${authorize.searchParams.get("port")}/callback`);
      callback.searchParams.set("state", authorize.searchParams.get("state")!);
      callback.searchParams.set("token", `br_${"a".repeat(64)}`);
      expect((await fetch(callback)).status).toBe(200);
    } });
    expect((await Bun.file(join(temp.dir, "credentials.json")).json()).url).toBe("https://bedrock.example.com");
  } finally { temp.cleanup(); }
});

test("new React scaffold installs, migrates, commits, builds and deploy prints URL/access", async () => {
  const temp = tempDirectory();
  const output: string[] = [];
  const root = resolve(import.meta.dir, "../../..");
  let daemon: ReturnType<typeof Bun.serve> | undefined;
  const originalLog = console.log;
  try {
    const created = await newPebble("my-app", "react", { cwd: temp.dir, terminal: {
      write: line => output.push(line),
      run: async (args, options) => {
        if (args[1] === "install") { await symlink(join(root, "examples/notes/node_modules"), join(options!.cwd!, "node_modules")); return ""; }
        return run(args, options);
      },
    } });
    expect(await Bun.file(join(created.dir, "migrations/meta/_journal.json")).exists()).toBe(true);
    expect(await run(["git", "log", "-1", "--format=%s"], { cwd: created.dir })).toBe("feat: create my-app");
    const build = await Bun.build({ entrypoints: [join(created.dir, "web/index.html")], target: "browser" });
    expect(build.success).toBe(true);
    daemon = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
      if (new URL(request.url).pathname === "/api/status") return Response.json({ ok: true, value: { domain: "example.com", pebbles: [] } });
      expect(request.headers.get("content-type")).toBe("application/gzip");
      expect((await request.arrayBuffer()).byteLength).toBeGreaterThan(0);
      return Response.json({ ok: true, value: { name: "my-app" } });
    } });
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    await daemonCommand("deploy", [created.dir, "--url", `http://127.0.0.1:${daemon.port}`, "--token", "fake-token", "--no-open"], false);
    console.log = originalLog;
    const transcript = output.join("\n") + "\n";
    if (process.env.UPDATE_ONBOARDING_TRANSCRIPT) await Bun.write(join(import.meta.dir, "fixtures/creator-transcript.txt"), transcript);
    expect(transcript).toBe(await Bun.file(join(import.meta.dir, "fixtures/creator-transcript.txt")).text());
  } finally { console.log = originalLog; await daemon?.stop(true); temp.cleanup(); }
});

test("local wildcard routing falls back to discovered DNS API without changing tunnel mode", async () => {
  const temp = tempDirectory();
  try {
    const fixture = await wizardHarness(temp.dir, ["example.com", "creator@example.com", "", "skip", "skip"]);
    const execute = fixture.options.terminal!.run!;
    fixture.options.terminal!.run = async (args, opts) => { if (args.includes("route") && !args.includes("--help")) throw new Error("unsupported wildcard"); return execute(args, opts); };
    await expect(setupWizard([], false, fixture.options)).rejects.toMatchObject({ code: "LOCAL_DNS_FAILED" });
    const cf = fakeCloudflare();
    await setupWizard(["cloudflare", "--yes"], true, { ...fixture.options, api: cf.api });
    expect((await readConfig(fixture.home)).cloudflare?.mode).toBe("local");
    expect(cf.requests.find(request => request.method === "POST" && request.path.includes("dns_records"))?.body).toMatchObject({ name: "*.example.com", content: "11111111-1111-1111-1111-111111111111.cfargotunnel.com", proxied: true });
    expect(await tunnelStatus(fixture.home, cf.api)).toMatchObject({ matches: true });
  } finally { temp.cleanup(); }
});

test("dashboard redirects to Google, authorizes creators, and status reports real creator sessions and token email", async () => {
  const { startDaemon } = await import("../src/daemon");
  const { setup } = await import("../src/daemon/config");
  const { openDaemonDatabase } = await import("../src/daemon/db");
  const { createSessions } = await import("../src/auth/sessions");
  const temp = tempDirectory();
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let database: Awaited<ReturnType<typeof openDaemonDatabase>> | undefined;
  try {
    await setup(temp.dir, "example.com", "creator@example.com", 0, { clientId: client, clientSecret: "fake" });
    daemon = await startDaemon({ home: temp.dir });
    const url = `http://127.0.0.1:${daemon.server.port}`;
    const headers = { host: "bedrock.example.com" };
    const response = await fetch(url + "/", { headers, redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toStartWith("https://auth.example.com/login?return=");
    database = await openDaemonDatabase(temp.dir);
    const sessions = createSessions(database.db);
    const user = sessions.user("creator@example.com", "Creator");
    const cookie = `bedrock_session=${sessions.create(user.id)}`;
    expect(await (await fetch(url + "/", { headers: { ...headers, cookie } })).text()).toContain("Your server is ready");
    const token = database.createToken(user.email);
    const status = (await (await fetch(url + "/api/status", { headers: { ...headers, authorization: `Bearer ${token}` } })).json()).value;
    expect(status).toMatchObject({ domain: "example.com", user: "creator@example.com", creatorSignedIn: true });
    const outsider = sessions.user("outsider@example.com", "Other");
    expect((await fetch(url + "/", { headers: { ...headers, cookie: `bedrock_session=${sessions.create(outsider.id)}` } })).status).toBe(403);
  } finally { database?.close(); await daemon?.stop(); temp.cleanup(); }
});

test("local tunnel supervisor uses config argv, clears run token and serves despite fake connector exit", async () => {
  const { TunnelSupervisor } = await import("../src/tunnel/supervisor");
  const temp = tempDirectory();
  let supervisor: InstanceType<typeof TunnelSupervisor> | undefined;
  try {
    const { chmod } = await import("node:fs/promises");
    const binary = join(temp.dir, "connector");
    const output = join(temp.dir, "argv.json");
    await Bun.write(binary, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(output)}, JSON.stringify({ args: process.argv.slice(2), token: process.env.TUNNEL_TOKEN ?? null })); await Bun.sleep(10000);`);
    await chmod(binary, 0o700);
    supervisor = new TunnelSupervisor(temp.dir, "", () => binary, join(temp.dir, "config.yml"));
    supervisor.start();
    for (let i = 0; i < 50 && !await Bun.file(output).exists(); i++) await Bun.sleep(10);
    expect(await Bun.file(output).json()).toEqual({ args: ["tunnel", "--no-autoupdate", "--config", join(temp.dir, "config.yml"), "run"], token: null });
  } finally { await supervisor?.stop(); temp.cleanup(); }
});

test("Linux linger requires an explicit flag in unattended mode, and daemon startup failures stay resumable", async () => {
  const temp = tempDirectory();
  try {
    const fixture = await wizardHarness(temp.dir);
    const cf = fakeCloudflare();
    await setupWizard([...flags, "--enable-linger"], true, { ...fixture.options, platform: "linux", api: cf.api });
    expect(fixture.calls.some(args => args[0] === "loginctl" && args.includes("enable-linger"))).toBe(true);
    await expect(setupWizard(["service", "--yes"], true, { ...fixture.options, status: async () => { throw new Error("not ready"); } })).rejects.toMatchObject({ code: "DAEMON_UNREACHABLE" });
    expect((await setupWizard(["--status"], true, fixture.options)).steps.find(s => s.step === "service")?.done).toBe(false);
  } finally { temp.cleanup(); }
});

test("setup entrypoint emits one JSON error/status object and never prompts with redirected stdin", async () => {
  const temp = tempDirectory();
  try {
    const cli = resolve(import.meta.dir, "../src/cli/index.ts");
    for (const status of [false, true]) {
      const child = Bun.spawn([process.execPath, cli, "setup", ...(status ? ["--status"] : []), "--json"], {
        env: { ...process.env, BEDROCK_HOME: join(temp.dir, "home"), CLOUDFLARE_API_TOKEN: undefined }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim().split("\n")).toHaveLength(1);
      const result = JSON.parse(stdout);
      expect(code).toBe(status ? 0 : 1);
      if (status) expect(result.steps).toHaveLength(7);
      else expect(result.error).toMatchObject({ code: "SETUP_FLAGS_MISSING", hint: expect.stringContaining("--creator") });
    }
    expect(await Bun.file(join(temp.dir, "home/setup.json")).exists()).toBe(false);
  } finally { temp.cleanup(); }
});
