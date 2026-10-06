import { expect, test } from "bun:test";
import { mkdtemp, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installRelease } from "./archive";

test("releases use daemon-owned first-party packages from every dependency section idempotently", async () => {
  const temp = await mkdtemp(join(tmpdir(), "bedrock-release-packages-"));
  try {
    const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
    await Bun.write(join(temp, "package.json"), JSON.stringify({ name: "test-release", ...Object.fromEntries(sections.map(section => [section, { bedrock: "workspace:*", "@bedrock/ui": "workspace:*" }])) }));
    const source = await Bun.file(join(temp, "package.json")).json();
    source.devDependencies.typescript = "^5.9.3";
    await Bun.write(join(temp, "package.json"), JSON.stringify(source));
    await installRelease(temp);
    const pkg = await Bun.file(join(temp, "package.json")).json();
    for (const section of sections) expect(pkg[section]).toEqual(section === "devDependencies" ? { typescript: "^5.9.3" } : {});
    expect(await readlink(join(temp, "node_modules/bedrock"))).toBe(resolve(import.meta.dir, "../.."));
    expect(await readlink(join(temp, "node_modules/@bedrock/ui"))).toBe(resolve(import.meta.dir, "../../../ui"));
    expect(await readlink(join(temp, "node_modules/react"))).toBe(resolve(Bun.resolveSync("react/package.json", resolve(import.meta.dir, "../../../ui")), ".."));
    expect(await readlink(join(temp, "node_modules/react-dom"))).toBe(resolve(Bun.resolveSync("react-dom/package.json", resolve(import.meta.dir, "../../../ui")), ".."));
    await installRelease(temp);
    expect(await readlink(join(temp, "node_modules/@bedrock/ui"))).toBe(resolve(import.meta.dir, "../../../ui"));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
