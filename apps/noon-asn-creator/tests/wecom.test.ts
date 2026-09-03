import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FolderRunResult } from "../src/runner.js";
import { formatWeComAppointmentMessage, formatWeComFileMessage, formatWeComSummary, loadWeComWebhookUrl, validateWeComWebhookUrl, WeComNotifier } from "../src/wecom.js";

const webhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-only";

describe("WeCom ASN notifications", () => {
  it("validates only the enterprise WeChat robot endpoint", () => {
    expect(validateWeComWebhookUrl(webhook).hostname).toBe("qyapi.weixin.qq.com");
    expect(() => validateWeComWebhookUrl("https://example.com/hook")).toThrow(/无效/);
  });

  it("loads the webhook from the external credential directory", async () => {
    const folder = await mkdtemp(join(tmpdir(), "noon-wecom-"));
    await writeFile(join(folder, "noon-asn-wecom-webhook.txt"), `${webhook}\n`, "utf8");
    await expect(loadWeComWebhookUrl(folder, undefined)).resolves.toBe(webhook);
  });

  it("formats failure messages but suppresses unscheduled success and skipped files", () => {
    expect(formatWeComFileMessage({ filePath: "a", fileName: "a.xlsx", status: "written", asnNumber: "ASN-1" }, "KSA"))
      .toBeUndefined();
    expect(formatWeComFileMessage({ filePath: "b", fileName: "b.xlsx", status: "failed", error: { kind: "network", stage: "seal", message: "超时" } }, "UAE"))
      .toContain("已约仓成功的文件不会重复约仓");
    expect(formatWeComFileMessage({ filePath: "c", fileName: "c.xlsx", status: "skipped_existing" }, "UAE")).toBeUndefined();
  });

  it("formats an appointment message without a product name", () => {
    expect(formatWeComAppointmentMessage({
      asnNumber: "A05928922PN",
      storeLabel: "店铺5",
      totalQuantity: 5,
      scheduleDate: "2026-08-18",
      scheduleSlot: "10:00-12:00",
    }, "UAE")).toBe("UAE\n5 店铺5已约仓完毕，ASN：A05928922PN，送仓时间：2026-08-18 10:00-12:00");
  });

  it("formats a final batch summary", () => {
    const result: FolderRunResult = { folderPath: "D:\\input", files: [{ filePath: "a", fileName: "a.xlsx", status: "written", asnNumber: "ASN-1" }] };
    expect(formatWeComSummary(result, "UAE")).toContain("UAE\n本次ASN已全部创建并锁定");
    expect(formatWeComSummary({ folderPath: "x", files: [{ filePath: "a", fileName: "a", status: "skipped_existing" }] }, "UAE")).toBeUndefined();
  });

  it("sends the exact text payload and handles robot errors", async () => {
    let payload: unknown;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({ errcode: 0, errmsg: "ok" });
    });
    const notifier = new WeComNotifier(webhook, "UAE", fetchMock);
    await notifier.send("测试通知");
    expect(payload).toEqual({ msgtype: "text", text: { content: "测试通知" } });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain("key=test-only");

    const failed = new WeComNotifier(webhook, "UAE", async () => Response.json({ errcode: 93000 }));
    await expect(failed.send("测试")).rejects.toThrow("93000");
  });
});
