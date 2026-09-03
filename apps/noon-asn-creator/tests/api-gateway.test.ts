import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { AsnJob, NoonSession } from "../src/contracts.js";
import { ContractApiGateway } from "../src/noon/api-gateway.js";
import { validateContractBundle } from "../src/noon/contract-schema.js";

const fixtureUrl = new URL("fixtures/contracts/synthetic.v1.json", import.meta.url);
const bundle = validateContractBundle(JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown);
const job: AsnJob = {
  filePath: "D:\\one.xlsx", fileName: "店铺1 one.xlsx", fileFingerprint: "a".repeat(64),
  storeIndex: 1, projectCode: "PRJ42958", partnerId: "42958", site: "UAE",
  items: [{ partnerSku: "SKU-A", quantity: 2 }]
};
const session: NoonSession = {
  cookieHeader: "session=old", projectCode: "PRJ42958", authenticatedAt: "2026-08-11T00:00:00.000Z"
};
const recordBody = {
  asn_number: "ASN-1", project_code: "PRJ42958", status: "created",
  items: [{ partner_sku: "SKU-A", quantity: 2 }]
};

function gateway(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new ContractApiGateway(bundle, {
    fetch: fetchImpl,
    retryDelaysMs: [0],
    sleep: async () => undefined,
    ...overrides
  });
}

