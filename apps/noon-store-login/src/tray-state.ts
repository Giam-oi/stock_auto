export interface SessionLogRecord {
  store: number;
  projectCode: string;
  valid: boolean;
  finalUrl: string;
  title: string;
  checkedAt: string;
  reason?: string;
}

export interface TrayStateSummary {
  severity: "healthy" | "warning" | "logout";
  lines: string[];
}

function isLogout(record: SessionLogRecord): boolean {
  let host = "";
  try { host = new URL(record.finalUrl).hostname; } catch { /* Inconclusive URL. */ }
  return !record.valid && (host === "login.noon.partners" || /Partners Login/i.test(record.title));
}

function beijingTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

export function summarizeTrayState(records: readonly SessionLogRecord[]): TrayStateSummary {
  const byStore = new Map(records.map((record) => [record.store, record]));
  let severity: TrayStateSummary["severity"] = "healthy";
  const lines: string[] = [];
  for (let store = 1; store <= 6; store += 1) {
    const record = byStore.get(store);
    if (!record) {
      severity = severity === "logout" ? severity : "warning";
      lines.push(`店铺${store}：尚无结果`);
      continue;
    }
    const time = beijingTime(record.checkedAt);
    if (isLogout(record)) {
      severity = "logout";
      lines.push(`店铺${store}：需要登录（${time}）`);
    } else if (!record.valid) {
      if (severity !== "logout") severity = "warning";
      lines.push(`店铺${store}：暂时不可用（${time}）`);
    } else {
      lines.push(`店铺${store}：正常（${time}）`);
    }
  }
  return { severity, lines };
}
