[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CollectorArguments)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $env:LOCALAPPDATA "NoonFinanceCollector\process-logs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot ("finance-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$node = (Get-Command node.exe -ErrorAction Stop).Source

Push-Location $appRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot "dist\src\cli.js"))) {
        & npm.cmd run build *>&1 | Tee-Object -FilePath $logPath -Append
        if ($LASTEXITCODE -ne 0) { throw "Finance collector build failed with exit code $LASTEXITCODE" }
    }
    & $node (Join-Path $appRoot "dist\src\cli.js") run @CollectorArguments *>&1 | Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) { throw "Finance collector failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
