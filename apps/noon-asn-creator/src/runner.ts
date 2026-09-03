import { basename } from "node:path";
import type { AsnGateway, AsnJob, AsnRecord, NoonSession, StoreIndex } from "./contracts.js";
import { AsnCreatorError } from "./errors.js";
import { JournalStore, createJobEntry, transition, type JobEntry, type JobStage } from "./journal.js";
import type { JsonLogger } from "./logger.js";
import { itemsExactlyMatch, reconcileUnique } from "./noon/verifier.js";
import {
  discoverWorkbookPaths,
  isSkippedWorkbook,
  readAsnJob,
  writeAsnNumber,
  type AsnWorkbookResult,
} from "./workbook.js";

interface SessionProvider {
  get(storeIndex: StoreIndex): Promise<NoonSession>;
}

interface BrowserFallback {
  createAndVerify(job: AsnJob, session: NoonSession): Promise<AsnRecord>;
}

export interface RunnerDependencies {
  journal: JournalStore;
  sessions: SessionProvider;
  gateway: AsnGateway;
  browser: BrowserFallback;
  logger?: JsonLogger;
  discoverWorkbooks?: (folderPath: string) => Promise<string[]>;
  readWorkbook?: (filePath: string) => Promise<AsnWorkbookResult>;
  writeAsn?: (job: AsnJob, asnNumber: string) => Promise<void>;
  onFolderDiscovered?: (filePaths: readonly string[]) => void | Promise<void>;
  onFileStart?: (filePath: string, index: number, total: number) => void | Promise<void>;
  onFileComplete?: (result: FileRunResult, index: number, total: number) => void | Promise<void>;
}

export interface FileRunResult {
  filePath: string;
  fileName: string;
  status: JobStage;
  asnNumber?: string;
  error?: { kind: string; stage: string; message: string };
}

export interface FolderRunResult {
  folderPath: string;
  files: readonly FileRunResult[];
}

function resultError(error: unknown): { kind: string; stage: string; message: string } {
  if (error instanceof AsnCreatorError) return { kind: error.kind, stage: error.stage, message: error.message };
  if (error instanceof Error) return { kind: "unexpected", stage: "runner", message: error.message };
  return { kind: "unexpected", stage: "runner", message: "Unknown runner error" };
}

async function putTransition(
  store: JournalStore,
  entry: JobEntry,
  stage: JobStage,
  patch: Partial<Omit<JobEntry, "key" | "stage" | "createdAt">> = {},
): Promise<JobEntry> {
  const next = transition(entry, stage, patch);
  await store.put(next);
  return next;
}

function verifyDetails(job: AsnJob, record: AsnRecord): void {
  if (record.projectCode !== job.projectCode || !itemsExactlyMatch(job.items, record.items)) {
    throw new AsnCreatorError("verification", false, "verify", "Noon ASN details do not exactly match the workbook");
  }
}

async function confirmedWrite(
  job: AsnJob,
  entry: JobEntry,
  record: AsnRecord,
  session: NoonSession,
  dependencies: RunnerDependencies,
): Promise<FileRunResult> {
  verifyDetails(job, record);
  const confirmed = entry.stage === "confirmed" || entry.stage === "sealed"
    ? entry
    : await putTransition(dependencies.journal, entry, "confirmed", { confirmedAsn: record.asnNumber });
  let readyToWrite = confirmed;
  if (confirmed.stage !== "sealed" && dependencies.gateway.seal) {
    try {
      const sealedRecord = await dependencies.gateway.seal(record.asnNumber, job, session);
      verifyDetails(job, sealedRecord);
      if (sealedRecord.status.toLowerCase() !== "sealed") {
        throw new AsnCreatorError("verification", true, "seal", "Noon ASN did not reach sealed status");
      }
      readyToWrite = await putTransition(dependencies.journal, confirmed, "sealed", { confirmedAsn: record.asnNumber });
    } catch (error) {
      return { filePath: job.filePath, fileName: job.fileName, status: "failed", asnNumber: record.asnNumber, error: resultError(error) };
    }
  }
  try {
    await (dependencies.writeAsn ?? writeAsnNumber)(job, record.asnNumber);
  } catch (error) {
    return { filePath: job.filePath, fileName: job.fileName, status: "failed", asnNumber: record.asnNumber, error: resultError(error) };
  }
  const written = await putTransition(dependencies.journal, readyToWrite, "written");
  return { filePath: job.filePath, fileName: job.fileName, status: written.stage, asnNumber: record.asnNumber };
}

