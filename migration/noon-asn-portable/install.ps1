param(
    [string]$ProjectRoot = (Join-Path $env:USERPROFILE 'Documents\CodexProjects\stock_auto'),
    [string]$ProgramRoot = (Join-Path $env:USERPROFILE 'NoonASNCreator'),
    [string]$SkillRoot = (Join-Path $env:USERPROFILE '.codex\skills'),
    [string]$ConfigRoot = (Join-Path $env:USERPROFILE '.noon-asn'),
    [string]$CredentialDirectory = (Join-Path $env:USERPROFILE '.noon-api'),
    [string]$GreenChannelWorkbook = (Join-Path $env:USERPROFILE 'Documents\绿通申请表模板.xlsx'),
    [switch]$InstallSourceDependencies,
    [switch]$SkipUserEnvironment
)

$ErrorActionPreference = 'Stop'
$bundleRoot = Split-Path -Parent $PSCommandPath
$skillSource = Join-Path $bundleRoot 'skill\noon-asn-operations'
$programSource = Join-Path $bundleRoot 'program\NoonASNCreator'
$projectSource = Join-Path $bundleRoot 'project\stock_auto'
$skillDestination = Join-Path $SkillRoot 'noon-asn-operations'
$configPath = Join-Path $ConfigRoot 'config.json'

foreach ($required in @($skillSource, $programSource, $projectSource)) {
    if (-not (Test-Path -LiteralPath $required -PathType Container)) {
        throw "迁移包不完整，缺少目录：$required"
    }
}

function Backup-ExistingDirectory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "{0}.previous-{1}" -f $Path, $stamp
    Move-Item -LiteralPath $Path -Destination $backup
    Write-Host "已备份旧目录：$backup"
}

New-Item -ItemType Directory -Force -Path $SkillRoot | Out-Null
Backup-ExistingDirectory $skillDestination
Copy-Item -LiteralPath $skillSource -Destination $skillDestination -Recurse

$programParent = Split-Path -Parent $ProgramRoot
New-Item -ItemType Directory -Force -Path $programParent | Out-Null
Backup-ExistingDirectory $ProgramRoot
Copy-Item -LiteralPath $programSource -Destination $ProgramRoot -Recurse

$projectParent = Split-Path -Parent $ProjectRoot
New-Item -ItemType Directory -Force -Path $projectParent | Out-Null
Backup-ExistingDirectory $ProjectRoot
Copy-Item -LiteralPath $projectSource -Destination $ProjectRoot -Recurse

New-Item -ItemType Directory -Force -Path $CredentialDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $ConfigRoot | Out-Null
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    $config = [ordered]@{
        credentialDirectory = $CredentialDirectory
        asnProgramPath = (Join-Path $ProgramRoot 'NoonASNCreator.exe')
        greenChannelWorkbook = $GreenChannelWorkbook
        wecomWebhookEnvironmentVariable = 'NOON_ASN_WECOM_WEBHOOK_URL'
        asnWriteback = [ordered]@{ sheet = '约仓'; cell = 'C2' }
        defaults = [ordered]@{
            AE = [ordered]@{ warehouseCode = 'AUH01S'; country = 'AE' }
            SA = [ordered]@{ warehouseCode = 'RUH01S'; country = 'SA' }
        }
    }
    $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
    Write-Host "已创建本机配置：$configPath"
} else {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ([string]$config.wecomWebhookEnvironmentVariable -eq 'NOON_WECOM_WEBHOOK') {
        $config.wecomWebhookEnvironmentVariable = 'NOON_ASN_WECOM_WEBHOOK_URL'
        $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
        Write-Host "已升级本机配置中的企微环境变量名：$configPath"
    } else {
        Write-Host "保留已有本机配置：$configPath"
    }
}

if (-not $SkipUserEnvironment) {
    [Environment]::SetEnvironmentVariable('NOON_CREDENTIAL_DIR', $CredentialDirectory, 'User')
    $env:NOON_CREDENTIAL_DIR = $CredentialDirectory
    Write-Host "已设置凭证目录环境变量：NOON_CREDENTIAL_DIR=$CredentialDirectory"
}

if ($InstallSourceDependencies) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) { throw '未找到 npm；EXE 可直接使用，但源码依赖无法自动安装。' }
    & $npm.Source ci --prefix (Join-Path $ProjectRoot 'apps\noon-asn-creator')
}

Write-Host ''
Write-Host '安装完成。下一步：'
Write-Host "1. 将六份 Noon 凭证安全放入：$CredentialDirectory"
Write-Host "2. 将绿通表安全放到：$GreenChannelWorkbook"
Write-Host '3. 单独设置用户环境变量 NOON_ASN_WECOM_WEBHOOK_URL。'
Write-Host '4. 运行技能 preflight.ps1，然后重启 Codex。'
Write-Host "5. 在 Codex 中打开项目：$ProjectRoot"

$preflight = Join-Path $skillDestination 'scripts\preflight.ps1'
& powershell.exe -ExecutionPolicy Bypass -File $preflight -ConfigPath $configPath
if ($LASTEXITCODE -ne 0) {
    Write-Warning '预检仍有缺失项；按上方提示放置敏感文件后再次运行预检。'
}
