import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { tempDirectory } from "../../test/helpers";
import { snapshotDirectories, restoreDirectories } from "./directories";
import { r2Target } from "./target";

test("directory snapshots deduplicate and restore through the R2 target adapter", async () => {
  const temp = tempDirectory();
  const objects = new Map<string, Uint8Array>();
  let puts = 0;
  const target = r2Target({ account: "a".repeat(32), bucket: "backup", accessKeyId: "test", secretAccessKey: "test" }, {
    async write(key: string, data: any) { puts++; objects.set(key, new Uint8Array(data)); return data.length; },
    file: ((key: string) => ({ arrayBuffer: async () => objects.get(key)!.slice().buffer })) as Bun.S3Client["file"],
    exists: async (key: string) => objects.has(key),
    delete: async (key: string) => { objects.delete(key); },
    list: async options => ({ contents: [...objects.keys()].filter(key => key.startsWith(options.prefix ?? "")).map(key => ({ key })), isTruncated: false }),
  });
  try {
    await Bun.write(join(temp.dir, "data/workspaces/a.txt"), "same bytes");
    await Bun.write(join(temp.dir, "data/workspaces/nested/b.txt"), "same bytes");
    await mkdir(join(temp.dir, "data/workspaces/empty"));
    const manifest = await snapshotDirectories(target, "pebbles/host/", join(temp.dir, "data"), { directories: ["workspaces"] });
    await snapshotDirectories(target, "pebbles/host/", join(temp.dir, "data"), { directories: ["workspaces"] });
    expect(puts).toBe(1);
    expect(await target.list("pebbles/host/files/")).toHaveLength(1);
    await restoreDirectories(target, "pebbles/host/", join(temp.dir, "stage"), manifest);
    expect(await Bun.file(join(temp.dir, "stage/workspaces/nested/b.txt")).text()).toBe("same bytes");
    const malicious = { directories: { workspaces: [{ ...manifest.directories.workspaces![0]!, path: "../../escape" }] } };
    await expect(restoreDirectories(target, "pebbles/host/", join(temp.dir, "stage2"), malicious)).rejects.toMatchObject({ code: "INVALID_BACKUP_DIRECTORY" });
    expect(await Bun.file(join(temp.dir, "escape")).exists()).toBe(false);
  } finally { temp.cleanup(); }
});
