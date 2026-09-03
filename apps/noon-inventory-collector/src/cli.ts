import { open, mkdir, rm, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { outputFileName, type SiteCode, type StoreIndex } from "./contracts.js";
import { createLogger } from "./logger.js";
import type { OneDriveRoots } from "./onedrive.js";
import {
  createRunnerServices,
  runCollector,
  type CollectorOptions,
  type CollectorRunResult,
} from "./runner.js";
import { sendWeComNotification, validateWeComWebhookUrl } from "./wecom.js";

type Environment = Record<string, string | undefined>;

const DEFAULT_ONEDRIVE_ROOTS: OneDriveRoots = {
  KSA: "C:\\Users\\admin\\OneDrive - AXIS PROFESSIONALS LTD\\A202 中东Noon运营 - 文档\\2.0 中东\\1.1 Noon\\1.3 运营日常资料\\1. KSA资料\\1. 出入库\\1. Pending表",
  UAE: "C:\\Users\\admin\\OneDrive - AXIS PROFESSIONALS LTD\\A202 中东Noon运营 - 文档\\2.0 中东\\1.1 Noon\\1.3 运营日常资料\\2. UAE资料\\1. 出入库",
};

export interface CliDependencies {
  execute(options: CollectorOptions): Promise<CollectorRunResult>;
  now(): Date;
  lockPath: string;
}

class CliConfigurationError extends Error {}

function dateInShanghai(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CliConfigurationError(`Missing value for ${option}`);
  }
  return value;
}

function validateDate(value: string): string {
  try {
    outputFileName("UAE", 1, value);
    return value;
  } catch {
    throw new CliConfigurationError("Invalid --date; expected a real YYYY-MM-DD date");
  }
}

function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliConfigurationError("NOON_SNAPSHOT_MAX_AGE_MINUTES must be positive");
  }
  return parsed;
}

function parseOptions(argv: string[], env: Environment, now: Date): CollectorOptions {
  const command = argv[0];
  if (command !== "run" && command !== "dry-run") {
    throw new CliConfigurationError(command ? `Invalid command: ${command}` : "Missing command");
  }
  if (command === "run" && argv.length !== 1) {
    throw new CliConfigurationError("The run command does not accept CLI options");
  }

  let selectedSite: SiteCode | undefined;
  let selectedStore: StoreIndex | undefined;
  let outputOverride: string | undefined;
  let runDate = dateInShanghai(now);
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index]!;
    const value = optionValue(argv, index, option);
    if (option === "--site") {
      if (value !== "UAE" && value !== "KSA") {
        throw new CliConfigurationError("Invalid site; expected UAE or KSA");
      }
      selectedSite = value;
    } else if (option === "--store") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
        throw new CliConfigurationError("Invalid store; expected 1 through 6");
      }
      selectedStore = parsed as StoreIndex;
    } else if (option === "--out") {
      outputOverride = value;
    } else if (option === "--date") {
      runDate = validateDate(value);
    } else {
      throw new CliConfigurationError(`Unknown option: ${option}`);
    }
  }

  if (selectedStore !== undefined && selectedSite === undefined) {
    throw new CliConfigurationError("--store requires --site");
  }
  if (command === "dry-run" && outputOverride === undefined) {
    throw new CliConfigurationError("dry-run requires --out to protect the formal output root");
  }
  if (command === "run") {
    validateWeComWebhookUrl(env.WECOM_WEBHOOK_URL);
  }

  return {
    credentialDir: env.NOON_CREDENTIAL_DIR ?? "D:\\noon-api",
    outputRoot: outputOverride ?? env.NOON_OUTPUT_ROOT ?? "D:\\文件\\库存文件",
    runDate,
    sites: selectedSite ? [selectedSite] : ["UAE", "KSA"],
    storeIndexes: selectedStore ? [selectedStore] : [1, 2, 3, 4, 5, 6],
    dryRun: command === "dry-run",
    maximumAgeMinutes: positiveNumber(env.NOON_SNAPSHOT_MAX_AGE_MINUTES, 60),
    oneDriveRoots: command === "run" ? {
      KSA: env.NOON_KSA_ONEDRIVE_ROOT ?? DEFAULT_ONEDRIVE_ROOTS.KSA,
      UAE: env.NOON_UAE_ONEDRIVE_ROOT ?? DEFAULT_ONEDRIVE_ROOTS.UAE,
    } : undefined,
  };
}

async function defaultDependencies(env: Environment): Promise<CliDependencies> {
  const logger = await createLogger();
  const services = createRunnerServices(
    logger,
    (summary) => sendWeComNotification(summary, env.WECOM_WEBHOOK_URL),
  );
  return {
    execute: (options) => runCollector(options, services),
    now: () => new Date(),
    lockPath: join(
      env.LOCALAPPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(),
      "NoonInventoryCollector",
      "collector.lock",
    ),
  };
}

async function acquireLock(lockPath: string): Promise<FileHandle | undefined> {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${process.pid}\n`, "utf8");
    return handle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return undefined;
    }
    throw error;
  }
}

export async function main(
  argv: string[],
  env: Environment = process.env,
  injectedDependencies?: CliDependencies,
): Promise<number> {
  const dependencies = injectedDependencies ?? await defaultDependencies(env);
  let options: CollectorOptions;
  try {
    options = parseOptions(argv, env, dependencies.now());
  } catch (error) {
    if (error instanceof CliConfigurationError || error instanceof Error) {
      return 2;
    }
    return 2;
  }

  let lock: FileHandle | undefined;
  try {
    lock = await acquireLock(dependencies.lockPath);
    if (!lock) return 3;
    const result = await dependencies.execute(options);
    return result.successful ? 0 : 1;
  } catch {
    return 1;
  } finally {
    if (lock) {
      await lock.close();
      await rm(dependencies.lockPath, { force: true });
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = await main(process.argv.slice(2));
}
