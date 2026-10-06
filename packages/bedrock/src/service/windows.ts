import { dirname, join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { atomicWrite } from "../daemon/config";
import type { ServiceOptions } from "./index";

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const xml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

export function windowsServiceFile(options: ServiceOptions, bun: string, cli: string) {
  const path = options.target ?? join(options.home, "service", "bedrock.ps1");
  return { path, platform: "win32", content: `\ufeff$ErrorActionPreference = 'Stop'\n$env:BEDROCK_HOME = ${quote(options.home)}\n[IO.File]::WriteAllText(${quote(path + ".pid")}, [string]$PID)\n& ${quote(bun)} ${quote(cli)} daemon\nexit $LASTEXITCODE\n` };
}

export function windowsServiceCommand(action: string, path: string, home: string) {
  const taskName = "Bedrock-" + new Bun.CryptoHasher("sha256").update(`${process.env.USERNAME ?? "bedrock"}:${home.toLowerCase()}`).digest("hex").slice(0, 12);
  const connect = `$scheduler = New-Object -ComObject Schedule.Service\n$scheduler.Connect()\n$folder = $scheduler.GetFolder('\\')\n`;
  const find = `$task = $null\ntry { $task = $folder.GetTask(${quote(taskName)}) } catch { if ($_.Exception.HResult -ne -2147024894) { throw } }\n`;
  // Task Scheduler stops the action, but its Bun descendants need explicit reaping.
  const stop = `if ($task -and $task.State -eq 4) {\n  for ($i = 0; $i -lt 40 -and -not (Test-Path -LiteralPath ${quote(path + ".pid")}); $i++) { Start-Sleep -Milliseconds 50 }\n  if (Test-Path -LiteralPath ${quote(path + ".pid")}) {\n    $launcherId = [int]([IO.File]::ReadAllText(${quote(path + ".pid")}))\n    $launcher = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $launcherId)\n    if ($launcher -and $launcher.Name -eq 'powershell.exe' -and $launcher.CommandLine.Contains(${quote(path)})) {\n      & taskkill.exe /PID $launcherId /T /F | Out-Null\n      if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $launcherId -ErrorAction SilentlyContinue)) { throw 'Could not stop Bedrock process tree.' }\n    }\n  }\n  $task.Stop(0)\n  Start-Sleep -Milliseconds 500\n}\nRemove-Item -LiteralPath ${quote(path + ".pid")} -Force -ErrorAction SilentlyContinue\n`;
  let operation: string;
  if (action === "install") {
    const definition = `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers><Principals><Principal id="User"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure></Settings><Actions Context="User"><Exec><Command>powershell.exe</Command><Arguments>${xml(`-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${path}"`)}</Arguments><WorkingDirectory>${xml(home)}</WorkingDirectory></Exec></Actions></Task>`;
    operation = `${stop}$definition = $scheduler.NewTask(0)\n$definition.XmlText = ${quote(definition)}\n$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n$definition.Principal.UserId = $sid\n$definition.Triggers.Item(1).UserId = $sid\n$task = $folder.RegisterTaskDefinition(${quote(taskName)}, $definition, 6, $null, $null, 3)\n$null = $task.Run($null)`;
  } else if (action === "status") operation = `if ($task) { Write-Output $task.State } else { Write-Output 0 }`;
  else if (action === "uninstall") operation = `${stop}if ($task) { $folder.DeleteTask(${quote(taskName)}, 0) }`;
  else operation = `${stop}if ($task) { $null = $task.Run($null) }`;
  const script = `$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n${connect}${find}${operation}\nexit 0`;
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

export async function windowsService(action: string, file: ReturnType<typeof windowsServiceFile>, home: string, run: (args: string[]) => Promise<void | string>, dryRun = false) {
  const hint = "The Windows Scheduled Task runs at login while your user is logged in.";
  if (dryRun) return { action, dryRun: true, ...file, hint };
  if (action === "status") {
    const state = String(await run(windowsServiceCommand(action, file.path, home))).trim();
    return { installed: state !== "0", running: state === "4", path: file.path, hint };
  }
  if (action === "install") {
    await mkdir(dirname(file.path), { recursive: true });
    await atomicWrite(file.path, file.content);
  }
  await run(windowsServiceCommand(action, file.path, home));
  if (action === "uninstall") await rm(file.path, { force: true });
  return { action, installed: action === "install", path: file.path, hint };
}
