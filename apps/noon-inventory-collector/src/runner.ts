import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { loginNoon, type NoonSession } from "./auth.js";
import {
  SITE_CONFIGS,
  STORE_CONFIGS,
  outputFileName,
  type SiteCode,
  type SiteConfig,
  type StoreConfig,
  type StoreIndex,
} from "./contracts.js";
import { validateInventoryCsv, type InventoryStats, type ValidatedInventoryCsv } from "./csv.js";
import { loadCredential, type NoonCredential } from "./credentials.js";
import type { CollectorLogger } from "./logger.js";
import { oneDriveInventoryDirectory, type OneDriveRoots } from "./onedrive.js";
import {
  publishSiteFiles,
  stageSiteFiles,
  type InventoryFile,
  type PublishedSiteResult,
  type StageSiteInput,
  type StagedSiteFiles,
} from "./publisher.js";
import {
  fetchRealtimeInventory,
  type InventoryDownload,
  type InventoryRequest,
} from "./realtime-client.js";
import { withRetry } from "./retry.js";
import type { NotificationSummary } from "./wecom.js";

export interface RunnerServices {
  loadCredential(path: string, store: StoreConfig): Promise<NoonCredential>;
  login(credential: NoonCredential): Promise<NoonSession>;
  download(input: InventoryRequest): Promise<InventoryDownload>;
  validate(
    download: InventoryDownload,
    store: StoreConfig,
    site: SiteConfig,
    now: Date,
    maximumAgeMinutes: number,
  ): ValidatedInventoryCsv;
  stage(input: StageSiteInput): Promise<StagedSiteFiles>;
  publish(staged: StagedSiteFiles): Promise<PublishedSiteResult>;
  notify(summary: NotificationSummary): Promise<void>;
  logger: CollectorLogger;
  now(): Date;
  createRunId(): string;
  sleep(milliseconds: number): Promise<void>;
}

export interface CollectorOptions {
  credentialDir: string;
  outputRoot: string;
  runDate: string;
  sites: SiteCode[];
  storeIndexes: StoreIndex[];
  dryRun: boolean;
  maximumAgeMinutes: number;
  oneDriveRoots?: OneDriveRoots;
}

export interface StoreRunResult {
  site: SiteCode;
  storeIndex: number;
  projectCode: string;
  fileName: string;
  attempts: number;
  status: "success" | "failed";
  stats?: InventoryStats;
  error?: { kind: string; stage: string; message: string };
}

export interface StoreExecution {
  result: StoreRunResult;
  file?: InventoryFile;
}

export interface SiteRunResult {
  site: SiteCode;
  status: "success" | "failed" | "skipped";
  stores: StoreRunResult[];
  finalDirectory?: string;
  stagingDirectory?: string;
  oneDriveDirectory?: string;
  error?: { kind: string; stage: string; message: string };
}

export interface CollectorRunResult {
  runId: string;
  runDate: string;
  startedAt: string;
  completedAt: string;
  sites: Record<SiteCode, SiteRunResult>;
  notificationStatus: "success" | "failed" | "skipped";
  successful: boolean;
}

export interface RunStoreInput {
  store: StoreConfig;
  site: SiteConfig;
  credentialDir: string;
  runDate: string;
  maximumAgeMinutes: number;
}

function errorDetails(error: unknown, stage: string): { kind: string; stage: string; message: string } {
  const record = typeof error === "object" && error !== null
    ? error as { kind?: unknown; name?: unknown; message?: unknown }
    : {};
  return {
    kind: typeof record.kind === "string"
      ? record.kind
      : typeof record.name === "string"
        ? record.name
        : "unknown",
    stage,
    message: typeof record.message === "string" ? record.message : String(error),
  };
}

function errorAttempts(error: unknown): number {
  if (typeof error === "object" && error !== null && "attempts" in error) {
    const attempts = Number((error as { attempts?: unknown }).attempts);
    if (Number.isInteger(attempts) && attempts > 0) return attempts;
  }
  return 1;
}

export async function runStore(
  input: RunStoreInput,
  services: RunnerServices,
): Promise<StoreExecution> {
  let stage = "credential";
  const fileName = outputFileName(input.site.code, input.store.index, input.runDate);
  try {
    const retried = await withRetry(async () => {
      stage = "credential";
      const credential = await services.loadCredential(
        join(input.credentialDir, input.store.credentialFile),
        input.store,
      );
      stage = "authentication";
      const session = await services.login(credential);
      stage = "download";
      const downloaded = await services.download({
        store: input.store,
        site: input.site,
        cookieHeader: session.cookieHeader,
      });
      stage = "validation";
      return services.validate(
        downloaded,
        input.store,
        input.site,
        services.now(),
        input.maximumAgeMinutes,
      );
    }, { delaysMs: [30_000, 90_000], sleep: services.sleep });

    const file: InventoryFile = {
      storeIndex: input.store.index,
      fileName,
      csvText: retried.value.csvText,
      stats: retried.value.stats,
    };
    return {
      file,
      result: {
        site: input.site.code,
        storeIndex: input.store.index,
        projectCode: input.store.projectCode,
        fileName,
        attempts: retried.attempts,
        status: "success",
        stats: retried.value.stats,
      },
    };
  } catch (error) {
    return {
      result: {
        site: input.site.code,
        storeIndex: input.store.index,
        projectCode: input.store.projectCode,
        fileName,
        attempts: errorAttempts(error),
        status: "failed",
        error: errorDetails(error, stage),
      },
    };
  }
}

