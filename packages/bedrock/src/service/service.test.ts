import { expect, test } from "bun:test";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { tempDirectory } from "../../test/helpers";
import { service, serviceFile, restartService } from "./index";

for (const platform of ["darwin", "linux"]) test(`service ${platform}: absolute paths, escaping, dry run, install/status/uninstall`, async () => {
  const temp = tempDirectory();
  const commands: string[][] = [];
  const options = { home: join(temp.dir, "home & space"), target: join(temp.dir, "units/bedrock"), platform,
    bun: "/absolute/bun", cli: "/absolute/cli file.ts", uid: 501, run: async (args: string[]) => { commands.push(args); } };
  try {
    const file = serviceFile(options);
    expect(file.content).toContain(platform === "darwin" ? "home &amp; space" : "BEDROCK_HOME=");
    expect(file.content).toContain("/absolute/bun");
    expect(file.content).toContain(platform === "darwin" ? "RunAtLoad" : "Restart=always");
    await service("install", options, true);
    expect(commands).toHaveLength(0);
    expect(await Bun.file(options.target).exists()).toBe(false);
    await service("install", options);
    expect(await Bun.file(options.target).text()).toBe(file.content);
    if (process.platform !== "win32") expect((await stat(options.target)).mode & 0o777).toBe(0o600);
    expect(await service("status", options)).toMatchObject({ installed: true, running: true });
    await service("install", options);
    expect(await restartService(options)).toEqual({ restarted: true });
    expect(commands.at(-1)).toEqual(platform === "darwin" ? ["launchctl", "kickstart", "-k", "gui/501/dev.bedrock.daemon"] : ["systemctl", "--user", "restart", "bedrock.service"]);
    await service("uninstall", options);
    expect(await restartService(options)).toEqual({ restarted: false });
    const count = commands.length;
    await service("uninstall", options);
    expect(commands).toHaveLength(count);
    expect(await Bun.file(options.target).exists()).toBe(false);
    expect(commands.some(args => args[0] === (platform === "darwin" ? "launchctl" : "systemctl"))).toBe(true);
  } finally {
    try { await service("uninstall", options); } finally { temp.cleanup(); }
  }
});

test("service validates paths and escapes systemd specifiers", () => {
  expect(() => serviceFile({ home: "relative", platform: "linux" })).toThrow();
  expect(() => serviceFile({ home: "/tmp/home", platform: "freebsd" })).toThrow();
  const file = serviceFile({ home: "/tmp/100%", platform: "linux", cli: "/tmp/$CLI.ts" });
  expect(file.content).toContain("100%%");
  expect(file.content).toContain("$$CLI");
});

for (const platform of ["darwin", "linux"]) test(`service ${platform} pins the currently running Bun without consulting PATH`, () => {
  const file = serviceFile({ home: "/tmp/bedrock-test", platform });
  expect(file.content).toContain(platform === "linux" ? process.execPath.replaceAll("\\", "\\\\") : process.execPath);
  expect(file.content).not.toContain(platform === "darwin" ? "<string>bun</string>" : "ExecStart=bun ");
});
