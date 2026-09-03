[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$TaskName = 'NoonAdvertisingReportCollector',
    [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')]
    [string]$StartTime = '09:20',
    [switch]$Preview
)

$ErrorActionPreference = 'Stop'
$wrapper = Join-Path $PSScriptRoot 'run-collector.ps1'
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$configuration = [ordered]@{
    taskName = $TaskName; startTime = $StartTime; schedule = 'Daily'; multipleInstances = 'IgnoreNew'
    startWhenAvailable = $true; executionTimeLimit = 'PT2H'; actionScript = $wrapper
    logonType = 'Interactive'; runOnlyWhenUserLoggedOn = $true; userId = $userId
}
if ($Preview) { $configuration | ConvertTo-Json -Compress; exit 0 }

$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`""
$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
if ($PSCmdlet.ShouldProcess($TaskName, "Register daily advertising task at $StartTime")) {
    Register-ScheduledTask -TaskName $TaskName -Description 'Download the latest completed UAE and KSA Noon advertising weeks, back up and update the formal workbook, and notify WeCom.' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "Scheduled task '$TaskName' installed for daily $StartTime."
}
