import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { tempDirectory } from "./helpers";
import { setup } from "../src/daemon/config";
import { openDaemonDatabase, tokenHash } from "../src/daemon/db";
import { createSessions } from "../src/auth/sessions";
import { startDaemon } from "../src/daemon";
import { createArchive } from "../src/daemon/archive";

const email = "creator@example.test";
const host = "notes.example.test";
const origin = `https://${host}`;
const cli = resolve(import.meta.dir, "../src/cli/index.ts");

test("local admin selects only existing creators and pebble-token CLI creates and revokes real tokens", async () => {
  const h = await harness();
  try {
    const count = h.db.db.query("SELECT count(*) AS n FROM users").get();
    for (const [token, as, code] of [
      [h.admin, "missing@example.test", "CREATOR_NOT_FOUND"],
      [h.admin, "outsider@example.test", "FORBIDDEN"],
      [h.legacy, email, "FORBIDDEN"],
      [h.creator, "second@example.test", "FORBIDDEN"],
    ]) {
      const result = await h.api(`/api/pebbles/notes/service-tokens?as=${as}`, { name: "refused", permissions: ["*"] }, token);
      expect(result.status).toBe(403);
      expect((await result.json()).error).toMatchObject({ code, hint: expect.any(String) });
    }
    expect(h.db.db.query("SELECT count(*) AS n FROM users").get()).toEqual(count);
    for (const token of [h.admin, h.legacy]) {
      expect((await (await h.api("/api/pebbles/notes/service-tokens", { name: "ownerless", permissions: ["*"] }, token)).json()).error).toMatchObject({ code: "TOKEN_OWNER_REQUIRED", hint: expect.stringContaining("--as") });
    }
    for (const as of ["", `?as=${email}`]) {
      expect((await h.api(`/api/pebbles/notes/service-tokens${as}`, { name: "self", permissions: ["query:who"] }, h.creator)).status).toBe(200);
    }
    const created = await h.command(["pebble-token", "create", "notes", "--name", "agent", "--permissions", "query:who", "--as", " Creator@Example.Test "]);
    expect(created.code).toBe(0);
    expect(created.value.value.token).toStartWith("brk_");
    const service = created.value.value;
    const result = await h.page("/_bedrock/q/who", { method: "POST", headers: { authorization: `Bearer ${service.token}` }, body: "null" });
    expect((await result.json()).value).toMatchObject({ user: { id: h.user.id, email }, token: { id: service.id } });
    expect((await h.command(["pebble-token", "revoke", "notes", service.id, "--as", email])).value.error.code).toBe("CONFIRM_REQUIRED");
    for (let i = 0; i < 2; i++) expect((await h.command(["pebble-token", "revoke", "notes", service.id, "--as", email, "--yes"])).value.value).toEqual({ revoked: true });
    expect((await h.page("/_bedrock/q/who", { method: "POST", headers: { authorization: `Bearer ${service.token}` }, body: "null" })).status).toBe(401);
    const login = await h.command(["login", "example.test"], false);
    expect(login.value.hint).toContain("bedrock session create");
    expect(login.value.hint).toContain("computer with your browser");
    expect(login.value.hint).toContain("--as");
  } finally { await h.cleanup(); }
}, 30000);

