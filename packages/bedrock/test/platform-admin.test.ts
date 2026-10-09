import { expect, test } from "bun:test";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { tempDirectory } from "./helpers";
import { setup } from "../src/daemon/config";
import { openDaemonDatabase } from "../src/daemon/db";
import { createSessions } from "../src/auth/sessions";
import { startDaemon } from "../src/daemon";
import { createArchive } from "../src/daemon/archive";

const source = (name = "upty", enabled = true) => `import { definePebble, query, job, BedrockError } from "bedrock";
console.log("secret:", process.env.DISCORD_TOKEN);
if (process.env.FAIL_START === "yes") throw new Error("startup rejected");
export default definePebble({ name: "${name}", access: "public", tokens: ${enabled},
jobs: {
  exit: job("0 0 31 2 *", () => { process.exit(1); }),
  check: job("0 0 31 2 *", ctx => { if (ctx.user !== null || !process.env.DISCORD_TOKEN) throw new Error("job context changed"); }),
  detached: job("0 0 31 2 *", async ctx => { await ctx.read(slot => { if (slot.user !== null) throw new Error("job identity changed"); }); }, { transaction: false }),
  fail: job("0 0 31 2 *", () => { throw new BedrockError("JOB_FAILED", process.env.DISCORD_TOKEN, process.env.DISCORD_TOKEN); })
},
queries: { who: query(ctx => ({ user: ctx.user, token: ctx.token })) }, routes: {
"GET /env": () => Response.json({ hasSecret: !!process.env.DISCORD_TOKEN, digest: process.env.DISCORD_TOKEN ? new Bun.CryptoHasher("sha256").update(process.env.DISCORD_TOKEN).digest("hex") : null, api: process.env.BEDROCK_API_URL, hasDaemonEnv: !!process.env.BEDROCK_TEST_DAEMON_CREDENTIAL }),
"GET /daemon": async () => new Response(String((await fetch(process.env.BEDROCK_API_URL + "/api/pebbles")).status))
}});`;

