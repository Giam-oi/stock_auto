export const STATEMENT_HEADERS = [
  "Contract", "Contract Title", "Date", "Transaction", "Reference", "Details EN", "Details AR", "Amount", "Total Due",
] as const;

export const TRANSACTION_HEADERS = [
  "Contract", "Contract Title", "Reference Nr", "Order Nr", "Item Nr", "Order Date", "Transaction Date", "Title",
  "SKUs", "Partner SKUs", "Transaction Type", "Currency", "Net Proceeds", "Referral Fee including VAT",
  "Fullfilment & Logistics Fees including VAT", "Shipping Credits including VAT", "Other Order Fees including VAT",
  "Order Subsidies including VAT", "Non-Order Fees including VAT", "Non-Order Subsidies including VAT",
  "Others including VAT", "Total",
] as const;

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("Invalid finance CSV: unterminated quoted field");
  if (field !== "" || row.length > 0) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((candidate) => candidate.some((value) => value !== ""));
}

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsv(rows: readonly string[][]): string {
  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
}

function assertHeaders(actual: readonly string[], expected: readonly string[], report: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${report} CSV header contract changed`);
  }
}

export function validateStatementCsv(text: string, siteSuffix: "AE" | "SA", fromDate: string, toDate: string): number {
  const rows = parseCsv(text);
  const headers = rows[0];
  if (!headers) throw new Error("Statements CSV is empty");
  assertHeaders(headers, STATEMENT_HEADERS, "Statements");
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index])) as Record<string, number>;
  for (const row of rows.slice(1)) {
    if (row.length !== headers.length) throw new Error("Statements CSV has inconsistent columns");
    if (!row[indexes.Contract!]?.endsWith(siteSuffix)) throw new Error("Statements CSV contains the wrong site contract");
    const date = row[indexes.Date!] ?? "";
    if (date < fromDate || date > toDate) throw new Error("Statements CSV contains an out-of-range date");
  }
  return rows.length - 1;
}

export function validateTransactionCsv(text: string, fromDate: string, toDate: string): number {
  const rows = parseCsv(text);
  const headers = rows[0];
  if (!headers) throw new Error("Transaction CSV is empty");
  assertHeaders(headers, TRANSACTION_HEADERS, "Transaction View");
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index])) as Record<string, number>;
  const currencies = new Set<string>();
  for (const row of rows.slice(1)) {
    if (row.length !== headers.length) throw new Error("Transaction CSV has inconsistent columns");
    const date = row[indexes["Transaction Date"]!] ?? "";
    if (date < fromDate || date > toDate) throw new Error("Transaction CSV contains an out-of-range date");
    const currency = row[indexes.Currency!];
    if (currency !== "AED" && currency !== "SAR") throw new Error(`Transaction CSV contains unexpected currency ${currency}`);
    currencies.add(currency);
  }
  if (rows.length > 1 && (!currencies.has("AED") || !currencies.has("SAR"))) {
    throw new Error("Transaction CSV does not contain both UAE and KSA currencies");
  }
  return rows.length - 1;
}
