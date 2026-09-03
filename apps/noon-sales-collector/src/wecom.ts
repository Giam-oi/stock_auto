import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { redactSecrets } from "./redaction.js";

export interface SalesNotification {
  fromDate: string;
  toDate: string;
  status: "success" | "failure";
  startedAt: string;
  completedAt: string;
  error?: string;
}

export class NotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationError";
  }
}

export function validateWeComWebhookUrl(urlText: string | undefined): URL {
  if (!urlText) throw new NotificationError("WECOM_WEBHOOK_URL is not configured");
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new NotificationError("WECOM_WEBHOOK_URL is invalid");
  }
  const expectedHost = ["qyapi", "weixin", "qq", "com"].join(".");
  if (
    url.protocol !== "https:" || url.hostname !== expectedHost ||
    url.pathname !== "/cgi-bin/webhook/send" || !url.searchParams.get("key")
  ) {
    throw new NotificationError("WECOM_WEBHOOK_URL is invalid");
  }
  return url;
}

function rangeText(notification: SalesNotification): string {
  return notification.fromDate === notification.toDate
    ? notification.fromDate
    : `${notification.fromDate}至${notification.toDate}`;
}

export function notificationMarkdown(notification: SalesNotification): string {
  const range = rangeText(notification);
  if (notification.status === "success") return `${range} 销售报表已成功备份`;
  return [
    "### Noon 销售报表采集失败",
    `> 日期：${range}`,
    `> 运行：${notification.startedAt} - ${notification.completedAt}`,
    `> 错误：${redactSecrets(notification.error ?? "unknown error")}`,
  ].join("\n");
}

export async function sendWeComNotification(
  notification: SalesNotification,
  webhookUrl: string | undefined = process.env.WECOM_WEBHOOK_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = validateWeComWebhookUrl(webhookUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content: notificationMarkdown(notification) } }),
      signal: controller.signal,
    });
  } catch {
    throw new NotificationError(
      controller.signal.aborted ? "WeCom notification timed out" : "WeCom notification network failure",
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new NotificationError(`WeCom notification failed with HTTP ${response.status}`);
  let result: { errcode?: unknown };
  try {
    result = await response.json() as { errcode?: unknown };
  } catch {
    throw new NotificationError("WeCom notification returned invalid JSON");
  }
  if (result.errcode !== 0) {
    throw new NotificationError(`WeCom notification failed with errcode ${String(result.errcode)}`);
  }
}

interface DeliveryState {
  deliveredSuccess: string[];
}

async function readState(path: string): Promise<DeliveryState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DeliveryState>;
    return { deliveredSuccess: Array.isArray(parsed.deliveredSuccess) ? parsed.deliveredSuccess : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { deliveredSuccess: [] };
    throw error;
  }
}

export async function sendSuccessOnce(
  notification: SalesNotification,
  webhookUrl: string | undefined,
  statePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"delivered" | "skipped"> {
  if (notification.status !== "success") throw new Error("sendSuccessOnce requires a success notification");
  const key = `${notification.fromDate}|${notification.toDate}|success`;
  const state = await readState(statePath);
  if (state.deliveredSuccess.includes(key)) return "skipped";
  await sendWeComNotification(notification, webhookUrl, fetchImpl);
  state.deliveredSuccess.push(key);
  state.deliveredSuccess = state.deliveredSuccess.slice(-120);
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    await rename(temporaryPath, statePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return "delivered";
}
