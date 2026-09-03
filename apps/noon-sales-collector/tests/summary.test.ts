import { describe, expect, it } from "vitest";
import { SALES_HEADERS } from "../src/csv.js";
import { summaryRows } from "../src/summary.js";

describe("sales summary rows", () => {
  it("drops destination and bayan, removes the header, and preserves the historical 16-column order", () => {
    const row = [
      "42958", "AE", "AE", "BH", "BAYAN", "NAEI1", "PARTNER-1", "SKU-1", "Delivered", "10.5", "9.5",
      "AED", "generic", "toys", "FBN", "2026-08-19 12:34:56", "2026-08-19 13:45:01", "2026-08-19 14:56:02",
    ];
    const result = summaryRows([`${SALES_HEADERS.join(",")}\n${row.join(",")}\n`]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(16);
    expect(result[0]!.slice(0, 7)).toEqual(["42958", "AE", "AE", "NAEI1", "PARTNER-1", "SKU-1", "Delivered"]);
    expect(result[0]![7]).toBe(10.5);
    expect(result[0]![8]).toBe(9.5);
    expect(result[0]![13]).toBe(Math.floor(result[0]![13] as number));
    expect((result[0]![14] as number) % 1).toBeGreaterThan(0);
  });

  it("excludes cancelled and could-not-be-delivered orders from the summary", () => {
    const row = (status: string, item: string) => [
      "42958", "AE", "AE", "AE", "", item, "PARTNER-1", "SKU-1", status, "10.5", "9.5",
      "AED", "generic", "toys", "FBN", "2026-08-19 12:34:56", "", "",
    ].join(",");
    const csv = [
      SALES_HEADERS.join(","),
      row("Delivered", "KEEP-DELIVERED"),
      row("Cancelled", "DROP-CANCELLED"),
      row("Could Not Be Delivered", "DROP-UNDELIVERABLE"),
      row("Processing", "KEEP-PROCESSING"),
    ].join("\n");

    const result = summaryRows([csv]);

    expect(result.map((entry) => entry[3])).toEqual(["KEEP-DELIVERED", "KEEP-PROCESSING"]);
    expect(result.map((entry) => entry[6])).toEqual(["Delivered", "Processing"]);
  });

  it("matches excluded statuses without case or surrounding-space sensitivity", () => {
    const row = [
      "42958", "AE", "AE", "AE", "", "DROP-1", "PARTNER-1", "SKU-1", " cancelled ", "10.5", "9.5",
      "AED", "generic", "toys", "FBN", "2026-08-19 12:34:56", "", "",
    ];
    const result = summaryRows([`${SALES_HEADERS.join(",")}\n${row.join(",")}\n`]);
    expect(result).toHaveLength(0);
  });
});
