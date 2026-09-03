[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    [string]$TaskName = "NoonFinanceReportCollector",
    [ValidatePattern("^(?:[01]\d|2[0-3]):[0-5]\d$")][string]$StartTime = "15:00",
    [switch]$Preview
)

$ErrorActionPreference = "Stop"
$wrapperPath = Join-Path $PSScriptRoot "run-collector.ps1"
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$configuration = [ordered]@{
    taskName = $TaskName
    schedule = "Monthly:Day24"
    startTime = $StartTime
    multipleInstances = "IgnoreNew"
    startWhenAvailable = $true
    executionTimeLimit = "PT2H"
    actionScript = $wrapperPath
    logonType = "Interactive"
    runOnlyWhenUserLoggedOn = $true
    userId = $userId
}
if ($Preview) { $configuration | ConvertTo-Json -Compress; exit 0 }

$startBoundary = "{0}-{1}-24T{2}:00{3}" -f (Get-Date).Year, (Get-Date).Month.ToString("00"), $StartTime, (Get-Date -Format "zzz")
$escapedPath = [Security.SecurityElement]::Escape($wrapperPath)
$escapedUser = [Security.SecurityElement]::Escape($userId)
$months = 1..12 | ForEach-Object { "<$(Get-Culture).DateTimeFormat.GetMonthName($_)>" }
$monthNames = @("January","February","March","April","May","June","July","August","September","October","November","December")
$monthXml = ($monthNames | ForEach-Object { "<$_ />" }) -join ""
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Download Noon UAE/KSA finance reports for six stores and publish them to OneDrive.</Description></RegistrationInfo>
  <Triggers><CalendarTrigger><StartBoundary>$startBoundary</StartBoundary><Enabled>true</Enabled><ScheduleByMonth><DaysOfMonth><Day>24</Day></DaysOfMonth><Months>$monthXml</Months></ScheduleByMonth></CalendarTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$escapedUser</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><ExecutionTimeLimit>PT2H</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>-NoProfile -ExecutionPolicy Bypass -File &quot;$escapedPath&quot;</Arguments></Exec></Actions>
</Task>
"@
if ($PSCmdlet.ShouldProcess($TaskName, "Register monthly task on day 24 at $StartTime")) {
    Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
    Write-Host "Scheduled task '$TaskName' installed for day 24 of every month at $StartTime."
}