test("session CLI produces scanner-safe, hashed, single-use, fixed-expiry links through production Host routing", async () => {
  const h = await harness();
  try {
    const started = Date.now();
    const minted = await h.command(["session", "create", "notes", "--as", email]);
    expect(minted.code).toBe(0);
    const link = minted.value.value;
    expect(link.expiresAt).toBeGreaterThanOrEqual(started + 15 * 60_000);
    expect(link.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    expect(link.url).toStartWith(`${origin}/_bedrock/session#`);
    const secret = new URL(link.url).hash.slice(1);
    expect(h.db.db.query("SELECT hash, user_id, pebble, expires_at FROM session_links").get()).toEqual({ hash: tokenHash(secret), user_id: h.user.id, pebble: "notes", expires_at: link.expiresAt });
    const page = await h.page("/_bedrock/session");
    expect(page.status).toBe(200);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'sha256-");
    const html = await page.text();
    expect(html).toContain('method="post"');
    expect(html).toContain("history.replaceState");
    expect(html).not.toContain(secret);
    // GETs (including scanners) leave the credential available until explicit confirmation.
    expect((await h.page("/_bedrock/session")).status).toBe(200);
    expect((await h.redeem(secret, "https://evil.test")).status).toBe(403);
    const responses = await Promise.all([h.redeem(secret), h.redeem(secret)]);
    expect(responses.map(response => response.status).sort()).toEqual([303, 400]);
    const success = responses.find(response => response.status === 303)!;
    expect(success.headers.get("location")).toBe(`${origin}/`);
    expect(success.headers.get("referrer-policy")).toBe("no-referrer");
    expect(success.headers.get("cache-control")).toBe("no-store");
    const cookie = success.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly; SameSite=Lax");
    expect(cookie).toContain("Domain=.example.test; Secure");
    const session = cookie.split(";")[0]!.split("=")[1]!;
    const sessions = createSessions(h.db.db);
    expect(sessions.resolve(session)).toMatchObject({ user: { id: h.user.id }, expiresAt: link.expiresAt, refreshed: false });
    // Normal resolution must never extend these sessions to the ordinary thirty-day lifetime.
    const signedPage = await h.page("/", { headers: { cookie: cookie.split(";")[0]! } });
    expect(signedPage.status).toBe(200);
    expect(await signedPage.text()).toBe("signed in");
    const me = await h.page("/_bedrock/me", { headers: { cookie: cookie.split(";")[0]! } });
    expect((await me.json()).user.id).toBe(h.user.id);
    expect(me.headers.get("set-cookie")).toBeNull();
    expect(createSessions(h.db.db, () => link.expiresAt - 1).resolve(session)?.expiresAt).toBe(link.expiresAt);
    expect(createSessions(h.db.db, () => link.expiresAt).resolve(session)).toBeNull();
    for (const token of [secret, "a".repeat(64), "invalid"]) {
      const refused = await h.redeem(token);
      expect(refused.status).toBe(400);
      expect(refused.headers.get("content-type")).toContain("text/html");
      expect(await refused.text()).toContain("INVALID_SESSION_LINK");
    }
    const expiring = (await h.command(["session", "create", "notes", "--as", email, "--ttl", "1s"])).value.value;
    const expired = new URL(expiring.url).hash.slice(1);
    h.db.db.query("UPDATE session_links SET expires_at=0 WHERE hash=?").run(tokenHash(expired));
    expect((await h.redeem(expired)).status).toBe(400);
    for (const ttl of ["61m", "0m", "2h", "-1m", "nonsense", 123]) {
      const response = await h.api(`/api/pebbles/notes/sessions?as=${email}`, { ttl });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_ARGS");
    }
    expect((await h.command(["session", "create", "notes", "--as", email, "--ttl", "61m"])).value.error.code).toBe("INVALID_ARGS");
    const max = await h.api(`/api/pebbles/notes/sessions?as=${email}`, { ttl: "1h" });
    expect(max.status).toBe(200);
    const capped = (await max.json()).value;
    expect(capped.expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
    const noIdentity = await h.api("/api/pebbles/notes/sessions", {});
    expect((await noIdentity.json()).error.code).toBe("TOKEN_OWNER_REQUIRED");
    expect((await h.api(`/api/pebbles/notes/sessions?as=${email}`, {}, h.legacy)).status).toBe(403);
    expect((await h.api("/api/pebbles/notes/sessions?as=second@example.test", {}, h.creator)).status).toBe(403);
    expect((await h.api("/api/pebbles/notes/sessions", {}, h.creator)).status).toBe(200);
    const scoped = h.db.createToken(email, { scope: { pebbles: ["notes"], actions: ["service-tokens"] } });
    expect((await h.api("/api/pebbles/notes/sessions", {}, scoped)).status).toBe(403);
    for (const as of ["missing@example.test", "outsider@example.test"]) expect((await h.api(`/api/pebbles/notes/sessions?as=${as}`, {})).status).toBe(403);
    const logs = await (await h.api("/api/pebbles/notes/logs", undefined, h.admin, "GET")).text();
    for (const token of [secret, expired, new URL(capped.url).hash.slice(1)]) expect(logs).not.toContain(token);
    expect(h.db.db.query("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  } finally { await h.cleanup(); }
}, 30000);

async function harness() {
  const temp = tempDirectory();
  const home = join(temp.dir, "home");
  await setup(home, "example.test", email, 0);
  const config = await Bun.file(join(home, "config.json")).json();
  await Bun.write(join(home, "config.json"), JSON.stringify({ ...config, creators: [email, "second@example.test"] }));
  const db = await openDaemonDatabase(home);
  const sessions = createSessions(db.db);
  const user = sessions.user(email, "Creator");
  sessions.user("second@example.test", "Second");
  sessions.user("outsider@example.test", "Outsider");
  const creator = db.createToken(email);
  const legacy = db.createToken();
  const daemon = await startDaemon({ home });
  const admin = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = (path: string, body?: unknown, token = admin, method = "POST") => fetch(new URL(path, daemon.server.url), { method, headers: { host: "bedrock.example.test", authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const dir = join(temp.dir, "source");
  await Bun.write(join(dir, "pebble.ts"), `import { definePebble, query } from "bedrock";
export default definePebble({ name: "notes", access: "creators", tokens: true, queries: { who: query(ctx => ({ user: ctx.user, token: ctx.token })) }, routes: { "GET /": () => new Response("signed in") } });`);
  const archive = join(temp.dir, "notes.tar.gz");
  await createArchive(dir, archive);
  const deployed = await fetch(new URL("/api/deploy?name=notes", daemon.server.url), { method: "POST", headers: { host: "bedrock.example.test", authorization: `Bearer ${admin}` }, body: Bun.file(archive) });
  expect(deployed.status).toBe(200);
  const page = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, redirect: "manual", headers: { host, accept: "text/html", ...init.headers } });
  return {
    db, user, admin, legacy, creator, api, page,
    redeem: (token: string, source = origin) => page("/_bedrock/session", { method: "POST", headers: { origin: source, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }),
    async command(args: string[], explicit = true) {
      const child = Bun.spawn([process.execPath, cli, ...args, ...(explicit ? ["--url", `http://127.0.0.1:${daemon.server.port}`, "--token", admin] : []), "--json"], { env: { ...process.env, BEDROCK_HOME: home, XDG_CONFIG_HOME: join(temp.dir, "config"), BEDROCK_URL: undefined, BEDROCK_TOKEN: undefined }, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim().split("\n")).toHaveLength(1);
      return { code, value: JSON.parse(stdout) };
    },
    async cleanup() { await daemon.stop(); db.close(); temp.cleanup(); },
  };
}
