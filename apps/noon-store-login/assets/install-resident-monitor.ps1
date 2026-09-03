$ErrorActionPreference = 'Stop'

$taskName = 'NoonStoreSessionMonitor'
$exePath = Join-Path $PSScriptRoot 'Noon店铺会话监控.exe'
$trayLauncher = Join-Path $PSScriptRoot 'noon-tray.vbs'
if (-not (Test-Path -LiteralPath $exePath)) {
  throw "未找到监控程序：$exePath"
}
if (-not (Test-Path -LiteralPath $trayLauncher)) { throw "未找到托盘启动器：$trayLauncher" }

$arguments = '--resident --store all --site UAE --page dashboard --interval-minutes 30'
$userId = "$env:USERDOMAIN\$env:USERNAME"
$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder = $service.GetFolder('\')
$task = $service.NewTask(0)
$task.RegistrationInfo.Description = 'Keeps six Noon Chrome profile sessions active and checks them every 30 minutes.'
$task.Principal.UserId = $userId
$task.Principal.LogonType = 3
$task.Principal.RunLevel = 0
$task.Settings.Enabled = $true
$task.Settings.StartWhenAvailable = $true
$task.Settings.DisallowStartIfOnBatteries = $false
$task.Settings.StopIfGoingOnBatteries = $false
$task.Settings.ExecutionTimeLimit = 'PT0S'
$task.Settings.RestartCount = 999
$task.Settings.RestartInterval = 'PT1M'
$task.Settings.MultipleInstances = 2

$logonTrigger = $task.Triggers.Create(9)
$logonTrigger.UserId = $userId
$unlockTrigger = $task.Triggers.Create(11)
$unlockTrigger.UserId = $userId
$unlockTrigger.StateChange = 8

$action = $task.Actions.Create(0)
$action.Path = Join-Path $env:WINDIR 'System32\wscript.exe'
$action.Arguments = "`"$trayLauncher`""
$action.WorkingDirectory = $PSScriptRoot

$registered = $folder.RegisterTaskDefinition($taskName, $task, 6, $userId, $null, 3)
$registered.Run($null) | Out-Null
Write-Host "已安装并启动 Noon 六店会话常驻监控。"
