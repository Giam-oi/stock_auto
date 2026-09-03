import assert from "node:assert/strict";
import test from "node:test";
import { verifiedExternalBase } from "../src/runner.mjs";

const action = { afterBid: 0.51, executedAt: "2026-08-26T09:08:00.000Z", source: "receipt.json" };

test("adopts a newer verified external bid that matches live", () => {
  assert.equal(verifiedExternalBase({
    key: "42958|1", actualBid: 0.51, priorTarget: { lastAppliedAt: "2026-08-26T07:20:00.000Z" }, action,
  }), 0.51);
});

test("does not adopt a receipt whose bid differs from live", () => {
  assert.equal(verifiedExternalBase({
    key: "42958|1", actualBid: 0.50, priorTarget: { lastAppliedAt: "2026-08-26T07:20:00.000Z" }, action,
  }), null);
});

test("does not adopt a stale receipt", () => {
  assert.equal(verifiedExternalBase({
    key: "42958|1", actualBid: 0.51, priorTarget: { lastAppliedAt: "2026-08-26T10:00:00.000Z" }, action,
  }), null);
});

test("does not adopt an unexplained live conflict", () => {
  assert.equal(verifiedExternalBase({
    key: "42958|1", actualBid: 0.51, priorTarget: {}, stateUpdatedAt: "2026-08-26T07:20:00.000Z",
  }), null);
});
