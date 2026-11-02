import { expect, test } from "bun:test";
import { join } from "node:path";

const command = ["systemd-run", "--user", "--scope", "-q", "-p", "Delegate=yes", process.execPath, join(import.meta.dir, "hibernate-kernel.ts")];
const supported = process.platform === "linux" && Bun.spawnSync([...command, "--probe"], { stdout: "ignore", stderr: "ignore", timeout: 10000 }).exitCode === 0;

test.skipIf(!supported)("quiet pebble hibernates in a delegated scope while jobs run, with responsive daemon", async () => {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`Kernel hibernation test failed (${code}):\n${stdout}\n${stderr}`);
  const result = stdout.split("\n").find(line => line.startsWith("HIBERNATE_RESULT "));
  expect(result).toBeDefined();
  console.log(result);
}, 95000);
