import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { is, Table } from "drizzle-orm";
import { openDatabase, migrationPlan, applyMigrations } from "../db";
import { loadPebble } from "../runtime/load";
import { BedrockError } from "../error";

export async function dbCommand(command: string, dir = process.cwd()) {
  const pebble = await loadPebble(dir);
  if (command === "generate") {
    const temp = await mkdtemp(join(dir, ".bedrock-drizzle-"));
    try {
      const tables = Object.entries(pebble.schema ?? {}).filter(([, value]) => is(value, Table));
      if (!tables.length) throw new BedrockError("NO_SCHEMA", "No Drizzle tables found in pebble.schema.", "Add tables to schema in definePebble before generating migrations.");
      const wrapper = `import pebble from ${JSON.stringify(resolve(dir, "pebble.ts"))};\n` +
        tables.map(([key], i) => `export const table${i} = pebble.schema![${JSON.stringify(key)}];`).join("\n");
      await Bun.write(join(temp, "schema.ts"), wrapper);
      await Bun.write(join(temp, "config.ts"), `export default ${JSON.stringify({ dialect: "sqlite", schema: relative(dir, join(temp, "schema.ts")), out: "./migrations" })};\n`);
      let kit: string;
      try {
        let entry: string;
        try { entry = Bun.resolveSync("drizzle-kit", dir); }
        catch { entry = Bun.resolveSync("drizzle-kit", import.meta.dir); }
        kit = join(dirname(entry), "bin.cjs");
      } catch {
        throw new BedrockError("DRIZZLE_KIT_MISSING", "drizzle-kit is required for migration generation.", "Run bun add --dev drizzle-kit in the pebble directory, then retry.");
      }
      const child = Bun.spawn([process.execPath, kit, "generate", "--config", join(temp, "config.ts")], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new BedrockError("GENERATE_FAILED", (stderr || stdout).trim(), "Check the schema exports and drizzle-kit output, then retry.");
      return { command: "db generate", directory: join(dir, "migrations"), output: stdout.trim() };
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  const database = openDatabase(join(dir, ".bedrock"), pebble.schema);
  try {
    if (command === "plan") return { command: "db plan", pending: await migrationPlan(database.sqlite, join(dir, "migrations")) };
    if (command === "migrate") return { command: "db migrate", applied: await applyMigrations(database.sqlite, join(dir, "migrations")) };
    throw new BedrockError("UNKNOWN_COMMAND", `Unknown db command: ${command}`, "Use bedrock db generate, bedrock db plan, or bedrock db migrate.");
  } finally { database.close(); }
}
