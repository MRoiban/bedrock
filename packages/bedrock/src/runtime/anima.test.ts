import { expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { startPebble } from "./index";

async function fakeGolem(root: string, version: string) {
  const golem = join(root, "node_modules/@mroiban/golem");
  await Bun.write(join(golem, "package.json"), JSON.stringify({ name: "@mroiban/golem", version, exports: { "./package.json": "./package.json", "./runtime/*": "./runtime/*" } }));
  await Bun.write(join(golem, "runtime/anima.js"), "export const anima = 1;\n");
  await Bun.write(join(golem, "runtime/scenes/switch.ani"), '{"anima":"0.1"}');
  await Bun.write(join(root, "node_modules/@mroiban/secret.txt"), "outside the runtime folder");
}

test("a pebble serves its installed Golem's Anima runtime under Golem's version", async () => {
  const temp = tempDirectory();
  await fakeGolem(temp.dir, "1.2.3");
  const app = await startPebble({ pebble: { name: "motion" }, dir: temp.dir, dataDir: temp.dir, cron: false, port: 0 });
  const get = (path: string, init?: RequestInit) => fetch(new URL(path, app.server.url), init);
  try {
    const runtime = await get("/_bedrock/anima/1.2.3/anima.js");
    expect(runtime.status).toBe(200);
    expect(runtime.headers.get("content-type")).toStartWith("text/javascript");
    expect(runtime.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await runtime.text()).toBe("export const anima = 1;\n");
    const scene = await get("/_bedrock/anima/1.2.3/scenes/switch.ani");
    expect(scene.headers.get("content-type")).toBe("application/json");
    expect(await scene.json()).toEqual({ anima: "0.1" });
    expect((await get("/_bedrock/anima/1.2.3/anima.js", { method: "HEAD" })).status).toBe(200);
    // An old page after a redeploy asks for its own version: no mixing, it falls back to plain Onyx.
    expect((await get("/_bedrock/anima/1.2.2/anima.js")).status).toBe(404);
    for (const path of ["/_bedrock/anima/1.2.3/../../secret.txt", "/_bedrock/anima/1.2.3/%2e%2e/%2e%2e/secret.txt", "/_bedrock/anima/1.2.3/", "/_bedrock/anima/1.2.3/scenes", "/_bedrock/anima/1.2.3/missing.js"])
      expect((await get(path)).status, path).toBe(404);
    expect((await get("/_bedrock/anima/1.2.3/anima.js", { method: "POST" })).status).toBe(405);
  } finally { await app.stop(); temp.cleanup(); }
});

test("Golem installed for @bedrock/ui (a link: dependency) is found through it", async () => {
  const temp = tempDirectory();
  const ui = join(temp.dir, "bedrock-ui");
  await Bun.write(join(ui, "package.json"), JSON.stringify({ name: "@bedrock/ui", version: "0.1.0", exports: { "./package.json": "./package.json" } }));
  await fakeGolem(ui, "2.0.0");
  const pebble = join(temp.dir, "pebble");
  await Bun.write(join(pebble, "node_modules/.keep"), "");
  await Bun.write(join(pebble, "node_modules/@bedrock/.keep"), "");
  symlinkSync(ui, join(pebble, "node_modules/@bedrock/ui"), "dir");
  const app = await startPebble({ pebble: { name: "linked" }, dir: pebble, dataDir: temp.dir, cron: false, port: 0 });
  try {
    expect((await fetch(new URL("/_bedrock/anima/2.0.0/anima.js", app.server.url))).status).toBe(200);
  } finally { await app.stop(); temp.cleanup(); }
});

test("a pebble without Golem answers 404, and other Bedrock endpoints are unaffected", async () => {
  const temp = tempDirectory();
  const app = await startPebble({ pebble: { name: "plain" }, dir: temp.dir, dataDir: temp.dir, cron: false, port: 0 });
  try {
    expect((await fetch(new URL("/_bedrock/anima/0.1.0/anima.js", app.server.url))).status).toBe(404);
    expect((await fetch(new URL("/_bedrock/health", app.server.url))).status).toBe(200);
  } finally { await app.stop(); temp.cleanup(); }
});
