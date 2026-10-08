import { spawn } from "node:child_process";
import { serviceFile, type ServiceOptions } from "./index";
import { windowsServiceCommand } from "./windows";
import { BedrockError } from "../error";
import { updateRun } from "../self-update";

export async function requireUpdateService(options: ServiceOptions) {
  const file = serviceFile(options);
  if (!await Bun.file(file.path).exists()) throw new BedrockError("SERVICE_REQUIRED", "Remote self-update requires an installed daemon service.", "Run bedrock service install on the server first.");
  return file;
}
export function restartHelperCommand(options: ServiceOptions) {
  const file = serviceFile(options);
  if (file.platform === "win32") {
    const restart = windowsServiceCommand("restart", file.path, options.home);
    const script = "Start-Sleep -Seconds 2\n" + Buffer.from(restart.at(-1)!, "base64").toString("utf16le");
    const command = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
    // CIM creates a process outside the Scheduled Task's tree: taskkill /T must not kill this helper.
    const launch = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${command}'}; if ($r.ReturnValue -ne 0) { throw 'Could not launch restart helper' }`;
    return ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(launch, "utf16le").toString("base64")];
  }
  const command = file.platform === "darwin" ? ["launchctl", "kickstart", "-k", `gui/${options.uid ?? process.getuid?.() ?? 0}/dev.bedrock.daemon`] : ["systemctl", "--user", "restart", "bedrock.service"];
  return [options.bun ?? process.execPath, "-e", `await Bun.sleep(2000); const p = Bun.spawn(${JSON.stringify(command)}, {stdin:'ignore',stdout:'ignore',stderr:'ignore'}); process.exit(await p.exited);`];
}
export async function scheduleUpdateRestart(options: ServiceOptions, launch = async (args: string[]) => {
  if ((options.platform ?? process.platform) === "win32") { await updateRun(args); return; }
  const child = spawn(args[0]!, args.slice(1), { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
}) {
  await launch(restartHelperCommand(options));
}
