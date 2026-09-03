import { describe, expect, it } from "vitest";
import { monthDirectory, outputFileName } from "../src/contracts.js";

describe("finance output naming", () => {
  it("uses the historical site and store prefix", () => {
    expect(outputFileName("UAE", 1, "statements"))
      .toBe("UAE 店铺1noon_financeweb_statements.csv");
    expect(outputFileName("KSA", 6, "transactionviewreportonitemlevelwithcontractselection"))
      .toBe("KSA 店铺6noon_financeweb_transactionviewreportonitemlevelwithcontractselection.csv");
  });

  it("files the run under the start month", () => {
    expect(monthDirectory("2026-07-01")).toBe("2026.07");
  });
});
