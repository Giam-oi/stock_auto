import { describe, expect, it } from "vitest";
import {
  outputCsvName, outputDirectoryName, SITE_CONFIGS, STORE_CONFIGS, summaryWorkbookName, validateRange,
} from "../src/contracts.js";

describe("sales output contracts", () => {
  it("uses the confirmed six Noon projects", () => {
    expect(STORE_CONFIGS.map((store) => store.projectCode)).toEqual([
      "PRJ42958", "PRJ55651", "PRJ61683", "PRJ65553", "PRJ75299", "PRJ363826",
    ]);
  });

  it("keeps UAE and KSA request identity separate", () => {
    expect(SITE_CONFIGS.UAE).toMatchObject({ countryCode: "AE", locale: "en-ae" });
    expect(SITE_CONFIGS.KSA).toMatchObject({ countryCode: "SA", locale: "en-sa" });
  });

  it("matches the historical directory and file names", () => {
    expect(outputDirectoryName("2026-08-14", "2026-08-16")).toBe("2026-08-14至2026-08-16销售数据");
    expect(outputCsvName("UAE", "42958")).toBe("42958销售数据-UAE.csv");
    expect(outputCsvName("KSA", "42958")).toBe("42958销售数据-KSA.csv");
    expect(summaryWorkbookName("UAE")).toBe("UAE数据整合.xlsx");
  });

  it("rejects reversed and invalid ranges", () => {
    expect(() => validateRange("2026-08-20", "2026-08-19")).toThrow(/fromDate/);
    expect(() => validateRange("2026-02-30", "2026-03-01")).toThrow(/calendar/);
  });
});
