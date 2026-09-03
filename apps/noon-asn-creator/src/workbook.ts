import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { parseStoreIndex, storeConfig, type AsnItem, type AsnJob } from "./contracts.js";
import { AsnCreatorError } from "./errors.js";
import { readOoxmlSheet, updateOoxmlTextCell } from "./ooxml.js";

const SHEET_NAME = "约仓";
const REQUIRED_HEADERS = ["约仓SKU", "数量", "ASN"] as const;

export interface SkippedWorkbook {
  skippedAsn: string;
  filePath: string;
  job: AsnJob;
}

export type AsnWorkbookResult = AsnJob | SkippedWorkbook;

export function isSkippedWorkbook(result: AsnWorkbookResult): result is SkippedWorkbook {
  return "skippedAsn" in result;
}

function workbookError(fileName: string, message: string): AsnCreatorError {
  return new AsnCreatorError("workbook", false, "workbook", `${fileName}: ${message}`);
}

export async function discoverWorkbookPaths(folderPath: string): Promise<string[]> {
  const absoluteFolder = resolve(folderPath);
  const entries = await readdir(absoluteFolder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("~$") && extname(name).toLowerCase() === ".xlsx")
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }))
    .map((name) => join(absoluteFolder, name));
}

function scalarText(value: ExcelJS.CellValue, label: string, fileName: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  throw workbookError(fileName, `${label} must be a scalar value`);
}

function parseQuantity(value: ExcelJS.CellValue, rowNumber: number, fileName: string): number {
  const text = scalarText(value, `quantity at row ${rowNumber}`, fileName);
  const quantity = Number(text);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw workbookError(fileName, `quantity at row ${rowNumber} must be a positive integer`);
  }
  return quantity;
}

function normalizedItems(sheet: ExcelJS.Worksheet, fileName: string): AsnItem[] {
  const items: AsnItem[] = [];
  const seen = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const skuText = scalarText(row.getCell(1).value, `SKU at row ${rowNumber}`, fileName);
    const quantityText = scalarText(row.getCell(2).value, `quantity at row ${rowNumber}`, fileName);
    if (skuText === "" && quantityText === "") continue;
    if (skuText === "") throw workbookError(fileName, `SKU at row ${rowNumber} must not be blank`);
    const quantity = parseQuantity(row.getCell(2).value, rowNumber, fileName);
    const duplicateKey = skuText.toUpperCase();
    if (seen.has(duplicateKey)) {
      throw workbookError(fileName, `duplicate SKU at row ${rowNumber}: ${skuText}`);
    }
    seen.add(duplicateKey);
    items.push({ partnerSku: skuText, quantity });
  }
  if (items.length === 0) throw workbookError(fileName, "workbook contains no ASN items");
  return items;
}

function assertHeaders(sheet: ExcelJS.Worksheet, fileName: string): void {
  const actual = REQUIRED_HEADERS.map((_header, index) => sheet.getCell(1, index + 1).text.trim());
  if (actual.some((header, index) => header !== REQUIRED_HEADERS[index])) {
    throw workbookError(
      fileName,
      `header mismatch: expected ${REQUIRED_HEADERS.join("/")}, received ${actual.join("/")}`,
    );
  }
}

function fingerprint(bytes: Buffer, jobShape: object): string {
  return createHash("sha256")
    .update(bytes)
    .update("\0")
    .update(JSON.stringify(jobShape))
    .digest("hex");
}

async function loadWorkbook(filePath: string): Promise<{ workbook: ExcelJS.Workbook; bytes: Buffer }> {
  const bytes = await readFile(filePath);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  } catch (error) {
    throw new AsnCreatorError("workbook", false, "workbook", `${basename(filePath)}: cannot read XLSX`, { cause: error });
  }
  return { workbook, bytes };
}

function ooxmlScalar(value: string | number | undefined): string {
  return value === undefined ? "" : String(value).trim();
}

