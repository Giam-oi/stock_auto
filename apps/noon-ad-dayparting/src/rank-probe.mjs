import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { dubaiHour, periodForHour } from "./policy.mjs";
import { readJson, writeJsonAtomic } from "./state.mjs";

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function chromePath(config) {
  const candidates = [config.chromePath, process.env.NOON_CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].filter(Boolean);
  for (const path of candidates) if (await exists(path)) return path;
  throw new Error("Google Chrome is unavailable for rank probing");
}

export function summarizeRank(entries, productSku) {
  const target = String(productSku).split("-", 1)[0];
  const products = [];
  const seen = new Set();
  for (const row of entries) {
    if (!row.sku || seen.has(`${row.sku}|${row.sponsored}`)) continue;
    seen.add(`${row.sku}|${row.sponsored}`);
    products.push(row);
  }
  const targetRows = products.map((row, index) => ({ ...row, overallPosition: index + 1 })).filter((row) => row.sku === target);
  const ad = targetRows.find((row) => row.sponsored) ?? null;
  const organic = targetRows.find((row) => !row.sponsored) ?? null;
  return {
    status: ad ? "served" : "not_served", adPosition: ad?.overallPosition ?? null,
    organicPosition: organic?.overallPosition ?? null, productsObserved: products.length,
  };
}

export async function probeRanks(options, services = {}) {
  const now = services.now?.() ?? new Date();
  const config = await readJson(options.rankConfigPath);
  if (!config?.targets?.length) throw new Error("Rank probe configuration is unavailable");
  const capturedAt = now.toISOString();
  const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const period = periodForHour(dubaiHour(now));
  const launchOptions = {
    executablePath: await chromePath(config), headless: true,
    args: ["--disable-gpu", "--disable-http2", "--no-first-run", "--disable-background-networking", "--disable-blink-features=AutomationControlled"],
  };
  const browser = services.launchBrowser
    ? await services.launchBrowser(launchOptions) : await chromium.launch(launchOptions);
  const probes = [], warnings = [];
  try {
    const context = await browser.newContext({
      locale: "en-AE", timezoneId: "Asia/Dubai", viewport: { width: 1440, height: 1100 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    });
    for (const target of config.targets) {
      const page = await context.newPage();
      try {
        const url = `https://www.noon.com/uae-en/search?q=${encodeURIComponent(target.keyword)}`;
        let navigationError;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }); navigationError = null; break; }
          catch (error) { navigationError = error; if (attempt < 2) await page.waitForTimeout(2_000); }
        }
        if (navigationError) throw navigationError;
        await page.waitForSelector('a[href*="/p/?o="]', { timeout: 30_000 });
        await page.waitForTimeout(3_000);
        const entries = await page.locator('a[href*="/p/?o="]').evaluateAll((elements) => elements.map((element) => {
          const href = element.getAttribute("href") ?? "";
          const match = href.match(/\/([A-Z0-9]+)\/p\//);
          return { sku: match?.[1] ?? null, sponsored: /\bsponsored\b/i.test(element.textContent ?? "") };
        }));
        probes.push({ ...target, url, ...summarizeRank(entries, target.productSku) });
      } catch (error) {
        warnings.push({ keyword: target.keyword, message: error.message });
        probes.push({ ...target, status: "unavailable", adPosition: null, organicPosition: null });
      } finally { await page.close(); }
    }
    await context.close();
  } finally { await browser.close(); }
  const hasObservation = probes.some((row) => row.status !== "unavailable");
  const errors = hasObservation ? [] : [{ stage: "probe_all_unavailable", message: "No keyword rank observation was available" }];
  const result = { version: 1, mode: "probe", site: "UAE", capturedAt, reportDate, period, observationOnly: config.observationOnly !== false, successful: errors.length === 0, probes, warnings, errors };
  const dayRoot = join(options.rankRoot, reportDate);
  await mkdir(dayRoot, { recursive: true });
  await writeJsonAtomic(join(dayRoot, `${capturedAt.replaceAll(":", "-").replaceAll(".", "-")}.json`), result);
  await writeJsonAtomic(options.resultPath, result);
  return result;
}
