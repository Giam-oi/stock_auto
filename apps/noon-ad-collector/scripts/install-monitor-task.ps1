[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$TaskName = 'NoonAdvertisingReportMonitor',
    [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')]
    [string]$StartTime = '10:15',
    [switch]$Preview
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'monitor.ps1'
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$configuration = [ordered]@{
    taskName = $TaskName; startTime = $StartTime; schedule = 'Daily'; multipleInstances = 'IgnoreNew'
    startWhenAvailable = $true; executionTimeLimit = 'PT15M'; actionScript = $script
    logonType = 'Interactive'; runOnlyWhenUserLoggedOn = $true; userId = $userId
}
if ($Preview) { $configuration | ConvertTo-Json -Compress; exit 0 }

$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
if ($PSCmdlet.ShouldProcess($TaskName, "Register daily advertising monitor at $StartTime")) {
    Register-ScheduledTask -TaskName $TaskName -Description 'Verify the daily Noon UAE advertising collector task and machine-readable result; notify WeCom on failure.' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "Scheduled task '$TaskName' installed for daily $StartTime."
}
