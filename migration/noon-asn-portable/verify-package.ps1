param([string]$Root = (Split-Path -Parent $PSCommandPath))

$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath $rootPath -PathType Container)) { throw "目录不存在：$rootPath" }

$required = @(
    '开始使用.txt',
    'install.ps1',
    'docs\新电脑复用说明.md',
    'docs\对话交接.md',
    'skill\noon-asn-operations\SKILL.md',
    'skill\noon-asn-operations\references\api-operations.md',
    'program\NoonASNCreator\NoonASNCreator.exe',
    'project\stock_auto\apps\noon-asn-creator\package.json',
    'project\stock_auto\apps\noon-asn-creator\dist\src\noon\auth.js'
)
foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $rootPath $relative) -PathType Leaf)) { throw "缺少必要文件：$relative" }
}

$forbiddenNames = @('journal.json', 'cookies.json', 'storage-state.json')
$forbiddenExtensions = @('.xlsx', '.xlsm', '.xls', '.csv', '.pdf', '.mp4', '.jsonl', '.har', '.sqlite', '.db')
$violations = New-Object System.Collections.Generic.List[string]
$files = Get-ChildItem -LiteralPath $rootPath -Recurse -File
foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($rootPath.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
    if ($file.Name -match '^noon[1-6]-API\.json$') { $violations.Add("凭证文件：$($file.FullName)") }
    if ($forbiddenNames -contains $file.Name) { $violations.Add("运行状态文件：$($file.FullName)") }
    if ($forbiddenExtensions -contains $file.Extension.ToLowerInvariant()) { $violations.Add("业务或媒体文件：$($file.FullName)") }
    if ($file.FullName -match '[\\/](node_modules|\.git|logs?|browser-profile)[\\/]') { $violations.Add("不应打包的目录：$($file.FullName)") }
    if ($relativePath -match '(^|[\\/])\.tmp[^\\/]*([\\/]|$)') { $violations.Add("临时目录：$relativePath") }

    if ($file.Length -le 5MB -and $file.Extension.ToLowerInvariant() -in @('.md','.txt','.ps1','.json','.ts','.js','.mjs','.yaml','.yml','.toml')) {
        $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
        if ($text -match '-----BEGIN (?:RSA )?PRIVATE KEY-----\s*[A-Za-z0-9+/=]{40,}') { $violations.Add("疑似私钥：$($file.FullName)") }
        if ($text -match 'qyapi\.weixin\.qq\.com/cgi-bin/webhook/send\?key=[0-9a-fA-F-]{20,}') { $violations.Add("疑似企微密钥：$($file.FullName)") }
        if ($text -match 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}') { $violations.Add("疑似 JWT：$($file.FullName)") }
    }
}

if ($violations.Count) { throw ("安全检查失败：`n" + ($violations -join "`n")) }
Write-Host "安全检查通过：$($files.Count) 个文件，未发现凭证、业务表、日志或真实 Webhook。"
