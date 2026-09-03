[CmdletBinding(SupportsShouldProcess)]
param([string]$AppRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $AppRoot '..\..'))
$runtimeRoot = Join-Path $projectRoot 'runtime\NoonAdDayparting'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 45) `
    -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$evaluateSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

$evaluateAction = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AppRoot\scripts\run.ps1`" -Mode evaluate -RuntimeRoot `"$runtimeRoot`"" -WorkingDirectory $AppRoot
$evaluateTrigger = New-ScheduledTaskTrigger -Daily -At '10:25'
$evaluateTask = New-ScheduledTask -Action $evaluateAction -Trigger $evaluateTrigger -Settings $evaluateSettings -Principal $principal -Description 'Daily Noon UAE daypart plan rebuild after the 08:35 saleable FBN inventory collection.'

$applyAction = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AppRoot\scripts\run.ps1`" -Mode apply -RuntimeRoot `"$runtimeRoot`"" -WorkingDirectory $AppRoot
$applyTriggers = @('03:00','04:00','08:00','12:00','23:00') | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
$applyTask = New-ScheduledTask -Action $applyAction -Trigger $applyTriggers -Settings $settings -Principal $principal -Description 'Noon UAE daypart bid application. China times map to UAE 23:00, 00:00, 04:00, 08:00 and 19:00.'

$collectAction = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AppRoot\scripts\run.ps1`" -Mode collect -RuntimeRoot `"$runtimeRoot`"" -WorkingDirectory $AppRoot
$collectStart = (Get-Date).Date.AddMinutes(10)
$collectTrigger = New-ScheduledTaskTrigger -Once -At $collectStart -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$collectTask = New-ScheduledTask -Action $collectAction -Trigger $collectTrigger -Settings $settings -Principal $principal -Description 'Hourly UAE six-store cumulative advertising snapshots for daypart delta analysis.'
if ($PSCmdlet.ShouldProcess('Noon daypart and hourly report tasks', 'Register scheduled tasks')) {
    Register-ScheduledTask -TaskName 'NoonAdDaypartEvaluation' -InputObject $evaluateTask -Force | Out-Null
    Register-ScheduledTask -TaskName 'NoonAdDaypartApply' -InputObject $applyTask -Force | Out-Null
    Register-ScheduledTask -TaskName 'NoonAdHourlyCollector' -InputObject $collectTask -Force | Out-Null
}
