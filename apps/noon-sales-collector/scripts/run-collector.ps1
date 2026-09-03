param(
    [string]$AppRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$NodePath = $env:NOON_NODE_PATH,
    [string]$ArtifactNodeModules = $env:NOON_ARTIFACT_TOOL_NODE_MODULES,
    [ValidateSet("ALL", "UAE", "KSA")]
    [string]$Site = "ALL",
    [string]$From = "",
    [string]$To = "",
    [string]$OutputRoot = "",
    [string]$KsaOneDriveRoot = "",
    [string]$UaeOneDriveRoot = "",
    [switch]$NoOneDrive,
    [switch]$NoWeCom,
    [string]$LogRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:WECOM_WEBHOOK_URL)) {
    $userWebhook = [Environment]::GetEnvironmentVariable("WECOM_WEBHOOK_URL", "User")
    if (-not [string]::IsNullOrWhiteSpace($userWebhook)) {
        $env:WECOM_WEBHOOK_URL = $userWebhook
    }
    Remove-Variable userWebhook -ErrorAction SilentlyContinue
}

if ([string]::IsNullOrWhiteSpace($LogRoot)) {
    $localBase = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $PWD.Path } else { $env:LOCALAPPDATA }
    $LogRoot = Join-Path $localBase "NoonSalesCollector\process-logs"
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $NodePath = "C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}
if ([string]::IsNullOrWhiteSpace($ArtifactNodeModules)) {
    $ArtifactNodeModules = "C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
}

$artifactTarget = Join-Path $ArtifactNodeModules "@oai\artifact-tool"
if (-not (Test-Path -LiteralPath $artifactTarget -PathType Container)) {
    throw "Artifact runtime was not found. Set NOON_ARTIFACT_TOOL_NODE_MODULES to the bundled node_modules path."
}
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Node executable was not found. Set NOON_NODE_PATH to node.exe."
}

$scopeDirectory = Join-Path $AppRoot "node_modules\@oai"
$artifactLink = Join-Path $scopeDirectory "artifact-tool"
New-Item -ItemType Directory -Force -Path $scopeDirectory | Out-Null
if (-not (Test-Path -LiteralPath $artifactLink)) {
    New-Item -ItemType Junction -Path $artifactLink -Target $artifactTarget | Out-Null
}

$cliPath = Join-Path $AppRoot "dist\src\cli.js"
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    throw "Compiled sales collector was not found. Run pnpm.cmd run build first."
}

$collectorArguments = @("run", "--site", $Site)
if (-not [string]::IsNullOrWhiteSpace($From)) {
    $collectorArguments += @("--from", $From)
}
if (-not [string]::IsNullOrWhiteSpace($To)) {
    $collectorArguments += @("--to", $To)
}
if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) {
    $collectorArguments += @("--output-root", $OutputRoot)
}
if (-not [string]::IsNullOrWhiteSpace($KsaOneDriveRoot)) {
    $collectorArguments += @("--ksa-onedrive-root", $KsaOneDriveRoot)
}
if (-not [string]::IsNullOrWhiteSpace($UaeOneDriveRoot)) {
    $collectorArguments += @("--uae-onedrive-root", $UaeOneDriveRoot)
}
if ($NoOneDrive) {
    $collectorArguments += @("--no-onedrive", "true")
}
if ($NoWeCom) {
    $collectorArguments += @("--no-wecom", "true")
}

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $LogRoot "sales-$timestamp.log"

$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$ErrorActionPreference = "Continue"
& $NodePath $cliPath @collectorArguments *>&1 | ForEach-Object {
    $_ | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    $_
}
$nodeExitCode = $LASTEXITCODE
exit $nodeExitCode
