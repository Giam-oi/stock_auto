param(
    [ValidateSet('evaluate', 'apply', 'collect', 'probe', 'pilot')][string]$Mode = 'apply',
    [switch]$DryRun,
    [string]$AppRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$RuntimeRoot
)
$ErrorActionPreference = 'Stop'
$bootstrapLog = Join-Path $AppRoot 'task-bootstrap-errors.log'
$mutexName = if ($Mode -eq 'evaluate') { 'Local\NoonAdEvaluation' } else { 'Local\NoonAdAutomation' }
$mutex = [System.Threading.Mutex]::new($false, $mutexName)
$hasMutex = $false
$scriptExitCode = 1
try {
    try { $hasMutex = $mutex.WaitOne([TimeSpan]::FromMinutes(20)) }
    catch [System.Threading.AbandonedMutexException] { $hasMutex = $true }
    if (-not $hasMutex) { throw 'Timed out waiting for another Noon advertising task to finish.' }
    $localAppData = if ($RuntimeRoot) { Split-Path -Parent $RuntimeRoot } elseif ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
    if (-not $localAppData) { throw 'LOCALAPPDATA is unavailable in the task session.' }
    $env:LOCALAPPDATA = $localAppData
    $localRoot = if ($RuntimeRoot) { $RuntimeRoot } else { Join-Path $localAppData 'NoonAdDayparting' }
    $env:NOON_DAYPART_ROOT = $localRoot
    $logRoot = Join-Path $localRoot 'process-logs'
    New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
    $env:WECOM_WEBHOOK_URL = if ($env:WECOM_WEBHOOK_URL) { $env:WECOM_WEBHOOK_URL } else { [Environment]::GetEnvironmentVariable('WECOM_WEBHOOK_URL', 'User') }
    $node = if ($env:NOON_NODE_PATH) { $env:NOON_NODE_PATH } else { 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
    if (-not (Test-Path -LiteralPath $node)) { throw "Node runtime not found: $node" }
    $arguments = @((Join-Path $AppRoot 'src\cli.mjs'), $Mode)
    if ($DryRun) { $arguments += '--dry-run' }
    $log = Join-Path $logRoot ("{0}-{1}.log" -f $Mode, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    & $node @arguments *>&1 | Tee-Object -FilePath $log
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) { throw 'Node process did not return an exit code.' }
    $scriptExitCode = $exitCode
} catch {
    $planExists = if ($localRoot) { Test-Path -LiteralPath (Join-Path $localRoot 'plan.json') } else { $false }
    $message = "{0:o} root={1} planExists={2} user={3} error={4}" -f (Get-Date), $localRoot, $planExists, [System.Security.Principal.WindowsIdentity]::GetCurrent().Name, $_.Exception.Message
    Add-Content -LiteralPath $bootstrapLog -Value $message -Encoding UTF8
    Write-Error $message
    $scriptExitCode = 1
} finally {
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
exit $scriptExitCode
