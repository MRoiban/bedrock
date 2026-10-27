import { request as httpRequest } from "node:http";
import { expect, test } from "bun:test";
import { cp, mkdir, readlink, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";
import { tempDirectory } from "./helpers";

async function harness(dev = false) {
  const temp = tempDirectory();
  const home = join(temp.dir, "home");
  await setup(home, dev ? "localhost" : "example.test", "creator@example.test", 0);
  const daemon = await startDaemon({ home, ...(dev ? { domain: "localhost", dev: true } : {}) });
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = (path: string, init: RequestInit = {}, bearer = token) => fetch(new URL(path, daemon.server.url), {
    ...init, headers: { host: "bedrock.localhost", authorization: `Bearer ${bearer}`, ...init.headers },
  });
  const request = (host: string, path = "/", init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { origin: `${host.includes(".localhost") ? "http" : "https"}://${host}`, ...init.headers, host }, redirect: "manual" });
  const deploy = async (name: string, dir: string) => {
    const archive = join(temp.dir, `${crypto.randomUUID()}.tar.gz`);
    await createArchive(dir, archive);
    return api(`/api/deploy?name=${name}`, { method: "POST", body: Bun.file(archive) });
  };
  const list = async () => (await (await api("/api/pebbles")).json()).value as { name: string; status: string; pid: number; release: string }[];
  return { temp, home, daemon, token, api, request, deploy, list, async cleanup() { await daemon.stop(); temp.cleanup(); } };
}
async function until(predicate: () => Promise<boolean>, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > end) throw new Error("Timed out waiting for daemon state");
    await Bun.sleep(25);
  }
}

const source = (version: string) => `import { definePebble } from "bedrock";
console.log("started ${version}");
export default definePebble({ name: "sample", routes: {
  "POST /echo": async request => new Response(await request.text(), { status: 201, headers: { "x-test": "preserved" } }),
  "GET /version": () => new Response("${version}"),
  "GET /slow": async () => { await Bun.sleep(250); return new Response("${version}"); },
  "GET /headers": request => Response.json(Object.fromEntries(request.headers)),
  "GET /crash": () => { setTimeout(() => process.exit(1), 20); return new Response("bye"); }
}});`;

