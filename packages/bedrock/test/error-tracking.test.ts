import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";
import { errorEvent } from "../src/errors/model";
import { tempDirectory } from "./helpers";

test("real error collector captures original browser/server frames, protects scopes and accepts idle reports without wake", async () => {
  const temp = tempDirectory(), home = join(temp.dir, "home"), source = join(temp.dir, "source");
  await setup(home, "example.test", "creator@example.test", 0);
  const daemon = await startDaemon({ home, idleTimeoutForTests: 250 });
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = (path: string, init: RequestInit = {}, bearer = token) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "bedrock.example.test", authorization: `Bearer ${bearer}` } });
  const request = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "faulty.example.test", ...init.headers } });
  await Bun.write(join(source, "pebble.ts"), `import {definePebble, query, mutation, BedrockError} from 'bedrock';
function serverFailure(){ throw new TypeError('server probe token=secret'); }
export default definePebble({name:'faulty',access:'public',web:'web/index.html',queries:{bad:query(serverFailure),expected:query(()=>{throw new BedrockError('INVALID_ARGS','expected','fix it')})},mutations:{bad:mutation(serverFailure)},routes:{'GET /fail':serverFailure}});`);
  await Bun.write(join(source, "web/index.html"), '<html><body><h1>errors</h1><script type="module" src="./app.ts"></script></body></html>');
  await Bun.write(join(source, "web/app.ts"), `import {createClient} from 'bedrock/client';
const client = createClient({sync:false,autoReload:false});
function browserFailure(){ throw new TypeError('browser probe'); }
function rejectionFailure(){ return Promise.reject(new RangeError('rejection probe')); }
Object.assign(window,{client,explode:()=>setTimeout(browserFailure),reject:()=>setTimeout(rejectionFailure)});`);
  const archive = join(temp.dir, "upload.tar.gz"); await createArchive(source, archive);
  try {
    const deployed = await (await api("/api/deploy?name=faulty", { method: "POST", body: Bun.file(archive) })).json();
    expect(deployed.ok).toBe(true);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url());
        const response = await request(url.pathname, { method: req.method(), headers: await req.allHeaders(), body: req.postData() ?? null });
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      });
      await page.goto("https://faulty.example.test/");
      await page.waitForFunction(() => !!(window as any).explode);
      await page.evaluate(() => { (window as any).explode(); (window as any).reject(); });
      await page.waitForTimeout(2300);
      await page.evaluate(() => { (window as any).explode(); (window as any).reject(); });
      await page.waitForTimeout(2300);
      await page.evaluate(() => (window as any).client.close());
    } finally { await browser.close(); }
    for (const path of ["/_bedrock/q/bad", "/_bedrock/m/bad", "/_bedrock/q/expected"]) await request(path, { method: "POST", body: "null", headers: { origin: "https://faulty.example.test", "content-type": "application/json" } });
    expect((await request("/fail")).status).toBe(500);
    const page = (await (await api("/api/pebbles/faulty/errors")).json()).value;
    expect(page.issues).toHaveLength(3);
    for (const issue of page.issues) {
      const detail = (await (await api(`/api/pebbles/faulty/errors/${issue.id}`)).json()).value;
      expect(detail.samples[0].frames[0].file).toBe(issue.runtime === "browser" ? "web/app.ts" : "pebble.ts");
      expect(detail.samples[0].frames[0].mapped).toBe(true);
      expect(issue.missing_maps).toBe(0);
      expect(detail.counts.reduce((n: number, c: any) => n + c.count, 0)).toBe(issue.runtime === "browser" ? 2 : 3);
      expect(JSON.stringify(detail)).not.toContain("token=secret");
    }
    const record = async () => (await (await api("/api/pebbles")).json()).value[0];
    for (let i = 0; i < 100 && (await record()).status !== "idle"; i++) await Bun.sleep(50);
    expect((await record()).status).toBe("idle");
    const report = () => JSON.stringify({ v: 1, events: [errorEvent(new Error("idle"), "browser", "unhandled-error", deployed.value.release.split("/").at(-1))] });
    const post = (body: string, origin = "https://faulty.example.test") => request("/_bedrock/errors", { method: "POST", headers: { origin, "content-type": "text/plain", authorization: "Bearer discarded", cookie: "unrelated=discarded" }, body });
    expect((await post(report(), "https://evil.test")).status).toBe(403);
    expect((await post("x".repeat(49153))).status).toBe(413);
    expect((await post('{"v":1,"events":[{}]}')).status).toBe(400);
    expect((await post(report())).status).toBe(202);
    expect((await record()).status).toBe("idle"); expect((await record()).pid).toBeNull();
    let limited: Response | undefined;
    for (let i = 0; i < 91; i++) { const response = await post(report()); if (response.status === 429) { limited = response; break; } }
    expect(limited?.status).toBe(429); expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await record()).status).toBe("idle");
    for (const path of ["/.bedrock-web/manifest.json", "/.bedrock-web/maps/app.js.map", "/app.js.map"]) expect((await request(path)).status).toBe(404);
    const mint = async (pebbles: string[], actions: string[]) => (await (await api("/api/tokens", { method: "POST", body: JSON.stringify({ scope: { pebbles, actions } }) })).json()).value.token;
    const logs = await mint(["faulty"], ["logs"]), status = await mint(["faulty"], ["status"]), other = await mint(["other"], ["logs"]);
    expect((await api("/api/pebbles/faulty/errors", {}, logs)).status).toBe(200);
    expect((await api("/api/pebbles/faulty/errors", {}, status)).status).toBe(403);
    expect((await api("/api/pebbles/faulty/errors", {}, other)).status).toBe(403);
    const issue = page.issues[0].id;
    expect((await api(`/api/pebbles/faulty/errors/${issue}/resolve?confirm=true`, { method: "POST" }, logs)).status).toBe(403);
    expect((await api(`/api/pebbles/faulty/errors/${issue}/merge`, { method: "POST" })).status).toBe(400);
    expect((await api(`/api/pebbles/faulty/errors/${issue}/resolve`, { method: "POST" })).status).toBe(200);
    expect((await api(`/api/pebbles/faulty/errors/${issue}/resolve?confirm=true`, { method: "POST" })).status).toBe(200);
    const cli = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/cli/index.ts"), "errors", "faulty", "--json"], { env: { ...process.env, BEDROCK_HOME: home, BEDROCK_URL: undefined, BEDROCK_TOKEN: undefined }, stdout: "pipe", stderr: "pipe" });
    const result = JSON.parse(await new Response(cli.stdout).text()); expect(await cli.exited).toBe(0); expect(result.value.issues.length).toBeGreaterThanOrEqual(3);
    expect((await (await api("/api/pebbles/faulty/errors/transitions")).json()).value.every((t: any) => t.delivery === "digest")).toBe(true);
  } finally { await daemon.stop(); temp.cleanup(); }
}, 30000);

