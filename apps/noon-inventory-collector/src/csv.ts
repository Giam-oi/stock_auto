import type { SiteConfig, StoreConfig } from "./contracts.js";
import type { InventoryDownload } from "./realtime-client.js";

const REQUIRED_HEADERS = [
  "inventory_type",
  "partner_sku",
  "qty",
  "id_partner",
  "inventory_snapshot_at",
  "country_code",
] as const;

export interface InventoryStats {
  partnerId: string;
  countryCode: "AE" | "SA";
  snapshotAtUtc: Date;
  rowCount: number;
  saleableRowCount: number;
  saleableSkuCount: number;
  saleableQty: number;
}

export interface ValidatedInventoryCsv {
  csvText: string;
  stats: InventoryStats;
}

function finishRow(rows: string[][], row: string[], field: string): void {
  row.push(field);
  rows.push(row);
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        row.push(field);
        field = "";
        afterQuote = false;
      } else if (character === "\n" || character === "\r") {
        finishRow(rows, row, field);
        row = [];
        field = "";
        afterQuote = false;
        if (character === "\r" && text[index + 1] === "\n") {
          index += 1;
        }
      } else {
        throw new Error("Invalid CSV: unexpected character after closing quote");
      }
      continue;
    }

    if (character === '"') {
      if (field !== "") {
        throw new Error("Invalid CSV: unexpected quote in unquoted field");
      }
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      finishRow(rows, row, field);
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("Invalid CSV: unclosed quoted field");
  }
  if (afterQuote || row.length > 0 || field !== "") {
    finishRow(rows, row, field);
  }
  if (rows.length === 0) {
    throw new Error("Invalid CSV: missing header row");
  }

  rows[0]![0] = rows[0]![0]!.replace(/^\uFEFF/, "");
  const normalizedHeaders = rows[0]!.map((header) => header.trim());
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error("Invalid CSV: duplicate header");
  }

  const width = rows[0]!.length;
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index]!.length !== width) {
      throw new Error(`Invalid CSV: row ${index + 1} does not match header width`);
    }
  }
  return rows;
}

function parseNoonTimestamp(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2}),\s*(\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid inventory snapshot timestamp`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = parts as [number, number, number, number, number, number];
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    timestamp.getUTCFullYear() !== year ||
    timestamp.getUTCMonth() + 1 !== month ||
    timestamp.getUTCDate() !== day ||
    timestamp.getUTCHours() !== hour ||
    timestamp.getUTCMinutes() !== minute ||
    timestamp.getUTCSeconds() !== second
  ) {
    throw new Error(`Invalid inventory snapshot timestamp`);
  }
  return timestamp;
}

export function validateInventoryCsv(
  download: InventoryDownload,
  store: StoreConfig,
  site: SiteConfig,
  now: Date = download.completedAt,
  maximumAgeMinutes = 60,
): ValidatedInventoryCsv {
  const rows = parseCsv(download.csvText);
  const headers = rows[0]!.map((header) => header.trim());
  const indexes = new Map(headers.map((header, index) => [header, index]));
  for (const required of REQUIRED_HEADERS) {
    if (!indexes.has(required)) {
      throw new Error(`Invalid inventory CSV: missing required header: ${required}`);
    }
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    throw new Error("Invalid inventory CSV: row count must be greater than zero");
  }

  const at = (row: string[], header: (typeof REQUIRED_HEADERS)[number]): string =>
    row[indexes.get(header)!]!.trim();
  const snapshots: Date[] = [];
  const saleableSkus = new Set<string>();
  let saleableRowCount = 0;
  let saleableQty = 0;

  for (const row of dataRows) {
    const partnerId = at(row, "id_partner");
    if (partnerId !== store.partnerId) {
      throw new Error(`Invalid inventory partner: expected ${store.partnerId}`);
    }
    const countryCode = at(row, "country_code");
    if (countryCode !== site.countryCode) {
      throw new Error(`Invalid inventory country: expected ${site.countryCode}`);
    }
    snapshots.push(parseNoonTimestamp(at(row, "inventory_snapshot_at")));

    if (at(row, "inventory_type").toLowerCase() === "saleable") {
      saleableRowCount += 1;
      const sku = at(row, "partner_sku");
      if (!sku) {
        throw new Error("Invalid saleable SKU: partner_sku is blank");
      }
      const quantityText = at(row, "qty");
      const quantity = Number(quantityText);
      if (quantityText === "" || !Number.isFinite(quantity) || quantity < 0) {
        throw new Error(`Invalid saleable quantity for SKU ${sku}`);
      }
      saleableSkus.add(sku);
      saleableQty += quantity;
    }
  }

  if (saleableRowCount === 0 || saleableSkus.size === 0) {
    throw new Error("Invalid inventory CSV: at least one saleable row is required");
  }
  if (!(saleableQty > 0)) {
    throw new Error("Invalid inventory CSV: saleable quantity must be greater than zero");
  }

  const snapshotAtUtc = new Date(Math.max(...snapshots.map((snapshot) => snapshot.getTime())));
  const ageMilliseconds = now.getTime() - snapshotAtUtc.getTime();
  if (ageMilliseconds > maximumAgeMinutes * 60_000) {
    throw new Error(`Invalid inventory snapshot: stale by more than ${maximumAgeMinutes} minutes`);
  }
  if (ageMilliseconds < -5 * 60_000) {
    throw new Error("Invalid inventory snapshot: timestamp is too far in the future");
  }

  return {
    csvText: download.csvText,
    stats: {
      partnerId: store.partnerId,
      countryCode: site.countryCode,
      snapshotAtUtc,
      rowCount: dataRows.length,
      saleableRowCount,
      saleableSkuCount: saleableSkus.size,
      saleableQty,
    },
  };
}
