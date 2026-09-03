import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import ExcelJS from "exceljs";
import { collectManualPilot } from "../src/manual-pilot.mjs";

const keywords = [
  ["sugar checking machine", 10502100, 0.35],
  ["glucose monitoring machine", 10502101, 0.35],
  ["blood sugar monitor", 10502102, 0.34],
  ["sugar test kit", 10502103, 0.32],
];

async function workbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const rows = keywords.map(([keyword], index) => ({
    "Campaign Name": "260826 M01血糖仪 manual NW26051508HB1",
    "Target Value": keyword,
    "Targeting Type": "keyword",
    Strategy: "exact",
    Views: index + 1,
    Clicks: 0,
    Orders: 0,
    Spends: 0,
    Revenue: 0,
    CPC: 0,
    ROAS: 0,
    CVR: 0,
  }));
  const sheet = workbook.addWorksheet("(Product) Target");
  sheet.columns = Object.keys(rows[0]).map((header) => ({ header, key: header }));
  sheet.addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("collects a read-only manual pilot snapshot from live API, report, and saleable inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "noon-pilot-"));
  const inventoryRoot = join(root, "inventory");
  await mkdir(join(inventoryRoot, "2026-08-30"), { recursive: true });
  await writeFile(join(inventoryRoot, "2026-08-30", "UAE1.20260830.csv"),
    "sku,id_partner,inventory_type,qty,inventory_snapshot_at\nZF7C5D97488A3FB339451Z-1,42958,saleable,23,2026-08-30 01:04:18\n");
  const rankConfigPath = join(root, "rank-config.json");
  await writeFile(rankConfigPath, JSON.stringify({
    targets: keywords.map(([keyword, targetId, currentBid]) => ({
      store: "42958", campaignCode: "C_YNLBNZN399", keyword, targetId, currentBid,
    })),
  }));
  const details = {
    campaign: {
      campaignCode: "C_YNLBNZN399", name: "260826 M01血糖仪 manual NW26051508HB1",
      status: "live", isActive: true, effectiveDailyLimit: 5, biddingStrategy: "fixed", isManual: true,
    },
    targeting: [{
      metadata: { adgroupCode: "ADG_0XJVFD2V8K" },
      targetedKeywords: keywords.map(([targetValue, idAdgroupTarget, bid]) => ({
        targetValue, idAdgroupTarget, bid, strategy: "exact", targetingType: "keyword", isActive: true,
      })),
    }],
    selectedProducts: { products: [{ productSku: "ZF7C5D97488A3FB339451Z-1", isActive: true, flags: ["fbn"] }] },
  };
  const options = {
    credentialDir: root,
    pilotRoot: join(root, "pilot"),
    pilotResultPath: join(root, "pilot-last-result.json"),
    inventoryRoot,
    rankConfigPath,
  };
  const result = await collectManualPilot(options, {
    now: () => new Date("2026-08-30T03:20:00.000Z"),
    session: async () => ({
      campaignMetrics: async () => [{ campaign: { campaignCode: "C_YNLBNZN399" }, metrics: { views: 10, spends: 0 } }],
      details: async () => details,
      downloadReport: async () => workbookBuffer(),
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sku.saleableQty, 23);
  assert.equal(result.keywordMetrics.length, 4);
  assert.equal(result.keywordMetrics.every((row) => row.reportRowFound), true);
  assert.deepEqual(result.decision.liveChanges, []);
  assert.equal(JSON.parse(await readFile(options.pilotResultPath, "utf8")).checks.bidsMatch, true);
});
