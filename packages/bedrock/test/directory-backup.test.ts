import { expect, test } from "bun:test";
import { mkdir, symlink, stat, chmod, utimes } from "node:fs/promises";
import { join } from "node:path";
import { startPebble } from "../src/runtime";
import { snapshot, restoreData, prune, fsTarget } from "../src/backup";
import { tempDirectory } from "./helpers";

test("live directory backup restores nested files, empty dirs, metadata and retains referenced blobs", async () => {
  const temp = tempDirectory();
  const data = join(temp.dir, "data");
  const target = fsTarget(join(temp.dir, "backup"));
  const config = { directories: ["workspaces"], exclude: ["**/node_modules/**"] };
  const runtime = await startPebble({ dir: temp.dir, dataDir: data, port: 0, pebble: { name: "directory", backup: config } });
  try {
    await mkdir(join(data, "workspaces/mod/empty"), { recursive: true });
    await Bun.write(join(data, "workspaces/mod/source.txt"), "source\n");
    await Bun.write(join(data, "workspaces/mod/node_modules/skip.txt"), "skip");
    await Bun.write(join(temp.dir, "outside.txt"), "outside");
    await symlink(join(temp.dir, "outside.txt"), join(data, "workspaces/link"));
    await chmod(join(data, "workspaces/mod/source.txt"), 0o640);
    await utimes(join(data, "workspaces/mod/source.txt"), 1700000000, 1700000000);
    const manifest = await snapshot(target, "directory", join(data, "db.sqlite"), join(data, "files"), new Date(), config);
    expect(manifest.directories?.workspaces?.map(file => file.path)).toEqual(["mod/source.txt"]);
    expect(manifest.emptyDirs?.workspaces).toEqual(["mod/empty"]);
    const file = manifest.directories!.workspaces![0]!;
    await target.put(`pebbles/directory/files/${"a".repeat(64)}`, new Uint8Array([1]));
    await prune(target, "directory");
    expect(await target.exists(`pebbles/directory/files/${file.sha256}`)).toBe(true);
    expect(await target.exists(`pebbles/directory/files/${"a".repeat(64)}`)).toBe(false);
    await runtime.stop();
    await Bun.write(join(data, "workspaces/mod/source.txt"), "changed");
    await restoreData(target, "directory", data);
    expect(await Bun.file(join(data, "workspaces/mod/source.txt")).text()).toBe("source\n");
    expect((await stat(join(data, "workspaces/mod/empty"))).isDirectory()).toBe(true);
    expect(await Bun.file(join(data, "workspaces/link")).exists()).toBe(false);
    expect(await Bun.file(join(data, "workspaces/mod/node_modules/skip.txt")).exists()).toBe(false);
    const restored = await stat(join(data, "workspaces/mod/source.txt"));
    if (process.platform !== "win32") expect(restored.mode & 0o777).toBe(0o640);
    expect(restored.mtimeMs).toBe(1700000000000);
    await target.put(`pebbles/directory/files/${file.sha256}`, new Uint8Array([0]));
    await expect(restoreData(target, "directory", data)).rejects.toMatchObject({ code: "BACKUP_CHECKSUM" });
    expect(await Bun.file(join(data, "workspaces/mod/source.txt")).text()).toBe("source\n");
  } finally { await runtime.stop(); temp.cleanup(); }
});
