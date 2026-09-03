param(
    [string]$AppRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$NodePath = $env:NOON_NODE_PATH,
    [string]$CredentialDir = $(if ($env:NOON_CREDENTIAL_DIR) { $env:NOON_CREDENTIAL_DIR } else { 'D:\noon-api' }),
    [string]$WorkbookPath = $(if ($env:NOON_AD_WORKBOOK_PATH) { $env:NOON_AD_WORKBOOK_PATH } else { 'C:\Users\admin\OneDrive - AXIS PROFESSIONALS LTD\A202 中东Noon运营 - 文档\2.0 中东\1.1 Noon\1.3 运营日常资料\Noon 广告跟进.xlsx' }),
    [string]$BackupDirectory = $env:NOON_AD_BACKUP_DIRECTORY,
    [string]$ReportRoot = $(if ($env:NOON_AD_REPORT_ROOT) { $env:NOON_AD_REPORT_ROOT } else { Join-Path $env:LOCALAPPDATA 'NoonAdCollector\reports' }),
    [string]$StateRoot = $(if ($env:NOON_AD_STATE_ROOT) { $env:NOON_AD_STATE_ROOT } else { Join-Path $env:LOCALAPPDATA 'NoonAdCollector' }),
    [ValidateSet('ALL', 'UAE', 'KSA')]
    [string]$Site = 'ALL',
    [string]$From = '',
    [string]$To = '',
    [switch]$NoWeCom
)

$ErrorActionPreference = 'Stop'
$storeIds = @('42958', '55651', '61683', '65553', '75299', '363826')
$expectedHeaders = @('Campaign Name', 'Views', 'Clicks', 'Orders', 'ATC', 'Spends', 'Revenue', 'CTR', 'ROAS', 'CPC', 'CPS', 'CVR')
$statePath = Join-Path $StateRoot 'state.json'
$resultPath = Join-Path $StateRoot 'last-result.json'

function Release-ComObject([object]$Object) {
    if ($null -eq $Object) { return }
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($Object) } catch {}
}

function Get-DefaultRange([string]$SiteCode) {
    $today = (Get-Date).Date
    $endDay = if ($SiteCode -eq 'UAE') { [DayOfWeek]::Wednesday } else { [DayOfWeek]::Thursday }
    $daysSinceEnd = (([int]$today.DayOfWeek - [int]$endDay + 7) % 7)
    $end = $today.AddDays(-$daysSinceEnd)
    if ($end -ge $today) { $end = $end.AddDays(-7) }
    [pscustomobject]@{ From = $end.AddDays(-6).ToString('yyyy-MM-dd'); To = $end.ToString('yyyy-MM-dd') }
}

function Assert-SiteRange([string]$SiteCode, [DateTime]$FromValue, [DateTime]$ToValue) {
    $startDay = if ($SiteCode -eq 'UAE') { [DayOfWeek]::Thursday } else { [DayOfWeek]::Friday }
    $endDay = if ($SiteCode -eq 'UAE') { [DayOfWeek]::Wednesday } else { [DayOfWeek]::Thursday }
    if (($ToValue - $FromValue).TotalDays -ne 6 -or $FromValue.DayOfWeek -ne $startDay -or $ToValue.DayOfWeek -ne $endDay) {
        throw "$SiteCode advertising range has invalid weekdays"
    }
}

function Get-IsoWeek([DateTime]$Date) {
    $calendar = [Globalization.CultureInfo]::InvariantCulture.Calendar
    $calendar.GetWeekOfYear($Date, [Globalization.CalendarWeekRule]::FirstFourDayWeek, [DayOfWeek]::Monday)
}

