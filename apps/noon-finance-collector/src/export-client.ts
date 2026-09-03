import { STATEMENT_HEADERS, TRANSACTION_HEADERS, serializeCsv } from "./csv.js";
import type { SiteConfig } from "./contracts.js";

type ExportOrigin = "https://finance.noon.partners" | "https://noon-payments.noon.partners";

export interface ExportRequest {
  origin: ExportOrigin;
  category: string;
  params: Record<string, unknown>;
  projectCode: string;
  cookieHeader: string;
  emptyHeaders: readonly string[];
  pollIntervalMs?: number;
  timeoutMs?: number;
}

interface ExportRecord {
  status_code?: string;
  download_url?: string;
  result?: string;
  logs?: Array<{ event_code?: string; event_data?: string }>;
}

export interface ExportDownload {
  csvText: string;
  exportCode: string;
  reportedRows: number | null;
}

async function postJson(
  input: ExportRequest,
  route: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${input.origin}/_svc/mp-partner-impex-api${route}`, {
    method: "POST",
    headers: {
      "User-Agent": "NoonFinanceCollector/1.0",
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: input.cookieHeader,
      "X-Platform": "web",
      "X-Project": input.projectCode,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { throw new Error(`Finance API ${route} returned non-JSON (HTTP ${response.status})`); }
  if (!response.ok) throw new Error(`Finance API ${route} failed with HTTP ${response.status}`);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`Finance API ${route} returned an invalid response`);
  }
  return payload as Record<string, unknown>;
}

function nestedExport(payload: Record<string, unknown>): unknown {
  const data = payload.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) return (data as Record<string, unknown>).export;
  return payload.export;
}

function totalRows(record: ExportRecord): number | null {
  if (!record.result) return null;
  try {
    const result = JSON.parse(record.result) as { total_rows?: unknown };
    return typeof result.total_rows === "number" ? result.total_rows : null;
  } catch { return null; }
}

export async function fetchFinanceExport(
  input: ExportRequest,
  fetchImpl: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<ExportDownload> {
  const created = await postJson(input, "/export/create", {
    exportCategoryCode: input.category,
    params: JSON.stringify(input.params),
    channelCode: "web",
  }, fetchImpl);
  const exportCode = nestedExport(created);
  if (typeof exportCode !== "string" || exportCode === "") throw new Error("Finance export returned no export code");

  const deadline = Date.now() + (input.timeoutMs ?? 20 * 60_000);
  let record: ExportRecord | undefined;
  while (Date.now() < deadline) {
    const status = await postJson(input, "/export/status", { exportCode }, fetchImpl);
    const value = nestedExport(status);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Finance export ${exportCode} returned invalid status`);
    }
    record = value as ExportRecord;
    if (record.status_code === "COMPLETE") break;
    if (record.status_code === "ERROR") {
      const message = record.logs?.find((entry) => entry.event_code === "ERROR")?.event_data ?? "unknown error";
      throw new Error(`Finance export ${exportCode} failed: ${message}`);
    }
    await wait(input.pollIntervalMs ?? 15_000);
  }
  if (record?.status_code !== "COMPLETE") throw new Error(`Finance export ${exportCode} timed out`);
  const reportedRows = totalRows(record);
  if (reportedRows === 0 && !record.download_url) {
    return { csvText: serializeCsv([Array.from(input.emptyHeaders)]), exportCode, reportedRows };
  }
  if (!record.download_url) throw new Error(`Finance export ${exportCode} returned no download URL`);
  const download = await fetchImpl(record.download_url);
  if (!download.ok) throw new Error(`Finance export ${exportCode} download failed with HTTP ${download.status}`);
  const csvText = await download.text();
  if (csvText.trim() === "") throw new Error(`Finance export ${exportCode} download was empty`);
  return { csvText, exportCode, reportedRows };
}

export function statementExportRequest(
  projectCode: string, cookieHeader: string, site: SiteConfig, fromDate: string, toDate: string,
): ExportRequest {
  return {
    origin: "https://finance.noon.partners",
    category: "noon_financeweb_statements",
    params: {
      from_date: fromDate, to_date: toDate, project_code: projectCode, currency: site.currency,
    },
    projectCode, cookieHeader, emptyHeaders: STATEMENT_HEADERS,
  };
}

export function transactionExportRequest(
  projectCode: string, cookieHeader: string, fromDate: string, toDate: string,
): ExportRequest {
  return {
    origin: "https://noon-payments.noon.partners",
    category: "noon_financeweb_transactionviewreportonitemlevelwithcontractselection",
    params: { from_date: fromDate, to_date: toDate, project_code: projectCode, currency: "", reference_nr: "" },
    projectCode, cookieHeader, emptyHeaders: TRANSACTION_HEADERS,
  };
}
