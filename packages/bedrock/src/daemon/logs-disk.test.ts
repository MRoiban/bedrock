import { expect, spyOn, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { tempDirectory } from "../../test/helpers";
import { PebbleLogs } from "./logs";

test("full log filesystem drops without throwing, warns once and resumes after a minute", async () => {
  const temp = tempDirectory();
  const notice = spyOn(console, "error").mockImplementation(() => {});
  let now = 0, full = true, attempts = 0;
  const append = ((...args: Parameters<typeof appendFileSync>) => {
    attempts++;
    if (full) throw Object.assign(new Error("full"), { code: "ENOSPC" });
    appendFileSync(...args);
  }) as typeof appendFileSync;
  const logs = new PebbleLogs(temp.dir, "test", 1024, undefined, "pebble.log", false, append, () => now);
  const write = () => logs.write(new TextEncoder().encode("hello\n"));
  try {
    write(); write();
    expect(attempts).toBe(1);
    now = 60000; write();
    expect(notice).toHaveBeenCalledTimes(1);
    full = false; now = 120000; write();
    expect(logs.tail()).toBe("hello\n");
    expect(attempts).toBe(3);
  } finally { notice.mockRestore(); logs.close(); temp.cleanup(); }
});
