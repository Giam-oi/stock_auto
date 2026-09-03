import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { outputDirectoryName, type SiteCode } from "./contracts.js";
import { workbookContentHash } from "./summary.js";

const SALES_ORDER_ROOT =
  "C:\\Users\\admin\\OneDrive - AXIS PROFESSIONALS LTD\\A202 中东Noon运营 - 文档\\2.0 中东\\1.1 Noon\\1.1 发货与库存管理\\3.销售订单";

export const DEFAULT_ONEDRIVE_ROOTS: Record<SiteCode, string> = {
  KSA: join(SALES_ORDER_ROOT, "1.KSA"),
  UAE: join(SALES_ORDER_ROOT, "2.UAE"),
};

export interface OneDriveSyncResult {
  status: "published" | "skipped";
  path: string;
  contentSha256: string;
}

export function oneDriveWorkbookName(fromDate: string, toDate: string): string {
  return `${outputDirectoryName(fromDate, toDate)}.xlsx`;
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

export async function syncSummaryToOneDrive(input: {
  sourcePath: string;
  destinationRoot: string;
  fromDate: string;
  toDate: string;
  contentHasher?: (path: string) => Promise<string>;
}): Promise<OneDriveSyncResult> {
  const fileName = oneDriveWorkbookName(input.fromDate, input.toDate);
  const destinationPath = join(input.destinationRoot, fileName);
  const sourceHash = await hashFile(input.sourcePath);
  const contentHasher = input.contentHasher ?? workbookContentHash;
  const sourceContentHash = await contentHasher(input.sourcePath);
  await mkdir(input.destinationRoot, { recursive: true });

  if (await fileExists(destinationPath)) {
    const destinationContentHash = await contentHasher(destinationPath);
    if (destinationContentHash !== sourceContentHash) {
      throw new Error(`OneDrive sales workbook already exists with different content: ${destinationPath}`);
    }
    return { status: "skipped", path: destinationPath, contentSha256: sourceContentHash };
  }

  const stagingRoot = join(tmpdir(), "NoonSalesCollector", "onedrive-staging");
  const stagingPath = join(stagingRoot, `${randomUUID()}-${fileName}`);
  await mkdir(stagingRoot, { recursive: true });
  try {
    await copyFile(input.sourcePath, stagingPath);
    if ((await hashFile(stagingPath)) !== sourceHash) throw new Error("OneDrive staging verification failed");
    await rename(stagingPath, destinationPath);
    if ((await contentHasher(destinationPath)) !== sourceContentHash) throw new Error("OneDrive publication verification failed");
    return { status: "published", path: destinationPath, contentSha256: sourceContentHash };
  } finally {
    await rm(stagingPath, { force: true });
  }
}
