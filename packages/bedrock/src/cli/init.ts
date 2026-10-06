import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateName } from "../config";
import { BedrockError } from "../error";

export async function init(name: string, cwd = process.cwd()) {
  validateName(name);
  const dir = resolve(cwd, name);
  const files = {
    "pebble.ts": `import { definePebble, query } from "bedrock";

export default definePebble({
  name: "${name}",
  access: "public",
  queries: { hello: query(() => ({ message: "Hello from ${name}!" })) },
  web: "./web/index.html",
});
`,
    "web/index.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title></head>
<body><h1>${name}</h1><p id="message"></p><script type="module">
const response = await fetch("/_bedrock/q/hello", { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" });
const result = await response.json();
document.querySelector("#message").textContent = result.ok ? result.value.message : result.error.message;
</script></body></html>
`,
    "package.json": JSON.stringify({ name, private: true, type: "module", scripts: { dev: "bedrock dev" }, dependencies: { bedrock: "^0.1.0" } }, null, 2) + "\n",
    "AGENTS.md": `# ${name}

pebble.ts is the source of truth. Use bedrock query/mutation and Standard Schema for arguments.
Functions receive { db, user, pebble, storage, request }. Queries are read-only.
Export Drizzle tables from pebble.ts. Run bedrock db generate after schema changes.
Run bedrock db plan to inspect pending SQL; bedrock db migrate applies it.
Run bun install, then bun run dev. Data lives in .bedrock/; never commit it.
All CLI commands support --json. Storage, plugins, auth, and sync are not implemented in Phase 1.
`,
    ".gitignore": "node_modules/\n.bedrock/\n",
  };
  let entries: string[];
  try { entries = await readdir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    entries = [];
  }
  if (entries.length) {
    if (await Bun.file(join(dir, "pebble.ts")).text().catch(() => "") === files["pebble.ts"] &&
        await Bun.file(join(dir, "package.json")).text().catch(() => "") === files["package.json"]) {
      return { name, dir, created: false };
    }
    throw new BedrockError("DIRECTORY_EXISTS", `Directory already contains files: ${dir}`, "Choose a new name or use the existing pebble; init never overwrites files.");
  }
  await mkdir(join(dir, "web"), { recursive: true });
  for (const [path, contents] of Object.entries(files)) await Bun.write(join(dir, path), contents);
  return { name, dir, created: true };
}
