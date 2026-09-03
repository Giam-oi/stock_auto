import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileRunResult, FolderRunResult } from "./runner.js";

export type NotificationSite = "UAE" | "KSA";

export interface WeComAppointmentNotification {
  asnNumber: string;
  storeLabel: string;
  totalQuantity: number;
  scheduleDate: string;
  scheduleSlot: string;
}

export class WeComNotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeComNotificationError";
  }
}

export function validateWeComWebhookUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new WeComNotificationError("企业微信机器人地址无效"); }
  if (url.protocol !== "https:" || url.hostname !== "qyapi.weixin.qq.com" ||
      url.pathname !== "/cgi-bin/webhook/send" || !url.searchParams.get("key")) {
    throw new WeComNotificationError("企业微信机器人地址无效");
  }
  return url;
}

export async function loadWeComWebhookUrl(
  credentialDirectory: string,
  envValue = process.env.NOON_ASN_WECOM_WEBHOOK_URL,
): Promise<string | undefined> {
  if (envValue?.trim()) return validateWeComWebhookUrl(envValue).href;
  try {
    const text = await readFile(join(credentialDirectory, "noon-asn-wecom-webhook.txt"), "utf8");
    return validateWeComWebhookUrl(text).href;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function formatWeComFileMessage(file: FileRunResult, site: NotificationSite): string | undefined {
  if (file.status === "failed" || file.status === "needs_review" || file.status === "invalid_input") {
    const reason = file.error?.message ?? "未知原因";
    return `${site}\n因特殊原因，${file.fileName}约仓失败，请重新运行程序（之前已约仓成功的文件不会重复约仓）。原因：${reason}`;
  }
  return undefined;
}

export function formatWeComAppointmentMessage(
  appointment: WeComAppointmentNotification,
  site: NotificationSite,
): string {
  return `${site}\n${appointment.totalQuantity} ${appointment.storeLabel}已约仓完毕，ASN：${appointment.asnNumber}，送仓时间：${appointment.scheduleDate} ${appointment.scheduleSlot}`;
}

export function formatWeComSummary(result: FolderRunResult, site: NotificationSite): string | undefined {
  const written = result.files.filter((file) => file.status === "written").length;
  const failed = result.files.filter((file) => file.status === "failed" || file.status === "needs_review" || file.status === "invalid_input").length;
  if (written === 0 && failed === 0) return undefined;
  if (failed === 0) return `${site}\n本次ASN已全部创建并锁定，祝各位老板天天爆单`;
  return `${site}\n本次约仓处理完成：成功 ${written} 个，失败 ${failed} 个。请处理失败文件后重新运行，已成功文件不会重复约仓。`;
}

export class WeComNotifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly site: NotificationSite,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {
    validateWeComWebhookUrl(webhookUrl);
  }

  async send(content: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(validateWeComWebhookUrl(this.webhookUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msgtype: "text", text: { content } }),
        signal: controller.signal,
      });
    } catch {
      throw new WeComNotificationError(controller.signal.aborted ? "企业微信通知超时" : "企业微信通知网络失败");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new WeComNotificationError(`企业微信通知 HTTP ${response.status}`);
    let body: { errcode?: unknown };
    try { body = await response.json() as { errcode?: unknown }; } catch { throw new WeComNotificationError("企业微信通知返回格式无效"); }
    if (body.errcode !== 0) throw new WeComNotificationError(`企业微信通知错误码 ${String(body.errcode)}`);
  }

  async notifyFile(file: FileRunResult): Promise<void> {
    const message = formatWeComFileMessage(file, this.site);
    if (message) await this.send(message);
  }

  async notifyAppointment(appointment: WeComAppointmentNotification): Promise<void> {
    await this.send(formatWeComAppointmentMessage(appointment, this.site));
  }

  async notifySummary(result: FolderRunResult): Promise<void> {
    const message = formatWeComSummary(result, this.site);
    if (message) await this.send(message);
  }
}