async function readOoxmlJob(
  absolutePath: string,
  fileName: string,
  bytes: Buffer,
  storeIndex: ReturnType<typeof parseStoreIndex>,
): Promise<AsnWorkbookResult> {
  const store = storeConfig(storeIndex);
  const sheet = await readOoxmlSheet(bytes, SHEET_NAME);
  const actualHeaders = REQUIRED_HEADERS.map((_header, index) => ooxmlScalar(sheet.values.get(`${String.fromCharCode(65 + index)}1`)));
  if (actualHeaders.some((header, index) => header !== REQUIRED_HEADERS[index])) {
    throw workbookError(fileName, `header mismatch: expected ${REQUIRED_HEADERS.join("/")}, received ${actualHeaders.join("/")}`);
  }
  const existingAsn = ooxmlScalar(sheet.values.get("C2"));

  const rowNumbers = [...sheet.values.keys()].map((address) => Number(address.match(/\d+$/)?.[0] ?? 0));
  const lastRow = Math.max(1, ...rowNumbers);
  const items: AsnItem[] = [];
  const seen = new Set<string>();
  for (let row = 2; row <= lastRow; row += 1) {
    const sku = ooxmlScalar(sheet.values.get(`A${row}`));
    const quantityText = ooxmlScalar(sheet.values.get(`B${row}`));
    if (sku === "" && quantityText === "") continue;
    if (sku === "") throw workbookError(fileName, `SKU at row ${row} must not be blank`);
    const quantity = Number(quantityText);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw workbookError(fileName, `quantity at row ${row} must be a positive integer`);
    const key = sku.toUpperCase();
    if (seen.has(key)) throw workbookError(fileName, `duplicate SKU at row ${row}: ${sku}`);
    seen.add(key);
    items.push({ partnerSku: sku, quantity });
  }
  if (items.length === 0) throw workbookError(fileName, "workbook contains no ASN items");
  const shape = { filePath: absolutePath, storeIndex, projectCode: store.projectCode, partnerId: store.partnerId, site: "UAE" as const, items };
  const job = { ...shape, fileName, fileFingerprint: fingerprint(bytes, shape) };
  if (existingAsn !== "") return { skippedAsn: existingAsn, filePath: absolutePath, job };
  return job;
}

export async function readAsnJob(filePath: string): Promise<AsnWorkbookResult> {
  const absolutePath = resolve(filePath);
  const fileName = basename(absolutePath);
  const storeIndex = parseStoreIndex(fileName);
  const store = storeConfig(storeIndex);
  const bytes = await readFile(absolutePath);
  let loaded: { workbook: ExcelJS.Workbook; bytes: Buffer };
  try {
    loaded = await loadWorkbook(absolutePath);
  } catch (excelError) {
    try {
      return await readOoxmlJob(absolutePath, fileName, bytes, storeIndex);
    } catch (ooxmlError) {
      throw new AsnCreatorError("workbook", false, "workbook", `${fileName}: cannot read XLSX`, { cause: ooxmlError ?? excelError });
    }
  }
  const { workbook } = loaded;
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw workbookError(fileName, `sheet ${SHEET_NAME} is missing`);
  assertHeaders(sheet, fileName);

  const existingAsn = sheet.getCell("C2").text.trim();
  const items = normalizedItems(sheet, fileName);
  const shape = {
    filePath: absolutePath,
    storeIndex,
    projectCode: store.projectCode,
    partnerId: store.partnerId,
    site: "UAE" as const,
    items,
  };
  const job: AsnJob = {
    ...shape,
    fileName,
    fileFingerprint: fingerprint(bytes, shape),
  };
  if (existingAsn !== "") return { skippedAsn: existingAsn, filePath: absolutePath, job };
  return job;
}

