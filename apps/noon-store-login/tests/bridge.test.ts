import { describe, expect, it } from "vitest";
import { SessionBridge } from "../src/bridge";
import type { OtpProvider } from "../src/outlook-otp";

describe("SessionBridge", () => {
  it("serves one monitor config and accepts a structured result", async () => {
    const bridge = new SessionBridge(2_000);
    await bridge.start();
    try {
      const session = bridge.prepare({
        storeIndex: 1,
        projectCode: "PRJ42958",
        targetUrl: "https://fbn.noon.partners/en-ae/inventory",
        intervalMinutes: 10,
      });
      const token = new URL(session.url).pathname.split("/").pop()!;
      const origin = new URL(session.url).origin;
      const payload = await fetch(`${origin}/config/${token}`).then((response) => response.json()) as Record<string, unknown>;
      expect(payload).toMatchObject({ storeIndex: 1, projectCode: "PRJ42958" });
      const result = {
        valid: true,
        finalUrl: "https://fbn.noon.partners/en-ae/inventory",
        title: "fulfillment | sc | noon | seller lab",
        checkedAt: "2026-08-11T10:00:00.000Z",
      };
      await fetch(`${origin}/complete/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      await expect(session.completed).resolves.toEqual(result);
    } finally {
      await bridge.close();
    }
  });

  it("serves a fresh Outlook code through the in-memory bridge", async () => {
    const provider: OtpProvider = {
      begin: async (storeIndex) => ({ messageIds: [`before-${storeIndex}`] }),
      waitForCode: async (storeIndex, baseline) => {
        expect(storeIndex).toBe(2);
        expect(baseline.messageIds).toEqual(["before-2"]);
        return "123456";
      },
    };
    const bridge = new SessionBridge(2_000, provider);
    await bridge.start();
    try {
      const session = bridge.prepare({
        storeIndex: 2,
        projectCode: "PRJ55651",
        targetUrl: "https://fbn.noon.partners/en-ae/inventory",
        intervalMinutes: 10,
        autoLogin: true,
      });
      const token = new URL(session.url).pathname.split("/").pop()!;
      const origin = new URL(session.url).origin;
      const config = await fetch(`${origin}/config/${token}`).then((response) => response.json()) as Record<string, unknown>;
      expect(config).toMatchObject({ bridgeBaseUrl: origin, bridgeToken: token, autoLogin: true });
      await expect(fetch(`${origin}/otp-begin/${token}`, { method: "POST" }).then((response) => response.json()))
        .resolves.toEqual({ ok: true });
      await expect(fetch(`${origin}/otp-code/${token}`).then((response) => response.json()))
        .resolves.toEqual({ code: "123456" });
      const result = {
        valid: true,
        finalUrl: "https://fbn.noon.partners/en-ae/inventory",
        title: "fulfillment | sc | noon | seller lab",
        checkedAt: "2026-08-14T03:30:00.000Z",
      };
      await fetch(`${origin}/complete/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      await expect(session.completed).resolves.toEqual(result);
    } finally {
      await bridge.close();
    }
  });
});
