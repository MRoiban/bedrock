import { expect, test } from "bun:test";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { cleanupSnapshots } from "./snapshot-temp";

test("snapshot recovery removes dead daemon staging and preserves live or unrelated directories", async () => {
  const temp = tempDirectory();
  const live = `.bedrock-backup-${process.pid}-active`;
  const abandoned = ".bedrock-backup-2147483647-abandoned";
  try {
    for (const name of [live, abandoned, "files"]) await mkdir(join(temp.dir, name));
    await Bun.write(join(temp.dir, abandoned, "snapshot.sqlite"), "incomplete");
    await cleanupSnapshots(temp.dir);
    expect((await readdir(temp.dir)).sort()).toEqual([live, "files"].sort());
  } finally { temp.cleanup(); }
});
