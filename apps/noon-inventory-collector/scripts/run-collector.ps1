param(
    [string]$AppRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$NodePath = $env:NOON_NODE_PATH,
    [string]$LogRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($LogRoot)) {
    $localBase = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $PWD.Path } else { $env:LOCALAPPDATA }
    $LogRoot = Join-Path $localBase "NoonInventoryCollector\process-logs"
}

if ([string]::IsNullOrWhiteSpace($env:WECOM_WEBHOOK_URL)) {
    $userWebhook = [Environment]::GetEnvironmentVariable("WECOM_WEBHOOK_URL", "User")
    if (-not [string]::IsNullOrWhiteSpace($userWebhook)) {
        $env:WECOM_WEBHOOK_URL = $userWebhook
    }
    Remove-Variable userWebhook -ErrorAction SilentlyContinue
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $NodePath = "C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Node executable was not found. Set NOON_NODE_PATH to a stable node.exe path."
}

$cliPath = Join-Path $AppRoot "dist\src\cli.js"
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    throw "Compiled collector was not found at $cliPath. Run npm.cmd run build first."
}

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $LogRoot "collector-$timestamp.log"

& $NodePath $cliPath run *>&1 | ForEach-Object {
    $_ | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    $_
}
$nodeExitCode = $LASTEXITCODE
exit $nodeExitCode
