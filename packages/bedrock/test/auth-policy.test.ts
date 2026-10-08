import { expect, test } from "bun:test";
import { join } from "node:path";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";
import { tempDirectory } from "./helpers";

test("daemon discovers access at health check and enforces every policy before custom routes", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "home");
  await setup(home, "example.test", "creator@example.test", 0);
  const daemon = await startDaemon({ home, auth: {
    oauth: {
      createAuthorizationURL(state) { return new URL(`https://google.invalid/?state=${state}`); },
      async validateAuthorizationCode(code) { return { accessToken: () => code }; },
    },
    profile: async email => ({ email, email_verified: true, name: email }),
  } });
  const adminToken = (await Bun.file(join(home, "admin-token")).text()).trim();
  const request = (host: string, path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, redirect: "manual", headers: { host, origin: `https://${host}`, ...init.headers } });
  const login = async (email: string) => {
    const start = await request("auth.example.test", "/login?start=1&return=https://members.example.test/");
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    const callback = await request("auth.example.test", `/callback?state=${state}&code=${encodeURIComponent(email)}`, { headers: { cookie: start.headers.get("set-cookie")!.split(";")[0]! } });
    expect(callback.status).toBe(302);
    return callback.headers.getSetCookie().find(cookie => cookie.startsWith("bedrock_session="))!.split(";")[0]!;
  };
  try {
    for (const [name, access] of Object.entries({ open: "public", members: "users", makers: "creators", team: { allow: ["@company.test", "guest@other.test"] }, crew: { allow: ["creators", "guest@other.test"] } })) {
      const dir = join(temp.dir, name);
      await Bun.write(join(dir, "pebble.ts"), `import { definePebble, query, detached } from "bedrock";
export default definePebble({ name: "${name}", access: ${JSON.stringify(access)},
queries: { who: query(({user, request}) => ({user, cookie: request.headers.get("cookie")})) },
routes: { "GET /page": () => new Response("permitted"), "GET /detached": detached(() => new Response("permitted")) } });`);
      const archive = join(temp.dir, `${name}.tar.gz`);
      await createArchive(dir, archive);
      expect((await request("bedrock.example.test", `/api/deploy?name=${name}`, { method: "POST", body: Bun.file(archive), headers: { authorization: `Bearer ${adminToken}` } })).status).toBe(200);
    }
    const creator = await login("creator@example.test");
    const member = await login("member@company.test");
    const guest = await login("guest@other.test");
    expect((await request("open.example.test", "/page")).status).toBe(200);
    for (const name of ["members", "makers", "team"]) {
      expect((await request(`${name}.example.test`, "/page")).status).toBe(401);
      const page = await request(`${name}.example.test`, "/page", { headers: { accept: "text/html" } });
      expect(page.status).toBe(302);
      expect(page.headers.get("location")).toContain("https://auth.example.test/login?return=");
    }
    expect((await request("members.example.test", "/page", { headers: { cookie: guest } })).status).toBe(200);
    expect((await request("makers.example.test", "/page", { headers: { cookie: creator } })).status).toBe(200);
    expect((await request("makers.example.test", "/page", { headers: { cookie: member, accept: "text/html" } })).status).toBe(403);
    expect((await request("team.example.test", "/page", { headers: { cookie: member } })).status).toBe(200);
    expect((await request("team.example.test", "/page", { headers: { cookie: guest } })).status).toBe(200);
    expect((await request("team.example.test", "/page", { headers: { cookie: creator } })).status).toBe(403);
    expect((await request("crew.example.test", "/page", { headers: { cookie: creator } })).status).toBe(200);
    expect((await request("crew.example.test", "/page", { headers: { cookie: guest } })).status).toBe(200);
    expect((await request("crew.example.test", "/page", { headers: { cookie: member, accept: "text/html" } })).status).toBe(403);
    for (const [name, cookie, status] of [
      ["open", "", 200], ["members", "", 401], ["members", guest, 200],
      ["makers", creator, 200], ["makers", member, 403],
      ["team", member, 200], ["team", creator, 403],
    ] as const) {
      expect((await request(`${name}.example.test`, "/detached", { headers: { cookie } })).status).toBe(status);
    }
    const identity = await (await request("makers.example.test", "/_bedrock/q/who", { method: "POST", body: "null", headers: { cookie: `${creator}; theme=dark`, "x-bedrock-user": "spoof" } })).json();
    expect(identity.value.user.email).toBe("creator@example.test");
    expect(identity.value.cookie).toBe("theme=dark");
    expect((await request("members.example.test", "/_bedrock/ws", { headers: { upgrade: "websocket" } })).status).toBe(401);
  } finally { await daemon.stop(); temp.cleanup(); }
}, 20000);
