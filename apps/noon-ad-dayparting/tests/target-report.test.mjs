import assert from "node:assert/strict";
import test from "node:test";
import { aggregateTargetMetrics, indexTargetMetrics, targetMetricKey } from "../src/target-report.mjs";

test("indexes auto keyword and auto category independently", () => {
  const rows = [
    { campaignName: "A", targetingType: "keyword", targetValue: "auto keyword", strategy: "auto", spends: 10, revenue: 40, orders: 1 },
    { campaignName: "A", targetingType: "category", targetValue: "auto category", strategy: "auto", spends: 5, revenue: 50, orders: 2 },
  ];
  const index = indexTargetMetrics(rows);
  assert.equal(index.get(targetMetricKey(rows[0])).length, 1);
  assert.equal(index.get(targetMetricKey(rows[1])).length, 1);
  assert.notEqual(targetMetricKey(rows[0]), targetMetricKey(rows[1]));
  const total = aggregateTargetMetrics(rows);
  assert.equal(total.spends, 15);
  assert.equal(total.revenue, 90);
  assert.equal(total.roas, 6);
});
