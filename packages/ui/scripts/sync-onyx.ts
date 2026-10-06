import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { BedrockError } from "bedrock/client";

export const selectedItems = ["button", "input", "textarea", "checkbox", "switch", "select", "dialog", "table", "tabs", "toast", "text", "empty-state", "progress", "kbd", "icon", "theme", "panel", "toolbar", "context-menu"];
export const defaultSource = "/Users/stellar/Playground/babel-ui/onyx";
const packageDir = resolve(import.meta.dir, "..");
interface RegistryItem { name: string; files: { path: string }[]; registryDependencies?: string[] }

export async function syncOnyx(source = defaultSource, destination = packageDir) {
  const registryFile = Bun.file(join(source, "registry.json"));
  if (!await registryFile.exists()) throw new BedrockError("ONYX_SOURCE_MISSING", `Onyx registry not found in ${source}.`, "Pass the Onyx directory to bun run sync:onyx.");
  const registry = await registryFile.json() as { items: RegistryItem[] };
  const items = new Map(registry.items.map(item => [item.name, item]));
  const files = new Set<string>();
  const visited = new Set<string>();
  function include(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const item = items.get(name);
    if (!item) throw new BedrockError("ONYX_REGISTRY_ITEM_MISSING", `Registry item ${name} is missing.`, "Review the selected component list against the upstream registry.");
    for (const file of item.files) files.add(file.path);
    for (const dependency of item.registryDependencies ?? []) include(dependency);
  }
  selectedItems.forEach(include);
  // Registry metadata omits shared helpers; follow relative source imports as well.
  async function read(path: string): Promise<string> {
    if (!path.startsWith("src/") || path.includes("..")) throw new BedrockError("ONYX_SOURCE_PATH", `Unsafe source path: ${path}`, "Use registry files inside Onyx src/.");
    const file = Bun.file(join(source, path));
    if (!await file.exists()) throw new BedrockError("ONYX_SOURCE_MISSING", `Source file ${path} is missing.`, "Check the registry and its relative imports.");
    return file.text();
  }
  const contents = new Map<string, string>();
  for (const path of files) {
    const content = await read(path);
    contents.set(path, content);
    for (const match of content.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) {
      const base = resolve(source, dirname(path), match[1]!);
      const candidates = [base, `${base}.ts`, `${base}.tsx`];
      const found = await Promise.all(candidates.map(async candidate => await Bun.file(candidate).exists() ? candidate : undefined));
      const dependency = found.find(Boolean);
      if (dependency) files.add(dependency.slice(resolve(source).length + 1).replaceAll("\\", "/"));
    }
  }
  const chosenRegistry = { ...registry, items: registry.items.filter(item => visited.has(item.name)) };
  const registryText = JSON.stringify(chosenRegistry, null, 2) + "\n";
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(registryText);
  for (const [path, content] of [...contents].sort(([a], [b]) => a.localeCompare(b))) hash.update(`${path}\0${content}\0`);
  const commit = Bun.spawnSync(["git", "-C", source, "rev-parse", "HEAD"]);
  const version = `commit ${commit.exitCode === 0 ? commit.stdout.toString().trim() : "unknown"}\nsha256 ${hash.digest("hex")}\n`;
  const target = join(destination, "src/onyx");
  await rm(target, { recursive: true, force: true });
  for (const [path, content] of contents) {
    const output = join(target, path.slice(4));
    await mkdir(dirname(output), { recursive: true });
    // Radix optional props must be omitted under Bedrock's exactOptionalPropertyTypes.
    const compatible = path === "src/components/context-menu.tsx"
      ? content.replace("checked={checked}", "{...(checked === undefined ? {} : { checked })}")
      : content;
    await Bun.write(output, `/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */\n${compatible}`);
  }
  await Bun.write(join(target, "registry.json"), registryText);
  await Bun.write(join(destination, "ONYX_VERSION"), version);
  await Bun.write(join(destination, "src/onyx/index.ts"), `/* Generated from Onyx registry. Do not edit; run bun run sync:onyx. */\n${[...visited].map(name => `export * from "./components/${name}";`).join("\n")}\nexport * from "./theme/tokens";\n`);
  return version;
}
if (import.meta.main) console.log(await syncOnyx(process.argv[2]));
