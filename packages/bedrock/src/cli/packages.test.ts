import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("repo packages expose no workspace protocols to standalone file consumers", async () => {
  const root = resolve(import.meta.dir, "../../../..");
  const paths = ["package.json", "packages/*/package.json", "examples/*/package.json"]
    .flatMap(pattern => [...new Bun.Glob(pattern).scanSync({ cwd: root })]);
  expect(paths.length).toBeGreaterThanOrEqual(4);
  for (const path of paths) {
    const pkg = await Bun.file(resolve(root, path)).json();
    // Bun reads dev dependencies of file packages too, even outside the workspace.
    for (const section of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
      for (const version of Object.values(pkg[section] ?? {})) expect(String(version).startsWith("workspace:")).toBe(false);
    }
  }
});
