param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Baseline', 'Wait')]
  [string]$Mode,
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 6)]
  [int]$StoreIndex
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NoonWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
}
'@

$script:OutlookHandle = [IntPtr]::Zero
$script:MinimizeAfterRead = $false

function Restore-OutlookWindow {
  if ($script:MinimizeAfterRead -and $script:OutlookHandle -ne [IntPtr]::Zero) {
    [void][NoonWindow]::ShowWindow($script:OutlookHandle, 6)
  }
}

function Get-OutlookRoot {
  $process = Get-Process olk -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
  if (-not $process) {
    $foreground = [NoonWindow]::GetForegroundWindow()
    Start-Process 'ms-outlook:'
    $deadline = (Get-Date).AddSeconds(12)
    do {
      Start-Sleep -Milliseconds 300
      $process = Get-Process olk -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
    } while (-not $process -and (Get-Date) -lt $deadline)
    if ($foreground -ne [IntPtr]::Zero) { [void][NoonWindow]::SetForegroundWindow($foreground) }
    $script:MinimizeAfterRead = $true
  }
  if (-not $process) { throw 'New Outlook is not available' }
  $script:OutlookHandle = [IntPtr]$process.MainWindowHandle
  if ([NoonWindow]::IsIconic($script:OutlookHandle)) {
    $script:MinimizeAfterRead = $true
    [void][NoonWindow]::ShowWindow($script:OutlookHandle, 4)
    Start-Sleep -Milliseconds 800
  }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($script:OutlookHandle)
  if (-not $root) { throw 'New Outlook accessibility interface is unavailable' }
  return $root
}

function Get-TreeItems($Root) {
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::TreeItem
  )
  return $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Select-StoreInbox($Root, [int]$Index) {
  $storePrefix = ([char]0x5E97) + ([char]0x94FA)
  $inboxPrefix = ([char]0x6536) + ([char]0x4EF6) + ([char]0x7BB1)
  $targetName = "$storePrefix$Index"
  $stores = Get-TreeItems $Root
  $target = $null
  for ($i = 0; $i -lt $stores.Count; $i++) {
    $item = $stores.Item($i)
    if ($item.Current.Name -notmatch "^$([regex]::Escape($storePrefix))[1-6]$") { continue }
    if ($item.Current.Name -eq $targetName) { $target = $item }
    $pattern = $null
    if ($item.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
      if ($item.Current.Name -eq $targetName) {
        if ($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) { $pattern.Expand() }
      } elseif ($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) {
        $pattern.Collapse()
      }
    }
  }
  if (-not $target) { throw "Store $Index is not configured in New Outlook" }
  Start-Sleep -Milliseconds 500
  $items = Get-TreeItems $Root
  $inbox = $null
  for ($i = 0; $i -lt $items.Count; $i++) {
    if ($items.Item($i).Current.Name -match "^$([regex]::Escape($inboxPrefix))(?:\s|$)") { $inbox = $items.Item($i); break }
  }
  if (-not $inbox) { throw "Store $Index inbox is unavailable" }
  $selection = $inbox.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
  $selection.Select()
  Start-Sleep -Milliseconds 700
}

function Get-NoonMessages($Root) {
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ListItem
  )
  $items = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  $result = @()
  for ($i = 0; $i -lt $items.Count; $i++) {
    $item = $items.Item($i)
    $name = $item.Current.Name
    if ($name -notmatch '(?i)(?:^|\s)noon(?:\s|$).*?\bverify\b.{0,80}\b(?:e-?mail|email)\b') { continue }
    $id = [string]$item.Current.AutomationId
    if ([string]::IsNullOrWhiteSpace($id)) {
      $runtimeId = $item.GetRuntimeId()
      $id = 'runtime:' + (($runtimeId | ForEach-Object { [string]$_ }) -join '.')
    }
    $result += [pscustomobject]@{ Id = $id; Element = $item }
  }
  return $result
}

function Select-NoonMessage($Message) {
  $selection = $null
  if ($Message.Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) {
    $selection.Select()
  } else {
    $invoke = $null
    if (-not $Message.Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
      throw 'New Outlook message cannot be opened'
    }
    $invoke.Invoke()
  }
  Start-Sleep -Milliseconds 900
}

function Get-ReadingPaneCode($Root) {
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Group
  )
  $groups = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  $codes = @{}
  for ($i = 0; $i -lt $groups.Count; $i++) {
    $text = [string]$groups.Item($i).Current.Name
    if ($text -notmatch '(?is)(?:enter|use).{0,180}(?:verification\s+)?code|(?:verification\s+)?code.{0,180}(?:login|verify)') { continue }
    foreach ($match in [regex]::Matches($text, '(?<!\d)\d{6}(?!\d)')) {
      $codes[$match.Value] = $true
    }
  }
  if ($codes.Count -eq 1) { return [string]@($codes.Keys)[0] }
  return $null
}

try {
  $root = Get-OutlookRoot
  Select-StoreInbox $root $StoreIndex

  if ($Mode -eq 'Baseline') {
    $ids = @(Get-NoonMessages $root | ForEach-Object Id)
    [pscustomobject]@{ messageIds = $ids } | ConvertTo-Json -Compress
    exit 0
  }

  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $baseline = @($request.messageIds)
  $deadline = (Get-Date).AddSeconds(60)
  do {
    foreach ($message in @(Get-NoonMessages $root)) {
      if ($baseline -contains $message.Id) { continue }
      Select-NoonMessage $message
      $code = Get-ReadingPaneCode $root
      if ($code) {
        [pscustomobject]@{ code = $code } | ConvertTo-Json -Compress
        exit 0
      }
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  throw "No new Noon verification email arrived for store $StoreIndex"
} finally {
  Restore-OutlookWindow
}
