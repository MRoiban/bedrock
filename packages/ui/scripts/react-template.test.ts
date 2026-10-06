import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { init } from "../../bedrock/src/cli/init";

test("React starter is idempotent, typed, and Bun HTML-bundleable", async () => {
  const temp = await mkdtemp(join(tmpdir(), "bedrock-react-template-"));
  try {
    const result = await init("notebook", temp, "react");
    expect(result.created).toBe(true);
    expect((await init("notebook", temp, "react")).created).toBe(false);
    const pkg = await Bun.file(join(result.dir, "package.json")).json();
    expect(pkg.dependencies["@bedrock/ui"]).toBe("^0.1.0");
    expect(pkg.dependencies).not.toHaveProperty("tailwindcss");
    await symlink(resolve(import.meta.dir, "../../../examples/notes/node_modules"), join(result.dir, "node_modules"));
    const build = await Bun.build({ entrypoints: [join(result.dir, "web/index.html")], outdir: join(temp, "build"), target: "browser" });
    expect(build.success).toBe(true);
    expect(build.outputs.some(output => output.path.endsWith(".css"))).toBe(true);
    const compiler = resolve(import.meta.dir, "../../../node_modules/typescript/bin/tsc");
    const check = Bun.spawn([process.execPath, compiler, "--project", result.dir, "--typeRoots", [resolve(import.meta.dir, "../../../node_modules/@types"), resolve(import.meta.dir, "../../../examples/notes/node_modules/@types")].join(",")], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([check.exited, new Response(check.stdout).text(), new Response(check.stderr).text()]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
    await expect(init("notebook", temp)).rejects.toMatchObject({ code: "DIRECTORY_EXISTS" });
    await expect(init("other", temp, "vue")).rejects.toMatchObject({ code: "INVALID_TEMPLATE" });
    const cli = resolve(import.meta.dir, "../../bedrock/src/cli/index.ts");
    await mkdir(join(temp, "cli-notes"), { recursive: true });
    const command = Bun.spawn([process.execPath, cli, "init", "cli-notes", "--template", "react", "--json"], { cwd: join(temp, "cli-notes"), stdout: "pipe", stderr: "pipe", env: { ...process.env, BEDROCK_HOME: join(temp, "home") } });
    const output = JSON.parse(await new Response(command.stdout).text());
    expect(await command.exited).toBe(0);
    expect(output).toMatchObject({ ok: true, name: "cli-notes", created: true });
    expect(await Bun.file(join(temp, "cli-notes/web/app.tsx")).exists()).toBe(true);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
