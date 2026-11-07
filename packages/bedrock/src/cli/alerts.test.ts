import { expect, test } from "bun:test";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { setup } from "../daemon/config";
import { tempDirectory } from "../../test/helpers";
import { validateAlerts } from "../daemon/alerts/config";
test("alerts setup accepts secret stdin, defaults to comms, never echoes it and supports JSON help", async () => {
  const temp = tempDirectory();
  await setup(temp.dir, "example.test", undefined, 0);
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts"), "alerts", "setup", "--json"], { env: { ...process.env, BEDROCK_HOME: temp.dir }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write("a-dedicated-test-token\n"); child.stdin.end();
    const output = await new Response(child.stdout).text();
    expect({ code: await child.exited, output, stderr: await new Response(child.stderr).text() }).toMatchObject({ code: 0 });
    expect(output).not.toContain("a-dedicated-test-token");
    expect(JSON.parse(output).webhook).toBe("https://comms.example.test/api/v1/messages");
    expect((await stat(join(temp.dir, "alerts-secret"))).mode & 0o777).toBe(0o600);
    const help = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts"), "alerts", "--help", "--json"], { env: { ...process.env, BEDROCK_HOME: temp.dir }, stdout: "pipe", stderr: "pipe" });
    expect(JSON.parse(await new Response(help.stdout).text()).usage).toContain("silence"); expect(await help.exited).toBe(0);
  } finally { temp.cleanup(); }
});
test("webhook configuration rejects credential URLs, insecure remote HTTP and malformed critical jobs", () => {
  for (const webhook of ["https://user:password@notify.test/messages", "http://notify.test/messages", "https://notify.test/messages?token=secret", "file:///tmp/messages"]) expect(() => validateAlerts({ webhook })).toThrow();
  expect(() => validateAlerts({ webhook: "http://127.0.0.1:1234/messages", criticalJobs: { notes: ["sync"] } })).not.toThrow();
});
