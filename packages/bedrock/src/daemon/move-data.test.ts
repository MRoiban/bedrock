import { expect, test } from "bun:test";
import { chmod, lstat, mkdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { readConfig, setup } from "./config";
import { moveData } from "./move-data";

const stopped = { running: async () => false };

async function install(dir: string) {
  const home = join(dir, "home");
  await setup(home, "example.test", "creator@example.test", 0);
  const pebble = join(home, "pebbles", "notes");
  await mkdir(join(pebble, "data", "files", "docs"), { recursive: true });
  await mkdir(join(pebble, "data", "empty"), { recursive: true });
  await mkdir(join(pebble, "logs"), { recursive: true });
  await mkdir(join(pebble, "releases", "1-a"), { recursive: true });
  await writeFile(join(pebble, "data", "db.sqlite"), "database");
  await writeFile(join(pebble, "data", "files", "docs", "a.txt"), "attachment", { mode: 0o640 });
  await writeFile(join(pebble, "logs", "pebble.log"), "log line\n");
  await writeFile(join(pebble, "secrets.json"), "{}");
  if (process.platform !== "win32") await symlink("files/docs/a.txt", join(pebble, "data", "link"));
  return { home, pebble };
}

test("moves pebble data and logs, verifies, switches dataDir and keeps the old copy", async () => {
  const temp = tempDirectory();
  try {
    const { home, pebble } = await install(temp.dir);
    const target = join(temp.dir, "disk", "bedrock");
    const progress: string[] = [];
    const result = await moveData(home, target, { ...stopped, progress: line => progress.push(line) });
    expect(result).toMatchObject({ moved: true, from: home, dataDir: target, pebbles: ["notes"] });
    expect(progress).toEqual([`Copying ${join(pebble, "data")}`, `Copying ${join(pebble, "logs")}`]);
    expect((await readConfig(home)).dataDir).toBe(target);
    const moved = join(target, "pebbles", "notes");
    expect(await Bun.file(join(moved, "data", "files", "docs", "a.txt")).text()).toBe("attachment");
    expect(await Bun.file(join(moved, "logs", "pebble.log")).text()).toBe("log line\n");
    expect((await stat(join(moved, "data", "empty"))).isDirectory()).toBe(true);
    if (process.platform !== "win32") {
      expect(await readlink(join(moved, "data", "link"))).toBe("files/docs/a.txt");
      expect((await stat(join(moved, "data", "files", "docs", "a.txt"))).mode & 0o777).toBe(0o640);
    }
    // Code and secrets stay in home; the old data stays until the operator removes it.
    expect(await Bun.file(join(moved, "secrets.json")).exists()).toBe(false);
    expect(await lstat(join(moved, "releases")).catch(() => null)).toBeNull();
    expect(await Bun.file(join(pebble, "data", "db.sqlite")).text()).toBe("database");
    expect(await lstat(join(moved, "data.partial")).catch(() => null)).toBeNull();
    expect(await moveData(home, target, stopped)).toMatchObject({ moved: false, dataDir: target });
  } finally { temp.cleanup(); }
});

test("resumes over an identical earlier copy, refuses a different one, and moves back to home", async () => {
  const temp = tempDirectory();
  try {
    const { home } = await install(temp.dir);
    const target = join(temp.dir, "disk");
    await moveData(home, target, stopped);
    const config = await readConfig(home);
    delete config.dataDir;
    await Bun.write(join(home, "config.json"), JSON.stringify(config));
    // An interrupted run left one finished copy and one partial copy behind.
    await rm(join(target, "pebbles", "notes", "logs"), { recursive: true });
    await writeFile(join(target, "pebbles", "notes", "logs.partial"), "garbage");
    expect(await moveData(home, target, stopped)).toMatchObject({ moved: true, dataDir: target });
    expect(await Bun.file(join(target, "pebbles", "notes", "logs", "pebble.log")).text()).toBe("log line\n");
    expect(await lstat(join(target, "pebbles", "notes", "logs.partial")).catch(() => null)).toBeNull();
    // Moving back finds the stale old copy in home and refuses to overwrite it.
    await writeFile(join(target, "pebbles", "notes", "data", "db.sqlite"), "newer");
    await expect(moveData(home, home, stopped)).rejects.toMatchObject({ code: "DATA_DIR_NOT_EMPTY" });
    await writeFile(join(home, "pebbles", "notes", "data", "db.sqlite"), "newer");
    expect(await moveData(home, home, stopped)).toMatchObject({ moved: true, dataDir: home });
    expect((await readConfig(home)).dataDir).toBeUndefined();
  } finally { temp.cleanup(); }
});

test("refuses while the daemon runs, overlapping targets, and too little space", async () => {
  const temp = tempDirectory();
  try {
    const { home, pebble } = await install(temp.dir);
    await expect(moveData(home, join(temp.dir, "disk"), { running: async () => true })).rejects.toMatchObject({ code: "DAEMON_RUNNING" });
    await expect(moveData(home, join(pebble, "data"), stopped)).rejects.toMatchObject({ code: "INVALID_DATA_DIR" });
    const disk = (async () => ({ bavail: 1, bsize: 1 })) as unknown as typeof import("node:fs/promises").statfs;
    await expect(moveData(home, join(temp.dir, "disk"), { ...stopped, disk })).rejects.toMatchObject({ code: "DATA_DIR_FULL" });
    expect((await readConfig(home)).dataDir).toBeUndefined();
  } finally { temp.cleanup(); }
});

test("refuses an unavailable data disk and paths that share files, follows symlinked pebbles and keeps directory modes", async () => {
  const temp = tempDirectory();
  try {
    const { home, pebble } = await install(temp.dir);
    // A configured data disk that is not mounted must not be read as "no pebbles".
    const config = await readConfig(home);
    await Bun.write(join(home, "config.json"), JSON.stringify({ ...config, dataDir: join(temp.dir, "unmounted") }));
    await expect(moveData(home, join(temp.dir, "disk"), stopped)).rejects.toMatchObject({ code: "DATA_DIR_MISSING" });
    await Bun.write(join(home, "config.json"), JSON.stringify(config));
    if (process.platform === "win32") return;
    const target = join(temp.dir, "disk");
    await mkdir(join(target, "pebbles", "notes"), { recursive: true });
    await symlink(join(pebble, "data"), join(target, "pebbles", "notes", "data"));
    await expect(moveData(home, target, stopped)).rejects.toMatchObject({ code: "INVALID_DATA_DIR" });
    await rm(join(target, "pebbles", "notes", "data"));
    const elsewhere = join(temp.dir, "manual", "chat");
    await mkdir(join(elsewhere, "data", "locked"), { recursive: true });
    await writeFile(join(elsewhere, "data", "locked", "db.sqlite"), "chat");
    await chmod(join(elsewhere, "data", "locked"), 0o500);
    await symlink(elsewhere, join(home, "pebbles", "chat"));
    expect((await moveData(home, target, stopped)).pebbles).toEqual(["chat", "notes"]);
    expect(await Bun.file(join(target, "pebbles", "chat", "data", "locked", "db.sqlite")).text()).toBe("chat");
    expect((await stat(join(target, "pebbles", "chat", "data", "locked"))).mode & 0o777).toBe(0o500);
    await chmod(join(elsewhere, "data", "locked"), 0o700);
    await chmod(join(target, "pebbles", "chat", "data", "locked"), 0o700);
  } finally { temp.cleanup(); }
});

test("a resumed move needs free space only for what is left to copy", async () => {
  const temp = tempDirectory();
  try {
    const { home } = await install(temp.dir);
    const target = join(temp.dir, "disk");
    await moveData(home, target, stopped);
    const config = await readConfig(home);
    delete config.dataDir;
    await Bun.write(join(home, "config.json"), JSON.stringify(config));
    const disk = (async () => ({ bavail: 0, bsize: 1 })) as unknown as typeof import("node:fs/promises").statfs;
    expect(await moveData(home, target, { ...stopped, disk })).toMatchObject({ moved: true, bytes: 0 });
  } finally { temp.cleanup(); }
});

test("checks every target against every source, across categories", async () => {
  if (process.platform === "win32") return;
  const temp = tempDirectory();
  try {
    const { home, pebble } = await install(temp.dir);
    const shared = join(temp.dir, "shared");
    await mkdir(join(shared, "data.partial"), { recursive: true });
    await writeFile(join(shared, "data.partial", "pebble.log"), "only copy");
    await rm(join(pebble, "logs"), { recursive: true });
    await symlink(join(shared, "data.partial"), join(pebble, "logs"));
    const target = join(temp.dir, "disk");
    await mkdir(join(target, "pebbles"), { recursive: true });
    await symlink(shared, join(target, "pebbles", "notes"));
    await expect(moveData(home, target, stopped)).rejects.toMatchObject({ code: "INVALID_DATA_DIR" });
    expect(await Bun.file(join(shared, "data.partial", "pebble.log")).text()).toBe("only copy");
  } finally { temp.cleanup(); }
});
