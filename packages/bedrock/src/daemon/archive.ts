import { mkdir, rm, symlink } from "node:fs/promises";
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
    if (name.startsWith("/") || name.split("/").some(part => ["..", "node_modules", ".bedrock", ".git"].includes(part))) {
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

export async function installRelease(release: string) {
  const path = join(release, "package.json");
  if (await Bun.file(path).exists()) {
    const pkg = await Bun.file(path).json();
    // Bedrock is owned by the daemon, never fetched from a registry or workspace.
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      if (pkg[section]) delete pkg[section].bedrock;
    }
    await Bun.write(path, JSON.stringify(pkg, null, 2) + "\n");
    // A workspace lockfile can still refer to unpublished bedrock or unrelated workspaces.
    await Promise.all(["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock"].map(name => rm(join(release, name), { force: true })));
    if (Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }).length) {
      await run([process.execPath, "install", "--production"], release);
    }
  }
  await mkdir(join(release, "node_modules"), { recursive: true });
  await rm(join(release, "node_modules/bedrock"), { recursive: true, force: true });
  await symlink(resolve(import.meta.dir, "../.."), join(release, "node_modules/bedrock"), "dir");
}

export async function createArchive(dir: string, archive: string) {
  await run(["tar", "--exclude=node_modules", "--exclude=.bedrock", "--exclude=.git", "-czf", archive, "-C", resolve(dir), "."]);
}