async function recoverPendingAsn(
  job: AsnJob,
  entry: JobEntry,
  session: NoonSession,
  dependencies: RunnerDependencies,
): Promise<FileRunResult> {
  try {
    let pendingDetails = await dependencies.gateway.getDetails(entry.pendingAsn!, job, session);
    if (!itemsExactlyMatch(job.items, pendingDetails.items) && dependencies.gateway.resume) {
      await dependencies.gateway.resume(job, session, entry.pendingAsn!);
      pendingDetails = await dependencies.gateway.getDetails(entry.pendingAsn!, job, session);
    }
    if (pendingDetails.projectCode === job.projectCode && itemsExactlyMatch(job.items, pendingDetails.items)) {
      return confirmedWrite(job, entry, pendingDetails, session, dependencies);
    }
    return {
      filePath: job.filePath,
      fileName: job.fileName,
      status: "failed",
      error: { kind: "verification", stage: "resume", message: "Pending ASN is still incomplete after safe resume" },
    };
  } catch (error) {
    const serialized = resultError(error);
    if (serialized.kind === "verification" && serialized.stage === "route") {
      const review = await putTransition(dependencies.journal, entry, "needs_review", { error: serialized });
      return { filePath: job.filePath, fileName: job.fileName, status: review.stage, error: serialized };
    }
    return { filePath: job.filePath, fileName: job.fileName, status: "failed", error: serialized };
  }
}

