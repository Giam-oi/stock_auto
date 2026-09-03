import { describe, expect, it, vi } from "vitest";
import { SITE_CONFIGS } from "../src/contracts.js";
import { resolvePrimaryContract } from "../src/finance-client.js";

describe("primary finance contract resolution", () => {
  it("accepts the store-6 spacing and case variation without selecting FBN", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ contractOrderNrs: [
      { contractTitle: "Noon AE", contractOrderNr: "PRIMARY" },
      { contractTitle: "FBN AE", contractOrderNr: "FBN" },
    ] }), { status: 200 }));
    await expect(resolvePrimaryContract(
      "PRJ363826", "session=value", SITE_CONFIGS.UAE, fetchMock as typeof fetch,
    )).resolves.toBe("PRIMARY");
  });
});
