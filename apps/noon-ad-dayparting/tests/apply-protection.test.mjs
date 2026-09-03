import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { apply } from "../src/runner.mjs";

test("protection mode blocks raises while retaining risk-reducing changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "noon-apply-protection-"));
  const receiptRoot = join(root, "receipts");
  await mkdir(receiptRoot);
  const planPath = join(root, "plan.json");
  const statePath = join(root, "state.json");
  const resultPath = join(root, "result.json");
  const common = {
    store: "42958", campaignCode: "C_TEST", campaignName: "test", adgroupCode: "ADG_TEST",
    targetingType: "keyword", strategy: "auto", metrics: { roas: 12, spends: 30, orders: 3 },
  };
  const plan = {
    generatedAt: "2026-09-01T14:00:00Z", toDate: "2026-08-31", protectionMode: true,
    raiseGuard: { allowRaises: false },
    targets: [
      { ...common, key: "42958|1", idAdgroupTarget: 1, targetValue: "auto keyword", baseBid: 1, lastAppliedBid: 0.9, tier: "optimize" },
      { ...common, key: "42958|2", idAdgroupTarget: 2, targetValue: "bad target", baseBid: 1, lastAppliedBid: 1, tier: "severe" },
    ],
  };
  const state = { version: 1, updatedAt: "2026-09-01T14:00:00Z", targets: {
    "42958|1": { baseBid: 1, lastAppliedBid: 0.9 },
    "42958|2": { baseBid: 1, lastAppliedBid: 1 },
  } };
  await writeFile(planPath, JSON.stringify(plan));
  await writeFile(statePath, JSON.stringify(state));
  const liveTargets = [
    { adgroupCode: "ADG_TEST", idAdgroupTarget: 1, targetValue: "auto keyword", targetingType: "keyword", strategy: "auto", bid: 0.9, isActive: true },
    { adgroupCode: "ADG_TEST", idAdgroupTarget: 2, targetValue: "bad target", targetingType: "keyword", strategy: "auto", bid: 1, isActive: true },
  ];
  const result = await apply({
    dryRun: true, planPath, statePath, resultPath, receiptRoot,
    credentialDir: root, auditPath: join(root, "audit.jsonl"),
  }, {
    now: () => new Date("2026-09-01T15:00:00Z"),
    loadCredential: async () => ({}), login: async () => "cookie",
    createClient: () => ({
      details: async () => ({ campaign: { status: "live" } }),
      targets: async () => liveTargets,
    }),
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].idAdgroupTarget, 2);
  assert.equal(result.changes[0].afterBid, 0.85);
});

test("pauses a zero-order target through stash and verifies its removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "noon-apply-pause-"));
  const receiptRoot = join(root, "receipts");
  await mkdir(receiptRoot);
  const planPath = join(root, "plan.json"), statePath = join(root, "state.json"), resultPath = join(root, "result.json");
  const planned = {
    key: "42958|3", store: "42958", campaignCode: "C_TEST", campaignName: "test",
    adgroupCode: "ADG_TEST", idAdgroupTarget: 3, targetingType: "keyword",
    targetValue: "zero order", strategy: "exact", baseBid: 0.5, lastAppliedBid: 0.5,
    tier: "zero_order_stop", pauseTarget: true, reason: "20 spend zero orders",
    metrics: { roas: 0, spends: 20, orders: 0 },
  };
  await writeFile(planPath, JSON.stringify({
    generatedAt: "2026-09-01T14:00:00Z", toDate: "2026-08-31", protectionMode: true,
    raiseGuard: { allowRaises: false }, targets: [planned],
  }));
  await writeFile(statePath, JSON.stringify({ version: 1, targets: {
    "42958|3": { baseBid: 0.5, lastAppliedBid: 0.5 },
  } }));
  let liveTargets = [{
    adgroupCode: "ADG_TEST", idAdgroupTarget: 3, targetValue: "zero order",
    targetingType: "keyword", strategy: "exact", bid: 0.5, isActive: true,
  }];
  const result = await apply({
    dryRun: false, planPath, statePath, resultPath, receiptRoot,
    credentialDir: root, auditPath: join(root, "audit.jsonl"),
  }, {
    now: () => new Date("2026-09-01T15:00:00Z"),
    loadCredential: async () => ({}), login: async () => "cookie",
    createClient: () => ({
      details: async () => ({ campaign: { status: "live" } }),
      targets: async () => liveTargets,
      stashTargets: async () => { liveTargets = []; },
    }),
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].action, "pause_target");
  assert.equal(result.changes[0].readBackVerified, true);
});
