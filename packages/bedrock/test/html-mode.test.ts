import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";
import { linkDependencies, tempDirectory } from "./helpers";

for (const mode of ["unset", "development", "dev-with-production-env"] as const) {
  test(`daemon HTML mode is explicit with ${mode}`, async () => {
    const temp = tempDirectory();
    const home = join(temp.dir, "home"), source = join(temp.dir, "source");
    const dev = mode === "dev-with-production-env";
    await setup(home, dev ? "localhost" : "example.test", "creator@example.test", 0);
    await Bun.write(join(source, "pebble.ts"), `import { definePebble } from "bedrock";
export default definePebble({ name: "html-mode", web: "./web/index.html" });`);
    await Bun.write(join(source, "web/index.html"), '<!doctype html><html><body><div id="root"></div><script type="module" src="./app.tsx"></script></body></html>');
    await Bun.write(join(source, "web/app.tsx"), `import React from "react";
import { createRoot } from "react-dom/client";
import marker from "./value.marker";
createRoot(document.getElementById("root")!).render(<h1>Explicit HTML mode {marker}</h1>);`);
    await Bun.write(join(source, "bunfig.toml"), '[serve.static]\nplugins = ["./frontend-plugin.ts"]\n');
    await Bun.write(join(source, "frontend-plugin.ts"), `export default {
  name: "mode-test",
  setup(build) {
    build.onLoad({ filter: /\\.marker$/ }, () => ({ contents: 'export default "Frontend plugin preserved"', loader: "js" }));
  },
};`);
    await Bun.write(join(source, "web/value.marker"), "plugin input");
    linkDependencies(resolve(import.meta.dir, "../../../examples/notes/node_modules"), join(source, "node_modules"));
    const env: Record<string, string | undefined> = { ...process.env, BEDROCK_HOME: home, BEDROCK_DEV_PORT: "0", BEDROCK_DEV: dev ? "0" : "1" };
    delete env.NODE_ENV;
    if (mode !== "unset") env.NODE_ENV = dev ? "production" : "development";
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/cli/index.ts"), dev ? "__dev_worker" : "daemon", ...(dev ? [] : ["--json"])], {
      cwd: source, env, stdout: "pipe", stderr: "pipe", ipc() {},
    });
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    try {
      const stateFile = join(dev ? join(source, ".bedrock/daemon") : home, "daemon.json");
      const deadline = Date.now() + 10000;
      while (!await Bun.file(stateFile).exists()) {
        if (Date.now() > deadline || child.exitCode !== null) throw new Error("Daemon failed to start");
        await Bun.sleep(20);
      }
      const { port } = await Bun.file(stateFile).json();
      const base = `http://127.0.0.1:${port}`;
      if (!dev) {
        const archive = join(temp.dir, "release.tar.gz");
        await createArchive(source, archive);
        const token = (await Bun.file(join(home, "admin-token")).text()).trim();
        const deploy = await fetch(`${base}/api/deploy?name=html-mode`, { method: "POST", headers: { host: "bedrock.example.test", authorization: `Bearer ${token}` }, body: Bun.file(archive) });
        expect((await deploy.json()).ok).toBe(true);
      }
      const host = dev ? "html-mode.localhost" : "html-mode.example.test";
      const request = (path: string) => fetch(new URL(path, base), { headers: { host } });
      const page = await request("/");
      expect(page.status).toBe(200);
      const html = await page.text();
      const script = /src="([^"]+\.js[^"]*)"/.exec(html);
      expect(script).not.toBeNull();
      const asset = await request(script![1]!);
      expect(asset.status).toBe(200);
      const javascript = await asset.text();
      expect(javascript).toContain("Explicit HTML mode");
      expect(javascript).toContain("Frontend plugin preserved");
      expect(html.includes("data-bun-dev-server-script")).toBe(dev);
      expect((await request("/_bedrock/health")).status).toBe(200);
    } finally {
      if (process.platform === "win32" && child.exitCode === null) {
        await Bun.spawn(["taskkill.exe", "/PID", String(child.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" }).exited;
      } else child.kill("SIGTERM");
      await child.exited;
      await output;
      temp.cleanup();
    }
  }, 30000);
}
