import { expect, test } from "bun:test";
import { parseCron } from "./cron";
import { createJobs, job } from "./index";

const date = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute);

test("cron numbers, wildcards, lists, ranges, steps, Sunday alias and day OR semantics", () => {
  expect(parseCron("*/15 2-4 1,6 10 2")(date(6, 3, 30))).toBe(true);
  expect(parseCron("*/15 2-4 * 10 2")(date(6, 3, 31))).toBe(false);
  expect(parseCron("5/20 * * * *")(date(6, 0, 45))).toBe(true);
  expect(parseCron("0 0 * * 7")(date(4, 0, 0))).toBe(true);
  expect(parseCron("0 0 1 * 2")(date(6, 0, 0))).toBe(true);
  expect(parseCron("0 0 1 * 2")(date(1, 0, 0))).toBe(true);
  expect(parseCron("0 0 * * 2")(date(1, 0, 0))).toBe(false);
  expect(parseCron("0 0 31 2 *")(new Date(2026, 1, 28))).toBe(false);
  for (const invalid of ["", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "*/0 * * * *", "9-2 * * * *", "1,,2 * * * *", "-1 * * * *", "* * * * MON", "1/1/2 * * * *", "1.5 * * * *"]) {
    expect(() => parseCron(invalid)).toThrow(expect.objectContaining({ code: "INVALID_CRON" }));
  }
});

test("jobs use injected local clock, skip overlapping runs and do not replay a minute", async () => {
  let now = date(6, 3, 0);
  let release!: () => void;
  let count = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const jobs = createJobs({ prune: job("0 3 * * *", () => {}) }, async () => { count++; await gate; }, () => now);
  jobs.tick(); jobs.tick();
  await Promise.resolve();
  expect(count).toBe(1);
  expect(await jobs.run("prune")).toEqual({ name: "prune", skipped: true });
  now = date(7, 3, 0); jobs.tick();
  expect(count).toBe(1);
  release(); await Bun.sleep(0);
  expect(await jobs.run("prune")).toEqual({ name: "prune", skipped: false });
  expect(count).toBe(2);
  await jobs.stop();
});

test("throwing jobs log their name and can run again", async () => {
  const errors: string[] = [];
  const jobs = createJobs({ broken: job("* * * * *", () => {}) }, async () => { throw new Error("broken"); }, () => new Date(), name => { errors.push(name); });
  await expect(jobs.run("missing")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  await expect(jobs.run("broken")).rejects.toThrow("broken");
  await expect(jobs.run("broken")).rejects.toThrow("broken");
  expect(errors).toEqual(["broken", "broken"]);
  await jobs.stop();
});
