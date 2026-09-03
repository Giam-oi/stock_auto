import type { SiteConfig, StoreConfig } from "./contracts.js";

export const SALES_HEADERS = [
  "id_partner", "src_country", "country_code", "dest_country", "bayan_nr", "item_nr",
  "partner_sku", "sku", "status", "offer_price", "gmv_lcy", "currency_code", "brand_code",
  "family", "fulfillment_model", "order_timestamp", "shipment_timestamp", "delivered_timestamp",
] as const;

export interface ValidatedSalesCsv {
  csvText: string;
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("Invalid sales CSV: unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value !== ""));
}

function datePart(value: string): string | undefined {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s|$)/.exec(value);
  if (!match) return undefined;
  return `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
}

export function validateSalesCsv(
  csvText: string,
  store: StoreConfig,
  site: SiteConfig,
  fromDate: string,
  toDate: string,
): ValidatedSalesCsv {
  const parsed = parseCsv(csvText.replace(/^\uFEFF/, ""));
  const headers = parsed[0];
  if (!headers) throw new Error("Invalid sales CSV: missing header row");
  for (const required of SALES_HEADERS) {
    if (!headers.includes(required)) throw new Error(`Invalid sales CSV: missing required header ${required}`);
  }
  const rows = parsed.slice(1);
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index])) as Record<string, number>;
  for (const row of rows) {
    if (row.length !== headers.length) throw new Error("Invalid sales CSV: inconsistent column count");
    if (row[indexes.id_partner!] !== store.partnerId) throw new Error(`Invalid sales partner for ${store.projectCode}`);
    if (row[indexes.country_code!] !== site.countryCode) throw new Error(`Invalid sales country for ${site.code}`);
    const orderDate = datePart(row[indexes.order_timestamp!] ?? "");
    if (!orderDate || orderDate < fromDate || orderDate > toDate) {
      throw new Error(`Invalid sales order date for ${store.projectCode}`);
    }
  }
  return { csvText, headers, rows };
}
