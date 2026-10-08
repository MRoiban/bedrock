import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { requireUpdateService, restartHelperCommand, scheduleUpdateRestart } from "./update-restart";

for (const platform of ["darwin", "linux", "win32"]) {
  test(`restart helper on ${platform} is delayed and launched independently`, async () => {
    const temp = tempDirectory();
    const options = { home: temp.dir, platform, target: join(temp.dir, "service"), uid: 123 };
    try {
      await expect(requireUpdateService(options)).rejects.toMatchObject({ code: "SERVICE_REQUIRED" });
      await Bun.write(options.target, "service");
      expect((await requireUpdateService(options)).path).toBe(options.target);
      const args = restartHelperCommand(options);
      const calls: string[][] = [];
      await scheduleUpdateRestart(options, async command => { calls.push(command); });
      expect(calls).toEqual([args]);
      if (platform === "win32") {
        expect(args[0]).toBe("powershell.exe");
        const launch = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
        expect(launch).toContain("Invoke-CimMethod -ClassName Win32_Process");
        const encoded = /Hidden -EncodedCommand ([A-Za-z0-9+/=]+)/.exec(launch)![1]!;
        const script = Buffer.from(encoded, "base64").toString("utf16le");
        expect(script).toContain("Start-Sleep -Seconds 2");
        expect(script).toContain("taskkill.exe");
        expect(script).toContain("$task.Run($null)");
      } else {
        expect(args[0]).toBe(process.execPath);
        expect(args.at(-1)).toContain("Bun.sleep(2000)");
        expect(args.at(-1)).toContain(platform === "darwin" ? "gui/123/dev.bedrock.daemon" : "systemctl");
      }
    } finally { temp.cleanup(); }
  });
}
