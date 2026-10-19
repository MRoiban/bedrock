import { expect, test } from "bun:test";
import { cp, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { linkedBunEnv, tempDirectory } from "./helpers";
import { init } from "../src/cli/init";
import { dbCommand } from "../src/cli/db";
import { run } from "../src/cli/terminal";
import { setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";

const root = resolve(import.meta.dir, "../../..");
const cli = resolve(import.meta.dir, "../src/cli/index.ts");

// The pebble gets its own physical React, as a registry install would, so linked Bedrock
// packages that resolve React from the checkout would add a second copy to the bundle.
async function reactStarter(dir: string, env: NodeJS.ProcessEnv) {
  const vendor = join(dir, "vendor/node_modules");
  const examples = join(root, "examples/notes/node_modules");
  const reactDom = await realpath(join(examples, "react-dom"));
  const sources = { react: await realpath(join(examples, "react")), "react-dom": reactDom, valibot: await realpath(join(examples, "valibot")), scheduler: resolve(Bun.resolveSync("scheduler/package.json", reactDom), "..") };
  for (const [name, source] of Object.entries(sources)) await cp(source, join(vendor, name), { recursive: true, dereference: true });
  for (const name of ["react", "react-dom", "valibot"]) await run([process.execPath, "link"], { cwd: join(vendor, name), env });
  const pebble = (await init("single", join(dir, "projects"), "react", false, root)).dir;
  const pkg = await Bun.file(join(pebble, "package.json")).json();
  const dependencies = { ...pkg.dependencies, react: "link:react", "react-dom": "link:react-dom", valibot: "link:valibot" };
  await Bun.write(join(pebble, "package.json"), JSON.stringify({ ...pkg, dependencies, devDependencies: {} }, null, 2));
  // Access does not change bundling; a public pebble serves its page without a session.
  const source = await Bun.file(join(pebble, "pebble.ts")).text();
  await Bun.write(join(pebble, "pebble.ts"), source.replace('access: "users"', 'access: "public"'));
  await run([process.execPath, "install"], { cwd: pebble, env });
  await dbCommand("generate", pebble);
  return pebble;
}

async function waitFor<T>(read: () => Promise<T | undefined>, child: Bun.Subprocess, output: () => string) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Timed out: ${output()}`);
    await Bun.sleep(50);
  }
}

function capture(child: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  let text = "";
  const read = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) text += new TextDecoder().decode(chunk); };
  void Promise.all([read(child.stdout), read(child.stderr)]);
  return () => text;
}

async function stop(child: Bun.Subprocess) {
  if (process.platform === "win32" && child.exitCode === null) {
    await Bun.spawn(["taskkill.exe", "/PID", String(child.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" }).exited;
  } else child.kill("SIGTERM");
  await child.exited;
}

async function bundle(base: string, host: string) {
  const request = (path: string) => fetch(new URL(path, base), { headers: { host } });
  const html = await (await request("/")).text();
  const scripts = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(match => match[1]!);
  expect(scripts.length).toBeGreaterThan(0);
  let javascript = "";
  for (const script of scripts) javascript += await (await request(script)).text();
  return javascript;
}

// Development bundles keep module paths; one package directory per name means one copy.
function modulePaths(javascript: string, name: string) {
  return new Set([...javascript.matchAll(new RegExp(`"([^"]*node_modules/${name})/index\\.js"`, "g"))].map(match => match[1]));
}

test("a linked React starter bundles exactly one React in bedrock dev and in a hosted release", async () => {
  const temp = tempDirectory();
  const children: Bun.Subprocess[] = [];
  try {
    const env = await linkedBunEnv(temp.dir);
    const pebble = await reactStarter(temp.dir, env);
    const ownReact = await realpath(join(pebble, "node_modules/react"));
    expect(ownReact).not.toBe(await realpath(resolve(Bun.resolveSync("react/package.json", join(root, "packages/bedrock")), "..")));

    const dev = Bun.spawn([process.execPath, cli, "dev", "--port", "0", "--json"], { cwd: pebble, env: { ...env, BEDROCK_HOME: join(temp.dir, "dev-home") }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    children.push(dev);
    const devOutput = capture(dev);
    const started = await waitFor(async () => /^\{.*\}$/m.exec(devOutput())?.[0], dev, devOutput);
    const url = new URL(JSON.parse(started).url);
    const devJavascript = await bundle(`http://127.0.0.1:${url.port}`, url.host);
    for (const name of ["react", "react-dom"]) expect(modulePaths(devJavascript, name).size).toBe(1);
    expect([...modulePaths(devJavascript, "react")][0]).not.toContain("node_modules/.bun/");

    const home = join(temp.dir, "home");
    await setup(home, "example.test", "creator@example.test", 0);
    const daemon = Bun.spawn([process.execPath, cli, "daemon", "--json"], { cwd: temp.dir, env: { ...env, BEDROCK_HOME: home }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    children.push(daemon);
    const daemonOutput = capture(daemon);
    const state = await waitFor(() => Bun.file(join(home, "daemon.json")).json().catch(() => undefined), daemon, daemonOutput);
    const base = `http://127.0.0.1:${state.port}`;
    const archive = join(temp.dir, "release.tar.gz");
    await createArchive(pebble, archive);
    const token = (await Bun.file(join(home, "admin-token")).text()).trim();
    const deploy = await fetch(`${base}/api/deploy?name=single`, { method: "POST", headers: { host: "bedrock.example.test", authorization: `Bearer ${token}` }, body: Bun.file(archive) });
    expect(await deploy.json()).toMatchObject({ ok: true });
    const hosted = await bundle(base, "single.example.test");
    // Production output is minified; React's hook wrappers appear once per bundled copy.
    expect(hosted.match(/\.H\.useState\(/g)).toHaveLength(1);
  } finally {
    for (const child of children) await stop(child);
    temp.cleanup();
  }
}, 60000);
