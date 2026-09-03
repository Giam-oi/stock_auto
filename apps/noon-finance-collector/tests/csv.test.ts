import { describe, expect, it } from "vitest";
import { STATEMENT_HEADERS, TRANSACTION_HEADERS, serializeCsv, validateStatementCsv, validateTransactionCsv } from "../src/csv.js";

describe("finance CSV contracts", () => {
  it("keeps and validates both currencies in the project transaction report", () => {
    const row = (currency: string, date: string) => TRANSACTION_HEADERS.map((header) => {
      if (header === "Currency") return currency;
      if (header === "Transaction Date") return date;
      return "value";
    });
    const csv = serializeCsv([Array.from(TRANSACTION_HEADERS), row("AED", "2026-08-19"), row("SAR", "2026-08-20")]);
    expect(validateTransactionCsv(csv, "2026-07-01", "2026-08-24")).toBe(2);
  });

  it("validates the statement site contract and date", () => {
    const row = STATEMENT_HEADERS.map((header) => {
      if (header === "Contract") return "MPABZTNAKZAE";
      if (header === "Date") return "2026-08-23";
      return "value";
    });
    const csv = serializeCsv([Array.from(STATEMENT_HEADERS), row]);
    expect(validateStatementCsv(csv, "AE", "2026-07-01", "2026-08-24")).toBe(1);
  });
});
