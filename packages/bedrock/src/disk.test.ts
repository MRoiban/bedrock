import { expect, test } from "bun:test";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { diskSpace, requireSpace, snapshotSpace, DISK_MARGIN } from "./disk";
import { asBedrockError } from "./error";
import { tempDirectory } from "../test/helpers";

const inspect = (free: number, total = 100 * 1024 ** 3) => (async () => ({ bsize: 1, bavail: free, blocks: total })) as unknown as typeof statfs;

test("space checks use available bytes, percentage and a snapshot margin including WAL", async () => {
  const temp = tempDirectory();
  try {
    const path = join(temp.dir, "db.sqlite");
    await Bun.write(path, new Uint8Array(1024));
    await Bun.write(path + "-wal", new Uint8Array(512));
    await expect(snapshotSpace(path, inspect(DISK_MARGIN + 3071))).rejects.toMatchObject({ code: "DISK_FULL" });
    await snapshotSpace(path, inspect(DISK_MARGIN + 3072));
    await expect(requireSpace(temp.dir, 1, inspect(0))).rejects.toMatchObject({ code: "DISK_FULL", message: expect.stringContaining(temp.dir) });
    expect((await diskSpace(temp.dir, inspect(2 * 1024 ** 3))).warning).toBe(true);
    expect((await diskSpace(temp.dir, inspect(10 * 1024 ** 3))).warning).toBe(false);
  } finally { temp.cleanup(); }
});

test("disk errors survive nested database causes and cyclic unrelated errors", () => {
  for (const code of ["ENOSPC", "EDQUOT", "SQLITE_FULL"]) {
    expect(asBedrockError(new Error("wrapped", { cause: { code } }), "FUNCTION_FAILED", "retry", "/data")).toMatchObject({ code: "DISK_FULL", message: expect.stringContaining("/data") });
  }
  const cyclic = { cause: {} }; cyclic.cause = cyclic;
  expect(asBedrockError(cyclic).code).toBe("INTERNAL_ERROR");
});
