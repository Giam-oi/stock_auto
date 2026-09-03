import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ExcelJS from "exceljs";
import { createAdClient } from "./ad-client.mjs";
import { loadCredential, loginNoon } from "./auth.mjs";
import { STORES, isoDateInZone } from "./contracts.mjs";
import { loadSaleableInventory } from "./inventory.mjs";

const PILOT = {
  store: "42958",
  campaignCode: "C_YNLBNZN399",
  campaignName: "260826 M01血糖仪 manual NW26051508HB1",
  sku: "ZF7C5D97488A3FB339451Z-1",
  dailyBudget: 5,
};

const numeric = (value) => value == null || value === "" ? null : Number(value);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(path, { force: true });
  await rename(temporary, path);
}

function campaignFrom(details) {
  return details?.campaign ?? details?.data?.campaign ?? {};
}

function keywordTargets(details) {
  const targeting = details?.targeting ?? details?.data?.targeting ?? [];
  return targeting.flatMap((group) => (group.targetedKeywords ?? []).map((target) => ({
    ...target,
    adgroupCode: target.adgroupCode ?? group.metadata?.adgroupCode,
  })));
}

function selectedProducts(details) {
  return details?.selectedProducts?.products ?? details?.data?.selectedProducts?.products ?? [];
}

function worksheetRows(sheet) {
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value ?? ""));
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    rows.push(Object.fromEntries(headers.map((header, index) => [header, row.getCell(index + 1).value ?? null])));
  });
  return rows;
}

export async function targetMetricsFromReport(buffer, campaignName) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("(Product) Target");
  if (!sheet) throw new Error("Advertising report is missing (Product) Target");
  return worksheetRows(sheet)
    .filter((row) => row["Campaign Name"] === campaignName)
    .map((row) => ({
      keyword: String(row["Target Value"] ?? ""),
      matchType: String(row.Strategy ?? "").toLowerCase(),
      views: numeric(row.Views),
      clicks: numeric(row.Clicks),
      spends: numeric(row.Spends),
      cpc: numeric(row.CPC),
      orders: numeric(row.Orders),
      revenue: numeric(row.Revenue),
      roas: numeric(row.ROAS),
      cvr: numeric(row.CVR),
      soi: numeric(row.SOI),
    }));
}

async function defaultSession(store, options) {
  const credential = await loadCredential(join(options.credentialDir, store.credentialFile), store);
  const cookie = await loginNoon(credential);
  return createAdClient({ store, cookie });
}

