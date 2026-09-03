param(
    [string]$OutputRoot = 'D:\Codex输出',
    [string]$PackageName = 'Noon-ASN-Codex完整迁移包-20260902',
    [switch]$SkipExeBuild
)

$ErrorActionPreference = 'Stop'
$templateRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $templateRoot '..\..'))
$skillSource = Join-Path $env:USERPROFILE '.codex\skills\noon-asn-operations'
$appSource = Join-Path $workspaceRoot 'apps\noon-asn-creator'
$releaseSource = Join-Path $appSource 'release\NoonASNCreator'
$outputFull = [IO.Path]::GetFullPath($OutputRoot)
$stageFull = [IO.Path]::GetFullPath((Join-Path $outputFull $PackageName))
$zipFull = [IO.Path]::GetFullPath((Join-Path $outputFull ($PackageName + '.zip')))
$prefix = $outputFull.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $stageFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw '暂存目录不在指定输出目录内。' }
if (-not $zipFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP 路径不在指定输出目录内。' }

foreach ($required in @($skillSource, $appSource)) {
    if (-not (Test-Path -LiteralPath $required -PathType Container)) { throw "缺少源目录：$required" }
}

if (-not $SkipExeBuild) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) { throw '未找到 npm，无法构建最新 EXE。' }
    & $npm.Source test --prefix $appSource
    & $npm.Source run typecheck --prefix $appSource
    & $npm.Source run package:win --prefix $appSource
}
if (-not (Test-Path -LiteralPath (Join-Path $releaseSource 'NoonASNCreator.exe') -PathType Leaf)) { throw '缺少 NoonASNCreator.exe。' }

New-Item -ItemType Directory -Force -Path $outputFull | Out-Null
if (Test-Path -LiteralPath $stageFull) { Remove-Item -LiteralPath $stageFull -Recurse -Force }
if (Test-Path -LiteralPath $zipFull) { Remove-Item -LiteralPath $zipFull -Force }

New-Item -ItemType Directory -Force -Path $stageFull | Out-Null
Copy-Item -LiteralPath (Join-Path $templateRoot 'install.ps1') -Destination $stageFull
Copy-Item -LiteralPath (Join-Path $templateRoot 'verify-package.ps1') -Destination $stageFull
Copy-Item -LiteralPath (Join-Path $templateRoot '开始使用.txt') -Destination $stageFull
Copy-Item -LiteralPath (Join-Path $templateRoot 'docs') -Destination (Join-Path $stageFull 'docs') -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $stageFull 'skill'), (Join-Path $stageFull 'program'), (Join-Path $stageFull 'project') | Out-Null
Copy-Item -LiteralPath $skillSource -Destination (Join-Path $stageFull 'skill\noon-asn-operations') -Recurse
Copy-Item -LiteralPath $releaseSource -Destination (Join-Path $stageFull 'program\NoonASNCreator') -Recurse

$projectDestination = Join-Path $stageFull 'project\stock_auto'
$appDestination = Join-Path $projectDestination 'apps\noon-asn-creator'
New-Item -ItemType Directory -Force -Path $appDestination | Out-Null
& robocopy.exe $appSource $appDestination /E /XD node_modules release /XF '.tmp-*' /NFL /NDL /NJH /NJS /NP | Out-Null
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -gt 7) { throw "复制源码失败，robocopy=$robocopyExit" }
Copy-Item -LiteralPath (Join-Path $templateRoot 'project-AGENTS.md') -Destination (Join-Path $projectDestination 'AGENTS.md')
Copy-Item -LiteralPath (Join-Path $workspaceRoot '.gitignore') -Destination $projectDestination
New-Item -ItemType Directory -Force -Path (Join-Path $projectDestination 'migration') | Out-Null
Copy-Item -LiteralPath $templateRoot -Destination (Join-Path $projectDestination 'migration\noon-asn-portable') -Recurse

$designDestination = Join-Path $projectDestination 'docs\design'
New-Item -ItemType Directory -Force -Path $designDestination | Out-Null
foreach ($relative in @(
    'docs\superpowers\plans\2026-08-11-noon-asn-creator.md',
    'docs\superpowers\specs\2026-08-11-noon-asn-creator-design.md',
    'docs\superpowers\specs\2026-08-12-noon-asn-codex-skill-design.md'
)) {
    $source = Join-Path $workspaceRoot $relative
    if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination $designDestination }
}

$git = Get-Command git -ErrorAction SilentlyContinue
$branch = if ($git) { (& $git.Source -C $workspaceRoot branch --show-current).Trim() } else { '' }
$commit = if ($git) { (& $git.Source -C $workspaceRoot rev-parse HEAD).Trim() } else { '' }
$info = [ordered]@{
    packageName = $PackageName
    packageVersion = 2
    builtAt = (Get-Date).ToString('o')
    sourceBranch = $branch
    sourceCommit = $commit
    containsUncommittedSource = $true
    secretsIncluded = $false
}
$info | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stageFull 'PACKAGE_INFO.json') -Encoding UTF8

& (Join-Path $stageFull 'verify-package.ps1') -Root $stageFull
$manifest = foreach ($file in Get-ChildItem -LiteralPath $stageFull -Recurse -File | Sort-Object FullName) {
    $relative = $file.FullName.Substring($stageFull.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $relative"
}
$manifest | Set-Content -LiteralPath (Join-Path $stageFull 'MANIFEST.sha256') -Encoding UTF8
Compress-Archive -Path (Join-Path $stageFull '*') -DestinationPath $zipFull -CompressionLevel Optimal
Write-Host $zipFull
