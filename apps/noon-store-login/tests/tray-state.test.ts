import { describe, expect, it } from "vitest";
import { summarizeTrayState, type SessionLogRecord } from "../src/tray-state";

const healthyRecords: SessionLogRecord[] = Array.from({ length: 6 }, (_, index) => ({
  store: index + 1,
  projectCode: `PRJ${index + 1}`,
  valid: true,
  finalUrl: "https://fbn.noon.partners/en-ae/inventory",
  title: "fulfillment | sc | noon | seller lab",
  checkedAt: "2026-08-12T08:00:00.000Z",
}));

describe("tray state summary", () => {
  it("marks six successful stores healthy", () => {
    expect(summarizeTrayState(healthyRecords)).toEqual({
      severity: "healthy",
      lines: [
        "店铺1：正常（16:00:00）",
        "店铺2：正常（16:00:00）",
        "店铺3：正常（16:00:00）",
        "店铺4：正常（16:00:00）",
        "店铺5：正常（16:00:00）",
        "店铺6：正常（16:00:00）",
      ],
    });
  });

  it("prefers confirmed logout over unavailable", () => {
    const records = healthyRecords.map((record) => ({ ...record }));
    records[1] = { ...records[1]!, valid: false, finalUrl: "", title: "", reason: "timeout" };
    records[4] = { ...records[4]!, valid: false, finalUrl: "https://login.noon.partners/en", title: "Partners Login" };
    expect(summarizeTrayState(records)).toMatchObject({
      severity: "logout",
      lines: expect.arrayContaining(["店铺2：暂时不可用（16:00:00）", "店铺5：需要登录（16:00:00）"]),
    });
  });
});
