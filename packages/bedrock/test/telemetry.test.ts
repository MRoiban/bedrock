import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { chmod, mkdir, rm } from "node:fs/promises";
import { tempDirectory } from "./helpers";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";

async function harness(denied = false) {
  const temp = tempDirectory(), home = join(temp.dir, "home"), source = join(temp.dir, "source");
  await setup(home, "localhost", undefined, 0);
  if (denied) { await Bun.write(join(home, "observability.sqlite"), ""); await chmod(join(home, "observability.sqlite"), 0); }
  await mkdir(source);
  await Bun.write(join(source, "pebble.ts"), `import { definePebble } from ${JSON.stringify(resolve(import.meta.dir, "../src/index.ts"))}; console.log("safe log"); export default definePebble({name:"sample", access:"public", routes:{"GET /":()=>new Response("ok"), "GET /fail":()=>new Response("failed",{status:500})}});`);
  const daemon = await startDaemon({ home });
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = (path: string, bearer = token, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "bedrock.localhost", authorization: `Bearer ${bearer}`, ...init.headers } });
  const archive = join(temp.dir, "pebble.tar.gz"); await createArchive(source, archive);
  expect((await api("/api/deploy?name=sample", token, { method: "POST", body: Bun.file(archive) })).ok).toBe(true);
  const request = async (path = "/") => { const response = await fetch(new URL(path, daemon.server.url), { headers: { host: "sample.localhost" } }); return { status: response.status, text: await response.text() }; };
  return { daemon, home, temp, api, request, async close() { await daemon.stop(); await chmod(join(home, "observability.sqlite"), 0o600).catch(() => {}); temp.cleanup(); } };
}
async function flush(h: Awaited<ReturnType<typeof harness>>) { h.daemon.telemetry.flush(); await Bun.sleep(200); }

test("real daemon telemetry APIs and CLI honor scopes, search and envelopes", async () => {
  const h = await harness();
  try {
    await h.request(); await h.request("/fail"); await flush(h);
    const mint = async (actions: string[]) => (await (await h.api("/api/tokens", undefined, { method: "POST", body: JSON.stringify({ scope: { pebbles: ["sample"], actions } }) })).json()).value.token;
    const statusToken = await mint(["status"]), logsToken = await mint(["logs"]);
    expect((await h.api("/api/pebbles/sample/metrics?since=1h", statusToken)).status).toBe(200);
    expect((await h.api("/api/pebbles/sample/metrics", logsToken)).status).toBe(403);
    expect((await h.api("/api/pebbles/sample/events", statusToken)).status).toBe(403);
    expect((await h.api("/api/pebbles/sample/logs?q=safe", logsToken)).status).toBe(200);
    expect((await h.api("/api/pebbles/other/metrics", statusToken)).status).toBe(403);
    const status = (await (await h.api("/api/status", statusToken)).json()).value;
    expect(status.pebbles[0].telemetry.last_5m.ordinary).toMatchObject({ starts: 2, completions: 2, failures: 1 });
    for (const args of [["metrics", "sample", "--since", "1h", "--step", "1m"], ["logs", "sample", "--search", "safe", "--since", "1h"]]) {
      const cli = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/cli/index.ts"), ...args, "--json"], { env: { ...process.env, BEDROCK_HOME: h.home, BEDROCK_URL: undefined, BEDROCK_TOKEN: undefined }, stdout: "pipe", stderr: "pipe" });
      const result = JSON.parse(await new Response(cli.stdout).text());
      expect(await cli.exited).toBe(0); expect(result.ok).toBe(true); expect(result.value.rows.length).toBeGreaterThan(0); expect(result.value).toHaveProperty("coverage"); expect(result.value).toHaveProperty("drops");
    }
  } finally { await h.close(); }
}, 15000);

test("real daemon serves through SQLITE_FULL and Worker crash, counts drops and recovers", async () => {
  const h = await harness();
  try {
    await flush(h); await h.daemon.telemetry.faultForTests("full");
    await h.request("/fail"); await flush(h);
    expect(h.daemon.telemetry.drops("sample").storage).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) expect(await h.request()).toEqual({ status: 200, text: "ok" });
    await h.daemon.telemetry.faultForTests(null); await h.request(); await flush(h);
    expect((await h.api("/api/pebbles/sample/metrics")).ok).toBe(true);
    await h.daemon.telemetry.faultForTests("crash"); await Bun.sleep(100);
    for (let i = 0; i < 100; i++) expect(await h.request()).toEqual({ status: 200, text: "ok" });
    await flush(h);
    await Bun.sleep(1200); await h.request(); await flush(h);
    expect((await h.api("/api/pebbles/sample/metrics")).ok).toBe(true);
    expect(h.daemon.telemetry.drops("sample").storage).toBeGreaterThan(0);
  } finally { await h.close(); }
}, 15000);

test("real daemon serves with an unwritable observability file and recovers after repair", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  const h = await harness(true);
  try {
    await flush(h);
    expect(h.daemon.telemetry.drops("sample").storage).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) expect(await h.request()).toEqual({ status: 200, text: "ok" });
    await chmod(join(h.home, "observability.sqlite"), 0o600);
    // Reset only the retry clock; the file permission repair is real.
    await h.daemon.telemetry.faultForTests(null); await h.request(); await flush(h);
    expect((await h.api("/api/pebbles/sample/metrics")).ok).toBe(true);
  } finally { await h.close(); }
}, 15000);
