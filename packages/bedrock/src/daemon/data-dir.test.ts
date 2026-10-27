import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { openDataRoot, pebbleDataDir, validateConfig } from "./config";
import { openDaemonDatabase } from "./db";

test("dataDir defaults to home, must be absolute, and must hold a pebbles directory", async () => {
  const temp = tempDirectory();
  try {
    const base = { domain: "example.test", creators: [], port: 0 };
    expect(await openDataRoot(temp.dir, {})).toBe(temp.dir);
    expect(() => validateConfig({ ...base, dataDir: "relative/data" })).toThrow("dataDir must be an absolute path.");
    const data = join(temp.dir, "disk");
    // An unmounted disk leaves an empty mount point; the daemon must not start on it.
    await mkdir(data);
    await expect(openDataRoot(temp.dir, { dataDir: data })).rejects.toMatchObject({ code: "DATA_DIR_MISSING" });
    await mkdir(join(data, "pebbles"));
    expect(await openDataRoot(temp.dir, validateConfig({ ...base, dataDir: data }))).toBe(data);
    expect(pebbleDataDir(data, "notes")).toBe(join(data, "pebbles", "notes", "data"));
  } finally { temp.cleanup(); }
});

test("registry stores releases relative to home and rewrites absolute rows from a moved home", async () => {
  const temp = tempDirectory();
  try {
    const home = join(temp.dir, "home");
    const first = await openDaemonDatabase(home);
    const release = join(home, "pebbles", "notes", "releases", "2-b");
    first.save({ name: "notes", release, previous_release: null, status: "running" });
    expect(first.db.query("SELECT release FROM pebbles").get()).toEqual({ release: join("pebbles", "notes", "releases", "2-b") });
    expect(first.get("notes")).toMatchObject({ release, previous_release: null });
    // Older daemons stored absolute paths under the home the install used to live in.
    first.db.query("INSERT INTO pebbles VALUES (?, ?, ?, ?)").run("old", "/old/home/pebbles/old/releases/2-b", "/old/home/pebbles/old/releases/1-a", "stopped");
    first.db.query("INSERT INTO pebbles VALUES (?, ?, ?, ?)").run("dev", "/src/dev", null, "stopped");
    first.close();
    const second = await openDaemonDatabase(home);
    expect(second.get("old")).toMatchObject({ release: join(home, "pebbles", "old", "releases", "2-b"), previous_release: join(home, "pebbles", "old", "releases", "1-a") });
    expect(second.get("dev")!.release).toBe(resolve("/src/dev"));
    expect(second.list().map(record => record.release)).toEqual([resolve("/src/dev"), join(home, "pebbles", "notes", "releases", "2-b"), join(home, "pebbles", "old", "releases", "2-b")]);
    second.close();
  } finally { temp.cleanup(); }
});
