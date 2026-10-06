param([switch]$InstallBun)
$ErrorActionPreference = 'Stop'
$checkout = $PSScriptRoot
$bunInstall = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { Join-Path $env:USERPROFILE '.bun' }
$bin = Join-Path $bunInstall 'bin'
$env:PATH = "$bin;$env:PATH"
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    if (-not $InstallBun) { throw 'Install Bun >= 1.2 from https://bun.sh, or rerun install.ps1 -InstallBun.' }
    Invoke-Expression (Invoke-RestMethod 'https://bun.sh/install.ps1')
}
$bun = (Get-Command bun -ErrorAction Stop).Source
$version = (& $bun --version).Trim().Split('.')
if ([int]$version[0] -lt 1 -or ([int]$version[0] -eq 1 -and [int]$version[1] -lt 2)) { throw 'Bun >= 1.2 is required.' }
Push-Location $checkout
try {
    & $bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'bun install failed.' }
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $cli = Join-Path $checkout 'packages\bedrock\src\cli\index.ts'
    # Bun's executable shim works in PowerShell and CMD without changing execution policy.
    Push-Location (Join-Path $checkout 'packages\bedrock')
    try { & $bun link; if ($LASTEXITCODE -ne 0) { throw 'bun link failed.' } } finally { Pop-Location }
    & $bun $cli --version
    if ($LASTEXITCODE -ne 0) { throw 'Bedrock verification failed.' }
} finally { Pop-Location }
Write-Output "Next: bedrock setup"
Write-Output "Ensure $bin is on PATH in your next terminal."
