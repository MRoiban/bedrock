import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { win32 } from "node:path";
import { powershellCommand, windowsTestCleanupScript } from "./service-cleanup";

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";

// Exercise the actual teardown against fake tasks, without registering any services.
test.skipIf(process.platform !== "win32")("Windows teardown removes only temporary Bedrock tasks and unregisters after a stop failure", () => {
  const inside = win32.join(tmpdir(), "bedrock-test-fake", "service & café", "bedrock.ps1");
  const outside = win32.join(tmpdir() + "-outside", "bedrock.ps1");
  const traversal = win32.join(tmpdir(), "..", "bedrock.ps1");
  const setup = `
$script:deleted = @()
$script:killed = @()
function New-Task($name, $paths) {
  $actions = @($paths | ForEach-Object { [pscustomobject]@{ Type = 0; Path = 'powershell.exe'; Arguments = ('-NoProfile -File "' + $_ + '"') } })
  $task = [pscustomobject]@{ Name = $name; Enabled = $true; Definition = [pscustomobject]@{ Actions = $actions } }
  $task | Add-Member ScriptMethod Stop { param($flags) throw 'simulated stop failure' }
  return $task
}
$tasks = @(
  (New-Task 'Bedrock-temp' @(${quote(inside)})),
  (New-Task 'Bedrock-real' @(${quote(outside)})),
  (New-Task 'Bedrock-traversal' @(${quote(traversal)})),
  (New-Task 'Other-temp' @(${quote(inside)})),
  (New-Task 'Bedrock-mixed' @(${quote(inside)}, ${quote(outside)}))
)
$folder = [pscustomobject]@{}
$folder | Add-Member ScriptMethod GetTasks { param($flags) return $tasks }
$folder | Add-Member ScriptMethod DeleteTask { param($name, $flags) $script:deleted += $name }
function Get-CimInstance { return [pscustomobject]@{ ProcessId = 123; CommandLine = ('powershell.exe -File "' + ${quote(inside)} + '"') } }
function taskkill.exe { $script:killed += ($args -join ' '); $global:LASTEXITCODE = 0 }
`;
  const connect = "$scheduler = New-Object -ComObject Schedule.Service\n$scheduler.Connect()\n$folder = $scheduler.GetFolder('\\')";
  const script = setup + "\ntry {\n" + windowsTestCleanupScript().replace(connect, "") + `
} catch { if ($_ -notmatch 'simulated stop failure') { throw } }
[pscustomobject]@{ deleted = @($script:deleted); killed = @($script:killed); enabled = @($tasks | ForEach-Object { $_.Enabled }) } | ConvertTo-Json -Compress
`;
  const result = Bun.spawnSync(powershellCommand(script), { stdout: "pipe", stderr: "pipe", timeout: 10000 });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual({ deleted: ["Bedrock-temp"], killed: ["/PID 123 /T /F"], enabled: [false, true, true, true, true] });
});
