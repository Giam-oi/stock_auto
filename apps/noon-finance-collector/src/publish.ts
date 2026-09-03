import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface PendingFile {
  name: string;
  csvText: string;
  rows: number;
  projectCode: string;
  site: string;
  report: string;
  exportCode: string;
}

function hash(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function existingHash(path: string): Promise<string | undefined> {
  try { return hash(await readFile(path)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function publishFiles(
  files: readonly PendingFile[],
  localDirectory: string,
  oneDriveDirectory?: string,
): Promise<{ localDirectory: string; oneDriveDirectory?: string; published: number; skipped: number }> {
  if (files.length !== 18) throw new Error(`Finance publication requires exactly 18 files, received ${files.length}`);
  const names = new Set(files.map((file) => file.name));
  if (names.size !== 18) throw new Error("Finance publication contains duplicate file names");

  const destinations = [localDirectory, ...(oneDriveDirectory ? [oneDriveDirectory] : [])];
  let skipped = 0;
  for (const directory of destinations) {
    for (const file of files) {
      const current = await existingHash(join(directory, file.name));
      if (current !== undefined && current !== hash(file.csvText)) {
        throw new Error(`Finance file already exists with different content: ${join(directory, file.name)}`);
      }
    }
  }

  for (const directory of destinations) {
    await mkdir(directory, { recursive: true });
    for (const file of files) {
      const target = join(directory, file.name);
      if (await existingHash(target)) { skipped += 1; continue; }
      const staging = join(directory, `.${file.name}.${randomUUID()}.tmp`);
      await writeFile(staging, file.csvText, "utf8");
      await rename(staging, target);
    }
  }
  return { localDirectory, oneDriveDirectory, published: destinations.length * files.length - skipped, skipped };
}
