import { test, expect } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { init } from "./init";
import { tempDirectory } from "../../test/helpers";

test("init writes a runnable scaffold, repeats safely, and never overwrites existing work", async () => {
  const temp = tempDirectory();
  try {
    expect((await init("hello", temp.dir)).created).toBe(true);
    expect((await init("hello", temp.dir)).created).toBe(false);
    expect(await Bun.file(join(temp.dir, "hello/web/index.html")).exists()).toBe(true);
    expect(await Bun.file(join(temp.dir, "hello/AGENTS.md")).text()).toContain("pebble.ts");
    await Bun.write(join(temp.dir, "hello/pebble.ts"), "// edited by the user");
    await expect(init("hello", temp.dir)).rejects.toMatchObject({ code: "DIRECTORY_EXISTS" });
    expect(await Bun.file(join(temp.dir, "hello/pebble.ts")).text()).toBe("// edited by the user");
    await expect(init("../oops", temp.dir)).rejects.toMatchObject({ code: "INVALID_PEBBLE_NAME" });
  } finally { temp.cleanup(); }
});

async function runCli(args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts"), ...args], {
    cwd, env: { ...process.env, BEDROCK_HOME: join(cwd, "home") }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}

for (const command of ["new", "init", "db", "deploy", "rm", "start", "stop", "restart", "rollback", "secrets", "token", "backup", "jobs"]) {
  test(`${command} help exits successfully without creating files`, async () => {
    const temp = tempDirectory();
    try {
      for (const flag of ["--help", "-h"]) {
        const result = await runCli([command, flag], temp.dir);
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(`Usage: bedrock ${command} `);
        if (command === "new" || command === "init") expect(result.stdout).toContain("<name> [--template react|minimal]");
        expect(result.stdout.trim().split("\n")).toHaveLength(2);
        expect(await readdir(temp.dir)).toEqual([]);
      }
    } finally { temp.cleanup(); }
  });
}

for (const command of ["new", "init"]) {
  test(`${command} rejects unknown flags with usage hints before writing files`, async () => {
    const temp = tempDirectory();
    try {
      for (const args of [["-x"], ["--unknown"], ["--template"], ["notes", "--unknown"], ["notes", "--template", "-x"]]) {
        const result = await runCli([command, ...args, "--json"], temp.dir);
        expect(result.code).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "INVALID_ARGS", hint: expect.stringContaining(`bedrock ${command} <name>`) } });
        expect(await readdir(temp.dir)).toEqual([]);
      }
      const result = await runCli([command, "--help", "--json"], temp.dir);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, command, usage: expect.stringContaining("<name> [--template react|minimal]"), description: expect.any(String) });
      expect(await readdir(temp.dir)).toEqual([]);
    } finally { temp.cleanup(); }
  });
}
