import { test, expect } from "bun:test";
import { join } from "node:path";
import { init } from "./init";
import { tempDirectory } from "../../test/helpers";

test("init writes a runnable scaffold, repeats safely, and never overwrites existing work", async () => {
  const temp = tempDirectory();
  try {
    expect((await init("hello", temp.dir)).created).toBe(true);
    expect((await init("hello", temp.dir)).created).toBe(false);
    expect(await Bun.file(join(temp.dir, "hello/web/index.html")).exists()).toBe(true);
    expect(await Bun.file(join(temp.dir, "hello/AGENTS.md")).text()).toContain("pebble.ts");
    await Bun.write(join(temp.dir, "hello/pebble.ts"), "// edited by the user");
    await expect(init("hello", temp.dir)).rejects.toMatchObject({ code: "DIRECTORY_EXISTS" });
    expect(await Bun.file(join(temp.dir, "hello/pebble.ts")).text()).toBe("// edited by the user");
    await expect(init("../oops", temp.dir)).rejects.toMatchObject({ code: "INVALID_PEBBLE_NAME" });
  } finally { temp.cleanup(); }
});
