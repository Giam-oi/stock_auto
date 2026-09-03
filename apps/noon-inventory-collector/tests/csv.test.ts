import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsv, validateInventoryCsv } from "../src/csv.js";
import { SITE_CONFIGS, STORE_CONFIGS } from "../src/contracts.js";
import type { InventoryDownload } from "../src/realtime-client.js";

const NOW = new Date("2026-08-07T10:30:00Z");

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

function download(csvText: string): InventoryDownload {
  return {
    csvText,
    contentType: "text/csv",
    requestedAt: new Date("2026-08-07T10:29:59Z"),
    completedAt: NOW,
    httpStatus: 200,
  };
}

const HEADER =
  "inventory_type,partner_sku,qty,id_partner,inventory_snapshot_at,country_code";

describe("parseCsv", () => {
  it("parses BOM, CRLF, quoted commas, escaped quotes, and trailing empty fields", () => {
    expect(parseCsv('\uFEFFa,b,c\r\n"x,y","z""q",\r\n')).toEqual([
      ["a", "b", "c"],
      ["x,y", 'z"q', ""],
    ]);
  });

  it("parses a real quoted-title fixture", () => {
    const rows = parseCsv(fixture("quoted-title.csv"));
    expect(rows[1]?.[6]).toBe('A "quoted", title');
  });

  it.each([
    ['a,b\n"unclosed,b', "unclosed quoted field"],
    ['a,b\n"x"z,b', "unexpected character after closing quote"],
    ["a,a\n1,2", "duplicate header"],
    ["a,b\n1,2,3", "does not match header width"],
  ])("rejects malformed CSV: %s", (text, expectedMessage) => {
    expect(() => parseCsv(text)).toThrow(expectedMessage);
  });
});

describe("validateInventoryCsv", () => {
  it("validates store, AE site, freshness, and saleable quantities", () => {
    const result = validateInventoryCsv(
      download(fixture("valid-ae.csv")),
      STORE_CONFIGS[0]!,
      SITE_CONFIGS.UAE,
      NOW,
    );

    expect(result.csvText).toBe(fixture("valid-ae.csv"));
    expect(result.stats).toEqual({
      partnerId: "42958",
      countryCode: "AE",
      snapshotAtUtc: new Date("2026-08-07T09:58:08Z"),
      rowCount: 3,
      saleableRowCount: 2,
      saleableSkuCount: 2,
      saleableQty: 15,
    });
  });

  it("sums duplicate saleable SKUs while counting distinct SKUs", () => {
    const text = `${HEADER}\n` +
      'saleable,SKU-1,2,42958,"2026-08-07, 09:58:08",AE\n' +
      'saleable,SKU-1,3,42958,"2026-08-07, 09:58:08",AE\n';
    const result = validateInventoryCsv(download(text), STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, NOW);
    expect(result.stats.saleableRowCount).toBe(2);
    expect(result.stats.saleableSkuCount).toBe(1);
    expect(result.stats.saleableQty).toBe(5);
  });

  it.each([
    ["wrong partner", 'saleable,SKU-1,1,55651,"2026-08-07, 09:58:08",AE', "partner"],
    ["blank partner", 'saleable,SKU-1,1,,"2026-08-07, 09:58:08",AE', "partner"],
    ["wrong country", 'saleable,SKU-1,1,42958,"2026-08-07, 09:58:08",SA', "country"],
    ["blank country", 'saleable,SKU-1,1,42958,"2026-08-07, 09:58:08",', "country"],
    ["negative quantity", 'saleable,SKU-1,-1,42958,"2026-08-07, 09:58:08",AE', "quantity"],
    ["non-number quantity", 'saleable,SKU-1,many,42958,"2026-08-07, 09:58:08",AE', "quantity"],
    ["blank SKU", 'saleable,,1,42958,"2026-08-07, 09:58:08",AE', "SKU"],
    ["zero saleable total", 'saleable,SKU-1,0,42958,"2026-08-07, 09:58:08",AE', "greater than zero"],
    ["no saleable rows", 'reserved,SKU-1,1,42958,"2026-08-07, 09:58:08",AE', "saleable"],
  ])("rejects %s", (_name, row, expectedMessage) => {
    expect(() =>
      validateInventoryCsv(download(`${HEADER}\n${row}\n`), STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, NOW),
    ).toThrow(expectedMessage);
  });

  it("rejects missing required headers", () => {
    const text = 'inventory_type,partner_sku,id_partner,inventory_snapshot_at,country_code\n' +
      'saleable,SKU-1,42958,"2026-08-07, 09:58:08",AE\n';
    expect(() => validateInventoryCsv(download(text), STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, NOW))
      .toThrow("missing required header: qty");
  });

  it("accepts a snapshot within 60 minutes and rejects a stale snapshot", () => {
    expect(() =>
      validateInventoryCsv(download(fixture("valid-ae.csv")), STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, NOW),
    ).not.toThrow();
    expect(() =>
      validateInventoryCsv(download(fixture("stale.csv")), STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, NOW),
    ).toThrow("stale");
  });

  it("allows five minutes of future clock skew but rejects more", () => {
    const nearFuture = `${HEADER}\n` +
      'saleable,SKU-1,1,42958,"2026-08-07, 10:34:59",AE\n';
    const farFuture = `${HEADER}\n` +
      'saleable,SKU-1,1,42958,"2026-08-07, 10:35:01",AE\n';
    expect(() =>
      validateInventoryCsv(download(nearFuture), STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, NOW),
    ).not.toThrow();
    expect(() =>
      validateInventoryCsv(download(farFuture), STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, NOW),
    ).toThrow("future");
  });
});
