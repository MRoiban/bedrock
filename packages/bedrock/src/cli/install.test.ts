import { expect, test } from "bun:test";
import { chmod, mkdir, copyFile, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { run } from "./terminal";

test.skipIf(process.platform === "win32")("POSIX installer has valid syntax and is idempotent with stubbed bun in an isolated HOME", async () => {
  const temp = tempDirectory();
  try {
    const source = resolve(import.meta.dir, "../../../../install.sh");
    await run(["sh", "-n", source]);
    const checkout = join(temp.dir, "checkout");
    const bin = join(temp.dir, "bin");
    await mkdir(join(checkout, "packages/bedrock/src/cli"), { recursive: true });
    await mkdir(bin);
    await copyFile(source, join(checkout, "install.sh"));
    await Bun.write(join(bin, "bun"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOME/bun-calls"\n');
    await Bun.write(join(checkout, "packages/bedrock/src/cli/index.ts"), '#!/bin/sh\nprintf "0.1.0\\n"\n');
    await chmod(join(bin, "bun"), 0o700);
    await chmod(join(checkout, "packages/bedrock/src/cli/index.ts"), 0o700);
    const env = { ...process.env, HOME: temp.dir, BUN_INSTALL: join(temp.dir, ".bun"), PATH: `${bin}:/usr/bin:/bin` };
    for (let i = 0; i < 2; i++) expect(await run(["sh", join(checkout, "install.sh")], { env })).toContain("Next: bedrock setup");
    expect(await readlink(join(temp.dir, ".bun/bin/bedrock"))).toBe(join(checkout, "packages/bedrock/src/cli/index.ts"));
    expect((await Bun.file(join(temp.dir, "bun-calls")).text()).match(/install --frozen-lockfile/g)).toHaveLength(2);
  } finally { temp.cleanup(); }
});

test("self-update fast-forwards checkout, installs dependencies and requests service restart", async () => {
  const { selfUpdate } = await import("./update");
  const temp = tempDirectory();
  const calls: string[][] = [];
  try {
    let head = "a".repeat(40);
    expect(await selfUpdate({ checkout: temp.dir, run: async (args, options) => {
      if (args.includes("--show-toplevel")) return temp.dir;
      if (args.includes("HEAD") && args.includes("rev-parse")) return head;
      if (args.includes("symbolic-ref")) return "main";
      if (args.includes("status")) return "";
      expect(options?.cwd).toBe(temp.dir); calls.push(args);
      if (args.includes("pull")) head = "b".repeat(40);
      return "";
    }, restart: async () => ({ restarted: true }) })).toMatchObject({ updated: true, restarted: true, from: "a".repeat(40), to: "b".repeat(40) });
    expect(calls).toEqual([["git", "pull", "--ff-only"], [process.execPath, "install"]]);
  } finally { temp.cleanup(); }
});

test.skipIf(process.platform !== "win32")("Windows installer repeats safely and creates a working executable launcher", async () => {
  const temp = tempDirectory();
  const root = resolve(import.meta.dir, "../../../..");
  const bin = join(temp.dir, "bun home", "bin");
  const env = { ...process.env, BUN_INSTALL: join(temp.dir, "bun home"), BEDROCK_HOME: join(temp.dir, "home") };
  try {
    for (let i = 0; i < 2; i++) {
      expect(await run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "install.ps1")], { env })).toContain("Next: bedrock setup");
    }
    expect(await run([join(bin, "bedrock.exe"), "--version"], { env })).toContain("bedrock 0.1.0");
  } finally { temp.cleanup(); }
}, 30000);
