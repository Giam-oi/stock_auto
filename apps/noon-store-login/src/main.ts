#!/usr/bin/env node
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { SessionBridge, type SessionCheckResult } from "./bridge";
import { captureForegroundWindow, isLegacyManagedChromeRunning, launchChromeProfile, locateChrome, openDirectory } from "./chrome";
import { parseArgs, pause, promptOptions, type Options } from "./cli";
import { destinationUrl, findStores, STORES, type StoreConfig } from "./config";
import { isConfirmedLogout, shouldOpenLoginPage } from "./monitor-state";
import { defaultChromeUserDataDir, loadStoreProfiles } from "./profiles";
import { runResidentLoop } from "./resident";
import { acquireSingleInstance, type InstanceLock } from "./single-instance";
import { OutlookOtpProvider } from "./outlook-otp";

interface PkgProcess extends NodeJS.Process { pkg?: unknown }
interface StoreCheck { store: StoreConfig; result: SessionCheckResult }

function runtimeRoot(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), "NoonStoreLogin");
}

function extensionDirectory(): string {
  if ((process as PkgProcess).pkg) return join(dirname(process.execPath), "Noon登录助手扩展");
  return join(__dirname, "..", "..", "extension");
}

async function acquireCheckTurn(timeoutMs = 15 * 60_000): Promise<InstanceLock> {
  const deadline = Date.now() + timeoutMs;
  do {
    const lock = await acquireSingleInstance(join(runtimeRoot(), "check.lock"));
    if (lock.acquired) return lock;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } while (Date.now() < deadline);
  throw new Error("等待其他 Noon 检查结束超时");
}

async function setupExtension(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const chromePath = await locateChrome(options.chromePath);
  if (await isLegacyManagedChromeRunning()) throw new Error("检测到旧版受管 Chrome，请先关闭旧版 Chrome");
  const profiles = await loadStoreProfiles(defaultChromeUserDataDir());
  openDirectory(extensionDirectory());
  const setupPage = pathToFileURL(join(dirname(extensionDirectory()), "安装监控扩展.html")).href;
  console.log("\n  正在打开六个 Chrome 个人资料的扩展管理页...\n");
  for (const store of STORES) {
    const profileDirectory = profiles.get(store.index);
    if (!profileDirectory) throw new Error(`Chrome 中未找到“店铺${store.index}”`);
    launchChromeProfile({ chromePath, profileDirectory, url: setupPage, newWindow: true, preserveForeground: false });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  console.log("  每个店铺窗口已打开安装说明页，请按页面步骤加载或刷新扩展。\n");
  await pause();
}

async function checkStores(options: Options, stores: readonly StoreConfig[]): Promise<StoreCheck[]> {
  const chromePath = await locateChrome(options.chromePath);
  const profiles = await loadStoreProfiles(defaultChromeUserDataDir());
  const bridge = new SessionBridge(120_000, options.autoLogin ? new OutlookOtpProvider() : undefined);
  await bridge.start();
  const pending: Array<{ store: StoreConfig; result: Promise<SessionCheckResult> }> = [];
  const completed: StoreCheck[] = [];
  const foregroundHandle = captureForegroundWindow();
  try {
    for (const store of stores) {
      const profileDirectory = profiles.get(store.index);
      if (!profileDirectory) throw new Error(`Chrome 中未找到“店铺${store.index}”`);
      const targetUrl = destinationUrl(store, options.site, options.destination);
      const check = bridge.prepare({
        storeIndex: store.index,
        projectCode: store.projectCode,
        targetUrl,
        intervalMinutes: options.intervalMinutes,
        alarmMode: options.monitorUntil === undefined ? "primary" : "fallback",
        autoLogin: options.autoLogin,
      });
      const result = check.completed.catch((error: unknown) => ({
        valid: false,
        finalUrl: "",
        title: "",
        checkedAt: new Date().toISOString(),
        reason: error instanceof Error ? error.message : "check_failed",
      }));
      pending.push({ store, result });
      launchChromeProfile({ chromePath, profileDirectory, url: check.url, foregroundHandle });
      if (options.autoLogin) completed.push({ store, result: await result });
    }
    if (options.autoLogin) return completed;
    return Promise.all(pending.map(async ({ store, result }) => ({ store, result: await result })));
  } finally {
    await Promise.all(pending.map(({ result }) => result));
    await bridge.close();
  }
}

async function writeLog(checks: readonly StoreCheck[]): Promise<void> {
  const directory = runtimeRoot();
  await mkdir(directory, { recursive: true });
  const lines = checks.map(({ store, result }) => JSON.stringify({
    store: store.index,
    projectCode: store.projectCode,
    ...result,
  })).join("\n") + "\n";
  await appendFile(join(directory, "session-monitor.jsonl"), lines, "utf8");
}

function printChecks(checks: readonly StoreCheck[]): void {
  console.log("");
  for (const { store, result } of checks) {
    console.log(`  店铺${store.index}  ${result.valid ? "正常" : "掉登录"}  ${result.title || result.reason || "未知状态"}`);
  }
}

async function run(): Promise<void> {
  if (process.argv.includes("--setup-extension")) return setupExtension();
  let options = parseArgs(process.argv.slice(2));
  if (options.interactive) options = await promptOptions(options);
  const stores = findStores(options.stores);
  const until = options.monitorUntil ? Date.parse(options.monitorUntil) : undefined;
  if (until !== undefined && until <= Date.now()) throw new Error("--monitor-until 必须晚于当前时间");
  const confirmedLogout = new Map<number, boolean>();

  const checkOnce = async () => {
    const turn = await acquireCheckTurn();
    try {
      const checks = await checkStores(options, stores);
      await writeLog(checks);
      printChecks(checks);
      for (const { store, result } of checks) {
        const previous = confirmedLogout.get(store.index) ?? false;
        if (result.valid) confirmedLogout.set(store.index, false);
        else if (isConfirmedLogout(result)) confirmedLogout.set(store.index, true);
        if (options.openLoginOnLogout && shouldOpenLoginPage(previous, result)) {
          const profiles = await loadStoreProfiles(defaultChromeUserDataDir());
          const profileDirectory = profiles.get(store.index);
          if (profileDirectory) launchChromeProfile({ chromePath: await locateChrome(options.chromePath), profileDirectory, url: result.finalUrl, preserveForeground: false });
        }
      }
    } finally {
      await turn.release();
    }
  };

  if (options.resident) {
    await mkdir(runtimeRoot(), { recursive: true });
    const lock = await acquireSingleInstance(join(runtimeRoot(), "resident.lock"));
    if (!lock.acquired) {
      console.log("  Noon 会话常驻监控已在运行。");
      return;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      await runResidentLoop(checkOnce, options.intervalMinutes * 60_000, controller.signal);
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await lock.release();
    }
    return;
  }

  do {
    await checkOnce();
    if (until === undefined || Date.now() >= until) break;
    const waitMs = Math.min(options.intervalMinutes * 60_000, until - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  } while (Date.now() < until);

  if (options.interactive) await pause();
}

run().catch(async (error: unknown) => {
  console.error(`\n  错误：${error instanceof Error ? error.message : "程序运行失败"}`);
  if (process.argv.length <= 2 || process.argv.includes("--setup-extension")) await pause();
  process.exitCode = 1;
});
