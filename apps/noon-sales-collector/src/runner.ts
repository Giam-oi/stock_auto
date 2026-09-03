import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loginNoon } from "./auth.js";
import { loadCredential } from "./credentials.js";
import {
  outputCsvName, outputDirectoryName, SITE_CONFIGS, STORE_CONFIGS, summaryWorkbookName,
  type SiteCode,
} from "./contracts.js";
import { validateSalesCsv } from "./csv.js";
import { fetchSalesExport } from "./sales-client.js";
import { writeSummaryWorkbook } from "./summary.js";
import { withRetry } from "./retry.js";
import { syncSummaryToOneDrive, type OneDriveSyncResult } from "./onedrive.js";

export interface CollectorOptions {
  sites: readonly SiteCode[];
  fromDate: string;
  toDate: string;
  credentialDir: string;
  outputRoot: string;
  oneDriveRoots?: Record<SiteCode, string>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface StoreResult {
  projectCode: string;
  partnerId: string;
  rows: number;
  fileName: string;
}

export interface SiteResult {
  site: SiteCode;
  status: "published" | "skipped";
  directory: string;
  stores: StoreResult[];
  oneDrive?: OneDriveSyncResult;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isCompleteTarget(directory: string, site: SiteCode): Promise<boolean> {
  const names = new Set(await readdir(directory));
  const expected = [
    ...STORE_CONFIGS.map((store) => outputCsvName(site, store.partnerId)),
    summaryWorkbookName(site),
  ];
  return expected.every((name) => names.has(name));
}

export async function runSite(options: CollectorOptions, siteCode: SiteCode): Promise<SiteResult> {
  const site = SITE_CONFIGS[siteCode];
  const siteRoot = join(options.outputRoot, siteCode);
  const directoryName = outputDirectoryName(options.fromDate, options.toDate);
  const targetDirectory = join(siteRoot, directoryName);
  if (await exists(targetDirectory)) {
    if (!(await isCompleteTarget(targetDirectory, siteCode))) {
      throw new Error(`Existing sales output is incomplete: ${targetDirectory}`);
    }
    return { site: siteCode, status: "skipped", directory: targetDirectory, stores: [] };
  }

  const stagingRoot = join(options.outputRoot, ".sales-staging");
  const stagingDirectory = join(stagingRoot, `${siteCode}-${directoryName}-${randomUUID()}`);
  await mkdir(stagingDirectory, { recursive: true });
  const csvTexts: string[] = [];
  const stores: StoreResult[] = [];
  try {
    for (const store of STORE_CONFIGS) {
      try {
        const completed = await withRetry(async () => {
          const credential = await loadCredential(join(options.credentialDir, store.credentialFile), store);
          const session = await loginNoon(credential);
          const download = await fetchSalesExport({
            store,
            site,
            cookieHeader: session.cookieHeader,
            fromDate: options.fromDate,
            toDate: options.toDate,
            pollIntervalMs: options.pollIntervalMs,
            timeoutMs: options.timeoutMs,
          });
          return validateSalesCsv(download.csvText, store, site, options.fromDate, options.toDate);
        });
        const fileName = outputCsvName(siteCode, store.partnerId);
        await writeFile(join(stagingDirectory, fileName), completed.csvText, "utf8");
        csvTexts.push(completed.csvText);
        stores.push({ projectCode: store.projectCode, partnerId: store.partnerId, rows: completed.rows.length, fileName });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${siteCode} ${store.projectCode} failed: ${message}`);
      }
    }
    const sorted = stores
      .map((store, index) => ({ store, csvText: csvTexts[index]! }))
      .sort((left, right) => left.store.partnerId.localeCompare(right.store.partnerId));
    const summaryPath = join(stagingDirectory, summaryWorkbookName(siteCode));
    await writeSummaryWorkbook(sorted.map((item) => item.csvText), summaryPath);
    await rm(`${summaryPath}.inspect.ndjson`, { force: true });
    await mkdir(siteRoot, { recursive: true });
    if (await exists(targetDirectory)) throw new Error(`Sales output appeared during publish: ${targetDirectory}`);
    await rename(stagingDirectory, targetDirectory);
    return { site: siteCode, status: "published", directory: targetDirectory, stores };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function runCollector(options: CollectorOptions): Promise<SiteResult[]> {
  const settled = await Promise.allSettled(options.sites.map((site) => runSite(options, site)));
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), "Sales collection failed");
  const results = settled.map((result) => (result as PromiseFulfilledResult<SiteResult>).value);
  if (!options.oneDriveRoots) return results;

  const synced = await Promise.allSettled(results.map(async (result) => {
    try {
      const oneDrive = await syncSummaryToOneDrive({
        sourcePath: join(result.directory, summaryWorkbookName(result.site)),
        destinationRoot: options.oneDriveRoots![result.site],
        fromDate: options.fromDate,
        toDate: options.toDate,
      });
      return { ...result, oneDrive };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${result.site} OneDrive sync failed: ${message}`);
    }
  }));
  const syncFailures = synced.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (syncFailures.length > 0) {
    throw new AggregateError(syncFailures.map((failure) => failure.reason), "Sales OneDrive sync failed");
  }
  return synced.map((result) => (result as PromiseFulfilledResult<SiteResult>).value);
}
