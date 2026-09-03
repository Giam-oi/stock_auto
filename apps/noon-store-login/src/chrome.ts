import { execFileSync, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";

interface PkgProcess extends NodeJS.Process { pkg?: unknown }

function backgroundLauncherPath(): string {
  if ((process as PkgProcess).pkg) return join(dirname(process.execPath), "launch-chrome-background.ps1");
  return join(__dirname, "..", "..", "assets", "launch-chrome-background.ps1");
}

export function chromeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env.PROGRAMFILES && join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    env["PROGRAMFILES(X86)"] && join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter((value): value is string => Boolean(value));
}

export async function locateChrome(explicitPath?: string): Promise<string> {
  const candidates = explicitPath ? [explicitPath] : chromeCandidates();
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the standard installation paths.
    }
  }
  throw new Error("未找到 Google Chrome，请先安装 Chrome，或使用 --chrome 指定 chrome.exe");
}

export async function isLegacyManagedChromeRunning(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!env.LOCALAPPDATA) return false;
  const portFile = join(env.LOCALAPPDATA, "NoonStoreLogin", "ChromeUserData", "DevToolsActivePort");
  try {
    const port = Number((await readFile(portFile, "utf8")).split(/\r?\n/, 1)[0]);
    if (!Number.isInteger(port) || port < 1) return false;
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

export function launchChromeProfile(input: {
  chromePath: string;
  profileDirectory: string;
  url: string;
  newWindow?: boolean;
  preserveForeground?: boolean;
  foregroundHandle?: number;
}): void {
  if (input.preserveForeground !== false && process.platform === "win32") {
    const foregroundHandle = input.foregroundHandle ?? captureForegroundWindow();
    const args = [`--profile-directory=${input.profileDirectory}`, input.url];
    const chromeChild = spawn(input.chromePath, args, { detached: true, stdio: "ignore", windowsHide: true });
    chromeChild.unref();
    const guard = spawn("powershell.exe", [
      "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
      "-File", backgroundLauncherPath(),
      "-ForegroundHandle", String(foregroundHandle),
    ], { detached: true, stdio: "ignore", windowsHide: true });
    guard.unref();
    return;
  }
  const args = [`--profile-directory=${input.profileDirectory}`];
  if (input.newWindow) args.push("--new-window");
  args.push(input.url);
  const child = spawn(input.chromePath, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

export function captureForegroundWindow(): number {
  if (process.platform !== "win32") return 0;
  try {
    const output = execFileSync("powershell.exe", [
      "-NoProfile", "-Command",
      "Add-Type 'using System; using System.Runtime.InteropServices; public static class F { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); }'; [F]::GetForegroundWindow().ToInt64()",
    ], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
    const value = Number(output.trim());
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

export function openDirectory(directory: string): void {
  const child = spawn("explorer.exe", [directory], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}
