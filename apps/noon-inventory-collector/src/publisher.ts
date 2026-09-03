import {
  mkdir,
  open,
  readFile,
  rename as nativeRename,
  rmdir,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { InventoryStats } from "./csv.js";
import {
  outputDirectory,
  outputFileName,
  type SiteCode,
  type StoreIndex,
} from "./contracts.js";

export interface InventoryFile {
  storeIndex: StoreIndex;
  fileName: string;
  csvText: string;
  stats: InventoryStats;
}

interface StagedFile extends InventoryFile {
  byteSize: number;
}

export interface StageSiteInput {
  outputRoot: string;
  targetDirectory?: string;
  runId: string;
  runDate: string;
  site: SiteCode;
  files: InventoryFile[];
  expectedStoreIndexes: StoreIndex[];
}

export interface StagedSiteFiles {
  outputRoot: string;
  targetDirectory?: string;
  runId: string;
  runDate: string;
  site: SiteCode;
  stagingDirectory: string;
  files: StagedFile[];
  expectedStoreIndexes: StoreIndex[];
}

export interface PublishedSiteResult {
  site: SiteCode;
  runDate: string;
  finalDirectory: string;
  fileNames: string[];
}

export interface PublisherOperations {
  rename?: (source: string, destination: string) => Promise<void>;
}

const PRODUCTION_STORES: StoreIndex[] = [1, 2, 3, 4, 5, 6];

function sameIndexes(actual: StoreIndex[], expected: StoreIndex[]): boolean {
  return actual.length === expected.length &&
    actual.slice().sort().every((value, index) => value === expected.slice().sort()[index]);
}

function validateFileSet(input: StageSiteInput): void {
  const expected = input.expectedStoreIndexes;
  const actual = input.files.map((file) => file.storeIndex);
  const uniqueExpected = new Set(expected);
  const uniqueActual = new Set(actual);
  if (
    uniqueExpected.size !== expected.length ||
    uniqueActual.size !== actual.length ||
    !sameIndexes(actual, expected)
  ) {
    throw new Error("Invalid inventory file set: store indexes do not match expected stores");
  }
  for (const file of input.files) {
    if (file.fileName !== outputFileName(input.site, file.storeIndex, input.runDate)) {
      throw new Error("Invalid inventory file set: filename does not match site, store, and date");
    }
  }
}

export async function stageSiteFiles(input: StageSiteInput): Promise<StagedSiteFiles> {
  validateFileSet(input);
  const stagingDirectory = join(input.outputRoot, ".staging", input.runId, input.site);
  await mkdir(stagingDirectory, { recursive: true });
  const stagedFiles: StagedFile[] = [];

  for (const file of input.files) {
    const partialPath = join(stagingDirectory, `${file.fileName}.partial`);
    const stagedPath = join(stagingDirectory, file.fileName);
    const handle = await open(partialPath, "w");
    try {
      await handle.writeFile(file.csvText, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await nativeRename(partialPath, stagedPath);

    const byteSize = Buffer.byteLength(file.csvText, "utf8");
    const stagedStat = await stat(stagedPath);
    const firstLine = (await readFile(stagedPath, "utf8")).split(/\r?\n/, 1)[0] ?? "";
    if (stagedStat.size !== byteSize || firstLine.trim() === "") {
      throw new Error(`Staged inventory verification failed for ${file.fileName}`);
    }
    stagedFiles.push({ ...file, byteSize });
  }

  return {
    outputRoot: input.outputRoot,
    targetDirectory: input.targetDirectory,
    runId: input.runId,
    runDate: input.runDate,
    site: input.site,
    stagingDirectory,
    files: stagedFiles,
    expectedStoreIndexes: input.expectedStoreIndexes.slice(),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") {
      throw error;
    }
  }
}

interface RollbackState {
  finalDirectory: string;
  stagingDirectory: string;
  previousDirectory: string;
  movedNewFileNames: string[];
  backedUpFileNames: string[];
}

export async function rollbackPublish(
  state: RollbackState,
  rename: (source: string, destination: string) => Promise<void> = nativeRename,
): Promise<void> {
  for (const fileName of state.movedNewFileNames.slice().reverse()) {
    const finalPath = join(state.finalDirectory, fileName);
    if (await pathExists(finalPath)) {
      await rename(finalPath, join(state.stagingDirectory, fileName));
    }
  }
  for (const fileName of state.backedUpFileNames.slice().reverse()) {
    const previousPath = join(state.previousDirectory, fileName);
    if (await pathExists(previousPath)) {
      await rename(previousPath, join(state.finalDirectory, fileName));
    }
  }
}

export async function publishSiteFiles(
  staged: StagedSiteFiles,
  operations: PublisherOperations = {},
): Promise<PublishedSiteResult> {
  if (!sameIndexes(staged.expectedStoreIndexes, PRODUCTION_STORES)) {
    throw new Error("Production publication requires exactly stores 1-6");
  }

  const rename = operations.rename ?? nativeRename;
  const finalDirectory = staged.targetDirectory ??
    outputDirectory(staged.outputRoot, staged.site, staged.runDate);
  const previousDirectory = join(staged.stagingDirectory, ".previous");
  await mkdir(finalDirectory, { recursive: true });
  await mkdir(previousDirectory, { recursive: true });
  const state: RollbackState = {
    finalDirectory,
    stagingDirectory: staged.stagingDirectory,
    previousDirectory,
    movedNewFileNames: [],
    backedUpFileNames: [],
  };

  try {
    for (const file of staged.files) {
      const finalPath = join(finalDirectory, file.fileName);
      if (await pathExists(finalPath)) {
        await rename(finalPath, join(previousDirectory, file.fileName));
        state.backedUpFileNames.push(file.fileName);
      }
    }

    for (const file of staged.files) {
      await rename(join(staged.stagingDirectory, file.fileName), join(finalDirectory, file.fileName));
      state.movedNewFileNames.push(file.fileName);
    }

    for (const file of staged.files) {
      const finalStat = await stat(join(finalDirectory, file.fileName));
      if (finalStat.size !== file.byteSize) {
        throw new Error(`Published inventory verification failed for ${file.fileName}`);
      }
    }
  } catch (error) {
    try {
      await rollbackPublish(state, rename);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Inventory publication and rollback both failed");
    }
    throw error;
  }

  await rm(staged.stagingDirectory, { recursive: true, force: true });
  const runStagingDirectory = dirname(staged.stagingDirectory);
  await removeEmptyDirectory(runStagingDirectory);
  await removeEmptyDirectory(dirname(runStagingDirectory));
  return {
    site: staged.site,
    runDate: staged.runDate,
    finalDirectory,
    fileNames: staged.files.map((file) => file.fileName),
  };
}
