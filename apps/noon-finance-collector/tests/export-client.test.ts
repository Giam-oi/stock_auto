import { describe, expect, it, vi } from "vitest";
import { fetchFinanceExport, statementExportRequest, transactionExportRequest } from "../src/export-client.js";
import { SITE_CONFIGS } from "../src/contracts.js";
import { TRANSACTION_HEADERS, serializeCsv } from "../src/csv.js";

describe("finance export client", () => {
  it("creates, polls, and downloads one export", async () => {
    const csv = serializeCsv([Array.from(TRANSACTION_HEADERS)]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ export: "EXP1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ export: {
        status_code: "COMPLETE", download_url: "https://download.test/file", result: '{"total_rows":0}',
      } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(csv, { status: 200 }));
    const input = transactionExportRequest("PRJ42958", "session=value", "2026-07-01", "2026-08-24");
    const result = await fetchFinanceExport(input, fetchMock as typeof fetch, async () => {});
    expect(result.exportCode).toBe("EXP1");
    expect(result.csvText.replace(/^\uFEFF/, "")).toBe(csv.replace(/^\uFEFF/, ""));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("splits statements by the site currency", () => {
    expect(statementExportRequest("PRJ42958", "session=value", SITE_CONFIGS.UAE, "2026-07-01", "2026-08-24").params)
      .toEqual({ from_date: "2026-07-01", to_date: "2026-08-24", project_code: "PRJ42958", currency: "AED" });
    expect(statementExportRequest("PRJ42958", "session=value", SITE_CONFIGS.KSA, "2026-07-01", "2026-08-24").params)
      .toEqual({ from_date: "2026-07-01", to_date: "2026-08-24", project_code: "PRJ42958", currency: "SAR" });
  });
});
