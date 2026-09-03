import { describe, expect, it } from "vitest";
import { oneDriveInventoryDirectory, type OneDriveRoots } from "../src/onedrive.js";

const roots: OneDriveRoots = {
  KSA: "C:/OneDrive/KSA/1. Pending表",
  UAE: "C:/OneDrive/UAE/1. 出入库",
};

describe("oneDriveInventoryDirectory", () => {
  it("preserves the historical KSA year, unpadded month, and dotted date layout", () => {
    expect(oneDriveInventoryDirectory("KSA", "2026-08-09", roots).replaceAll("\\", "/"))
      .toBe("C:/OneDrive/KSA/1. Pending表/2026/2026.8/2026.08.09");
  });

  it("preserves the historical UAE 4.year, padded month, and dotted date layout", () => {
    expect(oneDriveInventoryDirectory("UAE", "2026-08-09", roots).replaceAll("\\", "/"))
      .toBe("C:/OneDrive/UAE/1. 出入库/4.2026/2026.08/2026.08.09");
  });

  it.each(["2026-8-9", "2026-02-30", "bad"])("rejects invalid date %s", (runDate) => {
    expect(() => oneDriveInventoryDirectory("UAE", runDate, roots)).toThrow("YYYY-MM-DD");
  });
});
