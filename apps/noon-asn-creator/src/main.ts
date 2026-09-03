import { access, mkdtemp } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { BrowserAsnFallback } from "./browser/fallback.js";
import { locateChrome } from "./browser/chrome.js";
import { STORE_CONFIGS } from "./contracts.js";
import { JournalStore } from "./journal.js";
import { JsonLogger } from "./logger.js";
import { chooseFolder, exitCodeForResult, formatOperatorSummary, formatSummary, showOperatorMessage } from "./launcher.js";
import { ContractApiGateway } from "./noon/api-gateway.js";
import { SessionManager } from "./noon/auth.js";
import { loadContractBundle } from "./noon/contract-loader.js";
import { runFolder } from "./runner.js";
import { discoverWorkbookPaths, isSkippedWorkbook, readAsnJob } from "./workbook.js";
import { loadWeComWebhookUrl, WeComNotifier } from "./wecom.js";

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function localAppData(): string {
  return process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? ".", "AppData", "Local");
}

async function validateCredentialDirectory(path: string): Promise<void> {
  await Promise.all(STORE_CONFIGS.map((store) => access(join(path, store.credentialFile))));
}

async function contractPath(argv: readonly string[]): Promise<string> {
  const moduleDirectory = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const explicit = argument(argv, "--contract");
  const candidates = [
    explicit,
    join(dirname(process.execPath), "noon-uae-asn.v1.json"),
    resolve(moduleDirectory, "..", "..", "contracts", "noon-uae-asn.v1.json"),
  ].filter((path): path is string => Boolean(path));
  for (const path of candidates) {
    try { await access(path); return path; } catch { /* Try the next packaged/source location. */ }
  }
  throw new Error("Verified Noon ASN API contract is missing");
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const nonInteractive = argv.includes("--non-interactive");
  if (argv.includes("--folder-cancel-test")) return 3;
  if (argv.includes("--offline-smoke-test")) {
    const folder = argument(argv, "--folder");
    if (!folder) return 2;
    const paths = await discoverWorkbookPaths(folder);
    if (paths.length === 0) return 2;
    for (const path of paths) {
      if (!isSkippedWorkbook(await readAsnJob(path))) return 2;
    }
    process.stdout.write("skipped_existing offline workbook validation passed\n");
    return 0;
  }
  if (argv.includes("--browser-launch-test")) {
    const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "NoonASNCreatorExeBrowser-")), {
      executablePath: await locateChrome(),
      headless: true,
    });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      await page.setContent("<button>Browser Ready</button>");
      if (!await page.getByRole("button", { name: "Browser Ready", exact: true }).isVisible()) return 2;
      process.stdout.write("Packaged browser launch test passed\n");
      return 0;
    } finally {
      await context.close();
    }
  }
  try {
    if (!nonInteractive) process.stdout.write("Noon ASN 创建工具\n正在检查配置...\n");
    const credentialDirectory = process.env.NOON_CREDENTIAL_DIR ?? "D:\\noon-api";
    await validateCredentialDirectory(credentialDirectory);
    const chromePath = await locateChrome();
    if (!nonInteractive && !argument(argv, "--folder")) process.stdout.write("请在弹窗中选择表格文件夹...\n");
    const selectedFolder = argument(argv, "--folder") ?? await chooseFolder();
    if (!selectedFolder) return 3;
    if (!nonInteractive) process.stdout.write(`已选择：${selectedFolder}\n`);

    const sessions = new SessionManager(credentialDirectory);
    const bundle = await loadContractBundle(await contractPath(argv));
    const gateway = new ContractApiGateway(bundle, { refreshSession: (storeIndex) => sessions.refresh(storeIndex) });
    const logger = new JsonLogger();
    const notificationFailures: string[] = [];
    let notifier: WeComNotifier | undefined;
    try {
      const webhookUrl = await loadWeComWebhookUrl(credentialDirectory);
      if (webhookUrl) notifier = new WeComNotifier(webhookUrl, "UAE");
    } catch (error) {
      const message = error instanceof Error ? error.message : "企业微信通知配置无效";
      notificationFailures.push(message);
      await logger.write({ event: "wecom_notification_failed", stage: "configuration", message });
    }
    const browser = new BrowserAsnFallback({
      gateway,
      refreshSession: (storeIndex) => sessions.refresh(storeIndex),
      chromePath,
      profileDirectory: join(localAppData(), "NoonASNCreator", "browser-profile"),
    });
    const result = await runFolder(resolve(selectedFolder), {
      journal: new JournalStore(),
      sessions,
      gateway,
      browser,
      logger,
      onFolderDiscovered: (paths: readonly string[]) => {
        if (nonInteractive) return;
        process.stdout.write(`发现 ${paths.length} 个表格。\n`);
        if (paths.length === 0) process.stdout.write("所选文件夹中没有可处理的 .xlsx 文件。\n");
      },
      onFileStart: (filePath: string, index: number, total: number) => {
        if (!nonInteractive) process.stdout.write(`[${index}/${total}] 正在处理：${basename(filePath)}\n`);
      },
      onFileComplete: async (file, index: number, total: number) => {
        if (!nonInteractive) {
          const message = file.error?.message ? ` - ${file.error.message}` : "";
          const labels: Record<string, string> = {
            written: "已锁定并写入",
            skipped_existing: "已有 ASN，已核验锁定",
            failed: "失败",
            needs_review: "需要人工检查",
            invalid_input: "表格无效",
          };
          process.stdout.write(`[${index}/${total}] ${labels[file.status] ?? file.status}：${file.fileName}${message}\n`);
        }
        if (notifier) {
          try { await notifier.notifyFile(file); } catch (error) {
            const message = error instanceof Error ? error.message : "企业微信通知失败";
            notificationFailures.push(`${file.fileName}：${message}`);
            await logger.write({ event: "wecom_notification_failed", stage: "file", fileName: file.fileName, message });
          }
        }
      },
    });
    if (notifier) {
      try { await notifier.notifySummary(result); } catch (error) {
        const message = error instanceof Error ? error.message : "企业微信汇总通知失败";
        notificationFailures.push(message);
        await logger.write({ event: "wecom_notification_failed", stage: "summary", message });
      }
    }
    process.stdout.write(`${formatSummary(result)}\n`);
    const exitCode = exitCodeForResult(result);
    if (notificationFailures.length > 0) process.stderr.write(`企业微信通知失败：${notificationFailures.join("；")}\n`);
    if (!nonInteractive) {
      const dialogText = notificationFailures.length > 0
        ? `${formatOperatorSummary(result)}\n\n企业微信通知失败：\n${notificationFailures.join("\n")}`
        : formatOperatorSummary(result);
      try { await showOperatorMessage(dialogText, exitCode !== 0 || notificationFailures.length > 0); } catch (dialogError) {
        process.stderr.write(`NoonASNCreator: ${dialogError instanceof Error ? dialogError.message : "Unable to show the result dialog"}\n`);
      }
    }
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown configuration error";
    process.stderr.write(`NoonASNCreator: ${message}\n`);
    if (!nonInteractive) {
      try { await showOperatorMessage(`程序未完成：\n${message}`, true); } catch { /* The console error remains available. */ }
    }
    return 2;
  }
}

const isPackaged = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (isPackaged || import.meta.url === invokedPath) {
  void main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`NoonASNCreator: ${error instanceof Error ? error.message : "Unexpected startup error"}\n`);
    process.exitCode = 2;
  });
}