test("daemon routes, strips headers, authorizes, swaps, retains releases, rolls back, restarts and deletes", async () => {
  const h = await harness();
  const dir = join(h.temp.dir, "source");
  await Bun.write(join(dir, "pebble.ts"), source("v1"));
  try {
    if (process.platform !== "win32") expect((await stat(join(h.home, "admin-token"))).mode & 0o777).toBe(0o600);
    expect((await h.api("/api/pebbles", {}, "bad")).status).toBe(401);
    expect((await h.request("bedrock.example.test", "/api/pebbles", { headers: { authorization: `Bearer ${h.token}` } })).status).toBe(200);
    for (const host of ["unknown.localhost", "auth.localhost", "www.example.test", "sample.evil.test", "nested.sample.localhost"]) expect((await h.request(host)).status).toBe(404);
    const deployed = await (await h.deploy("sample", dir)).json();
    expect(deployed.ok).toBe(true);
    const current = async () => resolve(h.home, "pebbles/sample", await readlink(join(h.home, "pebbles/sample/current")));
    expect(await current()).toBe(deployed.value.release);
    // POSIX links are relative so a moved BEDROCK_HOME keeps them; Windows junctions are absolute.
    if (process.platform !== "win32") expect(await readlink(join(h.home, "pebbles/sample/current"))).toBe(join("releases", basename(deployed.value.release)));
    expect(await readlink(join(deployed.value.release, "node_modules/bedrock"))).toBe(resolve(import.meta.dir, ".."));
    for (const host of ["sample.localhost", "sample.example.test", "sample.localhost:1234"]) expect(await (await h.request(host, "/version")).text()).toBe("v1");
    const echo = await h.request("sample.localhost", "/echo", { method: "POST", body: "streamed body" });
    expect(echo.status).toBe(201);
    expect(echo.headers.get("x-test")).toBe("preserved");
    expect(await echo.text()).toBe("streamed body");
    const headers = await (await h.request("sample.localhost:42", "/headers", { headers: { "x-bedrock-user": "spoofed", "x-bedrock-signature": "spoofed", "x-bedrock-any": "spoofed", "x-forwarded-host": "evil", "x-forwarded-proto": "evil" } })).json();
    expect(Object.keys(headers).some(name => name.startsWith("x-bedrock-"))).toBe(false);
    expect(headers["x-forwarded-host"]).toBe("sample.localhost:42");
    expect(headers["x-forwarded-proto"]).toBe("http");
    const inFlight = h.request("sample.localhost", "/slow");
    await Bun.sleep(25);
    await Bun.write(join(dir, "pebble.ts"), source("v2"));
    expect((await (await h.deploy("sample", dir)).json()).ok).toBe(true);
    expect(await (await inFlight).text()).toBe("v1");
    const v2 = (await h.list())[0]!.release;
    expect(await (await h.request("sample.localhost", "/version")).text()).toBe("v2");
    await Bun.write(join(dir, "pebble.ts"), "throw new Error('broken release');");
    expect((await h.deploy("sample", dir)).status).toBe(500);
    expect(await (await h.request("sample.localhost", "/version")).text()).toBe("v2");
    expect(await current()).toBe(v2);
    expect((await h.api("/api/pebbles/sample/rollback", { method: "POST" })).status).toBe(200);
    expect(await (await h.request("sample.localhost", "/version")).text()).toBe("v1");
    const oldPid = (await h.list())[0]!.pid;
    await h.request("sample.localhost", "/crash");
    await until(async () => { const row = (await h.list())[0]!; return row.status === "running" && row.pid !== oldPid; });
    expect(await (await h.request("sample.localhost", "/version")).text()).toBe("v1");
    const logs = await (await h.api("/api/pebbles/sample/logs")).text();
    expect(logs).toContain("started v1");
    const follow = new AbortController();
    const followed = await h.api("/api/pebbles/sample/logs?follow=true", { signal: follow.signal });
    const reader = followed.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("started v1");
    await h.api("/api/pebbles/sample/restart", { method: "POST" });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("started v1");
    follow.abort();
    await reader.cancel().catch(() => {});
    expect((await h.api("/api/pebbles/sample/stop", { method: "POST" })).status).toBe(200);
    expect((await h.request("sample.localhost", "/version")).status).toBe(404);
    expect((await h.api("/api/pebbles/sample/start", { method: "POST" })).status).toBe(200);
    for (const version of ["v3", "v4", "v5"]) {
      await Bun.write(join(dir, "pebble.ts"), source(version));
      expect((await h.deploy("sample", dir)).status).toBe(200);
    }
    expect(await readdir(join(h.home, "pebbles/sample/releases"))).toHaveLength(3);
    const createdToken = (await (await h.api("/api/tokens", { method: "POST" })).json()).value.token;
    expect((await h.api("/api/pebbles", {}, createdToken)).status).toBe(200);
    expect((await h.api("/api/pebbles/sample", { method: "DELETE" })).status).toBe(400);
    expect((await h.api("/api/pebbles/sample?confirm=true", { method: "DELETE" })).status).toBe(200);
    expect(await h.list()).toEqual([]);
    expect(await Bun.file(join(h.home, "pebbles/sample/logs/pebble.log")).exists()).toBe(false);
  } finally { await h.cleanup(); }
}, 30000);

