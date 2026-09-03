import { describe, expect, it } from "vitest";
import type { AsnJob, AsnRecord } from "../src/contracts.js";
import { itemsExactlyMatch, normalizeItems, reconcileUnique } from "../src/noon/verifier.js";

const job: AsnJob = {
  filePath: "D:\\one.xlsx",
  fileName: "店铺1 one.xlsx",
  fileFingerprint: "a".repeat(64),
  storeIndex: 1,
  projectCode: "PRJ42958",
  partnerId: "42958",
  site: "UAE",
  items: [{ partnerSku: "A", quantity: 2 }, { partnerSku: "B", quantity: 1 }]
};

function record(overrides: Partial<AsnRecord> = {}): AsnRecord {
  return {
    asnNumber: "ASN-1",
    projectCode: "PRJ42958",
    status: "created",
    items: [{ partnerSku: "B", quantity: 1 }, { partnerSku: "A", quantity: 2 }],
    ...overrides
  };
}

describe("ASN verifier", () => {
  it("normalizes order and matches exact SKU quantities", () => {
    expect(normalizeItems(job.items)).toEqual(["A\u00002", "B\u00001"]);
    expect(itemsExactlyMatch(job.items, record().items)).toBe(true);
  });

  it("rejects missing, extra, changed, and duplicate response items", () => {
    expect(itemsExactlyMatch(job.items, [{ partnerSku: "A", quantity: 2 }])).toBe(false);
    expect(itemsExactlyMatch(job.items, [...job.items, { partnerSku: "C", quantity: 1 }])).toBe(false);
    expect(itemsExactlyMatch(job.items, [{ partnerSku: "A", quantity: 3 }, { partnerSku: "B", quantity: 1 }])).toBe(false);
    expect(itemsExactlyMatch(job.items, [{ partnerSku: "A", quantity: 1 }, { partnerSku: "A", quantity: 1 }, { partnerSku: "B", quantity: 1 }])).toBe(false);
  });

  it("returns only one exact project/item match", () => {
    expect(reconcileUnique(job, [])).toBeUndefined();
    expect(reconcileUnique(job, [record({ projectCode: "PRJ99999" })])).toBeUndefined();
    expect(reconcileUnique(job, [record()])?.asnNumber).toBe("ASN-1");
    expect(() => reconcileUnique(job, [record(), record({ asnNumber: "ASN-2" })])).toThrow(/multiple/i);
  });
});
