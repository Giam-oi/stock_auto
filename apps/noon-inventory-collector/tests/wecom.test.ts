import { describe, expect, it } from "vitest";
import {
  NotificationError,
  sendWeComNotification,
  type NotificationSummary,
} from "../src/wecom.js";

const host = ["qyapi", "weixin", "qq", "com"].join(".");
const webhookUrl = `https://${host}/cgi-bin/webhook/send?key=test-only-key`;

function successSummary(): NotificationSummary {
  return {
    runId: "run-1",
    runDate: "2026-08-07",
    startedAt: "2026-08-07T08:00:00+08:00",
    completedAt: "2026-08-07T08:02:00+08:00",
    status: "success",
    sites: [
      {
        site: "UAE",
        status: "success",
        stores: [{
          storeIndex: 1,
          status: "success",
          attempts: 1,
          fileName: "UAE1.20260807.csv",
          snapshotAt: "2026-08-07T00:01:00Z",
          rowCount: 100,
          saleableSkuCount: 20,
          saleableQty: 35,
        }],
      },
      { site: "KSA", status: "success", stores: [] },
    ],
  };
}

describe("sendWeComNotification", () => {
  it("sends only the date and backup confirmation for a successful run", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      return new Response('{"errcode":0,"errmsg":"ok"}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await sendWeComNotification(successSummary(), webhookUrl, fakeFetch);

    expect(capturedUrl).toBe(webhookUrl);
    const payload = JSON.parse(capturedBody) as { msgtype: string; markdown: { content: string } };
    expect(payload.msgtype).toBe("markdown");
    expect(payload.markdown.content).toBe("2026-08-07 已成功备份");
    expect(payload.markdown.content).not.toContain("UAE");
    expect(payload.markdown.content).not.toContain("KSA");
    expect(payload.markdown.content).not.toContain("UAE1.20260807.csv");
    expect(capturedBody).not.toContain("test-only-key");
  });

  it("includes failure stage and attempts but redacts error secrets", async () => {
    const summary = successSummary();
    summary.status = "failure";
    summary.sites[0] = {
      site: "UAE",
      status: "failed",
      stores: [{
        storeIndex: 4,
        status: "failed",
        attempts: 3,
        error: { stage: "download", kind: "http", message: "Cookie: session=secret" },
      }],
    };
    let body = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      body = String(init?.body);
      return new Response('{"errcode":0}', { status: 200 });
    };

    await sendWeComNotification(summary, webhookUrl, fakeFetch);

    expect(body).toContain("download");
    expect(body).toContain("尝试 3 次");
    expect(body).not.toContain("session=secret");
  });

  it("includes a site-level publish failure", async () => {
    const summary = successSummary();
    summary.status = "failure";
    summary.sites[0] = {
      site: "UAE",
      status: "failed",
      stores: [],
      error: { stage: "publish", kind: "filesystem", message: "disk full" },
    };
    let body = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      body = String(init?.body);
      return new Response('{"errcode":0}', { status: 200 });
    };

    await sendWeComNotification(summary, webhookUrl, fakeFetch);

    expect(body).toContain("publish/filesystem");
    expect(body).toContain("disk full");
  });

  it.each([undefined, "http://example.com/hook", "https://example.com/hook"])(
    "rejects missing or invalid webhook %s before fetching",
    async (url) => {
      const originalWebhook = process.env.WECOM_WEBHOOK_URL;
      if (url === undefined) delete process.env.WECOM_WEBHOOK_URL;
      let called = false;
      const fakeFetch: typeof fetch = async () => { called = true; return new Response(); };
      try {
        await expect(sendWeComNotification(successSummary(), url, fakeFetch)).rejects.toBeInstanceOf(NotificationError);
        expect(called).toBe(false);
      } finally {
        if (originalWebhook === undefined) delete process.env.WECOM_WEBHOOK_URL;
        else process.env.WECOM_WEBHOOK_URL = originalWebhook;
      }
    },
  );

  it("rejects WeCom API errors without exposing the webhook", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('{"errcode":93000,"errmsg":"invalid webhook"}', { status: 200 });
    const error = await sendWeComNotification(successSummary(), webhookUrl, fakeFetch)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(NotificationError);
    expect((error as Error).message).toContain("93000");
    expect((error as Error).message).not.toContain("test-only-key");
  });
});
