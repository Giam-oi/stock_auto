import type { SiteConfig, StoreConfig } from "./contracts.js";

const INVENTORY_URL =
  "https://fbn.noon.partners/_svc/sc-fbn/api/v5/seller-lab/fbn-inventory";

export interface InventoryRequest {
  store: StoreConfig;
  site: SiteConfig;
  cookieHeader: string;
  timeoutMs?: number;
}

export interface InventoryDownload {
  csvText: string;
  contentType: string;
  requestedAt: Date;
  completedAt: Date;
  httpStatus: number;
}

export class InventoryClientError extends Error {
  constructor(
    readonly kind: string,
    readonly retryable: boolean,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "InventoryClientError";
  }
}

function httpError(status: number): InventoryClientError {
  const retryable = status === 429 || status >= 500;
  return new InventoryClientError(
    "http",
    retryable,
    `Noon inventory export failed with HTTP ${status}`,
    status,
  );
}

export async function fetchRealtimeInventory(
  input: InventoryRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<InventoryDownload> {
  const requestedAt = new Date();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);

  let response: Response;
  try {
    response = await fetchImpl(INVENTORY_URL, {
      method: "POST",
      headers: {
        "User-Agent": "StockAuto/1.0",
        "Content-Type": "application/json",
        Accept: "text/csv",
        Cookie: input.cookieHeader,
        "X-Locale": input.site.locale,
        "X-Platform": "web",
        "X-Project": input.store.projectCode,
        "Country-Code": input.site.countryCode.toLowerCase(),
        "Id-Partner": input.store.partnerId,
      },
      body: JSON.stringify({ inventory_tab_name: "export" }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new InventoryClientError("timeout", true, "Noon inventory export timed out");
    }
    throw new InventoryClientError("network", true, "Noon inventory export network failure");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status !== 200) {
    throw httpError(response.status);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/csv")) {
    throw new InventoryClientError(
      "content-type",
      false,
      `Noon inventory export returned unexpected content type`,
      response.status,
    );
  }

  const csvText = await response.text();
  const completedAt = new Date();
  if (csvText.trim() === "") {
    throw new InventoryClientError("empty", false, "Noon inventory export returned an empty CSV", response.status);
  }
  if (/^[\s\uFEFF]*[\[{]/.test(csvText)) {
    throw new InventoryClientError(
      "unexpected-body",
      false,
      "Noon inventory export returned a non-CSV response body",
      response.status,
    );
  }

  return {
    csvText,
    contentType,
    requestedAt,
    completedAt,
    httpStatus: response.status,
  };
}
