import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  notificationMarkdown, sendSuccessOnce, sendWeComNotification, type SalesNotification,
} from "../src/wecom.js";

const host = ["qyapi", "weixin", "qq", "com"].join(".");
const webhook = `https://${host}/cgi-bin/webhook/send?key=test-only-key`;
const success: SalesNotification = {
  fromDate: "2026-08-14", toDate: "2026-08-16", status: "success",
  startedAt: "2026-08-17T01:20:00Z", completedAt: "2026-08-17T01:23:00Z",
};

describe("sales WeCom notification", () => {
  it("matches the inventory backup-style success format", () => {
    expect(notificationMarkdown(success)).toBe("2026-08-14至2026-08-16 销售报表已成功备份");
  });

  it("sends markdown without exposing the webhook key", async () => {
    let body = "";
    const fetchMock: typeof fetch = async (_url, init) => {
      body = String(init?.body);
      return new Response('{"errcode":0,"errmsg":"ok"}', { status: 200 });
    };
    await sendWeComNotification(success, webhook, fetchMock);
    expect(body).toContain("销售报表已成功备份");
    expect(body).not.toContain("test-only-key");
  });

  it("redacts secrets from failure details", () => {
    const markdown = notificationMarkdown({
      ...success, status: "failure", error: "Cookie: session=secret&key=hidden",
    });
    expect(markdown).toContain("销售报表采集失败");
    expect(markdown).not.toContain("session=secret");
    expect(markdown).not.toContain("key=hidden");
  });

  it("delivers one success per date range", async () => {
    const root = await mkdtemp(join(tmpdir(), "sales-wecom-"));
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      return new Response('{"errcode":0}', { status: 200 });
    };
    try {
      const statePath = join(root, "state.json");
      await expect(sendSuccessOnce(success, webhook, statePath, fetchMock)).resolves.toBe("delivered");
      await expect(sendSuccessOnce(success, webhook, statePath, fetchMock)).resolves.toBe("skipped");
      expect(calls).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
