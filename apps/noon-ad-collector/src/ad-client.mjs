const ROOT = "https://admanager.noon.partners";

function commonHeaders(site, store, cookieHeader) {
  return {
    "User-Agent": "NoonAdCollector/1.0",
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    "x-content": "desktop",
    "x-locale": site.locale,
    "x-cms": "v3",
    "x-platform": "web",
    "X-Project": store.projectCode,
    "x-mp": "noon",
    "x-border-enabled": "true",
    "x-seller-view": "true",
    "x-id-advertiser": store.partnerId,
  };
}

async function fetchWithTimeout(url, options, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadCampaignReport(input, fetchImpl = fetch) {
  const headers = commonHeaders(input.site, input.store, input.cookieHeader);
  const metadata = await fetchWithTimeout(
    `${ROOT}/_svc/productads/onboarding/advertiser_status`,
    { headers },
    input.timeoutMs ?? 300_000,
    fetchImpl,
  );
  if (!metadata.ok) throw new Error(`Advertising account lookup failed with HTTP ${metadata.status}`);
  const payload = await metadata.json();
  const advertiserCode = payload?.advertiserOverdraft?.advertiserCode;
  if (typeof advertiserCode !== "string" || advertiserCode.trim() === "") {
    throw new Error(`Advertising account is unavailable for ${input.store.projectCode}`);
  }
  const response = await fetchWithTimeout(
    `${ROOT}/_svc/productads/v2/noon/reports`,
    {
      method: "POST",
      headers: {
        ...headers,
        Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream",
        "x-advertiser-codes": advertiserCode,
        "x-advertiser-code": advertiserCode,
      },
      body: JSON.stringify({ startDate: input.fromDate, endDate: input.toDate }),
    },
    input.timeoutMs ?? 300_000,
    fetchImpl,
  );
  if (!response.ok) throw new Error(`Advertising export failed with HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 4_000 || buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error(`Advertising export returned an invalid XLSX for ${input.store.projectCode}`);
  }
  return buffer;
}
