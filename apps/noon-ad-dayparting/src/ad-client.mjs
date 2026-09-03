const ROOT = "https://admanager.noon.partners";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, options, label, fetchImpl, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      const text = await response.text();
      if (response.ok) {
        if (!text) return null;
        try { return JSON.parse(text); } catch { return text; }
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
        throw new Error(`${label} HTTP ${response.status}: ${text.slice(0, 180)}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    } finally { clearTimeout(timer); }
    await sleep(attempt * 1_500);
  }
  throw lastError ?? new Error(`${label} failed`);
}

function itemsFrom(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
    if (Array.isArray(value?.data?.[key])) return value.data[key];
  }
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

export async function createAdClient({ store, cookie, fetchImpl = fetch }) {
  const base = {
    "User-Agent": "NoonAdDayparting/1.0", "Content-Type": "application/json", Cookie: cookie,
    "x-content": "desktop", "x-locale": "en-ae", "x-cms": "v3", "x-platform": "web",
    "X-Project": store.projectCode, "x-mp": "noon", "x-border-enabled": "true",
    "x-seller-view": "true", "x-id-advertiser": store.partnerId,
  };
  const status = await request(`${ROOT}/_svc/productads/onboarding/advertiser_status`, { headers: base }, "advertiser_status", fetchImpl);
  const advertiserCode = status?.advertiserOverdraft?.advertiserCode;
  if (!advertiserCode) throw new Error(`Advertising account unavailable for ${store.partnerId}`);
  const headers = { ...base, "x-advertiser-code": advertiserCode, "x-advertiser-codes": advertiserCode };

  async function campaignMetrics(fromDate, toDate) {
    const rows = [];
    for (let pageNo = 0, pages = 1; pageNo < pages; pageNo += 1) {
      const body = {
        startDate: fromDate, endDate: toDate, pageNo, pageSize: 100,
        filters: { campaignCode: [], campaignType: ["product"], budgetCode: [], orderCode: [], walletCode: [], status: ["live"], search: "" },
      };
      const page = await request(`${ROOT}/_svc/productads/v2/noon/metrics/campaigns`, {
        method: "POST", headers, body: JSON.stringify(body),
      }, `campaign metrics ${pageNo}`, fetchImpl);
      const campaigns = itemsFrom(page, ["campaigns"]);
      const metrics = page?.campaignMetrics ?? page?.data?.campaignMetrics ?? {};
      rows.push(...campaigns.map((campaign) => ({ campaign, metrics: metrics[campaign.campaignCode] ?? campaign.metrics ?? {} })));
      pages = Math.max(1, Number(page?.paginationMetadata?.nbPages ?? page?.data?.paginationMetadata?.nbPages ?? 1));
    }
    return rows;
  }
  const details = (code) => request(`${ROOT}/_svc/productads/campaign/details?campaign_code=${encodeURIComponent(code)}`, { headers }, `${code} details`, fetchImpl);
  const adgroups = async (code) => itemsFrom(await request(
    `${ROOT}/_svc/productads/adgroup/list?campaign_code=${encodeURIComponent(code)}`, { headers }, `${code} adgroups`, fetchImpl,
  ), ["adgroups", "targets"]);
  const targets = async (code) => itemsFrom(await request(
    `${ROOT}/_svc/productads/adgroup-target/list?adgroup_code=${encodeURIComponent(code)}`, { headers }, `${code} targets`, fetchImpl,
  ), ["targets", "adgroupTargets"]);
  const updateTargets = (payload) => request(`${ROOT}/_svc/productads/adgroup-target/update`, {
    method: "POST", headers, body: JSON.stringify(payload),
  }, "target update", fetchImpl);
  const stashTargets = (payload) => request(`${ROOT}/_svc/productads/adgroup-target/stash`, {
    method: "POST", headers, body: JSON.stringify(payload),
  }, "target stash", fetchImpl);
  const downloadReport = async (fromDate, toDate) => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await fetchImpl(`${ROOT}/_svc/productads/v2/noon/reports`, {
          method: "POST", signal: controller.signal,
          headers: { ...headers, Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream" },
          body: JSON.stringify({ startDate: fromDate, endDate: toDate }),
        });
        if (!response.ok) throw new Error(`Advertising export HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length < 4_000 || buffer.subarray(0, 4).toString("hex") !== "504b0304") {
          throw new Error("Advertising export returned an invalid XLSX");
        }
        return buffer;
      } catch (error) {
        lastError = error;
        if (attempt === 3) throw error;
        await sleep(attempt * 2_000);
      } finally { clearTimeout(timer); }
    }
    throw lastError ?? new Error("Advertising export failed");
  };
  return { campaignMetrics, details, adgroups, targets, updateTargets, stashTargets, downloadReport };
}

export function targetPayload(campaignCode, target, bid, isActive = target.isActive) {
  return {
    campaignCode, adgroupCode: target.adgroupCode, bid, isNewKeyword: false,
    idAdgroupTarget: target.idAdgroupTarget, isActive, isbidUpdate: true,
    strategy: target.strategy, targetValue: target.targetValue, targetingType: target.targetingType,
    config: target.config ?? undefined,
  };
}
