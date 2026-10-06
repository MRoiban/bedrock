import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { syncOnyx } from "./sync-onyx";

async function snapshot(dir: string) {
  const result: Record<string, string> = {};
  for await (const path of new Bun.Glob("**/*").scan({ cwd: dir, onlyFiles: true })) result[path] = await Bun.file(join(dir, path)).text();
  return result;
}
test("registry sync is deterministic, complete, and idempotent", async () => {
  const temp = await mkdtemp(join(tmpdir(), "bedrock-ui-sync-"));
  const source = join(temp, "source");
  const destination = join(temp, "output");
  try {
    const vendored = join(import.meta.dir, "../src/onyx");
    for (const [path, content] of Object.entries(await snapshot(vendored))) {
      if (path === "index.ts") continue;
      const output = path === "registry.json" ? join(source, path) : join(source, "src", path);
      await mkdir(dirname(output), { recursive: true });
      await Bun.write(output, content.replace(/^\/\* Vendored[^\n]*\n/, ""));
    }
    await syncOnyx(source, destination);
    const first = await snapshot(destination);
    await syncOnyx(source, destination);
    expect(await snapshot(destination)).toEqual(first);
    expect(first["src/onyx/lib/cn.ts"]).toContain("Do not edit");
    expect(first["ONYX_VERSION"]).toMatch(/sha256 [a-f0-9]{64}/);
    expect(first["src/onyx/index.ts"]).toContain("context-menu");
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test("missing source reports a repair hint", async () => {
  await expect(syncOnyx("/nonexistent/bedrock-onyx")).rejects.toMatchObject({ code: "ONYX_SOURCE_MISSING", hint: expect.any(String) });
});
