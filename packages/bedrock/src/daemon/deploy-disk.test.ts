import { test, expect, spyOn } from "bun:test";
import * as disk from "../disk";
import { diskFull } from "../error";
import { Releases } from "./releases";
import { openDaemonDatabase } from "./db";
import { Supervisor } from "./supervisor";
import { tempDirectory } from "../../test/helpers";

test("deploy rejects insufficient space before reading the upload", async () => {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(temp.dir);
  const releases = new Releases(temp.dir, db, new Supervisor(temp.dir, db, "test-secret"));
  const check = spyOn(disk, "requireSpace").mockRejectedValue(diskFull(temp.dir));
  let consumed = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { consumed = true; controller.close(); } }, { highWaterMark: 0 });
  try {
    await expect(releases.deploy("notes", new Request("http://localhost", { method: "POST", body, headers: { "content-length": "1000000" } }))).rejects.toMatchObject({ code: "DISK_FULL" });
    expect(consumed).toBe(false);
    expect(check).toHaveBeenCalledWith(temp.dir, 1000000);
  } finally { check.mockRestore(); db.close(); temp.cleanup(); }
});

test("archive command disk exhaustion names its target filesystem", async () => {
  const { run } = await import("./archive");
  const temp = tempDirectory();
  try {
    for (const message of ["No space left on device", "Disk quota exceeded"]) {
      await expect(run([process.execPath, "-e", `console.error(${JSON.stringify(message)}); process.exit(1)`], temp.dir)).rejects.toMatchObject({ code: "DISK_FULL", message: expect.stringContaining(temp.dir) });
    }
  } finally { temp.cleanup(); }
});
