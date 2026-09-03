param([Parameter(Mandatory = $true)][long]$ForegroundHandle)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NoonForegroundGuard {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint source, uint target, bool attach);
  [DllImport("user32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
'@

function Restore-OriginalWindow {
  if (-not [NoonForegroundGuard]::IsWindow($original)) { return }
  $targetProcessId = [uint32]0
  $targetThread = [NoonForegroundGuard]::GetWindowThreadProcessId($original, [ref]$targetProcessId)
  $currentThread = [NoonForegroundGuard]::GetCurrentThreadId()
  [void][NoonForegroundGuard]::AttachThreadInput($currentThread, $targetThread, $true)
  try {
    [void][NoonForegroundGuard]::BringWindowToTop($original)
    [void][NoonForegroundGuard]::SetForegroundWindow($original)
  } finally {
    [void][NoonForegroundGuard]::AttachThreadInput($currentThread, $targetThread, $false)
  }
}

$original = [IntPtr]$ForegroundHandle
$deadline = [DateTime]::UtcNow.AddSeconds(5)
while ([DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 80
  $foreground = [NoonForegroundGuard]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero -or $foreground -eq $original) { continue }
  $processId = [uint32]0
  [void][NoonForegroundGuard]::GetWindowThreadProcessId($foreground, [ref]$processId)
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'chrome') {
    Restore-OriginalWindow
  }
}
