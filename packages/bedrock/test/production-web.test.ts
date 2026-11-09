import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { readdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";
import { symbolicate } from "../src/daemon/source-maps";
import { tempDirectory } from "./helpers";

test("production web builds before health, hides maps, retains artifacts through restart/rollback/prune", async () => {
  const temp = tempDirectory(), home = join(temp.dir, "home"), source = join(temp.dir, "source");
  await setup(home, "example.test", "creator@example.test", 0);
  const daemon = await startDaemon({ home });
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = (path: string, init?: RequestInit) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "bedrock.example.test", authorization: `Bearer ${token}` } });
  const request = (path: string, init?: RequestInit) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "built.example.test", ...init?.headers } });
  const deploy = async () => {
    const archive = join(temp.dir, "upload.tar.gz");
    await createArchive(source, archive);
    return (await api("/api/deploy?name=built", { method: "POST", body: Bun.file(archive) })).json();
  };
  const root = join(home, "pebbles/built/releases");
  await Bun.write(join(source, "pebble.ts"), `import {definePebble} from 'bedrock';
export default definePebble({name:'built',web:'web/start.html',routes:{'GET /explicit':()=>new Response('custom'),
'GET /stack':()=>{try{throw new Error('server probe')}catch(e){return new Response((e as Error).stack)}}}});`);
  await Bun.write(join(source, "web/start.html"), '<html><head><link rel="stylesheet" href="./style.css"></head><body><h1>built</h1><script type="module" src="./app.ts"></script></body></html>');
  const app = (version: number) => `import logo from './logo.svg';
document.querySelector('h1')!.textContent='version ${version}';
document.body.style.backgroundImage='url('+logo+')';
Object.assign(window,{explode: function pilotFailure() {
  throw new Error('browser probe');
},lazy:()=>import('./lazy.ts')});`;
  await Bun.write(join(source, "web/app.ts"), app(1));
  await Bun.write(join(source, "web/style.css"), 'h1 { color: rgb(1, 2, 3); }');
  await Bun.write(join(source, "web/logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await Bun.write(join(source, "web/lazy.ts"), 'export const value="lazy";');
  try {
    const first = await deploy();
    expect(first).toMatchObject({ ok: true });
    const release = first.value.release as string;
    const html = await (await request("/")).text();
    const script = new URL(/src="([^"]+\.js)"/.exec(html)![1]!, "http://built.example.test/").pathname;
    expect(script).toMatch(/-[a-z0-9]{8,}\.js$/i);
    const js = await (await request(script)).text();
    expect(js).not.toContain("sourceMappingURL");
    expect((await request(script)).headers.get("cache-control")).toContain("immutable");
    const etag = (await request(script)).headers.get("etag")!;
    expect((await request(script, { headers: { "if-none-match": etag } })).status).toBe(304);
    expect((await request("/some/page")).status).toBe(200);
    expect(await (await request("/explicit")).text()).toBe("custom");
    expect(await (await request("/stack")).text()).toContain("pebble.ts:3:");
    expect((await request("/", { method: "HEAD" })).headers.get("content-type")).toContain("html");
    const manifest = await Bun.file(join(release, ".bedrock-web/manifest.json")).json();
    expect(Object.keys(manifest.maps).length).toBeGreaterThan(0);
    const map = await Bun.file(join(release, ".bedrock-web", Object.values(manifest.maps)[0] as string)).json();
    expect(map.sourcesContent.length).toBeGreaterThan(0);
    for (const path of [script + ".map", "/.bedrock-web/", "/.bedrock-web/maps/", "/.bedrock-web/manifest.json", ...Object.values(manifest.maps).map(path => "/" + path), "/%2ebedrock-web/maps/", "/nested.map/x"]) {
      expect([path, (await request(path)).status]).toEqual([path, 404]);
    }
    for (const file of manifest.files as string[]) {
      expect(file).not.toEndWith(".map");
      const response = await request(file);
      expect(response.status).toBe(200);
      if (/\.(js|css)$/.test(file)) expect(await response.text()).not.toContain("sourceMappingURL");
    }
    if (existsSync(chromium.executablePath())) {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.route("**/*", async route => {
          const url = new URL(route.request().url());
          const response = await request(url.pathname);
          await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
        });
        await page.goto("http://built.example.test/some/page");
        expect(await page.locator("h1").textContent()).toBe("version 1");
        expect(await page.locator("h1").evaluate(el => getComputedStyle(el).color)).toBe("rgb(1, 2, 3)");
        const stack = await page.evaluate(() => { try { (window as any).explode(); } catch (error) { return (error as Error).stack!; } });
        const frame = /https?:\/\/[^\s)]+:(\d+):(\d+)/.exec(stack!)!;
        const position = await symbolicate(root, basename(release), script, Number(frame[1]), Number(frame[2]));
        expect(position?.source).toEndWith("app.ts");
        expect(position?.line).toBe(5);
        expect(position?.column).toBeGreaterThan(0);
        expect(await page.evaluate(async () => (await (window as any).lazy()).value)).toBe("lazy");
      } finally { await browser.close(); }
    }
    await Bun.write(join(source, "web/app.ts"), 'this is invalid TypeScript ???');
    const failure = await deploy();
    expect(failure).toMatchObject({ ok: false, error: { code: "WEB_BUILD_FAILED" } });
    expect(failure.error.hint).toContain("previous release");
    expect(await readdir(root)).toHaveLength(1);
    expect(await (await request(script)).text()).toBe(js);
    await Bun.write(join(release, "web/app.ts"), "invalid after build");
    expect((await api("/api/pebbles/built/restart", { method: "POST" })).status).toBe(200);
    expect(await (await request(script)).text()).toBe(js);
    for (let version = 2; version <= 4; version++) {
      await Bun.write(join(source, "web/app.ts"), app(version));
      expect(await deploy()).toMatchObject({ ok: true });
      if (version === 2) {
        expect(await (await request(script)).text()).toBe(js);
        expect((await api("/api/pebbles/built/rollback", { method: "POST" })).status).toBe(200);
        expect(await (await request("/")).text()).toBe(html);
        expect(await Bun.file(join(release, ".bedrock-web/manifest.json")).exists()).toBe(true);
      }
    }
    expect(await readdir(root)).toHaveLength(3);
    expect(await Bun.file(join(release, ".bedrock-web/manifest.json")).exists()).toBe(false);
    expect(await symbolicate(root, basename(release), script, 1, 1)).toBeNull();
  } finally { await daemon.stop(); temp.cleanup(); }
}, 30000);
