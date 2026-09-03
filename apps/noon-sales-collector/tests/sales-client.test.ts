import { describe, expect, it } from "vitest";
import { SITE_CONFIGS, STORE_CONFIGS } from "../src/contracts.js";
import { fetchSalesExport } from "../src/sales-client.js";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

const input = {
  store: STORE_CONFIGS[0]!, site: SITE_CONFIGS.UAE, cookieHeader: "session=value",
  fromDate: "2026-08-19", toDate: "2026-08-19", pollIntervalMs: 0, timeoutMs: 5_000,
};

describe("sales export client", () => {
  it("generates an export when latest returns null", async () => {
    const calls: string[] = [];
    const responses = [
      json(null),
      json(null),
      json({ id_exports: 30, status: "Processing" }),
      json({ id_exports: 30, status: "Success", export_attachment: { file_name: "new.csv", url: "https://download/new" } }),
      new Response("a,b\n1,2\n", { status: 200 }),
    ];
    const fetchMock: typeof fetch = async (url) => {
      calls.push(String(url));
      return responses.shift()!;
    };

    const result = await fetchSalesExport(input, fetchMock, async () => undefined);

    expect(result).toMatchObject({ exportId: 30, sourceFileName: "new.csv" });
    expect(calls.some((url) => url.endsWith("/export/generate"))).toBe(true);
  });

  it("generates, avoids the previous cached success, polls, and downloads the new export", async () => {
    const calls: string[] = [];
    const responses = [
      json({ id_exports: 10, status: "Success", export_attachment: { file_name: "old.csv", url: "https://download/old" } }),
      json(null),
      json({ id_exports: 10, status: "Success", export_attachment: { file_name: "old.csv", url: "https://download/old" } }),
      json({ id_exports: 11, status: "Processing" }),
      json({ id_exports: 11, status: "Success", export_attachment: { file_name: "new.csv", url: "https://download/new" } }),
      new Response("a,b\n1,2\n", { status: 200 }),
    ];
    const fetchMock: typeof fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).includes("/export/")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-Project")).toBe("PRJ42958");
        expect(headers.get("Country-Code")).toBe("ae");
      }
      return responses.shift()!;
    };
    const result = await fetchSalesExport(input, fetchMock, async () => undefined);
    expect(result).toMatchObject({ exportId: 11, sourceFileName: "new.csv", csvText: "a,b\n1,2\n" });
    expect(calls).not.toContain("https://download/old");
    expect(calls.at(-1)).toBe("https://download/new");
  });

  it("resumes an active export instead of generating a duplicate", async () => {
    const calls: string[] = [];
    const fetchMock: typeof fetch = async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return json({ id_exports: 20, status: "Processing" });
      if (calls.length === 2) return json({ id_exports: 20, status: "Success", export_attachment: { file_name: "done.csv", url: "https://download/done" } });
      return new Response("a,b\n1,2\n", { status: 200 });
    };
    await fetchSalesExport(input, fetchMock, async () => undefined);
    expect(calls.some((url) => url.endsWith("/export/generate"))).toBe(false);
  });
});
