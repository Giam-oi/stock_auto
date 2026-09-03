import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { injectNoonCookies } from "../dist/src/browser/cookies.js";
import { locateChrome } from "../dist/src/browser/chrome.js";
import { ContractCapture } from "../dist/src/browser/capture.js";
import { storeConfig } from "../dist/src/contracts.js";
import { loadCredential, loginNoon } from "../dist/src/noon/auth.js";
import { isSkippedWorkbook, readAsnJob } from "../dist/src/workbook.js";

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

const filePath = arg("--file");
const credentialDirectory = process.env.NOON_CREDENTIAL_DIR ?? "D:\\noon-api";
const job = await readAsnJob(filePath);
if (isSkippedWorkbook(job)) throw new Error("Acceptance workbook already contains an ASN");
const store = storeConfig(job.storeIndex);
const credential = await loadCredential(join(credentialDirectory, store.credentialFile), store);
const session = await loginNoon(credential);
const profile = await mkdtemp(join(tmpdir(), "NoonASNCreatorInspect-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: await locateChrome(),
  headless: false,
  viewport: { width: 1440, height: 960 },
});
try {
  await injectNoonCookies(context, session.cookieHeader);
  const page = context.pages()[0] ?? await context.newPage();
  const exchanges = [];
  const structures = [];
  const pendingStructures = [];
  let latestEligibleRows;
  const asnCandidates = new Set();
  const collectAsnCandidates = (value) => {
    if (Array.isArray(value)) { value.forEach(collectAsnCandidates); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (/asn/i.test(key) && typeof item === "string" && item.trim()) asnCandidates.add(item.trim());
      collectAsnCandidates(item);
    }
  };
  const structure = (value, depth = 0) => {
    if (depth > 6) return "...";
    if (Array.isArray(value)) return value.length === 0 ? [] : [structure(value[0], depth + 1)];
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, structure(item, depth + 1)]));
    return value === null ? "null" : typeof value;
  };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname.endsWith("noon.partners")) {
      exchanges.push({ method: response.request().method(), status: response.status(), origin: url.origin, path: url.pathname });
      if (url.pathname.includes("/asn/")) {
        const task = (async () => {
          let requestBody;
          let responseBody;
          try { requestBody = response.request().postDataJSON(); } catch { requestBody = undefined; }
          try { responseBody = await response.json(); } catch { responseBody = undefined; }
          if (url.pathname.endsWith("/asn/list_eligible_lines") && Array.isArray(responseBody?.rows)) {
            latestEligibleRows = responseBody.rows;
          }
          collectAsnCandidates(responseBody);
          structures.push({
            method: response.request().method(),
            status: response.status(),
            path: url.pathname,
            headerNames: Object.keys(await response.request().allHeaders()).sort(),
            request: structure(requestBody),
            requestMeta: url.pathname.endsWith("/asn/partner_asn_details") ? {
              idPartnerSource: requestBody?.idPartnerSource,
              hasAsnNr: typeof requestBody?.asnNr === "string" && requestBody.asnNr.length > 0,
              pagination: requestBody?.pagination,
              filters: requestBody?.filters,
              orderBy: requestBody?.orderBy,
            } : undefined,
            response: structure(responseBody),
            containsRequestedSku: (JSON.stringify(responseBody) ?? "").includes(job.items[0].partnerSku),
          });
        })();
        pendingStructures.push(task);
      }
    }
  });
  await page.goto(`https://fbn.noon.partners/en-ae/asn/createasn?project=${job.projectCode}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForTimeout(12_000);
    if (await page.getByText("Choose from Your Catalog", { exact: true }).count() > 0) break;
    if (attempt < 2) await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  }
  const choice = page.getByText("Choose from Your Catalog", { exact: true });
  const choiceElement = await choice.evaluate((node) => {
    const clickable = node.closest("button,[role=button],a,[tabindex],div") ?? node;
    return { tag: clickable.tagName, role: clickable.getAttribute("role"), className: clickable.getAttribute("class") };
  });
  if (process.argv.includes("--list")) {
    await page.goto(`https://fbn.noon.partners/en-ae/asn?project=${job.projectCode}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(15_000);
  }
  if (process.argv.includes("--catalog")) {
    await choice.click();
    await page.waitForTimeout(5_000);
  }
  let rowStructure;
  if (process.argv.includes("--prepare")) {
    const search = page.getByPlaceholder("Search sku, code...", { exact: true });
    await search.fill(job.items[0].partnerSku);
    await page.waitForTimeout(4_000);
    const skuText = page.getByText(job.items[0].partnerSku, { exact: true });
    const row = page.locator("tr").filter({ has: skuText });
    rowStructure = {
      matches: await row.count(),
      exactTextMatches: await skuText.count(),
      bodyContainsSku: (await page.locator("body").innerText()).includes(job.items[0].partnerSku),
      ancestors: await skuText.evaluateAll((nodes) => nodes.map((node) => {
        const parent = node.closest("tr,[role=row],label,div") ?? node.parentElement;
        return { tag: parent?.tagName, role: parent?.getAttribute("role"), className: parent?.getAttribute("class") };
      })),
      inputs: await row.locator("input").evaluateAll((nodes) => nodes.map((node) => ({
        type: node.getAttribute("type"),
        role: node.getAttribute("role"),
        placeholder: node.getAttribute("placeholder"),
      }))),
      buttons: await row.locator("button").allTextContents(),
      soleDataRows: await page.locator("tbody tr").count(),
    };
  }
  if (process.argv.includes("--stage2")) {
    if (!Array.isArray(latestEligibleRows) || latestEligibleRows.length !== 1 || latestEligibleRows[0].partner_sku !== job.items[0].partnerSku) {
      throw new Error("Catalog search did not return one exact partner SKU");
    }
    const dataRow = page.locator("tbody tr");
    if (await dataRow.count() !== 1) throw new Error("Catalog UI did not render exactly one data row");
    await dataRow.getByRole("checkbox").check();
    await dataRow.locator("input:not([type=checkbox])").fill(String(job.items[0].quantity));
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForTimeout(5_000);
  }
  let rawCaptureDirectory;
  if (process.argv.includes("--create")) {
    if (process.env.NOON_ASN_ALLOW_CREATE !== "YES") throw new Error("Set NOON_ASN_ALLOW_CREATE=YES for the authorized live create");
    rawCaptureDirectory = join(process.env.LOCALAPPDATA ?? tmpdir(), "NoonASNCreator", "capture", `live-${Date.now()}`);
    const capture = new ContractCapture(page, rawCaptureDirectory);
    try {
      await capture.during("create", async () => {
        const responsePromise = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.hostname === "fbn.noon.partners" && url.pathname.includes("/asn/") &&
            !url.pathname.endsWith("/asn/list_eligible_lines") && response.request().method() !== "GET";
        }, { timeout: 90_000 });
        await page.getByRole("button", { name: "Agree & Proceed", exact: true }).click();
        await responsePromise;
        await page.waitForTimeout(12_000);
      });
    } finally {
      capture.dispose();
    }
  }
  const screenshot = join(profile, "inspect.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  const inputs = await page.locator("input").evaluateAll((nodes) => nodes.map((node) => ({
    type: node.getAttribute("type"),
    placeholder: node.getAttribute("placeholder"),
    ariaLabel: node.getAttribute("aria-label"),
  })));
  await Promise.all(pendingStructures);
  const report = {
    url: page.url(),
    title: await page.title(),
    headings: await page.locator("h1,h2,h3").allTextContents(),
    buttons: await page.locator("button").allTextContents(),
    inputs,
    links: await page.locator("a").evaluateAll((nodes) => nodes.map((node) => ({ text: (node.textContent ?? "").trim(), href: node.getAttribute("href") })).filter((item) => /ASN/i.test(item.text))),
    choiceElement,
    rowStructure,
    exchanges,
    structures,
    asnCandidates: [...asnCandidates],
    rawCaptureDirectory,
    errors,
    uiText: (await page.locator("body").innerText()).split("\n").filter((line) => /catalog|continue|product|quantity|penalty|agree|proceed|search/i.test(line)).slice(0, 50),
    screenshot,
  };
  const output = process.argv.includes("--compact")
    ? { url: report.url, structures: report.structures, asnCandidates: report.asnCandidates, errors: report.errors }
    : report;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  await context.close();
}
