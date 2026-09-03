import { describe, expect, it } from "vitest";
import { SITE_CONFIGS, STORE_CONFIGS } from "../src/contracts.js";
import {
  InventoryClientError,
  fetchRealtimeInventory,
} from "../src/realtime-client.js";

const SAMPLE_CSV = "inventory_type,partner_sku,qty\r\nsaleable,SKU-1,2\r\n";

function csvResponse(body = SAMPLE_CSV, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/csv; charset=utf-8" } });
}

describe("fetchRealtimeInventory", () => {
  it("requests the exact UAE real-time export contract", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return csvResponse();
    };

    const download = await fetchRealtimeInventory(
      {
        store: STORE_CONFIGS[0]!,
        site: SITE_CONFIGS.UAE,
        cookieHeader: "session=test",
      },
      fakeFetch,
    );

    expect(capturedUrl).toBe(
      "https://fbn.noon.partners/_svc/sc-fbn/api/v5/seller-lab/fbn-inventory",
    );
    expect(capturedInit?.method).toBe("POST");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("X-Locale")).toBe("en-ae");
    expect(headers.get("X-Project")).toBe("PRJ42958");
    expect(headers.get("X-Platform")).toBe("web");
    expect(headers.get("Country-Code")).toBe("ae");
    expect(headers.get("Id-Partner")).toBe("42958");
    expect(headers.get("Cookie")).toBe("session=test");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({ inventory_tab_name: "export" });
    expect(download.csvText).toBe(SAMPLE_CSV);
    expect(download.contentType).toContain("text/csv");
    expect(download.httpStatus).toBe(200);
    expect(download.completedAt.getTime()).toBeGreaterThanOrEqual(download.requestedAt.getTime());
  });

  it("uses the KSA locale without changing the store project", async () => {
    let capturedHeaders = new Headers();
    const fakeFetch: typeof fetch = async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return csvResponse();
    };

    await fetchRealtimeInventory(
      { store: STORE_CONFIGS[0]!, site: SITE_CONFIGS.KSA, cookieHeader: "session=test" },
      fakeFetch,
    );

    expect(capturedHeaders.get("X-Locale")).toBe("en-sa");
    expect(capturedHeaders.get("X-Project")).toBe("PRJ42958");
    expect(capturedHeaders.get("Country-Code")).toBe("sa");
    expect(capturedHeaders.get("Id-Partner")).toBe("42958");
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [401, false],
    [403, false],
    [404, false],
  ])("classifies HTTP %i retryable=%s", async (status, retryable) => {
    const fakeFetch: typeof fetch = async () => csvResponse("diagnostic body", status);
    const error = await fetchRealtimeInventory(
      { store: STORE_CONFIGS[0]!, site: SITE_CONFIGS.UAE, cookieHeader: "secret-cookie" },
      fakeFetch,
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(InventoryClientError);
    expect(error).toMatchObject({ kind: "http", status, retryable });
    expect((error as Error).message).not.toContain("secret-cookie");
    expect((error as Error).message).not.toContain("diagnostic body");
  });

  it.each([
    ["text/html", "<html>login</html>", "content-type"],
    ["text/csv", "", "empty"],
    ["text/csv", "{\"error\":\"not csv\"}", "unexpected-body"],
  ])("rejects invalid success response %s", async (contentType, body, kind) => {
    const fakeFetch: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { "Content-Type": contentType } });

    const error = await fetchRealtimeInventory(
      { store: STORE_CONFIGS[0]!, site: SITE_CONFIGS.UAE, cookieHeader: "session=test" },
      fakeFetch,
    ).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind, retryable: false });
  });

  it("turns timeout aborts into a retryable error", async () => {
    const fakeFetch: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });

    const error = await fetchRealtimeInventory(
      {
        store: STORE_CONFIGS[0]!,
        site: SITE_CONFIGS.UAE,
        cookieHeader: "session=test",
        timeoutMs: 5,
      },
      fakeFetch,
    ).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "timeout", retryable: true });
  });
});
