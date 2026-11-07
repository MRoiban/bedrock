import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { symlink } from "node:fs/promises";
import { tempDirectory } from "./helpers";
import { launchDev } from "../src/cli/dev-launcher";

const cli = resolve(import.meta.dir, "../src/cli/index.ts");
const packageDir = resolve(import.meta.dir, "..");
let browserInstalled = false;
try { browserInstalled = existsSync((await import("@playwright/test")).chromium.executablePath()); } catch {}

async function pebble(dir: string) {
  await Bun.write(join(dir, "package.json"), '{"type":"module"}');
  await Bun.write(join(dir, "node_modules/.keep"), "");
  await symlink(packageDir, join(dir, "node_modules/bedrock"), process.platform === "win32" ? "junction" : "dir");
  await Bun.write(join(dir, "pebble.ts"), `import {definePebble,job} from 'bedrock';export default definePebble({name:'probe',web:'web',jobs:{tick:job('* * * * *',ctx=>{ctx.db.$client.exec('UPDATE count SET n=n+1')})},routes:{'GET /count':(_r,_s,ctx)=>Response.json(ctx.db.$client.query('SELECT n FROM count').get())}});`);
  await Bun.write(join(dir, "migrations/001.sql"), "CREATE TABLE count(n INTEGER); INSERT INTO count VALUES (0);");
  await Bun.write(join(dir, "web/index.html"), '<!doctype html><html lang="en"><head><title>Probe</title><link rel="icon" href="data:,"></head><body><main><h1>Probe</h1></main></body></html>');
}
async function command(dir: string, args: string[]) {
  const child = Bun.spawn([process.execPath, cli, "test", ...args, "--json"], { cwd: dir, env: { ...process.env, BEDROCK_HOME: join(dir, "unused-home") }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const report = JSON.parse(stdout);
  return { code, stderr, report: report.ok ? report.value : report.error.data, envelope: report };
}

test("reusable dev launcher isolates data, disables cron and permits explicit jobs", async () => {
  const temp = tempDirectory();
  try {
    await pebble(temp.dir);
    const app = await launchDev({ dir: temp.dir, home: join(temp.dir, "home"), dataDir: join(temp.dir, "data"), port: 0, watch: false, cron: false });
    const url = new URL(app.url);
    const count = async () => (await fetch(`http://127.0.0.1:${url.port}/count`, { headers: { host: url.host } })).json();
    try { expect(await count()).toEqual({ n: 0 }); await app.runJob("tick"); expect(await count()).toEqual({ n: 1 }); }
    finally { await app.stop(); }
    expect(existsSync(join(temp.dir, ".bedrock"))).toBe(false);
    expect(existsSync(join(temp.dir, "data/db.sqlite"))).toBe(true);
  } finally { temp.cleanup(); }
}, 30_000);

test.skipIf(!browserInstalled)("bedrock test runs real units, isolated browser cases, login/logout, and built-in smoke", async () => {
  const temp = tempDirectory();
  try {
    await pebble(temp.dir);
    await Bun.write(join(temp.dir, "tests/unit/runtime.test.ts"), `import{test,expect}from'bun:test';import{startPebble}from'bedrock/server';test('SQLite',async()=>{const app=await startPebble({dir:process.cwd(),port:0,cron:false});try{expect(app.db.$client.query('SELECT n FROM count').get()).toEqual({n:0})}finally{await app.stop()}})`);
    await Bun.write(join(temp.dir, "tests/e2e/app.spec.ts"), `import {test,expect} from 'bedrock/testing';
      test('mutate and login',async({page,loginAs,server})=>{await page.goto('/');expect(await page.evaluate(async()=>(await fetch('/count')).json())).toEqual({n:0});await server.runJob('tick');await loginAs(page,'friend');expect(await page.evaluate(async()=>(await fetch('/_bedrock/me')).json())).toMatchObject({user:{id:'bedrock-test-friend'}});await page.evaluate(async()=>fetch('/_bedrock/logout',{method:'POST'}));expect(await page.evaluate(async()=>(await fetch('/_bedrock/me')).json())).toEqual({user:null});});
      test('fresh database and separate roles',async({page,owner,outsider,anonymous})=>{expect(owner.viewportSize()).toEqual(page.viewportSize());expect(outsider.viewportSize()).toEqual(page.viewportSize());expect(anonymous.viewportSize()).toEqual(page.viewportSize());await page.goto('/');expect(await page.evaluate(async()=>(await fetch('/count')).json())).toEqual({n:0});expect(await owner.evaluate(async()=>(await fetch('/_bedrock/me')).json())).toMatchObject({user:{id:'bedrock-test-owner'}});expect(await outsider.evaluate(async()=>(await fetch('/_bedrock/me')).json())).toMatchObject({user:{id:'bedrock-test-outsider'}});await anonymous.goto('/');expect(await anonymous.evaluate(async()=>(await fetch('/_bedrock/me')).json())).toEqual({user:null});});`);
    const result = await command(temp.dir, ["--project", "desktop"]);
    expect(result.envelope.ok, JSON.stringify(result.report)).toBe(true);
    expect(result.report.checks.filter((check: any) => check.id.startsWith("unit:")).length).toBe(1);
    expect(result.report.checks.some((check: any) => check.id.endsWith(":accessibility") && check.status === "passed")).toBe(true);
    const list = await command(temp.dir, ["--list"]);
    expect(list.code).toBe(0);
    expect(list.report.checks.every((check: any) => check.attempts === 0 || check.status === "skipped")).toBe(true);
  } finally { temp.cleanup(); }
}, 120_000);

test.skipIf(!browserInstalled)("smoke reports axe, overflow and console failures; diagnostic retry stays nonzero", async () => {
  const temp = tempDirectory();
  try {
    await pebble(temp.dir);
    await Bun.write(join(temp.dir, "bedrock.test.ts"), "export default {pages:[{path:'/',ready:'main'}]}");
    await Bun.write(join(temp.dir, "web/index.html"), '<!doctype html><html><head><title>Bad</title><link rel="icon" href="data:,"></head><body style="min-width:1800px"><main><h1>Bad</h1><img src="data:,"/><script>console.error("smoke error")</script></main></body></html>');
    await Bun.write(join(temp.dir, "tests/e2e/flake.spec.ts"), "import{test,expect}from'bedrock/testing';test('flaky',async({},info)=>{expect(info.retry).toBe(1)})");
    const result = await command(temp.dir, ["--project", "phone", "--diagnostic-retry"]);
    expect(result.code).toBe(1);
    const checks = result.report.checks;
    for (const name of ["accessibility", "overflow", "browser-errors"]) expect(checks.some((check: any) => check.id.endsWith(`:${name}`) && check.status === "failed")).toBe(true);
    expect(checks.some((check: any) => check.status === "flaky" && check.attempts === 2)).toBe(true);
    expect(result.report.artifacts.some((path: string) => path.endsWith("trace.zip"))).toBe(true);
    expect(result.report.artifacts.some((path: string) => path.endsWith(".png"))).toBe(true);
  } finally { temp.cleanup(); }
}, 120_000);

test.skipIf(!browserInstalled)("visual smoke requires approval, runs the preparation hook and reuses stable baselines", async () => {
  const temp = tempDirectory();
  try {
    await pebble(temp.dir);
    await Bun.write(join(temp.dir, "bedrock.test.ts"), `export default {pages:[{path:'/',ready:'main',visual:true}],prepareScreenshot:async page=>{await page.locator('h1').evaluate(node=>node.textContent='Prepared')}};`);
    const missing = await command(temp.dir, ["--project", "desktop"]);
    expect(missing.code).toBe(1);
    expect(missing.report.checks.some((check: any) => check.id.endsWith(":visual") && check.status === "failed")).toBe(true);
    const approved = await command(temp.dir, ["--project", "desktop", "--update-snapshots", "--yes"]);
    expect(approved.envelope.ok, JSON.stringify(approved.report)).toBe(true);
    const comparison = await command(temp.dir, ["--project", "desktop"]);
    expect(comparison.envelope.ok, JSON.stringify(comparison.report)).toBe(true);
  } finally { temp.cleanup(); }
}, 120_000);
