$ErrorActionPreference = 'Stop'
$taskName = 'NoonStoreSessionMonitor'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$lockPath = Join-Path $env:LOCALAPPDATA 'NoonStoreLogin\resident.lock\owner.json'
$trayOwnerPath = Join-Path $env:LOCALAPPDATA 'NoonStoreLogin\tray-owner.json'
if (Test-Path -LiteralPath $lockPath) {
  try {
    $owner = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
    Stop-Process -Id ([int]$owner.pid) -ErrorAction SilentlyContinue
  } catch {}
}
if (Test-Path -LiteralPath $trayOwnerPath) {
  try {
    $owner = Get-Content -Raw -LiteralPath $trayOwnerPath | ConvertFrom-Json
    Stop-Process -Id ([int]$owner.pid) -ErrorAction SilentlyContinue
  } catch {}
}
Write-Host "已卸载 Noon 六店会话常驻监控计划任务。"