export async function runFile(filePath: string, dependencies: RunnerDependencies): Promise<FileRunResult> {
  const readWorkbook = dependencies.readWorkbook ?? readAsnJob;
  let job: AsnJob | undefined;
  let entry: JobEntry | undefined;
  try {
    const workbook = await readWorkbook(filePath);
    if (isSkippedWorkbook(workbook)) {
      job = workbook.job;
      try {
        const session = await dependencies.sessions.get(job.storeIndex);
        const details = await dependencies.gateway.getDetails(workbook.skippedAsn, job, session);
        verifyDetails(job, details);
        if (dependencies.gateway.seal) {
          const sealed = await dependencies.gateway.seal(workbook.skippedAsn, job, session);
          verifyDetails(job, sealed);
          if (sealed.status.toLowerCase() !== "sealed") throw new AsnCreatorError("verification", true, "seal", "Noon ASN did not reach sealed status");
        }
        return { filePath: workbook.filePath, fileName: basename(workbook.filePath), status: "skipped_existing", asnNumber: workbook.skippedAsn };
      } catch (error) {
        return { filePath: workbook.filePath, fileName: basename(workbook.filePath), status: "failed", asnNumber: workbook.skippedAsn, error: resultError(error) };
      }
    }
    job = workbook;

    entry = await dependencies.journal.get(job);
    if (!entry) {
      const prior = (await dependencies.journal.findByFilePath(job.filePath)).find(
        (candidate) => candidate.fileFingerprint !== job!.fileFingerprint && Boolean(candidate.confirmedAsn),
      );
      entry = createJobEntry(job);
      await dependencies.journal.put(entry);
      if (prior) {
        const changedError = { kind: "workbook", stage: "reconcile", message: "Workbook changed after an ASN was confirmed" };
        entry = await putTransition(dependencies.journal, entry, "needs_review", {
          error: changedError,
        });
        return { filePath: job.filePath, fileName: job.fileName, status: entry.stage, error: changedError };
      }
    }

    const retryableCatalogReview = entry.stage === "needs_review" &&
      entry.error?.kind === "verification" &&
      entry.error.stage === "catalog" &&
      /unidentified storage/i.test(entry.error.message) &&
      !entry.pendingAsn && !entry.confirmedAsn;
    if (retryableCatalogReview) {
      const { error: _previousCatalogError, ...entryWithoutError } = entry;
      entry = await putTransition(dependencies.journal, entryWithoutError, "validated", { attempts: 0 });
    } else if (entry.stage === "needs_review") {
      return { filePath: job.filePath, fileName: job.fileName, status: entry.stage, ...(entry.confirmedAsn ? { asnNumber: entry.confirmedAsn } : {}), ...(entry.error ? { error: entry.error } : {}) };
    }
    if (entry.stage === "written") {
      return { filePath: job.filePath, fileName: job.fileName, status: "written", ...(entry.confirmedAsn ? { asnNumber: entry.confirmedAsn } : {}) };
    }
    const session = await dependencies.sessions.get(job.storeIndex);
    if ((entry.stage === "confirmed" || entry.stage === "sealed") && entry.confirmedAsn) {
      const recovered: AsnRecord = { asnNumber: entry.confirmedAsn, projectCode: job.projectCode, status: "confirmed", items: job.items };
      return confirmedWrite(job, entry, recovered, session, dependencies);
    }
    if (entry.stage === "failed") entry = await putTransition(dependencies.journal, entry, "validated");
    if (entry.stage === "discovered") entry = await putTransition(dependencies.journal, entry, "validated");
    if (entry.stage === "creating") entry = await putTransition(dependencies.journal, entry, "verifying");
    if (entry.stage === "validated") entry = await putTransition(dependencies.journal, entry, "verifying");

    if (entry.pendingAsn) {
      return recoverPendingAsn(job, entry, session, dependencies);
    }

    const existingRecords = await dependencies.gateway.findMatches(job, session);
    const existing = reconcileUnique(job, existingRecords);
    if (existing) {
      const details = await dependencies.gateway.getDetails(existing.asnNumber, job, session);
      return confirmedWrite(job, entry, details, session, dependencies);
    }

    // A prior create reached the server or lost its response. Only reconciliation is safe on rerun.
    if (entry.attempts > 0) {
      return {
        filePath: job.filePath,
        fileName: job.fileName,
        status: "failed",
        error: { kind: "verification", stage: "reconcile", message: "No exact ASN match found after an earlier create attempt" },
      };
    }

    entry = await putTransition(dependencies.journal, entry, "creating", { attempts: entry.attempts + 1 });
    let explicitCreateError: unknown;
    let outcome: "accepted" | "uncertain" = "uncertain";
    let pendingAsn: string | undefined;
    try {
      ({ outcome, asnNumber: pendingAsn } = await dependencies.gateway.create(job, session));
    } catch (error) {
      explicitCreateError = error;
    }
    entry = await putTransition(dependencies.journal, entry, "verifying", pendingAsn ? { pendingAsn } : {});

    if (explicitCreateError) {
      const createFailure = resultError(explicitCreateError);
      if (createFailure.kind === "verification" && createFailure.stage === "catalog") {
        entry = await putTransition(dependencies.journal, entry, "needs_review", { error: createFailure });
        return { filePath: job.filePath, fileName: job.fileName, status: entry.stage, error: createFailure };
      }
    }

    if (pendingAsn) return recoverPendingAsn(job, entry, session, dependencies);

    const afterCreate = reconcileUnique(job, await dependencies.gateway.findMatches(job, session));
    if (afterCreate) {
      const details = await dependencies.gateway.getDetails(afterCreate.asnNumber, job, session);
      return confirmedWrite(job, entry, details, session, dependencies);
    }

    if (explicitCreateError) {
      try {
        const browserRecord = await dependencies.browser.createAndVerify(job, session);
        return confirmedWrite(job, entry, browserRecord, session, dependencies);
      } catch (browserError) {
        const browserFailure = resultError(browserError);
        entry = await putTransition(dependencies.journal, entry, "failed", { error: browserFailure });
        return { filePath: job.filePath, fileName: job.fileName, status: entry.stage, error: browserFailure };
      }
    }

    return {
      filePath: job.filePath,
      fileName: job.fileName,
      status: "failed",
      error: {
        kind: outcome === "uncertain" ? "network" : "verification",
        stage: "reconcile",
        message: outcome === "uncertain"
          ? "ASN create outcome is uncertain; rerun will reconcile without creating again"
          : "No exact ASN match found after Noon accepted the create request",
      },
    };
  } catch (error) {
    const serialized = resultError(error);
    if (job && entry) {
      const needsReview = serialized.kind === "verification" && /multiple/i.test(serialized.message);
      const target = needsReview ? "needs_review" : "failed";
      try {
        if (entry.stage !== target && entry.stage !== "confirmed" && entry.stage !== "written") {
          entry = await putTransition(dependencies.journal, entry, target, { error: serialized });
        }
      } catch {
        // Preserve and report the original operational failure.
      }
      return { filePath: job.filePath, fileName: job.fileName, status: target, error: serialized };
    }
    return { filePath, fileName: basename(filePath), status: "invalid_input", error: serialized };
  }
}

export async function runFolder(folderPath: string, dependencies: RunnerDependencies): Promise<FolderRunResult> {
  const paths = await (dependencies.discoverWorkbooks ?? discoverWorkbookPaths)(folderPath);
  await dependencies.onFolderDiscovered?.(paths);
  const files: FileRunResult[] = [];
  for (const [offset, path] of paths.entries()) {
    const index = offset + 1;
    await dependencies.onFileStart?.(path, index, paths.length);
    const result = await runFile(path, dependencies);
    files.push(result);
    await dependencies.logger?.write({ event: "file_result", ...result });
    await dependencies.onFileComplete?.(result, index, paths.length);
  }
  return { folderPath, files };
}
