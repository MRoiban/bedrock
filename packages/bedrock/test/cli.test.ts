import { linkDependencies } from "./helpers";
import { test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tempDirectory } from "./helpers";

const cli = resolve(import.meta.dir, "../src/cli/index.ts");
async function command(dir: string, args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args, "--json"], {
    cwd: dir, env: { ...process.env, BEDROCK_HOME: join(dir, "isolated-home") },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, value: JSON.parse(stdout), stderr };
}

test("CLI generates from pebble.schema and plans/applies migrations idempotently", async () => {
  const temp = tempDirectory();
  try {
    linkDependencies(resolve(import.meta.dir, "../../../examples/notes/node_modules"), join(temp.dir, "node_modules"));
    await Bun.write(join(temp.dir, "pebble.ts"), `import { definePebble, sqliteTable, text } from "bedrock";
const table = sqliteTable("records", { id: text("id").primaryKey() });
export default definePebble({ name: "generated", schema: { table } });
`);
    const generated = await command(temp.dir, ["db", "generate"]);
    expect(generated.code).toBe(0);
    expect(generated.value.ok).toBe(true);
    expect(readdirSync(join(temp.dir, "migrations")).filter(name => name.endsWith(".sql"))).toHaveLength(1);
    expect((await command(temp.dir, ["db", "generate"])).code).toBe(0);
    expect(readdirSync(join(temp.dir, "migrations")).filter(name => name.endsWith(".sql"))).toHaveLength(1);
    const plan = await command(temp.dir, ["db", "plan"]);
    expect(plan.value.pending).toHaveLength(1);
    expect(plan.value.pending[0].sql).toContain("CREATE TABLE");
    expect((await command(temp.dir, ["db", "migrate"])).value.applied).toHaveLength(1);
    expect((await command(temp.dir, ["db", "migrate"])).value.applied).toEqual([]);
    expect((await command(temp.dir, ["db", "plan"])).value.pending).toEqual([]);
    const invalid = await command(temp.dir, ["not-a-command"]);
    expect(invalid.code).toBe(1);
    expect(invalid.value.error.hint).toContain("bedrock init");
    expect(readdirSync(temp.dir).filter(name => name.startsWith(".bedrock-drizzle-"))).toEqual([]);
  } finally { temp.cleanup(); }
});
