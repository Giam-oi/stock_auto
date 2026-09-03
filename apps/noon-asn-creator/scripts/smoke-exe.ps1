param([string]$ExePath)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$exe = if ($ExePath) { [System.IO.Path]::GetFullPath($ExePath) } else { Join-Path $root "release\NoonASNCreator\NoonASNCreator.exe" }
if (-not (Test-Path -LiteralPath $exe)) { throw "Packaged EXE is missing" }

$tempRoot = Join-Path $env:TEMP ("NoonASNCreatorSmoke-" + [guid]::NewGuid().ToString("N"))
$inputFolder = Join-Path $tempRoot "input-files"
$credentialFolder = Join-Path $tempRoot "credentials"
New-Item -ItemType Directory -Path $inputFolder, $credentialFolder | Out-Null
node (Join-Path $PSScriptRoot "create-smoke-fixture.mjs") $inputFolder
1..6 | ForEach-Object { New-Item -ItemType File -Path (Join-Path $credentialFolder "noon$_-API.json") | Out-Null }
$workbook = (Get-ChildItem -LiteralPath $inputFolder -File -Filter *.xlsx | Select-Object -First 1 -ExpandProperty FullName)
if (-not $workbook) { throw "Smoke workbook was not created" }
$beforeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $workbook).Hash
$automationChromeBefore = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'NoonASNCreator[\\/]browser-profile' } |
  Select-Object -ExpandProperty ProcessId)

$savedPath = $env:PATH
$savedCredentials = $env:NOON_CREDENTIAL_DIR
try {
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
  $env:NOON_CREDENTIAL_DIR = $credentialFolder
  $savedErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $exe --folder $inputFolder --non-interactive --offline-smoke-test 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedErrorAction
  }
} finally {
  $env:PATH = $savedPath
  $env:NOON_CREDENTIAL_DIR = $savedCredentials
}

if ($exitCode -ne 0) { throw "EXE smoke test failed with exit code $exitCode`n$output" }
if (($output -join "`n") -notmatch "skipped_existing") { throw "EXE did not report the completed workbook as skipped" }
$afterHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $workbook).Hash
if ($beforeHash -ne $afterHash) { throw "EXE changed the completed workbook" }
$automationChromeAfter = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'NoonASNCreator[\\/]browser-profile' } |
  Select-Object -ExpandProperty ProcessId)
$newAutomationChrome = @($automationChromeAfter | Where-Object { $_ -notin $automationChromeBefore })
if ($newAutomationChrome.Count -ne 0) { throw "EXE started its automation Chrome for a completed workbook" }
Write-Output "NoonASNCreator.exe smoke test passed"
