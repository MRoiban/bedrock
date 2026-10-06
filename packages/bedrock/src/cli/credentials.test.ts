import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { browserCommand, loginCallback, logout, readCredentials, remoteUrl, saveCredentials } from "./credentials";

test("Windows browser launch passes callback URLs as a literal argument", () => {
  const url = "https://bedrock.example.com/cli-login?state=abc&port=1234";
  expect(browserCommand(url, "win32")).toEqual(["rundll32.exe", "url.dll,FileProtocolHandler", url]);
});

const token = `br_${"a".repeat(64)}`;
test("CLI callback checks state, token, method and consumes success only once", () => {
  let saved = "";
  const callback = loginCallback("state", value => { saved = value; });
  expect(callback(new Request(`http://127.0.0.1/callback?state=wrong&token=${token}`)).status).toBe(400);
  expect(saved).toBe("");
  expect(callback(new Request("http://127.0.0.1/callback?state=state&token=bad")).status).toBe(400);
  expect(callback(new Request(`http://127.0.0.1/callback?state=state&token=${token}`)).status).toBe(200);
  expect(saved).toBe(token);
  expect(callback(new Request(`http://127.0.0.1/callback?state=state&token=${token}`)).status).toBe(400);
});

test("credentials are private; logout revokes first and retains credentials on network failure", async () => {
  const temp = tempDirectory();
  const path = join(temp.dir, "config/credentials.json");
  try {
    await saveCredentials({ url: "https://bedrock.example.com", token }, path);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readCredentials(path))?.token).toBe(token);
    await expect(logout(path, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).rejects.toMatchObject({ code: "LOGOUT_FAILED" });
    expect(await Bun.file(path).exists()).toBe(true);
    let revoked = false;
    await logout(path, (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://bedrock.example.com/api/tokens/current");
      expect(init.method).toBe("DELETE");
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
      revoked = true;
      return Response.json({ ok: true });
    }) as typeof fetch);
    expect(revoked).toBe(true);
    expect(await readCredentials(path)).toBeNull();
    expect(await logout(path)).toMatchObject({ loggedOut: true });
  } finally { temp.cleanup(); }
});
test("remote URLs cannot send credentials to insecure or embedded-auth URLs", () => {
  for (const value of ["http://bedrock.example.com", "https://evil:pass@example.com", "https://example.com/path", "garbage"]) expect(() => remoteUrl(value)).toThrow();
});

test("login is idempotent for valid saved credentials and requires logout before switching servers", async () => {
  const { login } = await import("./credentials");
  const temp = tempDirectory();
  const path = join(temp.dir, "credentials.json");
  try {
    await saveCredentials({ url: "https://bedrock.example.com", token }, path);
    let opened = false;
    const result = await login("https://bedrock.example.com", { path, open: async () => { opened = true; },
      fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch });
    expect(result.authenticated).toBe(true);
    expect(opened).toBe(false);
    await expect(login("https://bedrock.other.com", { path })).rejects.toMatchObject({ code: "LOGIN_CONFLICT" });
  } finally { temp.cleanup(); }
});
