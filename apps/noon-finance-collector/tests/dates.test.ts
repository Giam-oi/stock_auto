import { describe, expect, it } from "vitest";
import { defaultFinanceRange } from "../src/dates.js";

describe("monthly finance range in Asia/Shanghai", () => {
  it("uses the previous month first day through current month day 24", () => {
    expect(defaultFinanceRange(new Date("2026-08-24T07:00:00Z"))).toEqual({
      fromDate: "2026-07-01", toDate: "2026-08-24",
    });
  });

  it("crosses the year boundary", () => {
    expect(defaultFinanceRange(new Date("2026-01-24T07:00:00Z"))).toEqual({
      fromDate: "2025-12-01", toDate: "2026-01-24",
    });
  });
});