test("job, detached route, socket and service throws report over real child IPC", async () => {
  const temp = tempDirectory(), home = join(temp.dir, "home"), source = join(temp.dir, "source");
  await setup(home, "example.test", "creator@example.test", 0);
  await Bun.write(join(source, "pebble.ts"), `import {definePebble,job,socket,service,detached} from 'bedrock';
export default definePebble({name:'boundaries',access:'public',
jobs:{bad:job('0 0 1 1 *',()=>{throw new SyntaxError('job')})},
sockets:{'/socket':socket({message(){},open(){throw new URIError('socket')}})},
services:{worker:service({start:()=>1,stop(){throw new RangeError('service')}})},
routes:{'GET /detached':detached(()=>{throw new EvalError('route')})}});`);
  const daemon = await startDaemon({ home });
  try {
    const token = (await Bun.file(join(home, "admin-token")).text()).trim();
    const api = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "bedrock.example.test", authorization: `Bearer ${token}` } });
    const archive = join(temp.dir, "upload.tar.gz"); await createArchive(source, archive);
    expect((await api("/api/deploy?name=boundaries", { method: "POST", body: Bun.file(archive) })).status).toBe(200);
    await api("/api/jobs/boundaries?job=bad", { method: "POST" });
    expect((await fetch(new URL("/detached", daemon.server.url), { headers: { host: "boundaries.example.test" } })).status).toBe(500);
    const { HeaderWebSocket } = await import("./helpers");
    const ws = new HeaderWebSocket(new URL(`ws://127.0.0.1:${daemon.server.port}/socket`), { headers: { host: "boundaries.example.test", origin: "https://boundaries.example.test" } });
    await new Promise<void>((resolve, reject) => { ws.onclose = () => resolve(); ws.onerror = reject; });
    await api("/api/pebbles/boundaries/stop", { method: "POST" });
    const page = (await (await api("/api/pebbles/boundaries/errors")).json()).value;
    expect(page.issues).toHaveLength(4);
    const mechanisms: string[] = [];
    for (const issue of page.issues) {
      const detail = (await (await api(`/api/pebbles/boundaries/errors/${issue.id}`)).json()).value;
      expect(detail.samples[0].frames[0].file).toBe("pebble.ts"); mechanisms.push(detail.samples[0].mechanism);
    }
    expect(mechanisms.sort()).toEqual(["job", "route", "service", "socket"]);
  } finally { await daemon.stop(); temp.cleanup(); }
}, 30000);
