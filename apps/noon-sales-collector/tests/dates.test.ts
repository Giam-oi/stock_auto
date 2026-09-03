import { describe, expect, it } from "vitest";
import { defaultReportRange } from "../src/dates.js";

describe("default sales report range in Asia/Shanghai", () => {
  it("uses Friday through Sunday on Monday", () => {
    expect(defaultReportRange(new Date("2026-08-17T00:35:00Z"))).toEqual({
      fromDate: "2026-08-14",
      toDate: "2026-08-16",
    });
  });

  it("uses the previous day from Tuesday through Friday", () => {
    expect(defaultReportRange(new Date("2026-08-18T00:35:00Z"))).toEqual({
      fromDate: "2026-08-17",
      toDate: "2026-08-17",
    });
  });

  it.each([
    ["Saturday", "2026-08-22T01:20:00Z"],
    ["Sunday", "2026-08-23T01:20:00Z"],
  ])("skips %s", (_day, timestamp) => {
    expect(defaultReportRange(new Date(timestamp))).toBeNull();
  });

  it("uses Shanghai's date across a UTC day boundary", () => {
    expect(defaultReportRange(new Date("2026-08-16T17:00:00Z"))).toEqual({
      fromDate: "2026-08-14",
      toDate: "2026-08-16",
    });
  });
});
