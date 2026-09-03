$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\NoonStoreSessionTray', [ref]$createdNew)
if (-not $createdNew) { exit 0 }

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'NoonStoreLogin'
$logPath = Join-Path $runtimeRoot 'session-monitor.jsonl'
$workerOwnerPath = Join-Path $runtimeRoot 'resident.lock\owner.json'
$trayOwnerPath = Join-Path $runtimeRoot 'tray-owner.json'
$workerPath = Join-Path $PSScriptRoot 'Noon店铺会话监控.exe'
$workerArguments = '--resident --store all --site UAE --page dashboard --interval-minutes 30'
$script:exiting = $false
$script:worker = $null

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
@{ pid = $PID; startedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath $trayOwnerPath -Encoding UTF8

function New-StatusIcon([string]$severity) {
  $bitmap = New-Object System.Drawing.Bitmap 32, 32
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $color = switch ($severity) {
      'healthy' { [System.Drawing.Color]::FromArgb(46, 125, 50) }
      'logout' { [System.Drawing.Color]::FromArgb(198, 40, 40) }
      default { [System.Drawing.Color]::FromArgb(245, 166, 35) }
    }
    $brush = New-Object System.Drawing.SolidBrush $color
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    try {
      $graphics.FillEllipse($brush, 1, 1, 30, 30)
      $font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      try { $graphics.DrawString('N', $font, $white, 9, 7) } finally { $font.Dispose() }
    } finally { $brush.Dispose(); $white.Dispose() }
    return [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

function Get-LatestStoreRecords {
  if (-not (Test-Path -LiteralPath $logPath)) { return @() }
  $records = @(Get-Content -LiteralPath $logPath -Tail 120 -Encoding UTF8 | ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { $null }
  } | Where-Object { $null -ne $_ })
  $latest = @{}
  foreach ($record in $records) { $latest[[int]$record.store] = $record }
  return @(1..6 | ForEach-Object { if ($latest.ContainsKey($_)) { $latest[$_] } })
}

function Test-ConfirmedLogout($record) {
  if ($record.valid) { return $false }
  $hostName = ''
  try { $hostName = ([Uri]$record.finalUrl).Host } catch {}
  return $hostName -eq 'login.noon.partners' -or ([string]$record.title) -match 'Partners Login'
}

function Get-DisplayState {
  $records = @(Get-LatestStoreRecords)
  $byStore = @{}
  foreach ($record in $records) { $byStore[[int]$record.store] = $record }
  $severity = 'healthy'
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($store in 1..6) {
    if (-not $byStore.ContainsKey($store)) {
      if ($severity -ne 'logout') { $severity = 'warning' }
      $lines.Add("店铺${store}：尚无结果")
      continue
    }
    $record = $byStore[$store]
    $time = try { ([DateTimeOffset]::Parse($record.checkedAt)).ToLocalTime().ToString('HH:mm:ss') } catch { '--:--:--' }
    if (Test-ConfirmedLogout $record) {
      $severity = 'logout'; $lines.Add("店铺${store}：需要登录（$time）")
    } elseif (-not $record.valid) {
      if ($severity -ne 'logout') { $severity = 'warning' }
      $lines.Add("店铺${store}：暂时不可用（$time）")
    } else { $lines.Add("店铺${store}：正常（$time）") }
  }
  return @{ severity = $severity; lines = $lines.ToArray() }
}

function Ensure-WorkerRunning {
  $alive = $false
  if (Test-Path -LiteralPath $workerOwnerPath) {
    try {
      $owner = Get-Content -Raw -LiteralPath $workerOwnerPath | ConvertFrom-Json
      $alive = $null -ne (Get-Process -Id ([int]$owner.pid) -ErrorAction SilentlyContinue)
    } catch {}
  }
  if (-not $alive) {
    $script:worker = Start-Process -FilePath $workerPath -ArgumentList $workerArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
  }
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Text = 'Noon 六店会话监控'
$notify.Visible = $true
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$showItem = $contextMenu.Items.Add('查看六店状态')
$checkItem = $contextMenu.Items.Add('立即检查')
$logItem = $contextMenu.Items.Add('打开日志目录')
[void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$exitItem = $contextMenu.Items.Add('退出监控')
$notify.ContextMenuStrip = $contextMenu

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Noon 六店会话监控'
$form.Size = New-Object System.Drawing.Size 410, 300
$form.StartPosition = 'CenterScreen'
$form.ShowInTaskbar = $false
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.FormBorderStyle = 'FixedDialog'
$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point 22, 18
$label.Size = New-Object System.Drawing.Size 350, 215
$label.Font = New-Object System.Drawing.Font 'Microsoft YaHei UI', 11
$form.Controls.Add($label)

function Refresh-Status {
  $state = Get-DisplayState
  $label.Text = ($state.lines -join [Environment]::NewLine)
  if ($notify.Icon) { $notify.Icon.Dispose() }
  $notify.Icon = New-StatusIcon $state.severity
  $notify.Text = switch ($state.severity) {
    'healthy' { 'Noon 六店会话正常' }
    'logout' { 'Noon 店铺需要重新登录' }
    default { 'Noon 会话检查暂时不可用' }
  }
}

function Show-Status {
  Refresh-Status
  $form.Show()
  $form.WindowState = 'Normal'
  $form.Activate()
}

$form.Add_FormClosing({
  param($sender, $eventArgs)
  if (-not $script:exiting) { $eventArgs.Cancel = $true; $form.Hide() }
})
$showItem.Add_Click({ Show-Status })
$notify.Add_DoubleClick({ Show-Status })
$checkItem.Add_Click({
  Start-Process -FilePath $workerPath -ArgumentList '--background --store all --site UAE --page dashboard --interval-minutes 30' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
  $notify.ShowBalloonTip(3000, 'Noon 会话监控', '已开始立即检查六个店铺。', [System.Windows.Forms.ToolTipIcon]::Info)
})
$logItem.Add_Click({ Start-Process explorer.exe -ArgumentList $runtimeRoot })
$exitItem.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show('确定退出 Noon 六店会话监控？下次登录或解锁电脑时会自动重新启动。', '退出监控', 'YesNo', 'Question')
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  $script:exiting = $true
  if (Test-Path -LiteralPath $workerOwnerPath) {
    try { $owner = Get-Content -Raw -LiteralPath $workerOwnerPath | ConvertFrom-Json; Stop-Process -Id ([int]$owner.pid) -ErrorAction SilentlyContinue } catch {}
  }
  $notify.Visible = $false
  $form.Close()
  [System.Windows.Forms.Application]::ExitThread()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 30000
$timer.Add_Tick({ Ensure-WorkerRunning; Refresh-Status })
$timer.Start()

try {
  Ensure-WorkerRunning
  Refresh-Status
  [System.Windows.Forms.Application]::Run()
} finally {
  $timer.Stop(); $timer.Dispose()
  $notify.Visible = $false; if ($notify.Icon) { $notify.Icon.Dispose() }; $notify.Dispose()
  $form.Dispose()
  Remove-Item -LiteralPath $trayOwnerPath -Force -ErrorAction SilentlyContinue
  $mutex.ReleaseMutex(); $mutex.Dispose()
}