describe("ContractApiGateway", () => {
  it("parses list and detail records through contract selectors", async () => {
    const fakeFetch = vi.fn<typeof fetch>(async (input) => String(input).includes("ASN-1")
      ? Response.json({ data: recordBody })
      : Response.json({ data: { records: [recordBody] } }));
    const api = gateway(fakeFetch);
    expect((await api.findMatches(job, session))[0]).toMatchObject({ asnNumber: "ASN-1", projectCode: "PRJ42958" });
    expect((await api.getDetails("ASN-1", job, session)).items).toEqual([{ partnerSku: "SKU-A", quantity: 2 }]);
  });

  it("refreshes once after a 401 and retries a read-only 429", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 401 });
      if (calls === 2) return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
      return Response.json({ data: { records: [recordBody] } });
    };
    const refreshSession = vi.fn(async () => ({ ...session, cookieHeader: "session=fresh" }));
    const result = await gateway(fakeFetch, { refreshSession }).findMatches(job, session);
    expect(result).toHaveLength(1);
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(calls).toBe(3);
  });

  it("reports accepted creation and never retries an uncertain creation", async () => {
    const accepted = vi.fn<typeof fetch>(async () => Response.json({ ok: true }, { status: 201 }));
    expect(await gateway(accepted).create(job, session)).toEqual({ outcome: "accepted" });
    expect(accepted).toHaveBeenCalledOnce();

    const uncertain = vi.fn<typeof fetch>(async () => { throw new TypeError("socket closed"); });
    expect(await gateway(uncertain).create(job, session)).toEqual({ outcome: "uncertain" });
    expect(uncertain).toHaveBeenCalledOnce();
  });

  it("rejects nonretryable 4xx, malformed JSON, and response schema drift", async () => {
    await expect(gateway(async () => new Response("bad", { status: 400 })).create(job, session)).rejects.toMatchObject({ status: 400 });
    await expect(gateway(async () => new Response("not-json", { status: 200 })).findMatches(job, session)).rejects.toMatchObject({ kind: "contract" });
    await expect(gateway(async () => Response.json({ data: { records: [{ status: "created" }] } })).findMatches(job, session)).rejects.toMatchObject({ kind: "contract" });
  });

  it("executes the captured eligible, main, lines, and storage workflow once", async () => {
    const liveBundle = validateContractBundle(JSON.parse(await readFile(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url), "utf8")) as unknown);
    const bodies: Array<{ path: string; body: any }> = [];
    const visibleLines: Array<{ partner_sku: string; qty: number }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body)) as any;
      bodies.push({ path, body });
      if (path.endsWith("list_eligible_lines")) return Response.json({ rows: [{
        partner_sku: "SKU-A", psku_code: "PSKU-1", sku: "NOON-SKU-1",
        cubic_feet: 0.5, storage_type_code: "standard"
      }] });
      if (path.endsWith("/asn/create")) return Response.json({ data: { asn_nr: "ASN-FAKE" } });
      if (path.endsWith("/routing/warehouse")) return Response.json({ data: [{ warehouse: "DXB" }], is_transfer: false });
      if (path.endsWith("create-batch")) {
        visibleLines.push({ partner_sku: "SKU-A", qty: 2 });
        return Response.json({ data: [{ asn_nr: "ASN-FAKE" }] });
      }
      if (path.endsWith("partner_asn_details")) {
        return Response.json({ data: { rows: [{ asn_nr: "ASN-FAKE", status: "created", lines: visibleLines }] } });
      }
      if (path.endsWith("available_storage_check")) return Response.json({ data: [{ status: "ok" }] });
      throw new Error(`unexpected ${path}`);
    };
    const api = new ContractApiGateway(liveBundle, { fetch: fakeFetch, retryDelaysMs: [] });
    await expect(api.create(job, session)).resolves.toEqual({ outcome: "accepted", asnNumber: "ASN-FAKE" });
    expect(bodies.map(({ path }) => path)).toEqual([
      "/_svc/inbound-partners/asn/list_eligible_lines",
      "/_svc/inbound-partners/asn/create",
      "/_svc/inbound-partners/routing/warehouse",
      "/_svc/inbound-partners/asn/lines/create-batch",
      "/_svc/inbound-partners/asn/partner_asn_details",
      "/_svc/inbound-partners/asn/available_storage_check"
    ]);
    expect(bodies[1]!.body).toEqual({ totalQty: 2 });
    expect(bodies[2]!.body).toEqual({
      asnNr: "ASN-FAKE",
      lines: [{ sku: "NOON-SKU-1", qty: 2, storage_type_code: "standard" }]
    });
    expect(bodies[3]!.body.partnerAsnLineList).toEqual([{
      psku_code: "PSKU-1", qty: 2, cubic_feet: 1, storage_type_code: "standard", sku: "NOON-SKU-1"
    }]);
  });

  it("does not recreate the ASN when the captured lines step loses its response", async () => {
    const liveBundle = validateContractBundle(JSON.parse(await readFile(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url), "utf8")) as unknown);
    const calls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname; calls.push(path);
      if (path.endsWith("list_eligible_lines")) return Response.json({ rows: [{ partner_sku: "SKU-A", psku_code: "P", sku: "N", cubic_feet: 1, storage_type_code: "standard" }] });
      if (path.endsWith("/asn/create")) return Response.json({ data: { asn_nr: "ASN-FAKE" } });
      if (path.endsWith("/routing/warehouse")) return Response.json({ data: [{ warehouse: "DXB" }], is_transfer: false });
      throw new TypeError("connection lost");
    };
    await expect(new ContractApiGateway(liveBundle, { fetch: fakeFetch, retryDelaysMs: [] }).create(job, session))
      .resolves.toEqual({ outcome: "uncertain", asnNumber: "ASN-FAKE" });
    expect(calls.filter((path) => path.endsWith("/asn/create"))).toHaveLength(1);
  });

  it("routes the ASN and writes all Noon lines in one request", async () => {
    const liveBundle = validateContractBundle(JSON.parse(await readFile(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url), "utf8")) as unknown);
    const manyItems = Array.from({ length: 12 }, (_value, index) => ({ partnerSku: `SKU-${index + 1}`, quantity: 1 }));
    const manyJob = { ...job, items: manyItems };
    const lineBatchSizes: number[] = [];
    const visibleLines: Array<{ partner_sku: string; qty: number }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body)) as any;
      if (path.endsWith("list_eligible_lines")) return Response.json({ rows: [{
        partner_sku: body.search.value,
        psku_code: `P-${body.search.value}`,
        sku: `N-${body.search.value}`,
        cubic_feet: 0.25,
        storage_type_code: "standard"
      }] });
      if (path.endsWith("/asn/create")) return Response.json({ data: { asn_nr: "ASN-MANY" } });
      if (path.endsWith("/routing/warehouse")) return Response.json({ data: [{ warehouse: "DXB" }], is_transfer: false });
      if (path.endsWith("create-batch")) {
        lineBatchSizes.push(body.partnerAsnLineList.length);
        visibleLines.push(...body.partnerAsnLineList.map((item: any) => ({
          partner_sku: String(item.psku_code).replace(/^P-/, ""),
          qty: item.qty
        })));
        return Response.json({ data: [] });
      }
      if (path.endsWith("partner_asn_details")) {
        return Response.json({ data: { rows: [{ asn_nr: "ASN-MANY", status: "created", lines: visibleLines }] } });
      }
      if (path.endsWith("available_storage_check")) return Response.json({ data: [] });
      throw new Error(`unexpected ${path}`);
    };
    await expect(new ContractApiGateway(liveBundle, { fetch: fakeFetch, retryDelaysMs: [] }).create(manyJob, session))
      .resolves.toEqual({ outcome: "accepted", asnNumber: "ASN-MANY" });
    expect(lineBatchSizes).toEqual([12]);
  });

  it("treats an omitted details lines field as an empty pending ASN", async () => {
    const liveBundle = validateContractBundle(JSON.parse(await readFile(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url), "utf8")) as unknown);
    const fakeFetch: typeof fetch = async () => Response.json({
      data: { rows: [{ asn_nr: "ASN-EMPTY", status: "created" }] }
    });
    await expect(new ContractApiGateway(liveBundle, { fetch: fakeFetch }).getDetails("ASN-EMPTY", job, session))
      .resolves.toMatchObject({ asnNumber: "ASN-EMPTY", items: [] });
  });

  it("stops safely when Noon routing rejects a one-ASN combination", async () => {
    const liveBundle = validateContractBundle(JSON.parse(await readFile(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url), "utf8")) as unknown);
    const sixItems = Array.from({ length: 6 }, (_value, index) => ({ partnerSku: `SKU-${index + 1}`, quantity: 1 }));
    let lineWrites = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body)) as any;
      if (path.endsWith("list_eligible_lines")) return Response.json({ rows: [{
        partner_sku: body.search.value, psku_code: `P-${body.search.value}`, sku: `N-${body.search.value}`,
        cubic_feet: 0.25, storage_type_code: "standard"
      }] });
      if (path.endsWith("/asn/create")) return Response.json({ data: { asn_nr: "ASN-DELAYED" } });
      if (path.endsWith("/routing/warehouse")) return Response.json({ data: [] });
      if (path.endsWith("create-batch")) { lineWrites += 1; return Response.json({ data: [] }); }
      throw new Error(`unexpected ${path}`);
    };
    const api = new ContractApiGateway(liveBundle, {
      fetch: fakeFetch,
      retryDelaysMs: [],
      sleep: async () => undefined
    });
    await expect(api.create({ ...job, items: sixItems }, session)).resolves.toEqual({
      outcome: "uncertain", asnNumber: "ASN-DELAYED"
    });
    expect(lineWrites).toBe(0);
  });

  it("uses standard storage and unit volume defaults for unidentified catalog items", async () => {
    const liveBundle = validateContractBundle(JSON.parse(await readFile(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url), "utf8")) as unknown);
    const bodies: Array<{ path: string; body: any }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body)) as any;
      bodies.push({ path, body });
      if (path.endsWith("list_eligible_lines")) return Response.json({ rows: [{
        partner_sku: "SKU-A", psku_code: "P", sku: "N", cubic_feet: 0,
        storage_type_code: "unidentified"
      }] });
      if (path.endsWith("get_size_classification")) return Response.json({
        volume: 0.00004, size_classification: "standard_parcel", storage_type_code: "standard"
      });
      if (path.endsWith("/asn/create")) return Response.json({ data: { asn_nr: "ASN-DEFAULTED" } });
      if (path.endsWith("/routing/warehouse")) return Response.json({ data: [{ warehouse: "DXB" }] });
      if (path.endsWith("create-batch")) return Response.json({ data: [] });
      if (path.endsWith("partner_asn_details")) return Response.json({ data: { rows: [{
        asn_nr: "ASN-DEFAULTED", status: "created", project_code: job.projectCode,
        lines: [{ partner_sku: "SKU-A", qty: 2 }]
      }] } });
      if (path.endsWith("available_storage_check")) return Response.json({ data: [{ status: "ok" }] });
      throw new Error(`unexpected ${path}`);
    };
    await expect(new ContractApiGateway(liveBundle, { fetch: fakeFetch }).create(job, session))
      .resolves.toEqual({ outcome: "accepted", asnNumber: "ASN-DEFAULTED" });
    expect(bodies.find(({ path }) => path.endsWith("/routing/warehouse"))?.body.lines).toEqual([
      { sku: "N", qty: 2, storage_type_code: "standard" },
    ]);
    expect(bodies.find(({ path }) => path.endsWith("create-batch"))?.body.partnerAsnLineList).toEqual([
      { psku_code: "P", qty: 2, cubic_feet: 0.00008, storage_type_code: "standard", sku: "N" },
    ]);
  });

  it("uses 1/1/1/1 defaults when catalog volume is missing even if storage is identified", async () => {
    const liveBundle = validateContractBundle(JSON.parse(await readFile(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url), "utf8")) as unknown);
    const bodies: Array<{ path: string; body: any }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body)) as any;
      bodies.push({ path, body });
      if (path.endsWith("list_eligible_lines")) return Response.json({ rows: [{
        partner_sku: "SKU-A", psku_code: "P", sku: "N", cubic_feet: 0,
        storage_type_code: "apparel_footwear"
      }] });
      if (path.endsWith("get_size_classification")) return Response.json({ volume: 0.00004, size_classification: "standard_parcel", storage_type_code: "standard" });
      if (path.endsWith("/asn/create")) return Response.json({ data: { asn_nr: "ASN-VOLUME" } });
      if (path.endsWith("/routing/warehouse")) return Response.json({ data: [{ warehouse: "DXB" }] });
      if (path.endsWith("create-batch")) return Response.json({ data: [] });
      if (path.endsWith("partner_asn_details")) return Response.json({ data: { rows: [{ asn_nr: "ASN-VOLUME", status: "created", project_code: job.projectCode, lines: [{ partner_sku: "SKU-A", qty: 2 }] }] } });
      if (path.endsWith("available_storage_check")) return Response.json({ data: [{ status: "ok" }] });
      throw new Error(`unexpected ${path}`);
    };

    await expect(new ContractApiGateway(liveBundle, { fetch: fakeFetch }).create(job, session)).resolves.toMatchObject({ outcome: "accepted" });
    expect(bodies.find(({ path }) => path.endsWith("create-batch"))?.body.partnerAsnLineList[0]).toMatchObject({
      cubic_feet: 0.00008,
      storage_type_code: "standard",
    });
  });

  it("seals a verified ASN and confirms sealed status", async () => {
    const liveBundle = validateContractBundle(JSON.parse(await readFile(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url), "utf8")) as unknown);
    const calls: string[] = [];
    let detailReads = 0;
    const fakeFetch: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path.endsWith("partner_asn_details")) {
        detailReads += 1;
        return Response.json({ data: { rows: [{
          asn_nr: "ASN-SEAL", status: detailReads === 1 ? "created" : "sealed", project_code: job.projectCode,
          lines: [{ partner_sku: "SKU-A", qty: 2 }]
        }] } });
      }
      if (path.endsWith("/asn/seal")) return Response.json({ data: { status: "sealed" } });
      throw new Error(`unexpected ${path}`);
    };

    await expect(new ContractApiGateway(liveBundle, { fetch: fakeFetch, visibilityDelaysMs: [] }).seal("ASN-SEAL", job, session))
      .resolves.toMatchObject({ asnNumber: "ASN-SEAL", status: "sealed", items: job.items });
    expect(calls.filter((path) => path.endsWith("/asn/seal"))).toHaveLength(1);
  });

  it("does not submit seal again when the ASN is already sealed", async () => {
    const liveBundle = validateContractBundle(JSON.parse(await readFile(new URL("../contracts/noon-uae-asn.v1.json", import.meta.url), "utf8")) as unknown);
    const seal = vi.fn<typeof fetch>();
    const fakeFetch: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("partner_asn_details")) return Response.json({ data: { rows: [{
        asn_nr: "ASN-SEAL", status: "sealed", project_code: job.projectCode,
        lines: [{ partner_sku: "SKU-A", qty: 2 }]
      }] } });
      return seal(input, init);
    };

    await expect(new ContractApiGateway(liveBundle, { fetch: fakeFetch }).seal("ASN-SEAL", job, session))
      .resolves.toMatchObject({ status: "sealed" });
    expect(seal).not.toHaveBeenCalled();
  });
});
