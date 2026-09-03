import test from "node:test";
import assert from "node:assert/strict";
import { classifyPerformance, factorFor, periodForHour, resolvePolicyCooldown, roundBid } from "../src/policy.mjs";

test("maps Dubai hours to stable periods", () => {
  assert.equal(periodForHour(0), "midnight");
  assert.equal(periodForHour(4), "trough");
  assert.equal(periodForHour(8), "baseline");
  assert.equal(periodForHour(19), "peak");
  assert.equal(periodForHour(23), "late");
});

test("uses target-level ROAS 8 hard line, 10 maintain line and 12 expansion line", () => {
  assert.equal(classifyPerformance({ roas: 12, spends: 30, orders: 3, ageDays: 8 }).tier, "optimize");
  assert.equal(classifyPerformance({ roas: 10, spends: 30, orders: 3, ageDays: 8 }).tier, "maintain");
  assert.equal(classifyPerformance({ roas: 8, spends: 30, orders: 3, ageDays: 8 }).tier, "hard_pass");
  assert.equal(classifyPerformance({ roas: 7.99, spends: 30, orders: 3, ageDays: 8 }).tier, "hard_fail");
  assert.equal(classifyPerformance({ roas: 4.9, spends: 30, orders: 1, ageDays: 8 }).tier, "severe");
});

test("stops zero-order targets at AED 20 and watches them from AED 10", () => {
  assert.equal(classifyPerformance({ roas: 0, spends: 9.99, orders: 0, ageDays: 8 }).tier, "observe");
  assert.equal(classifyPerformance({ roas: 0, spends: 10, orders: 0, ageDays: 8 }).tier, "zero_order_watch");
  const stopped = classifyPerformance({ roas: 0, spends: 20, orders: 0, ageDays: 8 });
  assert.equal(stopped.tier, "zero_order_stop");
  assert.equal(stopped.pauseTarget, true);
});

test("uses conservative factors and only qualified targets receive peak uplift", () => {
  assert.equal(factorFor("optimize", "peak"), 1.05);
  assert.equal(factorFor("maintain", "peak"), 1);
  assert.equal(factorFor("hard_fail", "baseline"), 0.90);
  assert.equal(factorFor("severe", "peak"), 0.85);
  assert.equal(factorFor("observe", "trough"), 1);
});

test("holds recovery for seven days but permits immediate risk reduction", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  const previous = { tier: "severe", reason: "low", policyUpdatedAt: "2026-08-30T00:00:00Z" };
  assert.equal(resolvePolicyCooldown({ tier: "optimize", reason: "better" }, previous, now).tier, "severe");
  assert.equal(resolvePolicyCooldown({ tier: "zero_order_stop", reason: "worse", pauseTarget: true }, previous, now).tier, "zero_order_stop");
});

test("rounds bids and enforces the Noon minimum", () => {
  assert.equal(roundBid(0.35, 1.05), 0.37);
  assert.equal(roundBid(0.25, 0.85), 0.25);
});