function Get-PeriodLabel([string]$FromDate, [string]$ToDate) {
    $fromValue = [DateTime]::ParseExact($FromDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    $toValue = [DateTime]::ParseExact($ToDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    '{0}-{1}' -f $fromValue.ToString('yyyy.MM.dd'), $toValue.ToString('MM.dd')
}

function New-EmptyState {
    [pscustomobject]@{ completedPeriods = @(); notifications = @() }
}

function Read-State([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return New-EmptyState }
    try {
        $state = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
        if ($null -eq $state.completedPeriods) { $state | Add-Member -NotePropertyName completedPeriods -NotePropertyValue @() }
        if ($null -eq $state.notifications) { $state | Add-Member -NotePropertyName notifications -NotePropertyValue @() }
        return $state
    } catch {
        throw "Advertising state file is invalid: $Path"
    }
}

function Save-State([object]$State, [string]$Path) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    $temporary = "$Path.tmp"
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-Webhook {
    if ($NoWeCom) { return '' }
    $webhook = $env:WECOM_WEBHOOK_URL
    if ([string]::IsNullOrWhiteSpace($webhook)) { $webhook = [Environment]::GetEnvironmentVariable('WECOM_WEBHOOK_URL', 'User') }
    if ([string]::IsNullOrWhiteSpace($webhook)) { throw 'WECOM_WEBHOOK_URL is not configured' }
    $uri = [Uri]$webhook
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'qyapi.weixin.qq.com' -or $uri.AbsolutePath -ne '/cgi-bin/webhook/send') {
        throw 'WECOM_WEBHOOK_URL is invalid'
    }
    $webhook
}

function Send-WeCom([string]$Message) {
    $webhook = Get-Webhook
    if (-not $webhook) { return }
    $payload = @{ msgtype = 'text'; text = @{ content = $Message } } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Method Post -Uri $webhook -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    if ($response.errcode -ne 0) { throw "WeCom returned error code $($response.errcode)" }
}

function Send-WeComOnce([object]$State, [string]$Key, [string]$Message) {
    if (@($State.notifications | Where-Object { $_.key -eq $Key }).Count -gt 0) { return 'skipped' }
    Send-WeCom $Message
    $State.notifications = @($State.notifications) + [pscustomobject]@{ key = $Key; deliveredAt = (Get-Date).ToString('o') }
    Save-State $State $statePath
    'delivered'
}

function Test-WorkbookPeriodComplete([string]$Path, [string]$Period, [string]$SiteCode) {
    $excel = $null; $book = $null; $sheet = $null; $used = $null
    try {
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.AskToUpdateLinks = $false
        $book = $excel.Workbooks.Open($Path, 0, $true, 5, '', '', $true)
        $sheet = $book.Worksheets.Item('Raw Data')
        $used = $sheet.UsedRange
        $lastRow = [int]($used.Row + $used.Rows.Count - 1)
        $stores = New-Object 'System.Collections.Generic.HashSet[string]'
        if ($lastRow -ge 2) {
            $values = $sheet.Range("A2:D$lastRow").Value2
            for ($row = 1; $row -le $values.GetLength(0); $row++) {
                if ([string]($values[$row, 1]) -eq $Period -and [string]($values[$row, 4]) -eq $SiteCode) {
                    [void]$stores.Add([string]($values[$row, 3]))
                }
            }
        }
        (@($storeIds | Where-Object { -not $stores.Contains($_) }).Count -eq 0)
    } finally {
        if ($book) { $book.Close($false) }
        if ($excel) { $excel.Quit() }
        Release-ComObject $used; Release-ComObject $sheet; Release-ComObject $book; Release-ComObject $excel
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    }
}

function Read-ReportRows([object]$Excel, [string]$Path, [string]$Store, [string]$SiteCode, [string]$Period, [int]$Week) {
    $book = $null; $sheet = $null; $used = $null
    try {
        $book = $Excel.Workbooks.Open($Path, 0, $true, 5, '', '', $true)
        $sheet = $book.Worksheets.Item('(Product) Campaign')
        for ($column = 1; $column -le $expectedHeaders.Count; $column++) {
            if ([string]$sheet.Cells.Item(1, $column).Value2 -ne $expectedHeaders[$column - 1]) {
                throw "Unexpected header in $Path at column $column"
            }
        }
        $used = $sheet.UsedRange
        $lastRow = [int]($used.Row + $used.Rows.Count - 1)
        $rows = New-Object System.Collections.Generic.List[object]
        if ($lastRow -ge 2) {
            $values = $sheet.Range("A2:L$lastRow").Value2
            for ($row = 1; $row -le $values.GetLength(0); $row++) {
                $campaign = ([string]($values[$row, 1])).Trim()
                if (-not $campaign) { continue }
                $target = @($Period, $Week, $Store, $SiteCode, 'Campaign', $campaign)
                for ($column = 2; $column -le 12; $column++) {
                    $value = $values[$row, $column]
                    if ($null -eq $value -or $value -eq '') { $value = 0 }
                    $target += $value
                }
                $rows.Add(@($target))
            }
        }
        return $rows.ToArray()
    } finally {
        if ($book) { $book.Close($false) }
        Release-ComObject $used; Release-ComObject $sheet; Release-ComObject $book
    }
}

function Add-CompletedPeriod([object]$State, [string]$SiteCode, [string]$Period, [int]$Rows, [string]$BackupPath) {
    if (@($State.completedPeriods | Where-Object { $_.site -eq $SiteCode -and $_.period -eq $Period }).Count -eq 0) {
        $State.completedPeriods = @($State.completedPeriods) + [pscustomobject]@{
            period = $Period; site = $SiteCode; rows = $Rows; backup = $BackupPath; completedAt = (Get-Date).ToString('o')
        }
    }
}

function Invoke-SiteUpdate([string]$SiteCode, [string]$FromDate, [string]$ToDate) {
    $fromValue = [DateTime]::ParseExact($FromDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    $toValue = [DateTime]::ParseExact($ToDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    Assert-SiteRange $SiteCode $fromValue $toValue
    $period = Get-PeriodLabel $FromDate $ToDate
    $week = Get-IsoWeek $fromValue
    $state = Read-State $statePath
    $keyPrefix = "$SiteCode|$period"
    $alreadyCompleted = @($state.completedPeriods | Where-Object { $_.site -eq $SiteCode -and $_.period -eq $period }).Count -gt 0
    if (-not $alreadyCompleted -and (Test-WorkbookPeriodComplete $WorkbookPath $period $SiteCode)) {
        Add-CompletedPeriod $state $SiteCode $period 0 ''
        Save-State $state $statePath
        $alreadyCompleted = $true
    }
    if ($alreadyCompleted) {
        $sourceDelivered = @($state.notifications | Where-Object { $_.key -eq "$keyPrefix|source" }).Count -gt 0
        $backupDelivered = @($state.notifications | Where-Object { $_.key -eq "$keyPrefix|backup" }).Count -gt 0
        if ($sourceDelivered -and $backupDelivered) {
            [void](Send-WeComOnce $state "$keyPrefix|update" "$ToDate $SiteCode 广告表已更新")
        }
        return [pscustomobject]@{ status = 'skipped'; period = $period; site = $SiteCode; appendedRows = 0 }
    }

    $startedAt = Get-Date
    $excel = $null; $formal = $null; $raw = $null; $used = $null; $target = $null; $config = $null
    try {
        $collector = Join-Path $AppRoot 'src\collector.mjs'
        $downloadJson = & $NodePath $collector --site $SiteCode --from $FromDate --to $ToDate --credential-dir $CredentialDir --output-root $ReportRoot
        if ($LASTEXITCODE -ne 0) { throw "Advertising download failed: $downloadJson" }
        $download = $downloadJson | ConvertFrom-Json
        if (-not $download.ok) { throw "Advertising download failed: $($download.error)" }
        $reportDirectory = [string]$download.directory

        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.AskToUpdateLinks = $false
        $sourceRows = New-Object System.Collections.Generic.List[object]
        foreach ($store in $storeIds) {
            $reportPath = Join-Path $reportDirectory "$store.xlsx"
            if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) { throw "Missing advertising report: $reportPath" }
            foreach ($row in @(Read-ReportRows $excel $reportPath $store $SiteCode $period $week)) { $sourceRows.Add($row) }
        }
        [void](Send-WeComOnce $state "$keyPrefix|source" "$ToDate $SiteCode 广告数据源已下载")

        $formal = $excel.Workbooks.Open($WorkbookPath, 0, $false, 5, '', '', $true)
        if ($formal.ReadOnly) { throw 'Advertising workbook opened read-only' }
        $raw = $formal.Worksheets.Item('Raw Data')
        $used = $raw.UsedRange
        $lastRow = [int]($used.Row + $used.Rows.Count - 1)
        $existing = New-Object 'System.Collections.Generic.HashSet[string]'
        if ($lastRow -ge 2) {
            $values = $raw.Range("A2:F$lastRow").Value2
            for ($row = 1; $row -le $values.GetLength(0); $row++) {
                $key = '{0}|{1}|{2}|{3}' -f [string]($values[$row, 1]), [string]($values[$row, 3]), [string]($values[$row, 4]), ([string]($values[$row, 6])).Trim()
                [void]$existing.Add($key)
            }
        }
        $pending = New-Object System.Collections.Generic.List[object]
        foreach ($row in $sourceRows) {
            $key = '{0}|{1}|{2}|{3}' -f $row[0], $row[2], $row[3], ([string]$row[5]).Trim()
            if ($existing.Add($key)) { $pending.Add($row) }
        }
        Release-ComObject $used; Release-ComObject $raw
        $used = $null; $raw = $null
        $formal.Close($false)
        Release-ComObject $formal
        $formal = $null

        New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null
        $backupPath = Join-Path $BackupDirectory ('{0}_备份_{1}_{2}.xlsx' -f [IO.Path]::GetFileNameWithoutExtension($WorkbookPath), $SiteCode, (Get-Date -Format 'yyyyMMdd_HHmmss'))
        Copy-Item -LiteralPath $WorkbookPath -Destination $backupPath
        if ((Get-FileHash -LiteralPath $WorkbookPath -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash) {
            throw 'Advertising workbook backup hash mismatch'
        }
        [void](Send-WeComOnce $state "$keyPrefix|backup" "$ToDate 广告表已备份")

        $formal = $excel.Workbooks.Open($WorkbookPath, 0, $false, 5, '', '', $true)
        if ($formal.ReadOnly) { throw 'Advertising workbook opened read-only after backup' }
        $raw = $formal.Worksheets.Item('Raw Data')
        if ($pending.Count -gt 0) {
            $used = $raw.UsedRange
            $startRow = [int]($used.Row + $used.Rows.Count)
            $endRow = $startRow + $pending.Count - 1
            $matrix = New-Object 'object[,]' $pending.Count, 17
            for ($r = 0; $r -lt $pending.Count; $r++) {
                for ($c = 0; $c -lt 17; $c++) { $matrix[$r, $c] = $pending[$r][$c] }
            }
            $target = $raw.Range("A$startRow`:Q$endRow")
            [void]$raw.Range("A$($startRow - 1)`:Q$($startRow - 1)").Copy()
            [void]$target.PasteSpecial(-4122)
            $target.Value2 = $matrix
            if ([int]$excel.WorksheetFunction.CountA($target) -ne ($pending.Count * 17)) { throw 'Advertising write verification failed' }
        }
        if ($SiteCode -eq 'KSA') {
            $config = $formal.Worksheets.Item('Config')
            $config.Range('B2').Value2 = $week
        }
        $excel.CalculateFullRebuild()
        $formal.Save()
        if ($SiteCode -eq 'KSA' -and [int]$config.Range('B2').Value2 -ne $week) { throw 'Config week update verification failed' }
        Release-ComObject $config; Release-ComObject $target; Release-ComObject $used; Release-ComObject $raw
        $config = $null; $target = $null; $used = $null; $raw = $null
        $formal.Close($true)
        Release-ComObject $formal
        $formal = $null

        Add-CompletedPeriod $state $SiteCode $period $pending.Count $backupPath
        Save-State $state $statePath
        [void](Send-WeComOnce $state "$keyPrefix|update" "$ToDate $SiteCode 广告表已更新")
        return [pscustomobject]@{
            status = 'updated'; period = $period; site = $SiteCode; sourceRows = $sourceRows.Count
            appendedRows = $pending.Count; backup = $backupPath; startedAt = $startedAt.ToString('o')
        }
    } catch {
        $message = $_.Exception.Message -replace 'https://qyapi\.weixin\.qq\.com/[^\s]+', '[REDACTED_WEBHOOK]'
        try { if (-not $NoWeCom) { Send-WeCom "Noon $SiteCode 广告表更新失败`n周期：$period`n错误：$message" } } catch {}
        throw
    } finally {
        if ($formal) { try { $formal.Close($false) } catch {} }
        if ($excel) { try { $excel.Quit() } catch {} }
        Release-ComObject $config; Release-ComObject $target; Release-ComObject $used; Release-ComObject $raw; Release-ComObject $formal; Release-ComObject $excel
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    }
}

if (-not (Test-Path -LiteralPath $WorkbookPath -PathType Leaf)) { throw "Workbook not found: $WorkbookPath" }
if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
    $BackupDirectory = Join-Path (Split-Path -Parent $WorkbookPath) '4. 广告数据'
}
if (-not $NodePath) { $NodePath = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node executable not found: $NodePath" }
if ($Site -eq 'ALL' -and ($From -or $To)) { throw 'Explicit From/To requires Site UAE or KSA' }

$sites = if ($Site -eq 'ALL') { @('UAE', 'KSA') } else { @($Site) }
$siteResults = New-Object System.Collections.Generic.List[object]
$startedAt = Get-Date
try {
    foreach ($siteCode in $sites) {
        $range = Get-DefaultRange $siteCode
        $fromDate = if ($From) { $From } else { $range.From }
        $toDate = if ($To) { $To } else { $range.To }
        $siteResults.Add((Invoke-SiteUpdate $siteCode $fromDate $toDate))
    }
    $result = [pscustomobject]@{
        ok = $true; status = if (@($siteResults | Where-Object { $_.status -eq 'updated' }).Count -gt 0) { 'updated' } else { 'skipped' }
        sites = $siteResults.ToArray(); startedAt = $startedAt.ToString('o'); completedAt = (Get-Date).ToString('o')
    }
    New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding UTF8
    $result | ConvertTo-Json -Compress -Depth 8
} catch {
    $message = $_.Exception.Message -replace 'https://qyapi\.weixin\.qq\.com/[^\s]+', '[REDACTED_WEBHOOK]'
    $result = [pscustomobject]@{
        ok = $false; status = 'failed'; sites = $siteResults.ToArray(); error = $message
        startedAt = $startedAt.ToString('o'); completedAt = (Get-Date).ToString('o')
    }
    New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding UTF8
    throw
}
