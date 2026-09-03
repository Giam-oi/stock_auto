import type { SiteCode } from "./contracts.js";
import { redactSecrets } from "./redaction.js";

export interface NotificationStoreSummary {
  storeIndex: number;
  status: "success" | "failed";
  attempts: number;
  fileName?: string;
  snapshotAt?: string;
  rowCount?: number;
  saleableSkuCount?: number;
  saleableQty?: number;
  error?: { stage: string; kind: string; message: string };
}

export interface NotificationSiteSummary {
  site: SiteCode;
  status: "success" | "failed";
  stores: NotificationStoreSummary[];
  error?: { stage: string; kind: string; message: string };
}

export interface NotificationSummary {
  runId: string;
  runDate: string;
  startedAt: string;
  completedAt: string;
  status: "success" | "failure";
  sites: NotificationSiteSummary[];
}

export class NotificationError extends Error {
  readonly kind = "notification";
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "NotificationError";
  }
}

export function validateWeComWebhookUrl(urlText: string | undefined): URL {
  if (!urlText) {
    throw new NotificationError("WECOM_WEBHOOK_URL is not configured");
  }
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new NotificationError("WECOM_WEBHOOK_URL is invalid");
  }
  const expectedHost = ["qyapi", "weixin", "qq", "com"].join(".");
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHost ||
    url.pathname !== "/cgi-bin/webhook/send" ||
    !url.searchParams.get("key")
  ) {
    throw new NotificationError("WECOM_WEBHOOK_URL is invalid");
  }
  return url;
}

function safeMessage(message: string): string {
  return String(redactSecrets(message));
}

function markdown(summary: NotificationSummary): string {
  if (summary.status === "success") {
    return `${summary.runDate} 已成功备份`;
  }

  const lines = [
    "### Noon 实时库存采集失败",
    `> 日期：${summary.runDate}`,
    `> 运行：${summary.startedAt} — ${summary.completedAt}`,
  ];
  for (const site of summary.sites) {
    lines.push(`**${site.site}：${site.status === "success" ? "成功" : "失败"}**`);
    if (site.error) {
      lines.push(`- 站点错误｜${site.error.stage}/${site.error.kind}｜${safeMessage(site.error.message)}`);
    }
    for (const store of site.stores) {
      if (store.status === "success") {
        lines.push(
          `- 店铺${store.storeIndex}｜${store.fileName ?? ""}｜快照 ${store.snapshotAt ?? ""}｜` +
          `行 ${store.rowCount ?? 0}｜可售SKU ${store.saleableSkuCount ?? 0}｜可售数量 ${store.saleableQty ?? 0}`,
        );
      } else {
        lines.push(
          `- 店铺${store.storeIndex}｜${store.error?.stage ?? "unknown"}/${store.error?.kind ?? "unknown"}｜` +
          `尝试 ${store.attempts} 次｜${safeMessage(store.error?.message ?? "unknown error")}`,
        );
      }
    }
  }
  return lines.join("\n");
}

export async function sendWeComNotification(
  summary: NotificationSummary,
  webhookUrl: string | undefined = process.env.WECOM_WEBHOOK_URL,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<void> {
  const url = validateWeComWebhookUrl(webhookUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content: markdown(summary) } }),
      signal: controller.signal,
    });
  } catch {
    throw new NotificationError(
      controller.signal.aborted ? "WeCom notification timed out" : "WeCom notification network failure",
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new NotificationError(`WeCom notification failed with HTTP ${response.status}`);
  }
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
