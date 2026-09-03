import test from "node:test";
import assert from "node:assert/strict";
import { latestCompletedUaeWeek, latestCompletedWeek } from "../src/dates.mjs";
import { validateRange } from "../src/contracts.mjs";

test("Thursday selects the week ending yesterday", () => {
  assert.deepEqual(latestCompletedUaeWeek(new Date("2026-08-20T01:20:00Z")), {
    fromDate: "2026-08-13", toDate: "2026-08-19",
  });
});

test("Wednesday never selects an incomplete current day", () => {
  assert.deepEqual(latestCompletedUaeWeek(new Date("2026-08-19T01:20:00Z")), {
    fromDate: "2026-08-06", toDate: "2026-08-12",
  });
});

test("Friday through Tuesday retain the latest completed Thursday-Wednesday week", () => {
  for (const instant of ["2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25"]) {
    assert.deepEqual(latestCompletedUaeWeek(new Date(`${instant}T01:20:00Z`)), {
      fromDate: "2026-08-13", toDate: "2026-08-19",
    });
  }
});

test("KSA Friday selects the week ending Thursday", () => {
  assert.deepEqual(latestCompletedWeek("KSA", new Date("2026-08-21T01:20:00Z")), {
    fromDate: "2026-08-14", toDate: "2026-08-20",
  });
});

test("KSA Thursday never selects the incomplete current day", () => {
  assert.deepEqual(latestCompletedWeek("KSA", new Date("2026-08-20T01:20:00Z")), {
    fromDate: "2026-08-07", toDate: "2026-08-13",
  });
});

test("site ranges enforce their distinct weekday contracts", () => {
  assert.doesNotThrow(() => validateRange("UAE", "2026-08-13", "2026-08-19"));
  assert.doesNotThrow(() => validateRange("KSA", "2026-08-14", "2026-08-20"));
  assert.throws(() => validateRange("KSA", "2026-08-13", "2026-08-19"));
});
