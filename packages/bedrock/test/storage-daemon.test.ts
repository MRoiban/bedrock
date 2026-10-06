import { linkDependencies } from "./helpers";
import { expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startDaemon } from "../src/daemon";
import { createArchive } from "../src/daemon/archive";
import { signIdentity } from "../src/auth/identity";
import { tempDirectory } from "./helpers";

test("daemon dev login uploads a notes attachment, links it, and isolates downloads", async () => {
  const temp = tempDirectory();
  const dir = join(temp.dir, "notes");
  await cp(resolve(import.meta.dir, "../../../examples/notes"), dir, { recursive: true,
    filter: path => !path.split(/[\\/]/).some(part => ["node_modules", ".bedrock"].includes(part)) });
  linkDependencies(resolve(import.meta.dir, "../../../examples/notes/node_modules"), join(dir, "node_modules"));
  const daemon = await startDaemon({ home: join(temp.dir, "home"), port: 0, domain: "localhost", dev: true, devPebble: { name: "notes", dir } });
  const origin = `http://notes.localhost:${daemon.server.port}`;
  const request = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), {
    ...init, redirect: "manual", headers: { host: new URL(origin).host, origin, ...init.headers },
  });
  const login = async (email: string) => {
    const response = await request("/_bedrock/dev-login", { method: "POST", body: new URLSearchParams({ email }) });
    expect(response.status).toBe(302);
    return response.headers.get("set-cookie")!.split(";")[0]!;
  };
  try {
    const alice = await login("alice@example.test"), bob = await login("bob@example.test");
    const upload = await request("/_bedrock/files/attachments", { method: "POST", body: new File(["notes attachment"], "note.txt"),
      headers: { cookie: alice, "content-type": "text/plain", "x-bedrock-file-name": "note.txt", "x-bedrock-user": "spoofed" } });
    expect(upload.status).toBe(201);
    const file = await upload.json();
    expect(file.name).toBe("note.txt");
    const linked = await request("/_bedrock/m/add", { method: "POST", body: JSON.stringify({ body: "Attached note", attachmentId: file.id }), headers: { cookie: alice } });
    expect(linked.status).toBe(200);
    expect((await linked.json()).value[0].attachmentId).toBe(file.id);
    const path = `/_bedrock/files/attachments/${file.id}`;
    const owner = await request(path, { headers: { cookie: alice } });
    expect(owner.status).toBe(200); expect(await owner.text()).toBe("notes attachment");
    expect((await request(path, { headers: { cookie: bob } })).status).toBe(403);
    expect((await request(path)).status).toBe(401);
    const range = await request(path, { headers: { cookie: alice, range: "bytes=0-4" } });
    expect(range.status).toBe(206); expect(range.headers.get("content-range")).toBe("bytes 0-4/16");
    expect(await range.text()).toBe("notes");
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect((await request(method === "POST" ? "/_bedrock/files/attachments" : path, { method, body: method === "DELETE" ? null : "attack",
        headers: { cookie: alice, origin: `http://sibling.localhost:${daemon.server.port}` } })).status).toBe(403);
      expect((await request(path, { method, headers: { cookie: alice, origin: "" } })).status).toBe(403);
    }
  } finally { await daemon.stop(); temp.cleanup(); }
}, 15000);

test("public pebble downloads need no session and sibling child secrets cannot forge identity", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "home");
  const daemon = await startDaemon({ home, port: 0, domain: "localhost", dev: true });
  const request = (name: string, path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), {
    ...init, headers: { host: `${name}.localhost:${daemon.server.port}`, origin: `http://${name}.localhost:${daemon.server.port}`, ...init.headers },
  });
  try {
    const token = (await Bun.file(join(home, "admin-token")).text()).trim();
    for (const name of ["pebble-a", "pebble-b"]) {
      const dir = join(temp.dir, name);
      // This route models compromised pebble code reading its own environment and port.
      await Bun.write(join(dir, "pebble.ts"), `import { definePebble, bucket, query } from "bedrock";
export default definePebble({ name: "${name}", access: "public",
  storage: [bucket("public", { maxSize: "128mb", access: "public" })],
  queries: { who: query(({user}) => user) },
  routes: { "GET /compromised": (_request, server) => Response.json({ secret: process.env.BEDROCK_IDENTITY_SECRET, port: server.port }) }
});`);
      const archive = join(temp.dir, `${name}.tar.gz`);
      await createArchive(dir, archive);
      expect((await request("bedrock", `/api/deploy?name=${name}`, { method: "POST", body: Bun.file(archive), headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    }
    const a = await (await request("pebble-a", "/compromised")).json();
    const b = await (await request("pebble-b", "/compromised")).json();
    expect(a.secret).not.toBe(b.secret);
    const forged = signIdentity({ id: "victim", email: "victim@example.test", name: "Victim" }, a.secret);
    const direct = (port: string, headers: HeadersInit) => fetch(`http://127.0.0.1:${port}/_bedrock/q/who`, { method: "POST", body: "null", headers });
    expect((await direct(a.port, forged)).status).toBe(200);
    expect((await direct(b.port, forged)).status).toBe(403);
    const uploaded = await request("pebble-b", "/_bedrock/files/public", { method: "POST", body: "public download", headers: { "x-bedrock-file-name": "public.txt" } });
    expect(uploaded.status).toBe(201);
    const file = await uploaded.json();
    const download = await request("pebble-b", `/_bedrock/files/public/${file.id}`);
    expect(download.status).toBe(200); expect(await download.text()).toBe("public download");
    expect(download.headers.get("cache-control")).toBe("public, max-age=3600");
  } finally { await daemon.stop(); temp.cleanup(); }
}, 20000);
