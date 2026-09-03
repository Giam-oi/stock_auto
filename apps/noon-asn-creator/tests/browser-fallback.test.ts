import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AsnGateway, AsnJob, AsnRecord, NoonSession } from "../src/contracts.js";
import { BrowserAsnFallback } from "../src/browser/fallback.js";
import { locateChrome } from "../src/browser/chrome.js";
import { parseCookieHeader } from "../src/browser/cookies.js";
import { startFixtureServer, type FixtureServer } from "./fixtures/web/server.js";

const servers: FixtureServer[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

const job: AsnJob = {
  filePath: "D:\\one.xlsx", fileName: "店铺1 one.xlsx", fileFingerprint: "a".repeat(64),
  storeIndex: 1, projectCode: "PRJ42958", partnerId: "42958", site: "UAE",
  items: [{ partnerSku: "SKU-A", quantity: 2 }]
};
const session: NoonSession = { cookieHeader: "session=test", projectCode: "PRJ42958", authenticatedAt: "2026-08-11T00:00:00Z" };
const record: AsnRecord = { asnNumber: "ASN-1", projectCode: "PRJ42958", status: "created", items: job.items };

function fakeGateway(server: FixtureServer): AsnGateway {
  return {
    findMatches: async () => server.submissions.length ? [record] : [],
    create: async () => { throw new Error("browser only"); },
    getDetails: async () => record
  };
}

async function fallback(server: FixtureServer, extra: Record<string, unknown> = {}) {
  return new BrowserAsnFallback({
    gateway: fakeGateway(server),
    refreshSession: async () => session,
    chromePath: await locateChrome(),
    profileDirectory: await mkdtemp(join(tmpdir(), "noon-browser-test-")),
    headless: true,
    createUrl: () => `${server.url}/create`,
    injectSession: async () => undefined,
    stepTimeoutMs: 3_000,
    pollDelaysMs: [0, 20],
    ...extra
  });
}

describe("browser fallback", () => {
  it("waits for the product table rather than networkidle and submits exact SKU quantities", async () => {
    const server = await startFixtureServer({ catalogDelayMs: 250 }); servers.push(server);
    const result = await (await fallback(server)).createAndVerify(job, session);
    expect(result.asnNumber).toBe("ASN-1");
    expect(server.submissions).toEqual([{ items: [{ partnerSku: "SKU-A", quantity: 2 }] }]);
  }, 45_000);

  it("refreshes authentication after a login redirect and opens named capture windows", async () => {
    const server = await startFixtureServer({ loginRedirectOnce: true }); servers.push(server);
    const refreshSession = vi.fn(async () => session);
    const windows: string[] = [];
    const capture = { during: async <T>(name: string, action: () => Promise<T>) => { windows.push(name); return action(); } };
    await (await fallback(server, { refreshSession, capture })).createAndVerify(job, session);
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(windows).toEqual(expect.arrayContaining(["create", "find", "details"]));
  }, 45_000);

  it("times out a stuck page without contaminating a later job", async () => {
    const stuck = await startFixtureServer({ neverReady: true }); servers.push(stuck);
    await expect((await fallback(stuck, { stepTimeoutMs: 300 })).createAndVerify(job, session)).rejects.toMatchObject({ kind: "browser" });
    const working = await startFixtureServer(); servers.push(working);
    await expect((await fallback(working)).createAndVerify(job, session)).resolves.toMatchObject({ asnNumber: "ASN-1" });
  }, 45_000);

  it("parses Cookie headers without reading a browser profile and has no coordinate automation", async () => {
    expect(parseCookieHeader("session=abc==; pref=en-ae")).toEqual([{ name: "session", value: "abc==" }, { name: "pref", value: "en-ae" }]);
    const source = await readFile(new URL("../src/browser/fallback.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/networkidle|mouse\.click\s*\(/);
  });
});
