import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { service, serviceFile, restartService } from "./index";
import { windowsServiceCommand } from "./windows";

const script = (args: string[]) => Buffer.from(args.at(-1)!, "base64").toString("utf16le");
test("Windows task installs, reports state, restarts and uninstalls without a shell interpolation boundary", async () => {
  const temp = tempDirectory();
  const calls: string[] = [];
  const options = { home: join(temp.dir, "home & O'Brien"), platform: "win32", run: async (args: string[]) => { calls.push(script(args)); return "4\n"; } };
  try {
    const file = serviceFile(options);
    expect(file.content).toContain("O''Brien");
    expect(file.content).toContain(process.execPath.replaceAll("'", "''"));
    await service("install", options, true);
    expect(calls).toHaveLength(0);
    expect(await Bun.file(file.path).exists()).toBe(false);
    await service("install", options);
    expect(calls[0]).toContain("InteractiveToken");
    expect(calls[0]).toContain("LeastPrivilege");
    expect(calls[0]).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(calls[0]).toContain("RestartOnFailure");
    expect(calls[0]).toContain("-WindowStyle Hidden");
    expect(await service("status", options)).toMatchObject({ installed: true, running: true });
    expect(await restartService(options)).toEqual({ restarted: true });
    expect(calls.at(-1)).toContain("$task.Stop(0)");
    await service("uninstall", options);
    expect(calls.at(-1)).toContain("DeleteTask");
    expect(await Bun.file(file.path).exists()).toBe(false);
    expect(await restartService(options)).toEqual({ restarted: false });
    expect(await service("status", { ...options, run: async () => "0" })).toMatchObject({ installed: false, running: false });
  } finally {
    try { await service("uninstall", options); } finally { temp.cleanup(); }
  }
});

test("Windows task script escapes XML and PowerShell metacharacters", () => {
  const command = script(windowsServiceCommand("install", "C:\\O'Brien & sons\\daemon.ps1", "C:\\O'Brien & sons"));
  expect(command).toContain("O&apos;Brien &amp; sons");
  expect(command).toContain("&quot;");
});