export async function runSite(
  siteCode: SiteCode,
  options: CollectorOptions,
  runId: string,
  services: RunnerServices,
): Promise<SiteRunResult> {
  const site = SITE_CONFIGS[siteCode];
  const selectedStores = options.storeIndexes.map((index) => STORE_CONFIGS[index - 1]!);
  const executions: StoreExecution[] = [];
  for (const store of selectedStores) {
    const execution = await runStore({
      store,
      site,
      credentialDir: options.credentialDir,
      runDate: options.runDate,
      maximumAgeMinutes: options.maximumAgeMinutes,
    }, services);
    executions.push(execution);
    await services.logger[execution.result.status === "success" ? "info" : "error"](
      "store_complete",
      execution.result,
    );
  }

  const stores = executions.map((execution) => execution.result);
  const validatedFiles = executions.flatMap((execution) => execution.file ? [execution.file] : []);
  if (validatedFiles.length !== selectedStores.length) {
    return { site: siteCode, status: "failed", stores };
  }

  let stage = "staging";
  let localFinalDirectory: string | undefined;
  try {
    const staged = await services.stage({
      outputRoot: options.outputRoot,
      runId,
      runDate: options.runDate,
      site: siteCode,
      files: validatedFiles,
      expectedStoreIndexes: options.storeIndexes,
    });
    if (options.dryRun) {
      return {
        site: siteCode,
        status: "success",
        stores,
        stagingDirectory: staged.stagingDirectory,
      };
    }
    stage = "publish";
    const published = await services.publish(staged);
    localFinalDirectory = published.finalDirectory;
    let syncedDirectory: string | undefined;
    if (options.oneDriveRoots) {
      stage = "onedrive-staging";
      const targetDirectory = oneDriveInventoryDirectory(
        siteCode,
        options.runDate,
        options.oneDriveRoots,
      );
      const oneDriveStaged = await services.stage({
        outputRoot: options.oneDriveRoots[siteCode],
        targetDirectory,
        runId: `${runId}-onedrive`,
        runDate: options.runDate,
        site: siteCode,
        files: validatedFiles,
        expectedStoreIndexes: options.storeIndexes,
      });
      stage = "onedrive-publish";
      const oneDrivePublished = await services.publish(oneDriveStaged);
      syncedDirectory = oneDrivePublished.finalDirectory;
    }
    return {
      site: siteCode,
      status: "success",
      stores,
      finalDirectory: published.finalDirectory,
      oneDriveDirectory: syncedDirectory,
    };
  } catch (error) {
    const detail = errorDetails(error, stage);
    await services.logger.error("site_publish_failed", { site: siteCode, ...detail });
    return {
      site: siteCode,
      status: "failed",
      stores,
      finalDirectory: localFinalDirectory,
      error: detail,
    };
  }
}

function notificationSummary(result: CollectorRunResult): NotificationSummary {
  const selected = (Object.values(result.sites) as SiteRunResult[]).filter(
    (site) => site.status !== "skipped",
  );
  return {
    runId: result.runId,
    runDate: result.runDate,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    status: selected.every((site) => site.status === "success") ? "success" : "failure",
    sites: selected.map((site) => ({
      site: site.site,
      status: site.status === "success" ? "success" : "failed",
      error: site.error,
      stores: site.stores.map((store) => ({
        storeIndex: store.storeIndex,
        status: store.status,
        attempts: store.attempts,
        fileName: store.fileName,
        snapshotAt: store.stats?.snapshotAtUtc.toISOString(),
        rowCount: store.stats?.rowCount,
        saleableSkuCount: store.stats?.saleableSkuCount,
        saleableQty: store.stats?.saleableQty,
        error: store.error,
      })),
    })),
  };
}

export async function runCollector(
  options: CollectorOptions,
  services: RunnerServices,
): Promise<CollectorRunResult> {
  const startedAt = services.now().toISOString();
  const runId = services.createRunId();
  const sites: Record<SiteCode, SiteRunResult> = {
    UAE: { site: "UAE", status: "skipped", stores: [] },
    KSA: { site: "KSA", status: "skipped", stores: [] },
  };
  await services.logger.info("run_started", { runId, options });

  for (const site of options.sites) {
    try {
      sites[site] = await runSite(site, options, runId, services);
    } catch (error) {
      sites[site] = {
        site,
        status: "failed",
        stores: [],
        error: errorDetails(error, "site"),
      };
    }
  }

  const result: CollectorRunResult = {
    runId,
    runDate: options.runDate,
    startedAt,
    completedAt: services.now().toISOString(),
    sites,
    notificationStatus: options.dryRun ? "skipped" : "success",
    successful: false,
  };
  const sitesSuccessful = options.sites.every((site) => sites[site].status === "success");

  if (!options.dryRun) {
    try {
      await services.notify(notificationSummary(result));
    } catch (error) {
      result.notificationStatus = "failed";
      await services.logger.error("notification_failed", error);
    }
  }
  result.successful = sitesSuccessful && result.notificationStatus !== "failed";
  await services.logger.info("run_completed", result);
  return result;
}

export function createRunnerServices(
  logger: CollectorLogger,
  notify: RunnerServices["notify"],
): RunnerServices {
  return {
    loadCredential,
    login: (credential) => loginNoon(credential),
    download: (input) => fetchRealtimeInventory(input),
    validate: validateInventoryCsv,
    stage: stageSiteFiles,
    publish: publishSiteFiles,
    notify,
    logger,
    now: () => new Date(),
    createRunId: randomUUID,
    sleep: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
}
