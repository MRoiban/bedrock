import { test, expect } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { definePebble } from "../src/config";
import { startPebble } from "../src/runtime";
import { tempDirectory } from "./helpers";

test("static directories serve files and reject traversal and symlink escapes", async () => {
  const temp = tempDirectory();
  await Bun.write(join(temp.dir, "web/index.html"), "<h1>Static pebble</h1>");
  await Bun.write(join(temp.dir, "secret.txt"), "secret");
  symlinkSync(temp.dir, join(temp.dir, "web/escape"), process.platform === "win32" ? "junction" : "dir");
  const running = await startPebble({
    dir: temp.dir, pebble: definePebble({ name: "static", web: "./web" }),
    dataDir: join(temp.dir, "data"), port: 0,
  });
  try {
    expect(await (await fetch(running.server.url)).text()).toBe("<h1>Static pebble</h1>");
    expect((await fetch(new URL("/escape/secret.txt", running.server.url))).status).toBe(404);
    expect((await fetch(new URL("/%2e%2e%2fsecret.txt", running.server.url))).status).toBe(404);
    if (process.platform === "win32") expect((await fetch(new URL("/index.html:$DATA", running.server.url))).status).toBe(404);
    expect((await fetch(new URL("/missing", running.server.url))).status).toBe(404);
    expect((await fetch(new URL("/_bedrock/unknown", running.server.url))).status).toBe(404);
    expect((await fetch(running.server.url, { method: "HEAD" })).status).toBe(200);
    await running.stop();
    await expect(running.execute("query", "nothing", null, new Request("http://localhost"))).rejects.toMatchObject({ code: "PEBBLE_STOPPED" });
  } finally { await running.stop(); temp.cleanup(); }
});

test("static caching uses weak validators and only fingerprints are immutable", async () => {
  const temp = tempDirectory();
  const files = ["index.html", "page-abcdef12.html", "app-abcdef12.js", "app.abc_def9.css", "app-abcdefgh.js", "app-abc123.js", "plain.js"];
  for (const file of files) await Bun.write(join(temp.dir, "web", file), file);
  const running = await startPebble({ dir: temp.dir, pebble: definePebble({ name: "cache", web: "./web" }), dataDir: join(temp.dir, "data"), port: 0 });
  try {
    for (const file of files) {
      const url = new URL(`/${file}`, running.server.url);
      const response = await fetch(url);
      const immutable = ["app-abcdef12.js", "app.abc_def9.css"].includes(file);
      expect(response.headers.get("cache-control")).toBe(immutable ? "public, max-age=31536000, immutable" : "no-cache");
      const etag = response.headers.get("etag")!;
      expect(etag).toMatch(/^W\/".+-.+"$/);
      expect(await response.text()).toBe(file);
      const cached = await fetch(url, { headers: { "if-none-match": `"other", ${etag}` } });
      expect(cached.status).toBe(304);
      expect(cached.headers.get("etag")).toBe(etag);
      expect(cached.headers.get("cache-control")).toBe(response.headers.get("cache-control"));
      expect(await cached.text()).toBe("");
      expect((await fetch(url, { method: "HEAD", headers: { "if-none-match": etag } })).status).toBe(304);
      expect((await fetch(url, { headers: { "if-none-match": 'W/"mismatch"' } })).status).toBe(200);
    }
    const url = new URL("/plain.js", running.server.url);
    const before = (await fetch(url)).headers.get("etag");
    await Bun.write(join(temp.dir, "web/plain.js"), "changed-size");
    expect((await fetch(url)).headers.get("etag")).not.toBe(before);
  } finally { await running.stop(); temp.cleanup(); }
});

test("previous static release supplies missing fingerprints but never HTML or escaping paths", async () => {
  const temp = tempDirectory();
  const previous = join(temp.dir, "previous"), current = join(temp.dir, "current");
  await Bun.write(join(current, "public/web/index.html"), "current");
  for (const file of ["old-abcdef12.js", "old-abcdef12.html", "old.html", "plain.js", "shared-abcdef12.js"]) await Bun.write(join(previous, "public/web", file), `previous ${file}`);
  await Bun.write(join(current, "public/web/shared-abcdef12.js"), "current shared");
  await Bun.write(join(previous, "secret-abcdef12.js"), "secret");
  symlinkSync(previous, join(previous, "public/web/escape"), process.platform === "win32" ? "junction" : "dir");
  symlinkSync(join(previous, "public/web/old.html"), join(previous, "public/web/alias-abcdef12.js"));
  const saved = process.env.BEDROCK_PREVIOUS_RELEASE;
  process.env.BEDROCK_PREVIOUS_RELEASE = previous;
  const running = await startPebble({ dir: current, pebble: definePebble({ name: "fallback", web: "./public/web" }), dataDir: join(temp.dir, "data"), port: 0 });
  if (saved === undefined) delete process.env.BEDROCK_PREVIOUS_RELEASE; else process.env.BEDROCK_PREVIOUS_RELEASE = saved;
  try {
    const response = await fetch(new URL("/old-abcdef12.js", running.server.url));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toBe("previous old-abcdef12.js");
    expect((await fetch(new URL("/old-abcdef12.js", running.server.url), { headers: { "if-none-match": response.headers.get("etag")! } })).status).toBe(304);
    expect(await (await fetch(new URL("/shared-abcdef12.js", running.server.url))).text()).toBe("current shared");
    for (const path of ["/alias-abcdef12.js", "/old-abcdef12.html", "/old.html", "/plain.js", "/escape/secret-abcdef12.js", "/%2e%2e%2fsecret-abcdef12.js"]) {
      expect((await fetch(new URL(path, running.server.url))).status).toBe(404);
    }
  } finally { await running.stop(); temp.cleanup(); }
});
