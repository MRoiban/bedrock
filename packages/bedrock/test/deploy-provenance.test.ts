import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { mkdir, symlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { setup } from "../src/daemon/config";
import { startDaemon } from "../src/daemon";
import { gitProvenance } from "../src/version";
import { run } from "../src/cli/terminal";
import { tempDirectory } from "./helpers";

const cli = resolve(import.meta.dir, "../src/cli/index.ts");
test("deploy retains provenance across rollback and restart, warns in human and JSON, and works without git", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "home"), source = join(temp.dir, "source");
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  const command = async (args: string[], json = true, extra = {}) => {
    const child = Bun.spawn([process.execPath, cli, ...args, ...(json ? ["--json"] : [])], { env: { ...process.env, BEDROCK_HOME: home, BEDROCK_URL: undefined, BEDROCK_TOKEN: undefined, ...extra }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(err).toBe(""); expect({ code, out }).toMatchObject({ code: 0 });
    if (json) { expect(out.trim().split("\n")).toHaveLength(1); return JSON.parse(out); }
    return out;
  };
  try {
    await Bun.write(join(source, "pebble.ts"), `export default { name: "origin", access: "public" };`);
    expect(await gitProvenance(source)).toEqual({ commit: null, branch: null, dirty: null });
    await run(["git", "init", "-b", "main", source]);
    await run(["git", "-C", source, "add", "."]);
    await run(["git", "-C", source, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "fixture"]);
    const clean = await gitProvenance(source);
    expect(clean.dirty).toBe(false); expect(clean.branch).toBe("main"); expect(clean.commit).toHaveLength(40);
    await setup(home, "localhost", undefined, 0);
    daemon = await startDaemon({ home });
    const first = await command(["deploy", source]);
    expect(first.value.provenance).toEqual(clean); expect(first.warnings).toEqual([]);
    await Bun.write(join(source, "untracked.txt"), "scratch");
    expect((await gitProvenance(source)).dirty).toBe(true);
    const dirty = await command(["deploy", source]);
    expect(dirty.value.provenance.dirty).toBe(true); expect(dirty.warnings.join(" ")).toContain("uncommitted");
    expect((await command(["rollback", "origin"])).value.provenance).toEqual(clean);
    await daemon.stop(); daemon = await startDaemon({ home });
    expect((await command(["ls"])).value[0].provenance).toEqual(clean);
    expect(await command(["deploy", source, "--no-open"], false)).toContain("Warning: Deploying uncommitted");
    // The previous release is the clean release selected by rollback.
    expect((await command(["rollback", "origin"])).value.provenance).toEqual(clean);
    await daemon.stop(); daemon = await startDaemon({ home });
    expect((await command(["ls"])).value[0].provenance).toEqual(clean);
    // Rollback swaps the release selection, not the deploy caller's current git state.
    const bin = join(temp.dir, "bin"); await mkdir(bin);
    for (const name of ["tar", "gzip"]) await symlink(Bun.which(name)!, join(bin, name));
    const nonGit = join(temp.dir, "export");
    await Bun.write(join(nonGit, "pebble.ts"), await Bun.file(join(source, "pebble.ts")).text());
    expect((await command(["deploy", nonGit])).value.provenance).toEqual({ commit: null, branch: null, dirty: null });
    expect((await command(["rollback", "origin"])).value.provenance).toEqual(clean);
    const noGit = await command(["deploy", source], true, { PATH: bin });
    expect(noGit.value.provenance).toEqual({ commit: null, branch: null, dirty: null });
    expect((await command(["rollback", "origin"])).value.provenance).toEqual(clean);
  } finally { await daemon?.stop(); temp.cleanup(); }
}, 60000);

test("large archives warn with the largest included top-level trees in human and JSON output", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "home"), source = join(temp.dir, "source");
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  try {
    await Bun.write(join(source, "pebble.ts"), 'export default { name: "large", access: "public" };');
    await Bun.write(join(source, "work/payload"), randomBytes(51_000_000));
    await setup(home, "localhost", undefined, 0); daemon = await startDaemon({ home });
    for (const json of [true, false]) {
      const child = Bun.spawn([process.execPath, cli, "deploy", source, "--no-open", ...(json ? ["--json"] : [])], { env: { ...process.env, BEDROCK_HOME: home, BEDROCK_URL: undefined, BEDROCK_TOKEN: undefined }, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(err).toBe(""); expect({ code, out }).toMatchObject({ code: 0 });
      if (json) { expect(out.trim().split("\n")).toHaveLength(1); expect(JSON.parse(out).warnings.join(" ")).toContain("work/ 51.0 MB"); }
      else expect(out).toContain("Warning: Archive is");
    }
  } finally { await daemon?.stop(); temp.cleanup(); }
}, 60000);
