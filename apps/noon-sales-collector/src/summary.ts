import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { parseCsv } from "./csv.js";

const SUMMARY_FIELDS = [
  "id_partner", "src_country", "country_code", "item_nr", "partner_sku", "sku", "status",
  "offer_price", "gmv_lcy", "currency_code", "brand_code", "family", "fulfillment_model",
  "order_timestamp", "shipment_timestamp", "delivered_timestamp",
] as const;

const EXCLUDED_SUMMARY_STATUSES = new Set(["cancelled", "could not be delivered"]);

function excelSerial(value: string, dateOnly: boolean): number | null {
  if (!value) return null;
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) throw new Error(`Invalid Noon timestamp: ${value}`);
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const milliseconds = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    dateOnly ? 0 : Number(hour), dateOnly ? 0 : Number(minute), dateOnly ? 0 : Number(second),
  );
  return milliseconds / 86_400_000 + 25_569;
}

export function summaryRows(csvTexts: readonly string[]): Array<Array<string | number | null>> {
  const result: Array<Array<string | number | null>> = [];
  for (const text of csvTexts) {
    const parsed = parseCsv(text.replace(/^\uFEFF/, ""));
    const headers = parsed[0];
    if (!headers) continue;
    const indexes = Object.fromEntries(headers.map((header, index) => [header, index])) as Record<string, number>;
    for (const row of parsed.slice(1)) {
      const status = (row[indexes.status!] ?? "").trim().toLowerCase();
      if (EXCLUDED_SUMMARY_STATUSES.has(status)) continue;
      result.push(SUMMARY_FIELDS.map((field) => {
        const value = row[indexes[field]!] ?? "";
        if (field === "offer_price" || field === "gmv_lcy") return value === "" ? null : Number(value);
        if (field === "order_timestamp") return excelSerial(value, true);
        if (field === "shipment_timestamp" || field === "delivered_timestamp") return excelSerial(value, false);
        return value;
      }));
    }
  }
  return result;
}

export async function writeSummaryWorkbook(csvTexts: readonly string[], outputPath: string): Promise<void> {
  const rows = summaryRows(csvTexts);
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("Sheet1");
  if (rows.length > 0) {
    sheet.getRangeByIndexes(0, 0, rows.length, SUMMARY_FIELDS.length).values = rows;
    sheet.getRangeByIndexes(0, 13, rows.length, 1).format.numberFormat = "m/d/yy";
    sheet.getRangeByIndexes(0, 14, rows.length, 2).format.numberFormat = "m/d/yy h:mm";
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const file = await SpreadsheetFile.exportXlsx(workbook);
  await file.save(outputPath);
}

export async function workbookContentHash(path: string): Promise<string> {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
  const values = workbook.worksheets.getItemAt(0).getUsedRange(true)?.values ?? [];
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
