import { expect, test } from "bun:test";
import { mkdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { pruneRuns } from "./artifacts";

test("interrupted runs count toward the budget and are reclaimed once abandoned", async () => {
  const temp = tempDirectory();
  const now = Date.now();
  const old = new Date(now - 8 * 86_400_000), recent = new Date(now - 60_000);
  try {
    await mkdir(join(temp.dir, "current"));
    for (const [name, time] of [["abandoned", old], ["active", recent]] as const) {
      await Bun.write(join(temp.dir, name, "trace.zip"), "x".repeat(1000));
      await utimes(join(temp.dir, name), time, time);
    }
    const result = await pruneRuns(temp.dir, "current", now, 1500);
    expect(result.removed).toEqual([join(temp.dir, "abandoned")]);
    expect(result.bytes).toBe(1000);
    expect(await Bun.file(join(temp.dir, "active", "trace.zip")).exists()).toBe(true);
  } finally { temp.cleanup(); }
});