test("secrets, deploy scope and service tokens work through the daemon and supervised executor", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "home");
  await setup(home, "localhost", "creator@example.test", 0);
  const db = await openDaemonDatabase(home);
  const user = createSessions(db.db).user("creator@example.test", "Creator");
  const creator = db.createToken(user.email);
  const otherUser = createSessions(db.db).user("other@example.test", "Other");
  const other = db.createToken(otherUser.email);
  db.close();
  const previousDaemonEnv = process.env.BEDROCK_TEST_DAEMON_CREDENTIAL;
  process.env.BEDROCK_TEST_DAEMON_CREDENTIAL = "daemon-only-credential";
  const daemon = await startDaemon({ home, dev: true, domain: "localhost" });
  const request = (path: string, token = creator, method = "GET", body?: unknown) => fetch(new URL(path, daemon.server.url), {
    method, headers: { host: "bedrock.localhost", authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const deploy = async (name: string, token: string, enabled = true) => {
    const dir = join(temp.dir, name); await Bun.write(join(dir, "pebble.ts"), source(name, enabled));
    const archive = join(temp.dir, `${name}.tar.gz`); await createArchive(dir, archive);
    return fetch(new URL(`/api/deploy?name=${name}`, daemon.server.url), { method: "POST", headers: { host: "bedrock.localhost", authorization: `Bearer ${token}` }, body: Bun.file(archive) });
  };
  const pebble = (path: string, token?: string) => fetch(new URL(path, daemon.server.url), { method: path.startsWith("/_bedrock/q/") ? "POST" : "GET", headers: { host: "upty.localhost", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(path.startsWith("/_bedrock/q/") ? { body: "null" } : {}) });
  try {
    const scoped = (await (await request("/api/tokens", creator, "POST", { name: "manager", scope: { pebbles: ["upty", "bot-*"], actions: ["deploy", "lifecycle", "logs", "secrets", "status", "service-tokens"] } })).json()).value.token;
    const scopeRows = (await (await request("/api/tokens")).json()).value;
    expect(scopeRows.find((row: { name: string }) => row.name === "manager")).toMatchObject({ userId: user.id, scope: { pebbles: ["upty", "bot-*"], actions: ["deploy", "lifecycle", "logs", "secrets", "status", "service-tokens"] } });
    for (const [path, method] of [["/api/tokens", "GET"], ["/api/tokens", "POST"], ["/api/tokens/current", "DELETE"], ["/api/self-update", "POST"], ["/api/backup/run", "POST"], ["/api/config", "GET"], ["/api/host", "GET"], ["/api/jobs/upty", "GET"], ["/api/pebbles/other/secrets", "GET"], ["/api/deploy?name=other", "POST"]]) {
      const response = await request(path!, scoped, method!); expect(response.status).toBe(403);
      expect((await response.json()).error).toMatchObject({ code: "FORBIDDEN", hint: expect.any(String) });
    }
    const secret = "super-secret-discord-credential";
    const update = await request("/api/pebbles/upty/secrets", scoped, "PUT", { set: { DISCORD_TOKEN: secret } });
    expect(update.status).toBe(200);
    const metadata = await update.json();
    expect(metadata).toEqual({ ok: true, value: { secrets: [{ name: "DISCORD_TOKEN", updatedAt: expect.any(Number) }] } });
    expect(update.headers.get("cache-control")).toBe("no-store");
    expect(await (await request("/api/pebbles/upty/secrets", scoped)).json()).toEqual(metadata);
    if (process.platform !== "win32") expect((await stat(join(home, "pebbles/upty/secrets.json"))).mode & 0o777).toBe(0o600);
    for (const name of ["BEDROCK_API_URL", "BEDROCK_IDENTITY_SECRET", "NODE_OPTIONS", "PATH", "lower", "A".repeat(65)]) {
      const invalid = await request("/api/pebbles/upty/secrets", scoped, "PUT", { set: { [name]: secret } });
      expect(invalid.status).toBe(400); expect(await invalid.text()).not.toContain(secret);
    }
    expect((await deploy("upty", scoped)).status).toBe(200);
    expect((await deploy("bot-second", scoped, false)).status).toBe(200);
    expect((await deploy("unrelated", creator)).status).toBe(200);
    expect((await (await request("/api/pebbles", scoped)).json()).value.map((row: { name: string }) => row.name)).toEqual(["bot-second", "upty"]);
    const status = (await (await request("/api/status", scoped)).json()).value;
    expect(status.pebbles.map((row: { name: string }) => row.name)).toEqual(["bot-second", "upty"]);
    expect(status.tunnel).toBeUndefined();
    expect(await (await pebble("/env")).json()).toEqual({ hasSecret: true, digest: new Bun.CryptoHasher("sha256").update(secret).digest("hex"), api: `http://127.0.0.1:${daemon.server.port}`, hasDaemonEnv: false });
    expect(await (await pebble("/daemon")).text()).toBe("401");
    expect(await (await request("/api/jobs/upty")).json()).toEqual({ ok: true, value: [
      { name: "exit", cron: "0 0 31 2 *", running: false },
      { name: "check", cron: "0 0 31 2 *", running: false },
      { name: "detached", cron: "0 0 31 2 *", running: false },
      { name: "fail", cron: "0 0 31 2 *", running: false },
    ] });
    for (const name of ["check", "detached"]) expect(await (await request(`/api/jobs/upty?job=${name}`, creator, "POST")).json()).toEqual({ ok: true, value: { name, skipped: false } });
    const jobFailure = await request("/api/jobs/upty?job=fail", creator, "POST");
    expect(await jobFailure.json()).toEqual({ ok: false, error: { code: "JOB_FAILED", message: "[REDACTED]", hint: "[REDACTED]" } });
    expect((await (await request("/api/jobs/upty?job=missing", creator, "POST")).json()).error.code).toBe("JOB_NOT_FOUND");
    expect((await pebble("/_bedrock/jobs")).status).toBe(404);
    const logText = await (await request("/api/pebbles/upty/logs", scoped)).text();
    expect(logText).not.toContain(secret); expect(logText).toContain("[REDACTED]");
    expect(await Bun.file(join(home, "pebbles/upty/logs/pebble.log")).text()).not.toContain(secret);
    const replacement = "rotated-discord-credential";
    expect((await request("/api/pebbles/upty/secrets", scoped, "PUT", { set: { DISCORD_TOKEN: replacement } })).status).toBe(200);
    expect((await (await pebble("/env")).json()).digest).toBe(new Bun.CryptoHasher("sha256").update(secret).digest("hex"));
    expect((await deploy("upty", scoped)).status).toBe(200);
    expect((await (await pebble("/env")).json()).digest).toBe(new Bun.CryptoHasher("sha256").update(replacement).digest("hex"));
    const minted = await request("/api/pebbles/upty/service-tokens", scoped, "POST", { name: "manager", permissions: ["query:who"] });
    expect(minted.status).toBe(200);
    expect(minted.headers.get("cache-control")).toBe("no-store");
    const serviceResponse = await minted.json(); expect(serviceResponse.ok).toBe(true);
    const service = serviceResponse.value; expect(Object.keys(service).sort()).toEqual(["id", "token"]); expect(service.token).toMatch(/^brk_/);
    const who = (await (await pebble("/_bedrock/q/who", service.token)).json()).value;
    expect(who.user.id).toBe(user.id); expect(who.token.id).toBe(service.id);
    const invalidPermission = await request("/api/pebbles/upty/service-tokens", scoped, "POST", { name: "bad", permissions: ["route:GET /missing"] });
    expect((await invalidPermission.json()).error.code).toBe("INVALID_TOKEN_PERMISSION");
    expect((await (await request("/api/pebbles/bot-second/service-tokens", scoped, "POST", { name: "disabled", permissions: ["*"] })).json()).error.code).toBe("TOKENS_DISABLED");
    expect((await request(`/api/pebbles/upty/service-tokens/${service.id}`, other, "DELETE")).status).toBe(403);
    for (let i = 0; i < 2; i++) {
      const revoked = await request(`/api/pebbles/upty/service-tokens/${service.id}`, scoped, "DELETE");
      expect(revoked.headers.get("cache-control")).toBe("no-store");
      expect(await revoked.json()).toEqual({ ok: true, value: { revoked: true } });
    }
    expect((await pebble("/_bedrock/q/who", service.token)).status).toBe(401);
    const admin = (await Bun.file(join(home, "admin-token")).text()).trim();
    expect((await (await request("/api/pebbles/upty/service-tokens", admin, "POST", { name: "ownerless", permissions: ["*"] })).json()).error.code).toBe("TOKEN_OWNER_REQUIRED");
    const pid = async () => (await (await request("/api/pebbles")).json()).value.find((row: { name: string }) => row.name === "upty").pid;
    const oldPid = await pid();
    expect((await request("/api/pebbles/upty/secrets", scoped, "PUT", { set: { FAIL_START: "yes" }, restart: true })).status).toBe(500);
    expect(await pid()).toBe(oldPid); expect((await pebble("/env")).status).toBe(200);
    expect((await request("/api/pebbles/upty/secrets", scoped, "PUT", { unset: ["FAIL_START", "DISCORD_TOKEN"], restart: true })).status).toBe(200);
    expect(await pid()).not.toBe(oldPid); expect((await (await pebble("/env")).json()).hasSecret).toBe(false);
    expect((await request("/api/pebbles/upty/restart", scoped, "POST")).status).toBe(200);
    expect((await (await pebble("/env")).json()).hasSecret).toBe(false);
    expect((await request("/api/pebbles/upty/stop", scoped, "POST")).status).toBe(200);
    expect((await (await request("/api/pebbles/upty/service-tokens", scoped, "POST", { name: "stopped", permissions: ["*"] })).json()).error.code).toBe("PEBBLE_STOPPED");
    expect((await (await request("/api/jobs/upty")).json()).error.code).toBe("PEBBLE_STOPPED");
    expect((await request("/api/pebbles/upty/start", scoped, "POST")).status).toBe(200);
    const exited = await request("/api/jobs/upty?job=exit", creator, "POST");
    expect(exited.status).toBe(409);
    expect((await exited.json()).error.code).toBe("PEBBLE_STOPPED");
  } finally {
    await daemon.stop();
    if (previousDaemonEnv === undefined) delete process.env.BEDROCK_TEST_DAEMON_CREDENTIAL;
    else process.env.BEDROCK_TEST_DAEMON_CREDENTIAL = previousDaemonEnv;
    temp.cleanup();
  }
}, 30000);
