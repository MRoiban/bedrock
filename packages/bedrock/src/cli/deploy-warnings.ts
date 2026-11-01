import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Provenance } from "../version";

const excluded = (name: string) => ["node_modules", ".bedrock", ".git", ".DS_Store", ".env"].includes(name) || name.startsWith("._") || name.startsWith(".env.");
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

async function directorySize(path: string, archive: string): Promise<number> {
  if (resolve(path) === resolve(archive)) return 0;
  const stat = await lstat(path);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let bytes = 0;
  for (const name of await readdir(path)) if (!excluded(name)) bytes += await directorySize(join(path, name), archive);
  return bytes;
}

export async function deployWarnings(dir: string, archive: string, provenance: Provenance): Promise<string[]> {
  const warnings: string[] = [];
  if (provenance.dirty) warnings.push("Deploying uncommitted changes (including untracked files).");
  const bytes = Bun.file(archive).size;
  if (bytes > 50_000_000) {
    const sizes: { name: string; bytes: number }[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || excluded(entry.name)) continue;
      try { sizes.push({ name: entry.name, bytes: await directorySize(join(dir, entry.name), archive) }); }
      catch { /* A changing scratch tree must not prevent deployment. */ }
    }
    sizes.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    warnings.push(`Archive is ${megabytes(bytes)} (over 50 MB). Largest top-level directories (uncompressed): ${sizes.slice(0, 5).map(item => `${item.name}/ ${megabytes(item.bytes)}`).join(", ") || "none"}. Deploy a clean export to ship less.`);
  }
  return warnings;
}
