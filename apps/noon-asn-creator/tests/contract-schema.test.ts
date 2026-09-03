import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  sanitizeExchange,
  validateContractBundle,
  type CapturedExchange,
} from "../src/noon/contract-schema.js";

const fixtureUrl = new URL("fixtures/contracts/synthetic.v1.json", import.meta.url);

describe("contract schema", () => {
  it("accepts a complete ASN operation bundle", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown;
    expect(validateContractBundle(fixture).version).toBe(1);
  });

  it("rejects unknown variables and credential-like literal values", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as Record<string, unknown>;
    const unknownVariable = structuredClone(fixture) as any;
    unknownVariable.operations.find.urlTemplate += "&bad=${unknown}";
    expect(() => validateContractBundle(unknownVariable)).toThrow(/unknown template variable/i);

    const credential = structuredClone(fixture) as any;
    credential.operations.create.bodyTemplate.secret = "aaa.bbb.ccc";
    expect(() => validateContractBundle(credential)).toThrow(/credential/i);
  });

  it("sanitizes a captured request without retaining auth or business values", () => {
    const exchange: CapturedExchange = {
      operation: "create",
      request: {
        method: "POST",
        url: "https://fbn.noon.partners/_svc/asn/create?project=PRJ42958&partner=42958&country=AE&locale=en-ae",
        headers: {
          Cookie: "session=private",
          Authorization: "Bearer aaa.bbb.ccc",
          "X-Project": "PRJ42958",
          "Id-Partner": "42958",
          "X-Locale": "en-ae",
          "Country-Code": "ae",
          "Content-Type": "application/json"
        },
        body: { items: [{ partner_sku: "SKU-PRIVATE", quantity: 3 }] }
      },
      response: { status: 201, body: { data: { asn_number: "ASN-PRIVATE" } } }
    };

    const sanitized = sanitizeExchange(exchange, {
      projectCode: "PRJ42958",
      partnerId: "42958",
      countryCode: "AE",
      locale: "en-ae",
      asnNumber: "ASN-PRIVATE",
      items: [{ partnerSku: "SKU-PRIVATE", quantity: 3 }]
    });
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("session=private");
    expect(text).not.toContain("aaa.bbb.ccc");
    expect(text).not.toContain("SKU-PRIVATE");
    expect(text).not.toContain("ASN-PRIVATE");
    expect(sanitized.allowedHeaders).not.toContain("Authorization");
    expect(sanitized.bodyTemplate).toEqual({ items: "${itemsJson}" });
    expect(sanitized.urlTemplate).toContain("${projectCode}");
  });
});
