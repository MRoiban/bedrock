import { join, resolve } from "node:path";
import { init } from "./init";
import { dbCommand } from "./db";
import { terminal, type Terminal } from "./terminal";

export async function newPebble(name: string, template = "react", options: { cwd?: string; terminal?: Partial<Terminal>; generate?: typeof dbCommand; json?: boolean } = {}) {
  const io = { ...terminal, ...options.terminal };
  const checkout = resolve(import.meta.dir, "../../../..");
  const source = await Bun.file(join(checkout, "install.sh")).exists() ? checkout : undefined;
  const result = await init(name, options.cwd ?? process.cwd(), template, false, source);
  await io.run([process.execPath, "install"], { cwd: result.dir });
  if (template === "react") await (options.generate ?? dbCommand)("generate", result.dir);
  if (io.which("git") && !await Bun.file(join(result.dir, ".git/HEAD")).exists()) {
    await io.run(["git", "init"], { cwd: result.dir });
    await io.run(["git", "add", "."], { cwd: result.dir });
    await io.run(["git", "-c", "commit.gpgsign=false", "-c", "user.name=Bedrock", "-c", "user.email=bedrock@localhost", "commit", "-m", `feat: create ${name}`], { cwd: result.dir });
  }
  if (!options.json) io.write(`✓ Created ${name} (${template})\ncd ${name}\nbedrock dev\nbedrock deploy`);
  return { command: "new", ...result, template };
}
