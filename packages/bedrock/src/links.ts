import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Check } from "./cli/doctor";
import type { updateRun } from "./self-update";

// Pebbles depend on link:<name>, which Bun resolves through its global link registry, not a path.
export const linkedPackages = [{ name: "bedrock", dir: "packages/bedrock" }, { name: "@bedrock/ui", dir: "packages/ui" }];

export function bunGlobalModules(env: Record<string, string | undefined> = process.env) {
  return join(env.BUN_INSTALL_GLOBAL_DIR ?? join(env.BUN_INSTALL ?? join(homedir(), ".bun"), "install", "global"), "node_modules");
}

export async function linkCheckout(checkout: string, execute: typeof updateRun) {
  const output: string[] = [];
  for (const { dir } of linkedPackages) {
    if (await Bun.file(join(checkout, dir, "package.json")).exists()) output.push(await execute([process.execPath, "link"], { cwd: join(checkout, dir) }));
  }
  return output.join("\n");
}

const real = (path: string) => realpath(path).catch(() => null);

// Never re-point an existing link: it may belong to the daemon's checkout.
export async function unlinkedPackages(checkout: string, globalModules = bunGlobalModules()) {
  const missing = [];
  for (const item of linkedPackages) {
    if (await Bun.file(join(checkout, item.dir, "package.json")).exists() && !await real(join(globalModules, item.name))) missing.push(item);
  }
  return missing;
}

export async function linkChecks(checkout: string, cwd: string, globalModules = bunGlobalModules()): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], message: string, hint: string) => { checks.push({ name, status, message, hint }); };
  for (const { name, dir } of linkedPackages) {
    const source = join(checkout, dir);
    const linked = await real(join(globalModules, name));
    const relink = `Run bun link in ${source}.`;
    if (!linked) add(`link:${name}`, "warn", `${name} is not registered with bun link.`, relink);
    else if (linked !== await real(source)) add(`link:${name}`, "warn", `${name} is linked to ${linked}, not this checkout.`, relink);
    else add(`link:${name}`, "pass", `${name} is linked to ${source}.`, "Pebbles use link: dependencies; bedrock self-update keeps the link current.");
  }
  const pkg = await Bun.file(join(cwd, "package.json")).json().catch(() => null);
  const deps: Record<string, string> = { ...pkg?.devDependencies, ...pkg?.dependencies };
  const used = linkedPackages.filter(({ name }) => typeof deps[name] === "string");
  if (!used.length) return checks;
  const stale = used.filter(({ name }) => deps[name]!.startsWith("file:"));
  if (stale.length) {
    add("pebble-deps", "warn", "This pebble uses file: dependencies, which break in copies and git worktrees.", `Switch to link: dependencies:\n  bun add ${stale.map(({ name }) => `${name}@link:${name}`).join(" ")}`);
  } else add("pebble-deps", "pass", "This pebble uses location-independent dependencies.", "Keep link: dependencies for Bedrock packages.");
  for (const { name, dir } of used) {
    const installed = await real(join(cwd, "node_modules", name));
    const source = join(checkout, dir);
    if (installed && installed === await real(source)) add(`pebble-link:${name}`, "pass", `node_modules/${name} resolves to ${source}.`, "Local dev runs the daemon's code.");
    else add(`pebble-link:${name}`, "warn", installed ? `node_modules/${name} resolves to ${installed}, not ${source}.` : `node_modules/${name} is missing.`, "Run bun install in the pebble; if it persists, fix the bun link checks above.");
  }
  return checks;
}
