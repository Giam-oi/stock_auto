import { describe, expect, it } from "vitest";
import { STORE_CONFIGS, UAE_SITE, parseStoreIndex } from "../src/contracts.js";

describe("ASN contracts", () => {
  it("keeps the established six-store project mapping", () => {
    expect(STORE_CONFIGS.map(({ index, projectCode, partnerId }) => ({ index, projectCode, partnerId }))).toEqual([
      { index: 1, projectCode: "PRJ42958", partnerId: "42958" },
      { index: 2, projectCode: "PRJ55651", partnerId: "55651" },
      { index: 3, projectCode: "PRJ61683", partnerId: "61683" },
      { index: 4, projectCode: "PRJ65553", partnerId: "65553" },
      { index: 5, projectCode: "PRJ75299", partnerId: "75299" },
      { index: 6, projectCode: "PRJ363826", partnerId: "363826" },
    ]);
  });

  it("fixes phase 1 to UAE", () => {
    expect(UAE_SITE).toEqual({ code: "UAE", locale: "en-ae", countryCode: "AE" });
  });

  it("requires exactly one store token", () => {
    expect(parseStoreIndex("01 店铺2 约仓文件 HL.xlsx")).toBe(2);
    expect(() => parseStoreIndex("店铺1 店铺2.xlsx")).toThrow(/exactly one/i);
    expect(() => parseStoreIndex("unknown.xlsx")).toThrow(/店铺1.*店铺6/);
  });
});
