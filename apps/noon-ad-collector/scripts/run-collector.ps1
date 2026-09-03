param(
    [string]$AppRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$LogRoot = $(if ($env:NOON_AD_LOG_ROOT) { $env:NOON_AD_LOG_ROOT } else { Join-Path $env:LOCALAPPDATA 'NoonAdCollector\process-logs' })
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$logPath = Join-Path $LogRoot ('ads-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

& (Join-Path $PSScriptRoot 'update-workbook.ps1') -AppRoot $AppRoot *>&1 | ForEach-Object {
    $_ | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    $_
}
exit $LASTEXITCODE
