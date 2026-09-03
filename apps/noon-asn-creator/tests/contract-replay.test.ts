import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AsnJob, NoonSession } from "../src/contracts.js";
import { loadContractBundle } from "../src/noon/contract-loader.js";
import { bindOperation } from "../src/noon/contract-replay.js";

const fixtureUrl = new URL("fixtures/contracts/synthetic.v1.json", import.meta.url);
const job: AsnJob = {
  filePath: "D:\\input.xlsx",
  fileName: "01 店铺1.xlsx",
  fileFingerprint: "a".repeat(64),
  storeIndex: 1,
  projectCode: "PRJ42958",
  partnerId: "42958",
  site: "UAE",
  items: [{ partnerSku: "SKU-A", quantity: 2 }]
};
const session: NoonSession = {
  cookieHeader: "session=test",
  projectCode: "PRJ42958",
  authenticatedAt: "2026-08-11T00:00:00.000Z"
};

describe("contract replay", () => {
  it("loads, validates, and binds an operation without mutating the bundle", async () => {
    const bundle = await loadContractBundle(fixtureUrl);
    const before = JSON.stringify(bundle);
    const request = bindOperation(bundle, "create", job, session);
    expect(request).toMatchObject({
      method: "POST",
      url: "https://fbn.noon.partners/_svc/asn/create?project=PRJ42958",
      body: { items: [{ partner_sku: "SKU-A", quantity: 2 }] }
    });
    expect(request.headers.Cookie).toBe("session=test");
    expect(JSON.stringify(bundle)).toBe(before);
  });

  it("requires an ASN number for details and URL-encodes it", async () => {
    const bundle = await loadContractBundle(fixtureUrl);
    expect(() => bindOperation(bundle, "details", job, session)).toThrow(/ASN number/i);
    expect(bindOperation(bundle, "details", job, session, "ASN 1/2").url).toContain("ASN%201%2F2");
    expect(() => bindOperation(bundle, "seal", job, session)).toThrow(/ASN number/i);
    expect(bindOperation(bundle, "seal", job, session, "ASN-1").body).toEqual({ asnNr: "ASN-1" });
  });

  it("does not load a bundle with a missing operation", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as any;
    delete fixture.operations.details;
    expect(() => JSON.stringify(fixture)).not.toThrow();
    expect(() => bindOperation(fixture, "find", job, session)).toThrow(/contract/i);
  });

  it("binds the captured Noon multi-step workflow with typed variables", async () => {
    const liveBundle = await loadContractBundle(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url));
    expect(bindOperation(liveBundle, "create", job, session).body).toEqual({ totalQty: 2 });
    expect(bindOperation(liveBundle, "eligible", job, session, undefined, { partnerSku: "SKU-A" }).body).toMatchObject({
      search: { value: "SKU-A" }
    });
    expect(bindOperation(liveBundle, "classify", job, session).body).toEqual({});
    expect(bindOperation(liveBundle, "classify", job, session).url).toContain("length=1&width=1&height=1&weight=1");
    expect(bindOperation(liveBundle, "route", job, session, "ASN-FAKE", {
      routeItems: [{ sku: "N1", qty: 2, storage_type_code: "standard" }]
    }).body).toEqual({
      asnNr: "ASN-FAKE",
      lines: [{ sku: "N1", qty: 2, storage_type_code: "standard" }]
    });
    expect(bindOperation(liveBundle, "createLines", job, session, "ASN-FAKE", {
      catalogItems: [{ psku_code: "P1", qty: 2, cubic_feet: 1.5, storage_type_code: "standard", sku: "N1" }]
    }).body).toEqual({
      asnNr: "ASN-FAKE",
      partnerAsnLineList: [{ psku_code: "P1", qty: 2, cubic_feet: 1.5, storage_type_code: "standard", sku: "N1" }]
    });
  });
});
