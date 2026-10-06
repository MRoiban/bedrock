import { expect, test, spyOn } from "bun:test";
import { Google } from "arctic";
import { openDaemonDatabase } from "../daemon/db";
import { tempDirectory } from "../../test/helpers";
import { createSessions } from "./sessions";
import { createAuth } from "./routes";

async function harness() {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(temp.dir);
  const sessions = createSessions(db.db);
  const revoked: string[] = [];
  const auth = createAuth({ domain: "example.test", creators: [], port: 0 }, false, sessions, hash => revoked.push(hash), {
    oauth: new Google("client", "secret", "https://auth.example.test/callback"),
    profile: async token => { expect(token).toBe("access"); return { email: "alice@example.test", email_verified: true, name: "Alice" }; },
  });
  return { auth, sessions, revoked, cleanup() { db.close(); temp.cleanup(); } };
}
test("Google OAuth uses PKCE, bound state and mocked token exchange without network", async () => {
  const h = await harness();
  let exchanges = 0;
  const mock = spyOn(globalThis, "fetch").mockImplementation((async (input: any) => {
    const request = input as Request;
    expect(request.url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(await request.text());
    expect(body.get("code")).toBe("valid-code");
    expect(body.get("code_verifier")!.length).toBeGreaterThan(30);
    expect(body.get("redirect_uri")).toBe("https://auth.example.test/callback");
    exchanges++;
    return Response.json({ access_token: "access", token_type: "Bearer", expires_in: 3600 });
  }) as typeof fetch);
  const origin = "https://auth.example.test";
  try {
    const page = await h.auth.handle(new Request(`${origin}/login?return=https://notes.example.test/`), origin);
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
    expect(await page.text()).toContain("Continue with Google");
    const start = await h.auth.handle(new Request(`${origin}/login?start=1&return=https://notes.example.test/`), origin);
    const google = new URL(start.headers.get("location")!);
    expect(google.hostname).toBe("accounts.google.com");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect(google.searchParams.get("code_challenge")!.length).toBeGreaterThan(30);
    const callback = `${origin}/callback?state=${google.searchParams.get("state")}&code=valid-code`;
    await expect(h.auth.handle(new Request(callback), origin)).rejects.toMatchObject({ code: "INVALID_OAUTH_STATE" });
    expect(start.headers.get("set-cookie")).toContain("__Host-bedrock_oauth=");
    expect(start.headers.get("set-cookie")).not.toContain("Domain=");
    const binding = start.headers.get("set-cookie")!.split(";")[0]!;
    const result = await h.auth.handle(new Request(callback, { headers: { cookie: binding } }), origin);
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("https://notes.example.test/");
    const cookie = result.headers.getSetCookie().find(value => value.startsWith("bedrock_session="))!;
    expect(cookie).toContain("HttpOnly; SameSite=Lax");
    expect(cookie).toContain("Domain=.example.test; Secure");
    const token = cookie.split(";")[0]!.split("=")[1]!;
    expect(h.sessions.resolve(token)?.user.email).toBe("alice@example.test");
    await expect(h.auth.handle(new Request(callback, { headers: { cookie: binding } }), origin)).rejects.toMatchObject({ code: "INVALID_OAUTH_STATE" });
    expect(exchanges).toBe(1);
    const logout = h.auth.logout(new Request(`${origin}/logout`, { method: "POST", headers: { origin, cookie: `bedrock_session=${token}` } }), origin);
    expect(logout.status).toBe(200);
    expect(h.revoked).toHaveLength(1);
    expect(h.sessions.resolve(token)).toBeNull();
  } finally { mock.mockRestore(); h.cleanup(); }
});
test("OAuth rejects bad state, return URLs and denied codes", async () => {
  const h = await harness();
  const origin = "https://auth.example.test";
  try {
    await expect(h.auth.handle(new Request(`${origin}/login?return=https://evil.test`), origin)).rejects.toMatchObject({ code: "INVALID_RETURN_URL" });
    await expect(h.auth.handle(new Request(`${origin}/callback?state=bad&code=bad`), origin)).rejects.toMatchObject({ code: "INVALID_OAUTH_STATE" });
    const start = await h.auth.handle(new Request(`${origin}/login?start=1`), origin);
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    await expect(h.auth.handle(new Request(`${origin}/callback?state=${state}&error=access_denied`, { headers: { cookie: start.headers.get("set-cookie")!.split(";")[0]! } }), origin)).rejects.toMatchObject({ code: "OAUTH_FAILED" });
  } finally { h.cleanup(); }
});

test("OAuth rejects unverified Google email and token endpoint failures", async () => {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(temp.dir);
  const sessions = createSessions(db.db);
  const origin = "https://auth.example.test";
  try {
    for (const tokenFails of [false, true]) {
      const auth = createAuth({ domain: "example.test", creators: [], port: 0 }, false, sessions, () => {}, {
        oauth: {
          createAuthorizationURL(state) { return new URL(`https://google.invalid/?state=${state}`); },
          async validateAuthorizationCode() { if (tokenFails) throw new Error("token rejected"); return { accessToken: () => "access" }; },
        },
        profile: async () => ({ email: "unverified@example.test", email_verified: false }),
      });
      const start = await auth.handle(new Request(`${origin}/login?start=1`), origin);
      const state = new URL(start.headers.get("location")!).searchParams.get("state");
      await expect(auth.handle(new Request(`${origin}/callback?state=${state}&code=code`, { headers: { cookie: start.headers.get("set-cookie")!.split(";")[0]! } }), origin)).rejects.toMatchObject({ code: "OAUTH_FAILED" });
    }
    expect(db.db.query("SELECT * FROM users").all()).toEqual([]);
  } finally { db.close(); temp.cleanup(); }
});
