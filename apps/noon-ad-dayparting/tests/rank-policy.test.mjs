import assert from "node:assert/strict";
import test from "node:test";
import { nextMinimumBid, targetMaxPosition } from "../src/rank-policy.mjs";
import { summarizeRank } from "../src/rank-probe.mjs";

test("uses top 3 in peak and top 20 outside peak", () => {
  assert.equal(targetMaxPosition("peak"), 3);
  assert.equal(targetMaxPosition("trough"), 20);
});

test("separates sponsored and organic rank", () => {
  const result = summarizeRank([{ sku: "OTHER", sponsored: true }, { sku: "TARGET", sponsored: false }], "TARGET-1");
  assert.equal(result.status, "not_served");
  assert.equal(result.adPosition, null);
  assert.equal(result.organicPosition, 2);
});

test("holds before sufficient samples and ROAS guard", () => {
  assert.equal(nextMinimumBid({ currentBid: 0.5, minimumBid: 0.25, maximumBid: 1, samplesInPeriod: 2, roas: 12, orders: 3, period: "peak" }).action, "hold");
  assert.equal(nextMinimumBid({ currentBid: 0.5, minimumBid: 0.25, maximumBid: 1, samplesInPeriod: 3, roas: 7, orders: 3, period: "peak" }).action, "hold");
});

test("binary searches downward after a passing rank", () => {
  const result = nextMinimumBid({ currentBid: 0.8, minimumBid: 0.25, maximumBid: 1.2, lowerFailBid: 0.6, adPosition: 3, samplesInPeriod: 3, roas: 12, orders: 3, period: "peak" });
  assert.equal(result.desiredBid, 0.7);
  assert.equal(result.direction, "down");
});
