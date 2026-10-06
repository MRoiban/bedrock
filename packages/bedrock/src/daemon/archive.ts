import { mkdir, readdir, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BedrockError } from "../error";

export async function run(command: string[], cwd?: string) {
  const child = Bun.spawn(command, { ...(cwd ? { cwd } : {}), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new BedrockError("DEPLOY_COMMAND_FAILED", `${command[0]} failed: ${(stderr || stdout).trim()}`, "Check the archive, package dependencies, and network connection, then retry.");
    return stdout;
  } finally { clearTimeout(timer); }
}

export async function extract(archive: string, release: string) {
  const names = await run(["tar", "-tzf", archive]);
  for (const name of names.trim().split("\n")) {
    if (/^[\\/]|:/.test(name) || name.split(/[\\/]/).some(part => ["..", "node_modules", ".bedrock", ".git"].includes(part))) {
      throw new BedrockError("UNSAFE_ARCHIVE", "Archive contains an unsafe or excluded path.", "Tar the pebble directory without node_modules, .bedrock, .git, or parent paths.");
    }
  }
  const entries = await run(["tar", "-tvzf", archive]);
  if (entries.split("\n").filter(Boolean).some(line => !["-", "d"].includes(line[0]!))) {
    throw new BedrockError("UNSAFE_ARCHIVE", "Archive contains links or special files.", "Deploy regular files and directories only; replace symbolic links with files.");
  }
  await mkdir(release, { recursive: true });
  await run(["tar", "-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", release]);
}

async function firstPartyPackages() {
  const bedrockDir = resolve(import.meta.dir, "../..");
  const parent = resolve(bedrockDir, "..");
  const directories = (await readdir(parent, { withFileTypes: true }))
    .filter(entry => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."))
    .map(entry => join(parent, entry.name));
  // Published installations put sibling first-party packages under the npm scope.
  const scoped = join(parent, "@bedrock");
  const scopedEntries = await readdir(scoped, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  directories.push(...scopedEntries.filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => join(scoped, entry.name)));
  const packages = [{ name: "bedrock", dir: bedrockDir }];
  for (const dir of directories) {
    const file = Bun.file(join(dir, "package.json"));
    if (!await file.exists()) continue;
    const pkg = await file.json();
    if (typeof pkg.name === "string" && /^@bedrock\/[a-z0-9_-]+$/.test(pkg.name)) packages.push({ name: pkg.name, dir });
  }
  // Source-linked packages and their consumers must share peer singletons such as React.
  for (const { dir } of [...packages]) {
    const pkg = await Bun.file(join(dir, "package.json")).json();
    for (const name of Object.keys(pkg.peerDependencies ?? {})) {
      if (packages.some(item => item.name === name)) continue;
      try {
        const peer = resolve(Bun.resolveSync(`${name}/package.json`, dir), "..");
        packages.push({ name, dir: peer });
      } catch (error) {
        if (!pkg.peerDependenciesMeta?.[name]?.optional) throw new BedrockError("DAEMON_PEER_MISSING", `Daemon package ${pkg.name} needs peer ${name}.`, `Install ${name} alongside the daemon's first-party packages.`);
      }
    }
  }
  return packages;
}

export async function installRelease(release: string) {
  const packages = await firstPartyPackages();
  const path = join(release, "package.json");
  if (await Bun.file(path).exists()) {
    const pkg = await Bun.file(path).json();
    // First-party packages are owned by the daemon, never fetched from a release manifest.
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      if (pkg[section]) for (const { name } of packages) delete pkg[section][name];
    }
    await Bun.write(path, JSON.stringify(pkg, null, 2) + "\n");
    // A workspace lockfile can still refer to unpublished bedrock or unrelated workspaces.
    await Promise.all(["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock"].map(name => rm(join(release, name), { force: true })));
    if (Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }).length) {
      await run([process.execPath, "install", "--production"], release);
    }
  }
  await mkdir(join(release, "node_modules"), { recursive: true });
  for (const { name, dir } of packages) {
    const target = join(release, "node_modules", name);
    await mkdir(resolve(target, ".."), { recursive: true });
    await rm(target, { recursive: true, force: true });
    await symlink(dir, target, process.platform === "win32" ? "junction" : "dir");
  }
}

export async function createArchive(dir: string, archive: string) {
  await run(["tar", "--exclude=node_modules", "--exclude=.bedrock", "--exclude=.git", "-czf", archive, "-C", resolve(dir), "."]);
}
