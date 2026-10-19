import { expect, test } from "bun:test";
import { cp, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { linkedBunEnv, tempDirectory } from "./helpers";
import { init } from "../src/cli/init";
import { run } from "../src/cli/terminal";

const root = resolve(import.meta.dir, "../../..");

test("an initialized pebble installs from its frozen lockfile after a copy or a git worktree clone", async () => {
  const temp = tempDirectory();
  try {
    const env = await linkedBunEnv(temp.dir);
    const bun = (args: string[], cwd: string) => run([process.execPath, ...args], { cwd, env });
    const { dir } = await init("linked", join(temp.dir, "projects"), "react", false, root);
    // Only first-party packages, so the test needs no registry access.
    const pkg = await Bun.file(join(dir, "package.json")).json();
    await Bun.write(join(dir, "package.json"), JSON.stringify({ ...pkg, dependencies: { bedrock: pkg.dependencies.bedrock, "@bedrock/ui": pkg.dependencies["@bedrock/ui"] }, devDependencies: {} }, null, 2));
    await bun(["install"], dir);
    const lock = await Bun.file(join(dir, "bun.lock")).text();
    expect(lock).toContain('"bedrock@link:bedrock"');
    expect(lock).not.toContain("file:");
    await run(["git", "init", "-q"], { cwd: dir });
    await run(["git", "add", "."], { cwd: dir });
    await run(["git", "-c", "commit.gpgsign=false", "-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-qm", "init"], { cwd: dir });
    const worktree = join(temp.dir, "a/b/c/worktree");
    await run(["git", "worktree", "add", "-q", worktree], { cwd: dir });
    const copy = join(temp.dir, "copy");
    await cp(dir, copy, { recursive: true, filter: source => !source.includes("node_modules") });
    for (const clone of [worktree, copy]) {
      await bun(["install", "--frozen-lockfile"], clone);
      expect(await realpath(join(clone, "node_modules/bedrock"))).toBe(await realpath(join(root, "packages/bedrock")));
      expect(await realpath(join(clone, "node_modules/@bedrock/ui"))).toBe(await realpath(join(root, "packages/ui")));
    }
  } finally { temp.cleanup(); }
}, 30000);
