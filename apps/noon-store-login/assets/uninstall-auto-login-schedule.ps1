$ErrorActionPreference = 'Stop'
$taskName = 'NoonStoreAutoLogin'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Write-Host 'Noon six-store automatic login schedule removed.'