async function currentFingerprint(job: AsnJob): Promise<string> {
  const bytes = await readFile(job.filePath);
  const shape = {
    filePath: job.filePath,
    storeIndex: job.storeIndex,
    projectCode: job.projectCode,
    partnerId: job.partnerId,
    site: job.site,
    items: job.items,
  };
  return fingerprint(bytes, shape);
}

export async function writeAsnNumber(job: AsnJob, asnNumber: string): Promise<void> {
  const normalizedAsn = asnNumber.trim();
  if (normalizedAsn === "") throw workbookError(job.fileName, "ASN number must not be blank");
  if (await currentFingerprint(job) !== job.fileFingerprint) {
    throw workbookError(job.fileName, "workbook changed after it was read");
  }

  let workbook: ExcelJS.Workbook;
  try {
    ({ workbook } = await loadWorkbook(job.filePath));
  } catch {
    const originalBytes = await readFile(job.filePath);
    let updatedBytes: Buffer;
    try {
      const before = await readOoxmlSheet(originalBytes, SHEET_NAME);
      if (ooxmlScalar(before.values.get("C2")) !== "") throw workbookError(job.fileName, "workbook changed because C2 is no longer blank");
      updatedBytes = await updateOoxmlTextCell(originalBytes, SHEET_NAME, "C2", normalizedAsn);
    } catch (error) {
      if (error instanceof AsnCreatorError) throw error;
      throw new AsnCreatorError("workbook", false, "write-back", `${job.fileName}: failed to update OOXML C2`, { cause: error });
    }
    const suffix = randomUUID();
    const temporaryPath = join(dirname(job.filePath), `.${job.fileName}.${suffix}.tmp.xlsx`);
    const backupPath = join(dirname(job.filePath), `.${job.fileName}.${suffix}.bak.xlsx`);
    let originalMoved = false;
    try {
      await writeFile(temporaryPath, updatedBytes);
      const verification = await readOoxmlSheet(updatedBytes, SHEET_NAME);
      if (ooxmlScalar(verification.values.get("C2")) !== normalizedAsn) throw workbookError(job.fileName, "temporary workbook verification failed");
      await rename(job.filePath, backupPath);
      originalMoved = true;
      await rename(temporaryPath, job.filePath);
      await rm(backupPath, { force: true });
      return;
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (originalMoved) await rename(backupPath, job.filePath).catch(() => undefined);
      if (error instanceof AsnCreatorError) throw error;
      throw new AsnCreatorError("workbook", false, "write-back", `${job.fileName}: failed to save ASN`, { cause: error });
    }
  }
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw workbookError(job.fileName, `sheet ${SHEET_NAME} is missing during write-back`);
  if (sheet.getCell("C2").text.trim() !== "") {
    throw workbookError(job.fileName, "workbook changed because C2 is no longer blank");
  }
  sheet.getCell("C2").value = normalizedAsn;

  const suffix = randomUUID();
  const temporaryPath = join(dirname(job.filePath), `.${job.fileName}.${suffix}.tmp.xlsx`);
  const backupPath = join(dirname(job.filePath), `.${job.fileName}.${suffix}.bak.xlsx`);
  let originalMoved = false;
  try {
    await workbook.xlsx.writeFile(temporaryPath);
    const verification = new ExcelJS.Workbook();
    await verification.xlsx.readFile(temporaryPath);
    if (verification.getWorksheet(SHEET_NAME)?.getCell("C2").text.trim() !== normalizedAsn) {
      throw workbookError(job.fileName, "temporary workbook verification failed");
    }
    await rename(job.filePath, backupPath);
    originalMoved = true;
    await rename(temporaryPath, job.filePath);
    await rm(backupPath, { force: true });
    originalMoved = false;
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (originalMoved) {
      await rename(backupPath, job.filePath).catch(() => undefined);
    }
    if (error instanceof AsnCreatorError) throw error;
    throw new AsnCreatorError("workbook", false, "write-back", `${job.fileName}: failed to save ASN`, { cause: error });
  }
}
