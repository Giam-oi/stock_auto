import { access } from "node:fs/promises";
import { join } from "node:path";
import { AsnCreatorError } from "../errors.js";

export async function locateChrome(): Promise<string> {
  const candidates = [
    process.env.NOON_ASN_CHROME_PATH,
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["PROGRAMFILES(X86)"] ? join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : undefined,
  ].filter((path): path is string => Boolean(path));

  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      // Probe the next standard installation path.
    }
  }
  throw new AsnCreatorError("configuration", false, "browser", "Google Chrome is not installed in a supported location");
}
