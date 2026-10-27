import { expect, test } from "bun:test";
import { lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { startDaemon } from "../src/daemon";
import { atomicWrite, readConfig, setup } from "../src/daemon/config";
import { createArchive } from "../src/daemon/archive";
import { moveData } from "../src/daemon/move-data";
import { backupSetup } from "../src/backup";
import { tempDirectory } from "./helpers";

const source = `import { definePebble } from "bedrock";
console.log("started");
export default definePebble({ name: "sample", backup: { directories: ["workspaces"] }, routes: {
  "GET /data": () => new Response(process.env.BEDROCK_DATA),
  "POST /note": async request => { await Bun.write(process.env.BEDROCK_DATA + "/workspaces/note.txt", await request.text()); return new Response("ok"); },
  "GET /note": () => new Response(Bun.file(process.env.BEDROCK_DATA + "/workspaces/note.txt")),
}});`;

test("pebble data, logs and backups follow dataDir; data move relocates them between daemon runs", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "home");
  const disk = join(temp.dir, "disk");
  const dir = join(temp.dir, "source");
  await setup(home, "example.test", "creator@example.test", 0);
  await backupSetup(home, { type: "fs", directory: join(temp.dir, "backups") });
  const config = await readConfig(home);
  config.dataDir = disk;
  await atomicWrite(join(home, "config.json"), JSON.stringify(config));
  await expect(startDaemon({ home })).rejects.toMatchObject({ code: "DATA_DIR_MISSING" });
  await mkdir(join(disk, "pebbles"), { recursive: true });
  await Bun.write(join(dir, "pebble.ts"), source);
  let daemon = await startDaemon({ home });
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "bedrock.localhost", authorization: `Bearer ${token}`, ...init.headers } });
  const pebble = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "sample.localhost", origin: "http://sample.localhost", ...init.headers } });
  try {
    const archive = join(temp.dir, "release.tar.gz");
    await createArchive(dir, archive);
    expect((await (await api("/api/deploy?name=sample", { method: "POST", body: Bun.file(archive) })).json()).ok).toBe(true);
    expect(await (await pebble("/data")).text()).toBe(join(disk, "pebbles", "sample", "data"));
    expect((await pebble("/note", { method: "POST", body: "kept" })).status).toBe(200);
    expect(await Bun.file(join(disk, "pebbles", "sample", "data", "db.sqlite")).exists()).toBe(true);
    expect(await Bun.file(join(disk, "pebbles", "sample", "logs", "pebble.log")).text()).toContain("started");
    expect((await readdir(join(home, "pebbles", "sample"))).sort()).toEqual(["current", "releases"]);
    const backup = (await (await api("/api/backup/run?name=sample", { method: "POST" })).json()).value;
    expect(backup[0].directories.workspaces[0].path).toBe("note.txt");

    await daemon.stop();
    const moved = join(temp.dir, "other");
    expect(await moveData(home, moved, { running: async () => false })).toMatchObject({ moved: true, from: disk, dataDir: moved, pebbles: ["sample"] });
    daemon = await startDaemon({ home });
    expect(await (await pebble("/data")).text()).toBe(join(moved, "pebbles", "sample", "data"));
    expect(await (await pebble("/note")).text()).toBe("kept");

    expect((await api("/api/pebbles/sample?confirm=true", { method: "DELETE" })).status).toBe(200);
    expect(await lstat(join(moved, "pebbles", "sample")).catch(() => null)).toBeNull();
    expect(await lstat(join(home, "pebbles", "sample")).catch(() => null)).toBeNull();
  } finally { await daemon.stop(); temp.cleanup(); }
}, 30000);
