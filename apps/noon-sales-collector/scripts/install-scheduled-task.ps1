[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    [string]$TaskName = "NoonSalesReportCollector",
    [ValidatePattern("^(?:[01]\d|2[0-3]):[0-5]\d$")]
    [string]$StartTime = "09:20",
    [switch]$Preview
)

$ErrorActionPreference = "Stop"
$wrapperPath = Join-Path $PSScriptRoot "run-collector.ps1"
$taskDescription = "Collect UAE and KSA Noon sales reports, build summaries, sync to OneDrive, and notify WeCom."
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$configuration = [ordered]@{
    taskName = $TaskName
    startTime = $StartTime
    schedule = "Weekly:Monday-Friday"
    multipleInstances = "IgnoreNew"
    startWhenAvailable = $true
    executionTimeLimit = "PT2H"
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
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) {
    throw "System Windows PowerShell was not found at $powerShellPath"
}
$escapedWrapper = $wrapperPath.Replace('"', '""')
$action = New-ScheduledTaskAction `
    -Execute $powerShellPath `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$escapedWrapper`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $StartTime
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal `
    -UserId $userId `
    -LogonType Interactive `
    -RunLevel Limited

if ($PSCmdlet.ShouldProcess($TaskName, "Register weekday task at $StartTime for $userId")) {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Description $taskDescription `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Force | Out-Null
    Write-Host "Scheduled task '$TaskName' installed for Monday-Friday at $StartTime."
    Write-Warning "The task uses Interactive logon and requires the user to remain signed in. Lock screen is allowed."
}
