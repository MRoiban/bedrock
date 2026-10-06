import { tmpdir } from "node:os";
import { BedrockError } from "../src/error";

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";

// Do not rely on the launcher PID file: a failed test may already have deleted it.
export function windowsTestCleanupScript(path?: string) {
  return `
$ErrorActionPreference = 'Stop'
$tempRoot = [IO.Path]::GetFullPath(${quote(tmpdir())}).TrimEnd('\\') + '\\'
$onlyPath = ${path ? quote(path) : "$null"}
function Get-TemporaryLauncher($action) {
  if ($action.Type -ne 0) { return $null }
  if ([IO.Path]::GetFileName($action.Path) -ine 'powershell.exe') { return $null }
  if ($action.Arguments -notmatch '(?i)(?:^|\\s)-File\\s+"([^"\\r\\n]+)"\\s*$') { return $null }
  $launcher = $Matches[1]
  if (-not [IO.Path]::IsPathRooted($launcher)) { return $null }
  $launcher = [IO.Path]::GetFullPath($launcher)
  if (-not $launcher.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  if ($onlyPath -and $launcher -ine [IO.Path]::GetFullPath($onlyPath)) { return $null }
  return $launcher
}
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$folder = $scheduler.GetFolder('\\')
$failures = @()
foreach ($task in @($folder.GetTasks(0))) {
  if ($task.Name -notlike 'Bedrock-*') { continue }
  $paths = @()
  foreach ($action in $task.Definition.Actions) {
    $launcher = Get-TemporaryLauncher $action
    if (-not $launcher) { $paths = @(); break }
    $paths += $launcher
  }
  if ($paths.Count -eq 0) { continue }
  # Disable restart/logon triggers before reaping the launcher and its descendants.
  try { $task.Enabled = $false } catch { $failures += $_ }
  try {
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'")) {
      if ($process.CommandLine -match '(?i)(?:^|\\s)-File\\s+"([^"\\r\\n]+)"\\s*$' -and $paths -icontains $Matches[1]) {
        & taskkill.exe /PID $process.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) {
          throw 'Could not kill temporary Bedrock process tree.'
        }
      }
    }
  } catch { $failures += $_ }
  finally {
    try { $task.Stop(0) } catch { $failures += $_ }
    try { $folder.DeleteTask($task.Name, 0) } catch { $failures += $_ }
  }
}
if ($failures.Count) { throw ($failures | Out-String) }
`;
}

export function powershellCommand(script: string) {
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

export function cleanupWindowsTestServices(path?: string) {
  if (process.platform !== "win32") return;
  const result = Bun.spawnSync(powershellCommand(windowsTestCleanupScript(path)), { stdout: "pipe", stderr: "pipe", timeout: 20000 });
  if (result.exitCode !== 0) throw new BedrockError("TEST_SERVICE_CLEANUP_FAILED", result.stderr.toString() || "Scheduled Task cleanup failed.", "Inspect temporary Bedrock-* tasks in Task Scheduler before rerunning tests.");
}

export async function watchWindowsTestService(path: string) {
  // This process survives Bun timeouts and exits, including cases where hooks cannot run.
  const script = `
$owner = Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue
$started = if ($owner) { $owner.StartTime } else { $null }
$deadline = [DateTime]::UtcNow.AddSeconds(45)
[Console]::Out.WriteLine('ready')
while ([DateTime]::UtcNow -lt $deadline) {
  $owner = Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue
  if (-not $owner -or $owner.StartTime -ne $started) { break }
  Start-Sleep -Milliseconds 200
}
${windowsTestCleanupScript(path)}
`;
  const child = Bun.spawn(powershellCommand(script), { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  const first = await reader.read();
  reader.releaseLock();
  if (first.done || !new TextDecoder().decode(first.value).includes("ready")) {
    child.kill();
    throw new BedrockError("TEST_SERVICE_WATCHDOG_FAILED", "Service cleanup watchdog did not start.", "Check PowerShell before enabling real service tests.");
  }
  return child;
}
