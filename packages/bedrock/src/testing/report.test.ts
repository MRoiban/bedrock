import { expect, test } from "bun:test";
import { browserChecks, unitChecks } from "./report";

test("reports retain a first failure even when the diagnostic retry passes", () => {
  const checks = browserChecks({ specs: [{ title: "save", file: "save.spec.ts", line: 3, tests: [{ projectName: "phone", status: "flaky", results: [
    { status: "failed", duration: 12, errors: ["first failure"], attachments: [{ name: "trace", path: "/trace.zip" }] },
    { status: "passed", duration: 7, attachments: [] },
  ] }] }] });
  expect(checks[0]).toMatchObject({ status: "flaky", attempts: 2, durationMs: 19, artifacts: ["/trace.zip"] });
});

test("unit report handles passed, failed and skipped JUnit cases", () => {
  expect(unitChecks('<testsuite><testcase name="a &amp; b" time="0.5"/><testcase name="bad"><failure>no</failure></testcase><testcase name="later"><skipped /></testcase></testsuite>').map(check => [check.id, check.status, check.durationMs])).toEqual([
    ["unit:a & b", "passed", 500], ["unit:bad", "failed", 0], ["unit:later", "skipped", 0],
  ]);
});
