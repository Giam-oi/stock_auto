import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { evaluate } from "../src/runner.mjs";
import { aggregateTargetMetrics, indexTargetMetrics } from "../src/target-report.mjs";

test("includes low-sample live FBN campaigns with saleable inventory and excludes protected campaigns", async () => {
  const root = await mkdtemp(join(tmpdir(), "noon-evaluate-scope-"));
  const receipts = join(root, "receipts");
  await mkdir(receipts);
  const options = {
    dryRun: true,
    credentialDir: root,
    inventoryRoot: root,
    receiptRoot: receipts,
    statePath: join(root, "state.json"),
    cooldownPath: join(root, "cooldowns.json"),
    planPath: join(root, "plan.json"),
    resultPath: join(root, "result.json"),
  };
  const campaigns = [
    { campaignCode: "C_INCLUDED", status: "live", name: "included", createdAt: "2026-08-30T00:00:00Z" },
    { campaignCode: "C_YNLBNZN399", status: "live", name: "protected", createdAt: "2026-08-01T00:00:00Z" },
  ];
  const result = await evaluate(options, {
    now: () => new Date("2026-08-31T04:00:00.000Z"),
    loadCredential: async () => ({}),
    login: async () => "cookie",
    loadSaleableInventory: async () => ({
      path: "inventory.csv", snapshotAt: "2026-08-31 08:35:00",
      quantities: new Map([["SKU-1", 5]]),
    }),
    loadTargetReports: async (store) => {
      const historicalRows = store.index === 1 ? [{
        campaignName: "included", targetingType: "keyword", targetValue: "auto keyword", strategy: "auto",
        views: 100, clicks: 5, spends: 12, orders: 0, revenue: 0, roas: 0,
      }] : [];
      const dailyRows = store.index === 1 ? [{ ...historicalRows[0], spends: 0 }] : [];
      return {
        historical: { rows: historicalRows, index: indexTargetMetrics(historicalRows), total: aggregateTargetMetrics(historicalRows) },
        previousDay: { rows: dailyRows, index: indexTargetMetrics(dailyRows), total: aggregateTargetMetrics(dailyRows) },
      };
    },
    createClient: ({ store }) => ({
      campaignMetrics: async () => store.index === 1
        ? campaigns.map((campaign) => ({ campaign, metrics: { roas: 0, spends: 0, orders: 0 } })) : [],
      details: async (code) => ({
        campaign: campaigns.find((campaign) => campaign.campaignCode === code),
        selectedProducts: { products: [{ productSku: "SKU-1", isActive: true, flags: ["fbn"] }] },
        targeting: [{
          metadata: { adgroupCode: "ADG-1" },
          targetedKeywords: [{
            idAdgroupTarget: 1, targetValue: "auto keyword", targetingType: "keyword",
            strategy: "auto", bid: 0.4, isActive: true,
          }],
        }],
      }),
    }),
  });
  assert.equal(result.successful, true);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].campaignCode, "C_INCLUDED");
  assert.equal(result.targets[0].tier, "observe");
  assert.equal(result.cooldownDays, 7);
  assert.equal(result.targets[0].metrics.spends, 12);
  assert.equal(result.stores[0].protectedCampaigns, 1);
});
