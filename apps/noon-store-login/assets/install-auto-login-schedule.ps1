$ErrorActionPreference = 'Stop'
$taskName = 'NoonStoreAutoLogin'
$launcher = Join-Path $PSScriptRoot 'Noon六店自动登录.exe'
if (-not (Test-Path -LiteralPath $launcher)) {
  throw 'Noon六店自动登录.exe is missing from the release directory.'
}

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $launcher -WorkingDirectory $PSScriptRoot
$triggers = @(
  New-ScheduledTaskTrigger -Daily -At '09:40'
  New-ScheduledTaskTrigger -Daily -At '14:00'
)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Automatically verify and sign in all six Noon stores at 09:40 and 14:00 daily.' -Force | Out-Null
Write-Host 'Noon six-store automatic login schedule installed: 09:40 and 14:00 daily.'
