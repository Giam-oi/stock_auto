import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StoreIndex } from "./config";

interface ChromeLocalState {
  profile?: {
    info_cache?: Record<string, { name?: string }>;
  };
}

export function defaultChromeUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.LOCALAPPDATA) throw new Error("无法确定 Chrome 用户资料目录");
  return join(env.LOCALAPPDATA, "Google", "Chrome", "User Data");
}

export function profileDirectoryMap(state: ChromeLocalState): Map<StoreIndex, string> {
  const result = new Map<StoreIndex, string>();
  for (const [directory, profile] of Object.entries(state.profile?.info_cache ?? {})) {
    const match = /^店铺([1-6])$/.exec(profile.name?.trim() ?? "");
    if (match) result.set(Number(match[1]) as StoreIndex, directory);
  }
  return result;
}

export async function loadStoreProfiles(userDataDir: string): Promise<Map<StoreIndex, string>> {
  let parsed: ChromeLocalState;
  try {
    parsed = JSON.parse(await readFile(join(userDataDir, "Local State"), "utf8")) as ChromeLocalState;
  } catch {
    throw new Error("无法读取 Chrome 个人资料，请确认 Chrome 已正确安装");
  }
  return profileDirectoryMap(parsed);
}
