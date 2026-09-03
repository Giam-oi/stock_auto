param(
    [string]$CollectorTaskName = 'NoonAdvertisingReportCollector',
    [string]$StateRoot = $(if ($env:NOON_AD_STATE_ROOT) { $env:NOON_AD_STATE_ROOT } else { Join-Path $env:LOCALAPPDATA 'NoonAdCollector' }),
    [switch]$NoWeCom
)

$ErrorActionPreference = 'Stop'

function Get-PeriodLabel([string]$SiteCode) {
    $today = (Get-Date).Date
    $endDay = if ($SiteCode -eq 'UAE') { [DayOfWeek]::Wednesday } else { [DayOfWeek]::Thursday }
    $daysSinceEnd = (([int]$today.DayOfWeek - [int]$endDay + 7) % 7)
    $end = $today.AddDays(-$daysSinceEnd)
    if ($end -ge $today) { $end = $end.AddDays(-7) }
    $start = $end.AddDays(-6)
    '{0}-{1}' -f $start.ToString('yyyy.MM.dd'), $end.ToString('MM.dd')
}

function Send-FailureOnce([string]$Key, [string]$Message) {
    if ($NoWeCom) { return }
    $path = Join-Path $StateRoot 'monitor-delivery.json'
    $delivered = @()
    if (Test-Path -LiteralPath $path) { $delivered = @((Get-Content -Raw -LiteralPath $path | ConvertFrom-Json).delivered) }
    if (@($delivered | Where-Object { $_.key -eq $Key }).Count -gt 0) { return }
    $webhook = $env:WECOM_WEBHOOK_URL
    if ([string]::IsNullOrWhiteSpace($webhook)) { $webhook = [Environment]::GetEnvironmentVariable('WECOM_WEBHOOK_URL', 'User') }
    if ([string]::IsNullOrWhiteSpace($webhook)) { throw 'WECOM_WEBHOOK_URL is not configured' }
    $uri = [Uri]$webhook
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'qyapi.weixin.qq.com' -or $uri.AbsolutePath -ne '/cgi-bin/webhook/send') { throw 'WECOM_WEBHOOK_URL is invalid' }
    $payload = @{ msgtype = 'text'; text = @{ content = $Message } } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Method Post -Uri $webhook -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    if ($response.errcode -ne 0) { throw "WeCom returned error code $($response.errcode)" }
    $delivered += [pscustomobject]@{ key = $Key; deliveredAt = (Get-Date).ToString('o') }
    New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
    @{ delivered = $delivered } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding UTF8
}

$today = (Get-Date).Date
$periods = @{ UAE = Get-PeriodLabel 'UAE'; KSA = Get-PeriodLabel 'KSA' }
$resultPath = Join-Path $StateRoot 'last-result.json'
$failures = New-Object System.Collections.Generic.List[string]

$task = Get-ScheduledTask -TaskName $CollectorTaskName -ErrorAction SilentlyContinue
if (-not $task) {
    $failures.Add("计划任务 $CollectorTaskName 不存在")
} else {
    $info = Get-ScheduledTaskInfo -TaskName $CollectorTaskName
    if ($info.LastRunTime.Date -ne $today) { $failures.Add('09:20 主任务今天尚未运行') }
    elseif ($info.LastTaskResult -ne 0) { $failures.Add("09:20 主任务退出码为 $($info.LastTaskResult)") }
    if ($task.Settings.MultipleInstances -ne 'IgnoreNew') { $failures.Add('计划任务并发策略不是 IgnoreNew') }
    if (-not $task.Settings.StartWhenAvailable) { $failures.Add('计划任务未启用 StartWhenAvailable') }
    if ([string]$task.Settings.ExecutionTimeLimit -ne 'PT2H') { $failures.Add('计划任务执行上限不是 PT2H') }
}

if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
    $failures.Add('缺少机器可读结果文件')
} else {
    try {
        $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
        if (-not $result.ok) { $failures.Add("主任务结果失败：$($result.error)") }
        foreach ($siteCode in @('UAE', 'KSA')) {
            $siteResult = @($result.sites | Where-Object { $_.site -eq $siteCode })
            if ($siteResult.Count -ne 1) { $failures.Add("结果缺少 $siteCode 站点") }
            elseif ([string]$siteResult[0].period -ne $periods[$siteCode]) {
                $failures.Add("$siteCode 结果周期不是最新完整周期 $($periods[$siteCode])")
            }
        }
        if (([DateTime]$result.completedAt).Date -ne $today) { $failures.Add('结果文件不是今天生成') }
    } catch {
        $failures.Add('机器可读结果文件无效')
    }
}

$monitorResult = [pscustomobject]@{
    ok = $failures.Count -eq 0; checkedAt = (Get-Date).ToString('o'); periods = $periods; failures = @($failures)
}
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$monitorResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $StateRoot 'last-monitor-result.json') -Encoding UTF8
if ($failures.Count -gt 0) {
    $message = "Noon 广告自动化监控失败`n日期：$($today.ToString('yyyy-MM-dd'))`n" + ($failures -join "`n")
    Send-FailureOnce "$($today.ToString('yyyy-MM-dd')):monitor" $message
    throw ($failures -join '; ')
}
$monitorResult | ConvertTo-Json -Compress
