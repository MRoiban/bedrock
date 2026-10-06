import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { readlink } from "node:fs/promises";
import { run as runCommand } from "../src/cli/terminal";
import { newPebble } from "../src/cli/new";
import { run, createArchive } from "../src/daemon/archive";
import { setup } from "../src/daemon/config";
import { startDaemon } from "../src/daemon";
import { tempDirectory } from "./helpers";

for (const template of ["react", "minimal"]) {
  test(`standalone ${template} installs, typechecks and deploys daemon-owned packages`, async () => {
    const temp = tempDirectory();
    const root = resolve(import.meta.dir, "../../..");
    let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
    try {
      expect(resolve(temp.dir).startsWith(root + "/")).toBe(false);
      const created = await newPebble(`standalone-${template}`, template, { cwd: temp.dir, json: true, terminal: {
        // A fresh host may have packages cached without their semver manifests.
        run: (args, options) => runCommand(args[1] === "install" ? [...args, "--prefer-offline"] : args, { ...options, env: { ...process.env, BEDROCK_HOME: join(temp.dir, "home") } }),
      } });
      expect(await Bun.file(join(created.dir, "bun.lock")).exists()).toBe(true);
      await run([process.execPath, "run", "typecheck"], created.dir);
      const home = join(temp.dir, "home");
      await setup(home, "localhost", "creator@example.test", 0);
      daemon = await startDaemon({ home, domain: "localhost", dev: true });
      const archive = join(temp.dir, "pebble.tar.gz");
      await createArchive(created.dir, archive);
      const token = (await Bun.file(join(home, "admin-token")).text()).trim();
      const response = await fetch(new URL(`/api/deploy?name=${created.name}`, daemon.server.url), {
        method: "POST", headers: { host: "bedrock.localhost", authorization: `Bearer ${token}` }, body: Bun.file(archive),
      });
      const deployed = await response.json();
      expect(deployed.ok).toBe(true);
      expect(await readlink(join(deployed.value.release, "node_modules/bedrock"))).toBe(join(root, "packages/bedrock"));
      if (template === "react") expect(await readlink(join(deployed.value.release, "node_modules/@bedrock/ui"))).toBe(join(root, "packages/ui"));
      const page = await fetch(new URL("/", daemon.server.url), { headers: { host: `${created.name}.localhost`, accept: "text/html" }, redirect: "manual" });
      expect(page.status).toBe(template === "react" ? 302 : 200);
      if (template === "react") {
        const host = `${created.name}.localhost`;
        const login = await fetch(new URL("/_bedrock/dev-login", daemon.server.url), {
          method: "POST", headers: { host, origin: `http://${host}` },
          body: new URLSearchParams({ email: "friend@example.test" }), redirect: "manual",
        });
        const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
        const signedIn = await fetch(new URL("/", daemon.server.url), { headers: { host, cookie } });
        expect(signedIn.status).toBe(200);
        const html = await signedIn.text();
        const script = html.match(/src="([^"]+\.js)"/)!;
        expect(script).not.toBeNull();
        const asset = await fetch(new URL(script[1]!, daemon.server.url), { headers: { host, cookie } });
        expect(asset.status).toBe(200);
        expect(await asset.text()).toContain("Your notes");
      }
      if (template === "minimal") expect(await page.text()).toContain("<h1>standalone-minimal</h1>");
    } finally { await daemon?.stop(); temp.cleanup(); }
  }, 30000);
}
