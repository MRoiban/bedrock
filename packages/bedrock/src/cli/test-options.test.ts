import { expect, test } from "bun:test";
import { parse } from "./args";
import { testOptions } from "./test-options";

const options = (...args: string[]) => testOptions(parse(["test"], args));

test("test options preserve defaults, selectors and browser controls", () => {
  expect(options()).toEqual({ path: "", grep: "", project: "", headed: false, list: false, repeat: 1, diagnosticRetry: false, updateSnapshots: false });
  expect(options("--grep=save", "--project", "phone", "--repeat=100", "--headed", "--list", "--diagnostic-retry", "--update-snapshots", "--yes", "--", "-notes")).toEqual({
    path: "-notes", grep: "save", project: "phone", repeat: 100, headed: true, list: true, diagnosticRetry: true, updateSnapshots: true,
  });
});

test("test options name invalid selectors and retain snapshot confirmation", () => {
  expect(() => options("--update-snapshots")).toThrow(expect.objectContaining({ code: "CONFIRM_REQUIRED" }));
  for (const value of ["0", "101", "1.5", "oops"]) {
    expect(() => options("--repeat", value)).toThrow(`Invalid value '${value}' for --repeat; use an integer from 1 to 100.`);
  }
  expect(() => options("--grep", "[")).toThrow("Invalid regular expression '[' for --grep.");
  expect(() => options("--project", "webkit")).toThrow("Invalid value 'webkit' for --project; choose desktop, phone.");
  expect(() => options("--wat")).toThrow("Unknown option --wat for bedrock test.");
  expect(() => options("--repeat", "1", "--repeat=2")).toThrow("Repeated option --repeat");
});
