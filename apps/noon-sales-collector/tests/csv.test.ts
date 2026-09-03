import { describe, expect, it } from "vitest";
import { SITE_CONFIGS, STORE_CONFIGS } from "../src/contracts.js";
import { SALES_HEADERS, parseCsv, validateSalesCsv } from "../src/csv.js";

const header = SALES_HEADERS.join(",");
const row = [
  "42958", "AE", "AE", "AE", "", "NAEI1", "PARTNER-1", "SKU-1", "Delivered", "10.5", "10.5",
  "AED", "generic", "toys", "Fulfilled by Noon (FBN)", "2026-08-19 12:00:01", "2026-08-19 13:00:02",
  "2026-08-19 14:00:03",
].join(",");

describe("sales CSV", () => {
  it("parses quoted fields", () => {
    expect(parseCsv('a,b\n1,"hello, world"\n')).toEqual([["a", "b"], ["1", "hello, world"]]);
  });

  it("accepts the confirmed 18-column UAE contract", () => {
    const result = validateSalesCsv(`${header}\n${row}\n`, STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, "2026-08-19", "2026-08-19");
    expect(result.rows).toHaveLength(1);
    expect(result.headers).toEqual(SALES_HEADERS);
  });

  it("accepts a header-only zero-sales export", () => {
    const result = validateSalesCsv(`${header}\n`, STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, "2026-08-19", "2026-08-19");
    expect(result.rows).toHaveLength(0);
  });

  it("rejects the wrong site, partner, and report date", () => {
    expect(() => validateSalesCsv(`${header}\n${row}\n`, STORE_CONFIGS[0]!, SITE_CONFIGS.KSA, "2026-08-19", "2026-08-19")).toThrow(/country/);
    expect(() => validateSalesCsv(`${header}\n${row.replace(/^42958/, "55651")}\n`, STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, "2026-08-19", "2026-08-19")).toThrow(/partner/);
    expect(() => validateSalesCsv(`${header}\n${row}\n`, STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, "2026-08-18", "2026-08-18")).toThrow(/order date/);
  });
});