export async function collectManualPilot(options, services = {}) {
  const now = services.now?.() ?? new Date();
  const reportDate = isoDateInZone(now);
  const compactDate = reportDate.replaceAll("-", "");
  const store = STORES.find((row) => row.partnerId === PILOT.store);
  const runRoot = join(options.pilotRoot, compactDate);
  const reportPath = join(runRoot, `${PILOT.store}.xlsx`);
  const livePath = join(runRoot, "live.json");
  const snapshotPath = join(options.pilotRoot, "snapshots", `${compactDate}.json`);
  await mkdir(runRoot, { recursive: true });

  try {
    const client = services.session ? await services.session(store, options) : await defaultSession(store, options);
    const [campaignRows, details, report] = await Promise.all([
      client.campaignMetrics(reportDate, reportDate),
      client.details(PILOT.campaignCode),
      client.downloadReport(reportDate, reportDate),
    ]);
    const campaignRow = campaignRows.find((row) => row.campaign?.campaignCode === PILOT.campaignCode);
    const campaign = campaignFrom(details);
    const liveTargets = keywordTargets(details);
    const products = selectedProducts(details);
    const rankConfig = await readJson(options.rankConfigPath);
    const configured = rankConfig.targets.filter((row) => row.store === PILOT.store
      && row.campaignCode === PILOT.campaignCode);
    const reportMetrics = await targetMetricsFromReport(report, PILOT.campaignName);
    const inventory = await loadSaleableInventory(options.inventoryRoot, reportDate, store);
    const saleableQty = Number(inventory.quantities.get(PILOT.sku) ?? 0);

    const keywordMetrics = configured.map((expected) => {
      const live = liveTargets.find((row) => Number(row.idAdgroupTarget) === Number(expected.targetId)
        && row.targetValue === expected.keyword && String(row.strategy).toLowerCase() === "exact");
      const metric = reportMetrics.find((row) => row.keyword === expected.keyword && row.matchType === "exact");
      return {
        keyword: expected.keyword,
        targetId: expected.targetId,
        matchType: "exact",
        isActive: live?.isActive === true,
        currentBid: numeric(live?.bid),
        expectedBid: numeric(expected.currentBid),
        views: metric?.views ?? null,
        clicks: metric?.clicks ?? null,
        spends: metric?.spends ?? null,
        cpc: metric?.cpc ?? null,
        orders: metric?.orders ?? null,
        revenue: metric?.revenue ?? null,
        roas: metric?.roas ?? null,
        cvr: metric?.cvr ?? null,
        soi: metric?.soi ?? null,
        reportRowFound: Boolean(metric),
      };
    });
    const effectiveBudget = numeric(campaign.effectiveDailyLimit ?? campaign.dailyBudget);
    const selected = products.find((row) => row.productSku === PILOT.sku);
    const checks = {
      campaignLive: campaign.status === "live" && campaign.isActive !== false,
      campaignName: campaign.name === PILOT.campaignName,
      dailyBudget: effectiveBudget === PILOT.dailyBudget,
      fixedStrategy: String(campaign.biddingStrategy).toLowerCase() === "fixed",
      skuPresentAndActive: selected?.isActive === true,
      fourExactTargets: keywordMetrics.length === 4 && keywordMetrics.every((row) => row.isActive),
      bidsMatch: keywordMetrics.every((row) => row.currentBid === row.expectedBid),
      saleableInventoryPositive: saleableQty > 0,
      allReportRowsFound: keywordMetrics.every((row) => row.reportRowFound),
      soiAvailable: keywordMetrics.some((row) => row.soi != null),
    };
    const highSpendZeroOrder = keywordMetrics.filter((row) => Number(row.spends ?? 0) >= 20 && Number(row.orders ?? 0) === 0);
    const critical = checks.campaignLive && checks.campaignName && checks.dailyBudget && checks.fixedStrategy
      && checks.skuPresentAndActive && checks.fourExactTargets && checks.bidsMatch && checks.saleableInventoryPositive;
    const observationOnly = reportDate < "2026-09-02";
    const snapshot = {
      ok: critical && highSpendZeroOrder.length === 0,
      collectedAt: now.toISOString(),
      runDate: reportDate,
      period: { fromDate: reportDate, toDate: reportDate },
      site: "UAE",
      store: PILOT.store,
      campaign: {
        campaignCode: PILOT.campaignCode,
        campaignName: campaign.name,
        status: campaign.status,
        dailyBudget: effectiveBudget,
        biddingStrategy: campaign.biddingStrategy,
        isManual: campaign.isManual,
      },
      sku: {
        productSku: PILOT.sku,
        active: selected?.isActive === true,
        fbn: selected?.flags?.includes("fbn") ?? null,
        saleableQty,
        inventorySnapshotAt: inventory.snapshotAt,
        source: inventory.path,
      },
      keywordMetrics,
      campaignMetrics: campaignRow?.metrics ?? null,
      checks,
      decision: {
        observationOnly,
        action: critical && highSpendZeroOrder.length === 0 ? "no_change" : "requires_review",
        reason: [
          observationOnly ? "2026-09-02前观察期" : "已进入逐词评估期",
          highSpendZeroOrder.length ? `${highSpendZeroOrder.length}个词消耗达到AED20且0单` : "未触发AED20且0单止损线",
          checks.allReportRowsFound ? "4个词均有报表行" : "无曝光词可能不生成Target报表行，保留null",
          checks.soiAvailable ? "报表包含SOI" : "Noon报表未提供SOI列",
        ],
        liveChanges: [],
      },
      sources: { report: reportPath, liveApi: livePath },
    };
    await writeFile(reportPath, report);
    await writeJsonAtomic(livePath, { collectedAt: now.toISOString(), campaignMetric: campaignRow ?? null, details });
    await writeJsonAtomic(snapshotPath, snapshot);
    await writeJsonAtomic(options.pilotResultPath, snapshot);
    return { ...snapshot, successful: snapshot.ok, snapshotPath };
  } catch (error) {
    const result = { ok: false, successful: false, collectedAt: now.toISOString(), runDate: reportDate, error: error.message };
    await writeJsonAtomic(options.pilotResultPath, result);
    return result;
  }
}
