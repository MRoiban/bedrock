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
