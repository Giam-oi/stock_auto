import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AsnJob } from "./contracts.js";
import { AsnCreatorError } from "./errors.js";

export type JobStage =
  | "discovered"
  | "validated"
  | "creating"
  | "verifying"
  | "confirmed"
  | "sealed"
  | "written"
  | "skipped_existing"
  | "invalid_input"
  | "needs_review"
  | "failed";

export interface JournalError {
  kind: string;
  stage: string;
  message: string;
}

export interface JobEntry {
  key: string;
  filePath: string;
  fileName: string;
  fileFingerprint: string;
  projectCode: `PRJ${string}`;
  storeIndex: number;
  stage: JobStage;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  confirmedAsn?: string;
  pendingAsn?: string;
  error?: JournalError;
}

interface JournalDocument {
  version: 1;
  entries: Record<string, JobEntry>;
}

const TRANSITIONS: Record<JobStage, readonly JobStage[]> = {
  discovered: ["validated", "skipped_existing", "invalid_input", "needs_review"],
  validated: ["creating", "verifying", "failed", "needs_review"],
  creating: ["verifying", "failed", "needs_review"],
  verifying: ["confirmed", "needs_review", "failed", "creating"],
  confirmed: ["sealed", "written", "needs_review"],
  sealed: ["written", "needs_review"],
  written: [],
  skipped_existing: [],
  invalid_input: [],
  needs_review: ["validated"],
  failed: ["validated"],
};

export function journalKey(job: AsnJob): string {
  return createHash("sha256")
    .update(job.filePath)
    .update("\0")
    .update(job.fileFingerprint)
    .update("\0")
    .update(job.projectCode)
    .digest("hex");
}

export function createJobEntry(job: AsnJob, now = new Date().toISOString()): JobEntry {
  return {
    key: journalKey(job),
    filePath: job.filePath,
    fileName: job.fileName,
    fileFingerprint: job.fileFingerprint,
    projectCode: job.projectCode,
    storeIndex: job.storeIndex,
    stage: "discovered",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function transition(
  entry: JobEntry,
  next: JobStage,
  patch: Partial<Omit<JobEntry, "key" | "stage" | "createdAt">> = {},
  now = new Date().toISOString(),
): JobEntry {
  if (!TRANSITIONS[entry.stage].includes(next)) {
    throw new AsnCreatorError(
      "journal",
      false,
      "journal",
      `Invalid transition from ${entry.stage} to ${next}`,
    );
  }
  return { ...entry, ...patch, key: entry.key, stage: next, createdAt: entry.createdAt, updatedAt: now };
}

function defaultJournalPath(): string {
  const root = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? ".", "AppData", "Local");
  return join(root, "NoonASNCreator", "journal.json");
}

export interface JournalStoreHooks {
  beforeReplace?: () => Promise<void>;
}

export class JournalStore {
  constructor(
    readonly path = defaultJournalPath(),
    private readonly hooks: JournalStoreHooks = {},
  ) {}

  private async load(): Promise<JournalDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as JournalDocument;
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") {
        throw new Error("unsupported journal structure");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: {} };
      throw new AsnCreatorError("journal", false, "journal", "Failed to read ASN journal", { cause: error });
    }
  }

  async get(job: AsnJob): Promise<JobEntry | undefined> {
    return (await this.load()).entries[journalKey(job)];
  }

  async findByFilePath(filePath: string): Promise<readonly JobEntry[]> {
    return Object.values((await this.load()).entries)
      .filter((entry) => entry.filePath.toLowerCase() === filePath.toLowerCase())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async put(entry: JobEntry): Promise<void> {
    const document = await this.load();
    document.entries[entry.key] = entry;
    await mkdir(dirname(this.path), { recursive: true });
    const suffix = randomUUID();
    const temporaryPath = `${this.path}.${suffix}.tmp`;
    const backupPath = `${this.path}.${suffix}.bak`;
    let originalMoved = false;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    try {
      await this.hooks.beforeReplace?.();
      try {
        await rename(this.path, backupPath);
        originalMoved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(temporaryPath, this.path);
      if (originalMoved) await rm(backupPath, { force: true });
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (originalMoved) await rename(backupPath, this.path).catch(() => undefined);
      throw error;
    }
  }
}
