import type { AsnItem, AsnJob, AsnRecord } from "../contracts.js";
import { AsnCreatorError } from "../errors.js";

export function normalizeItems(items: readonly AsnItem[]): readonly string[] {
  return items.map(({ partnerSku, quantity }) => `${partnerSku}\u0000${quantity}`).sort();
}

function hasDuplicateSku(items: readonly AsnItem[]): boolean {
  return new Set(items.map(({ partnerSku }) => partnerSku)).size !== items.length;
}

export function itemsExactlyMatch(expected: readonly AsnItem[], actual: readonly AsnItem[]): boolean {
  if (hasDuplicateSku(expected) || hasDuplicateSku(actual) || expected.length !== actual.length) return false;
  const left = normalizeItems(expected);
  const right = normalizeItems(actual);
  return left.every((value, index) => value === right[index]);
}

export function reconcileUnique(job: AsnJob, records: readonly AsnRecord[]): AsnRecord | undefined {
  const matches = records.filter(
    (record) => record.projectCode === job.projectCode && itemsExactlyMatch(job.items, record.items),
  );
  if (matches.length > 1) {
    throw new AsnCreatorError(
      "verification",
      false,
      "reconcile",
      "Multiple Noon ASNs exactly match this workbook; manual review is required",
    );
  }
  return matches[0];
}