test("daemon keeps slow pebble HTTP handlers and quiet response streams alive", async () => {
  const h = await harness();
  const dir = join(h.temp.dir, "source");
  try {
    await Bun.write(join(dir, "pebble.ts"), `import { definePebble, detached } from "bedrock";
export default definePebble({ name: "sample", access: "public", routes: {
  "GET /slow": detached(async () => {
    await Bun.sleep(11000);
    return new Response("slow response");
  }),
  "GET /stream": detached(() => new Response(new ReadableStream({ async start(controller) {
    controller.enqueue(new TextEncoder().encode("first"));
    await Bun.sleep(11000);
    controller.enqueue(new TextEncoder().encode("second"));
    controller.close();
  } }))),
}});`);
    expect((await h.deploy("sample", dir)).status).toBe(200);
    await Promise.all([
      (async () => {
        const response = await h.request("sample.localhost", "/slow");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("slow response");
      })(),
      (async () => {
        const response = await h.request("sample.localhost", "/stream");
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("second");
        expect((await reader.read()).done).toBe(true);
      })(),
    ]);
  } finally { await h.cleanup(); }
}, 30000);

test("deploys notes with production dependencies, serves HTML, adds/lists, and rejects a broken migration", async () => {
  const h = await harness(true);
  const dir = join(h.temp.dir, "notes");
  await mkdir(dir);
  await cp(resolve(import.meta.dir, "../../../examples/notes"), dir, { recursive: true, filter: path => !path.split(/[\\/]/).includes("node_modules") && !path.split(/[\\/]/).includes(".bedrock") });
  try {
    const response = await h.deploy("notes", dir);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect((await h.request("notes.localhost", "/", { headers: { accept: "text/html" } })).status).toBe(302);
    const login = await h.request("notes.localhost", "/_bedrock/dev-login", { method: "POST", body: new URLSearchParams({ email: "alice@example.test" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect((await h.request("notes.localhost", "/", { headers: { cookie } })).status).toBe(200);
    const call = (path: string, args: unknown) => h.request("notes.localhost", path, { method: "POST", body: JSON.stringify(args), headers: { "content-type": "application/json", cookie } });
    expect((await (await call("/_bedrock/m/add", { body: "deployed note" })).json()).value[0].body).toBe("deployed note");
    expect((await (await call("/_bedrock/q/mine", null)).json()).value).toHaveLength(1);
    await Bun.write(join(dir, "migrations/9999_bad.sql"), "THIS IS NOT SQL;");
    expect((await h.deploy("notes", dir)).status).toBe(500);
    expect((await (await call("/_bedrock/q/mine", null)).json()).value).toHaveLength(1);
    await h.daemon.stop();
    const restored = await startDaemon({ home: h.home, dev: true, domain: "localhost" });
    try {
      expect((await fetch(new URL("/api/health", restored.server.url), { headers: { host: "notes.localhost", cookie, origin: "http://notes.localhost" } })).status).toBe(200);
      const response = await fetch(new URL("/_bedrock/q/mine", restored.server.url), { method: "POST", body: "null", headers: { host: "notes.localhost", cookie, origin: "http://notes.localhost" } });
      expect((await response.json()).value).toHaveLength(1);
    } finally { await restored.stop(); }
  } finally { await h.cleanup(); }
}, 60000);

test("repeated fast failures become crashed and stop cancels automatic restarts", async () => {
  const h = await harness();
  const dir = join(h.temp.dir, "unstable");
  await Bun.write(join(dir, "pebble.ts"), source("unstable") + '\nsetTimeout(() => process.exit(1), 150);\n');
  try {
    expect((await h.deploy("sample", dir)).status).toBe(200);
    await until(async () => (await h.list())[0]!.status === "crashed", 15000);
    expect((await h.request("sample.localhost")).status).toBe(404);
    await h.api("/api/pebbles/sample/start", { method: "POST" });
    await until(async () => (await h.list())[0]!.status === "restarting");
    await h.api("/api/pebbles/sample/stop", { method: "POST" });
    await Bun.sleep(700);
    expect((await h.list())[0]!.status).toBe("stopped");
  } finally { await h.cleanup(); }
}, 25000);

test("dev-auth daemon keeps deployed service data outside release directories across redeploy", async () => {
  const h = await harness(true);
  try {
    const dir = join(h.temp.dir, "service-data"); await mkdir(dir);
    await Bun.write(join(dir, 'package.json'), JSON.stringify({ name: 'service-data', type: 'module', dependencies: { bedrock: '*' } }));
    await Bun.write(join(dir, 'pebble.ts'), `import { definePebble, service } from "bedrock";
import { join } from "node:path";
export default definePebble({name:"sample",access:"public",services:{data:service({async start(ctx){const file=join(ctx.dataDir,"persisted.txt");if(!await Bun.file(file).exists())await Bun.write(file,crypto.randomUUID());return {dir:ctx.dataDir,value:await Bun.file(file).text()};}})},routes:{"GET /data":(_r,_s,ctx)=>Response.json(ctx.services.data)}});`);
    expect((await h.deploy('sample', dir)).status).toBe(200);
    const first = await (await h.request('sample.localhost', '/data')).json();
    expect(first.dir).toBe(join(h.home, 'pebbles/sample/data'));
    expect((await h.deploy('sample', dir)).status).toBe(200);
    expect(await (await h.request('sample.localhost', '/data')).json()).toEqual(first);
  } finally { await h.cleanup(); }
}, 30000);

test("protected pebbles expose only public HTTP handlers, anonymously", async () => {
  const h = await harness(true);
  const dir = join(h.temp.dir, "public-routes");
  const keys = ["GET /doc", "GET /files/:id", "POST /public", "GET /head", "GET /detached"];
  try {
    await Bun.write(join(dir, "pebble.ts"), `import { definePebble, publicRoute, detached, mutation } from "bedrock";
const anonymous = (request, _server, ctx) => Response.json({ headers: Object.fromEntries(request.headers), user: ctx.user, token: ctx.token });
export default definePebble({ name: "sample", access: "creators", tokens: true,
mutations: { key: mutation(ctx => ctx.tokens.create({ name: "test", permissions: ["route:GET /doc"] })) },
routes: {
"GET /doc": publicRoute(anonymous), "GET /files/:id": publicRoute(() => new Response("file")),
"GET /files/secret": () => new Response("secret"), "GET /private": () => new Response("private"),
"POST /doc": () => new Response("private"), "POST /public": publicRoute(anonymous),
"GET /head": publicRoute(() => new Response("head")), "HEAD /head": () => new Response("private"),
"GET /detached": publicRoute(detached(async (request, server, ctx) => ctx.read(inner => anonymous(request, server, inner)))),
}});`);
    const deployed = await (await h.deploy("sample", dir)).json();
    expect(deployed.value.public_routes).toEqual(keys);
    expect((await (await h.api("/api/pebbles")).json()).value[0].public_routes).toEqual(keys);
    const login = await h.request("sample.localhost", "/_bedrock/dev-login", { method: "POST", body: new URLSearchParams({ email: "creator@example.test" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const created = await h.request("sample.localhost", "/_bedrock/m/key", { method: "POST", body: "null", headers: { cookie } });
    const bearer = (await created.json()).value.token;
    expect(bearer).toStartWith("brk_");
    for (const path of ["/doc", "/detached", "/public"]) {
      for (const credentials of [{}, { cookie }, { authorization: `Bearer ${bearer}` }, { cookie: `${cookie}; other=secret`, authorization: `Bearer ${bearer}` }]) {
        const response = await h.request("sample.localhost", path, { method: path === "/public" ? "POST" : "GET", headers: { ...credentials, accept: "text/html", origin: "https://evil.test", "x-bedrock-user": "spoofed", "x-bedrock-file-meta": "secret" } });
        expect(response.status).toBe(200);
        const value = await response.json();
        expect(value.user).toBeNull(); expect(value.token).toBeNull();
        expect(value.headers.cookie).toBeUndefined(); expect(value.headers.authorization).toBeUndefined();
        expect(Object.keys(value.headers).some(key => key.startsWith("x-bedrock-"))).toBe(false);
      }
    }
    expect((await h.request("sample.localhost", "/doc", { method: "HEAD" })).status).toBe(200);
    expect((await h.request("sample.localhost", "/head", { method: "HEAD" })).status).toBe(401);
    expect((await h.request("sample.localhost", "/doc", { method: "POST" })).status).toBe(401);
    expect((await h.request("sample.localhost", "/private")).status).toBe(401);
    expect((await h.request("sample.localhost", "/private", { headers: { accept: "text/html" } })).status).toBe(302);
    expect((await h.request("sample.localhost", "/files/abc")).status).toBe(200);
    expect((await h.request("sample.localhost", "/files/secret")).status).toBe(401);
    for (const path of ["/doc/", "//doc", "/DOC", "/x/../private", "/%70rivate", "/doc%2F..%2Fprivate", "/files/a/b"]) {
      // Bun fetch collapses // before sending; raw paths must reach the daemon unchanged.
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest({ hostname: "127.0.0.1", port: h.daemon.server.port, path, headers: { host: "sample.localhost" } }, response => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        });
        request.on("error", reject);
        request.end();
      });
      expect(status).toBe(401);
    }
    const port = (await (await h.api("/api/pebbles")).json()).value[0].port;
    expect((await fetch(`http://127.0.0.1:${port}/private`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/_bedrock/health`)).status).toBe(200);
    const cli = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/cli/index.ts"), "ls", "--json", "--url", h.daemon.server.url.origin, "--token", h.token], { env: { ...process.env, BEDROCK_HOME: h.home }, stdout: "pipe", stderr: "pipe" });
    expect(JSON.parse(await new Response(cli.stdout).text()).value[0].public_routes).toEqual(keys);
    expect(await cli.exited).toBe(0);
    await h.api("/api/pebbles/sample/stop", { method: "POST" });
    expect((await (await h.api("/api/pebbles")).json()).value[0].public_routes).toEqual(keys);
  } finally { await h.cleanup(); }
}, 30000);

test("public root params cannot expose protected Bun bundle assets", async () => {
  const h = await harness(true);
  const dir = join(h.temp.dir, "bundle-public");
  try {
    await Bun.write(join(dir, "index.html"), '<script src="./app.js"></script>');
    await Bun.write(join(dir, "app.js"), 'console.log("private bundle")');
    const source = (path: string) => `import { definePebble, publicRoute } from "bedrock";
export default definePebble({ name: "sample", access: "creators", web: "./index.html", routes: { "GET ${path}": publicRoute(() => new Response("public doc")) } });`;
    await Bun.write(join(dir, "pebble.ts"), source("/:id"));
    const rejected = await (await h.deploy("sample", dir)).json();
    expect(rejected.error.code).toBe("INVALID_PUBLIC_ROUTE");
    await Bun.write(join(dir, "pebble.ts"), source("/docs/:id"));
    expect((await h.deploy("sample", dir)).status).toBe(200);
    expect(await (await h.request("sample.localhost", "/docs/agents.md")).text()).toBe("public doc");
    expect((await h.request("sample.localhost", "/")).status).toBe(401);
    const login = await h.request("sample.localhost", "/_bedrock/dev-login", { method: "POST", body: new URLSearchParams({ email: "creator@example.test" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const page = await (await h.request("sample.localhost", "/", { headers: { cookie } })).text();
    const asset = /src="([^"]+\.js[^"]*)"/.exec(page)![1]!;
    expect((await h.request("sample.localhost", asset)).status).toBe(401);
    expect((await h.request("sample.localhost", asset, { headers: { cookie } })).status).toBe(200);
  } finally { await h.cleanup(); }
}, 30000);
