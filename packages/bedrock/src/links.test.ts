import { expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "../test/helpers";
import { bunGlobalModules, linkChecks, unlinkedPackages } from "./links";
import { doctor } from "./cli/doctor";

async function fixture(dir: string) {
  const checkout = join(dir, "checkout");
  const global = join(dir, "global");
  const pebble = join(dir, "pebble");
  for (const path of ["packages/bedrock", "packages/ui"]) await mkdir(join(checkout, path), { recursive: true });
  await mkdir(join(global, "@bedrock"), { recursive: true });
  await mkdir(join(pebble, "node_modules/@bedrock"), { recursive: true });
  return { checkout, global, pebble };
}
const byName = (checks: { name: string; status: string; hint: string }[]) => Object.fromEntries(checks.map(check => [check.name, check]));

test("doctor reports unregistered links and a pebble still on file: dependencies", async () => {
  const temp = tempDirectory();
  try {
    const { checkout, global, pebble } = await fixture(temp.dir);
    await symlink(join(checkout, "packages/bedrock"), join(global, "bedrock"));
    await Bun.write(join(pebble, "package.json"), JSON.stringify({ dependencies: { bedrock: `file:${checkout}/packages/bedrock`, "@bedrock/ui": `file:${checkout}/packages/ui` } }));
    await mkdir(join(pebble, "node_modules/bedrock"));
    const checks = byName(await linkChecks(checkout, pebble, global));
    expect(checks["link:bedrock"]!.status).toBe("pass");
    expect(checks["link:@bedrock/ui"]).toMatchObject({ status: "warn", hint: `Run bun link in ${join(checkout, "packages/ui")}.` });
    expect(checks["pebble-deps"]!.status).toBe("warn");
    expect(checks["pebble-deps"]!.hint).toBe("Switch to link: dependencies:\n  bun add bedrock@link:bedrock @bedrock/ui@link:@bedrock/ui");
    expect(checks["pebble-link:bedrock"]!.status).toBe("warn");
    expect(checks["pebble-link:@bedrock/ui"]!.status).toBe("warn");
  } finally { temp.cleanup(); }
});

test("doctor passes a linked pebble that resolves to the daemon checkout", async () => {
  const temp = tempDirectory();
  try {
    const { checkout, global, pebble } = await fixture(temp.dir);
    for (const [name, dir] of [["bedrock", "bedrock"], ["@bedrock/ui", "ui"]] as const) {
      await symlink(join(checkout, "packages", dir), join(global, name));
      await symlink(join(checkout, "packages", dir), join(pebble, "node_modules", name));
    }
    await Bun.write(join(pebble, "package.json"), JSON.stringify({ dependencies: { bedrock: "link:bedrock", "@bedrock/ui": "link:@bedrock/ui" } }));
    const checks = await doctor(join(temp.dir, "home"), { checkout, cwd: pebble, bunGlobal: global, fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    const links = checks.filter(check => /^(link:|pebble-)/.test(check.name));
    expect(links.map(check => [check.name, check.status])).toEqual([
      ["link:bedrock", "pass"], ["link:@bedrock/ui", "pass"], ["pebble-deps", "pass"], ["pebble-link:bedrock", "pass"], ["pebble-link:@bedrock/ui", "pass"],
    ]);
    // Outside a pebble and outside a source checkout, doctor adds no pebble or link checks.
    const elsewhere = await doctor(join(temp.dir, "home"), { checkout: null, cwd: temp.dir, fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    expect(elsewhere.some(check => /^(link:|pebble-)/.test(check.name))).toBe(false);
  } finally { temp.cleanup(); }
});

test("the global link registry follows Bun's environment variables", () => {
  expect(bunGlobalModules({ BUN_INSTALL: "/b" })).toBe(join("/b", "install", "global", "node_modules"));
  expect(bunGlobalModules({ BUN_INSTALL: "/b", BUN_INSTALL_GLOBAL_DIR: "/g" })).toBe(join("/g", "node_modules"));
});

test("new registers only missing links and never re-points an existing one", async () => {
  const temp = tempDirectory();
  try {
    const { checkout, global } = await fixture(temp.dir);
    for (const dir of ["packages/bedrock", "packages/ui"]) await Bun.write(join(checkout, dir, "package.json"), "{}");
    // Windows makes a file symlink when the target is missing, so create it first.
    await mkdir(join(temp.dir, "elsewhere"));
    await symlink(join(temp.dir, "elsewhere"), join(global, "bedrock"), "dir");
    expect((await unlinkedPackages(checkout, global)).map(item => item.name)).toEqual(["@bedrock/ui"]);
  } finally { temp.cleanup(); }
});
