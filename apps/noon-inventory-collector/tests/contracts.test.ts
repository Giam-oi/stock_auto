import { describe, expect, it } from "vitest";
import {
  outputDirectory,
  outputFileName,
  SITE_CONFIGS,
  STORE_CONFIGS,
} from "../src/contracts.js";

describe("collector contracts", () => {
  it("maps each credential file to the confirmed project and partner", () => {
    expect(
      STORE_CONFIGS.map((store) => [
        store.index,
        store.credentialFile,
        store.projectCode,
        store.partnerId,
      ]),
    ).toEqual([
      [1, "noon1-API.json", "PRJ42958", "42958"],
      [2, "noon2-API.json", "PRJ55651", "55651"],
      [3, "noon3-API.json", "PRJ61683", "61683"],
      [4, "noon4-API.json", "PRJ65553", "65553"],
      [5, "noon5-API.json", "PRJ75299", "75299"],
      [6, "noon6-API.json", "PRJ363826", "363826"],
    ]);
  });

  it("uses UAE and SA downstream filenames", () => {
    expect(outputFileName("UAE", 1, "2026-08-07")).toBe("UAE1.20260807.csv");
    expect(outputFileName("KSA", 6, "2026-08-07")).toBe("SA6.20260807.csv");
    expect(SITE_CONFIGS.KSA.locale).toBe("en-sa");
    expect(SITE_CONFIGS.KSA.countryCode).toBe("SA");
  });

  it("builds deterministic dated output paths", () => {
    expect(outputDirectory("D:/文件/库存文件", "UAE", "2026-08-07")).toBe(
      "D:/文件/库存文件/UAE/2026-08-07",
    );
    expect(outputDirectory("D:\\文件\\库存文件", "KSA", "2026-08-07")).toBe(
      "D:/文件/库存文件/KSA/2026-08-07",
    );
  });

  it.each(["2026-8-07", "20260807", "2026-02-30", "not-a-date"])(
    "rejects invalid run date %s",
    (runDate) => {
      expect(() => outputFileName("UAE", 1, runDate)).toThrow("YYYY-MM-DD");
    },
  );
});
