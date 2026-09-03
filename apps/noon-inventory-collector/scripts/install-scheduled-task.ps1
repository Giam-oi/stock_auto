[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    [string]$TaskName = "NoonRealtimeInventoryCollector",
    [ValidatePattern("^(?:[01]\d|2[0-3]):[0-5]\d$")]
    [string]$StartTime = "08:00",
    [switch]$Preview
)

$ErrorActionPreference = "Stop"
$wrapperPath = Join-Path $PSScriptRoot "run-collector.ps1"
$taskDescription = "Collect all six Noon UAE and KSA real-time inventory exports."
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$configuration = [ordered]@{
    taskName = $TaskName
    startTime = $StartTime
    schedule = "Daily"
    multipleInstances = "IgnoreNew"
    startWhenAvailable = $true
    actionScript = $wrapperPath
    logonType = "Interactive"
    runOnlyWhenUserLoggedOn = $true
    userId = $userId
}

if ($Preview) {
    $configuration | ConvertTo-Json -Compress
    exit 0
}

Import-Module ScheduledTasks -ErrorAction Stop
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    Write-Host "Existing task '$TaskName':"
    $existing.Actions | Format-Table Execute, Arguments -AutoSize
    $existing.Triggers | Format-Table StartBoundary, Enabled -AutoSize
}

$powerShellPath = Join-Path $PSHOME "powershell.exe"
$escapedWrapper = $wrapperPath.Replace('"', '""')
$action = New-ScheduledTaskAction `
    -Execute $powerShellPath `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$escapedWrapper`""
$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal `
    -UserId $userId `
    -LogonType Interactive `
    -RunLevel Limited

if ($PSCmdlet.ShouldProcess($TaskName, "Register daily task at $StartTime for $userId")) {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Description $taskDescription `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Force | Out-Null
    Write-Host "Scheduled task '$TaskName' installed for daily $StartTime."
    Write-Warning "The task uses Interactive logon and runs only while $userId is logged on."
}
