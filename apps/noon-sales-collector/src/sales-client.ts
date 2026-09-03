import type { SiteConfig, StoreConfig } from "./contracts.js";

const API_ROOT = "https://reports.noon.partners/_vs/mp/mp-inventory-health-api-sales-dashboard";

export type ExportStatus = "Pending" | "Picked" | "Processing" | "Success" | "Failed" | "Cancelled";

export interface ExportAttachment {
  file_name: string;
  url: string;
}

export interface ExportRecord {
  id_exports?: number;
  status?: ExportStatus;
  export_attachment?: ExportAttachment;
}

export interface SalesExportInput {
  store: StoreConfig;
  site: SiteConfig;
  cookieHeader: string;
  fromDate: string;
  toDate: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface SalesDownload {
  csvText: string;
  exportId?: number;
  sourceFileName: string;
}

export type WaitFunction = (milliseconds: number) => Promise<void>;

function requestBody(input: SalesExportInput): Record<string, unknown> {
  return {
    country_code: input.site.countryCode,
    export_config: {
      from_date: input.fromDate,
      to_date: input.toDate,
      search: "",
      filters: {},
    },
  };
}

async function postJson(
  input: SalesExportInput,
  route: string,
  fetchImpl: typeof fetch,
  deadline: number,
): Promise<ExportRecord> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`Sales export timed out for ${input.store.projectCode} ${input.site.code}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(remaining, 60_000));
  try {
    const response = await fetchImpl(`${API_ROOT}${route}`, {
      method: "POST",
      headers: {
        "User-Agent": "NoonSalesCollector/1.0",
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: input.cookieHeader,
        "X-Lang": "en",
        "X-Locale": input.site.locale,
        "X-Platform": "web",
        "X-Project": input.store.projectCode,
        "Country-Code": input.site.countryCode.toLowerCase(),
        "Id-Partner": input.store.partnerId,
      },
      body: JSON.stringify(requestBody(input)),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown;
    if (text.trim() === "" && route === "/export/generate") {
      payload = {};
    } else {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`Sales API returned non-JSON for ${input.store.projectCode}`);
      }
    }
    if (!response.ok) throw new Error(`Sales API ${route} failed with HTTP ${response.status}`);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      if (payload === null && (route === "/export/latest" || route === "/export/generate")) return {};
      if (route === "/export/generate") return {};
      throw new Error(`Sales API ${route} returned an invalid response`);
    }
    return payload as ExportRecord;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSalesExport(
  input: SalesExportInput,
  fetchImpl: typeof fetch = fetch,
  wait: WaitFunction = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<SalesDownload> {
  const deadline = Date.now() + (input.timeoutMs ?? 10 * 60_000);
  const latest = await postJson(input, "/export/latest", fetchImpl, deadline);
  const active = latest.status && ["Pending", "Picked", "Processing"].includes(latest.status);
  const previousSuccessId = !active && latest.status === "Success" ? latest.id_exports : undefined;
  const generated = active ? undefined : await postJson(input, "/export/generate", fetchImpl, deadline);

  let record: ExportRecord = latest;
  while (Date.now() < deadline) {
    record = await postJson(input, "/export/latest", fetchImpl, deadline);
    if (record.status === "Success") {
      const expectedId = generated?.id_exports;
      if (expectedId !== undefined && record.id_exports !== expectedId) {
        await wait(input.pollIntervalMs ?? 10_000);
        continue;
      }
      if (expectedId === undefined && previousSuccessId !== undefined && record.id_exports === previousSuccessId) {
        await wait(input.pollIntervalMs ?? 10_000);
        continue;
      }
      break;
    }
    if (record.status === "Failed" || record.status === "Cancelled") {
      throw new Error(`Sales export ended with status ${record.status} for ${input.store.projectCode}`);
    }
    await wait(input.pollIntervalMs ?? 10_000);
  }
  const attachment = record.export_attachment;
  if (record.status !== "Success" || !attachment?.url || !attachment.file_name) {
    throw new Error(`Sales export timed out for ${input.store.projectCode} ${input.site.code}`);
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`Sales export download timed out for ${input.store.projectCode}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(remaining, 60_000));
  try {
    const response = await fetchImpl(attachment.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Sales CSV download failed with HTTP ${response.status}`);
    const csvText = await response.text();
    if (csvText.trim() === "") throw new Error(`Sales CSV download was empty for ${input.store.projectCode}`);
    return { csvText, exportId: record.id_exports, sourceFileName: attachment.file_name };
  } finally {
    clearTimeout(timeout);
  }
}
