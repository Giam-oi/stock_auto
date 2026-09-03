import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import type { AsnGateway, AsnJob, AsnRecord, NoonSession, StoreIndex } from "../contracts.js";
import { AsnCreatorError } from "../errors.js";
import type { ContractOperationName } from "../noon/contract-schema.js";
import { itemsExactlyMatch, reconcileUnique } from "../noon/verifier.js";
import { injectNoonCookies } from "./cookies.js";
import { ASN_SELECTORS } from "./selectors.js";

interface CaptureWindow {
  during<T>(operation: ContractOperationName, action: () => Promise<T>): Promise<T>;
}

interface BrowserFallbackOptions {
  gateway: AsnGateway;
  refreshSession: (storeIndex: StoreIndex) => Promise<NoonSession>;
  chromePath: string;
  profileDirectory: string;
  headless?: boolean;
  createUrl?: (job: AsnJob) => string;
  injectSession?: (context: BrowserContext, session: NoonSession) => Promise<void>;
  capture?: CaptureWindow;
  stepTimeoutMs?: number;
  pollDelaysMs?: readonly number[];
}

const noCapture: CaptureWindow = {
  during: async <T>(_operation: ContractOperationName, action: () => Promise<T>) => action(),
};

function defaultCreateUrl(job: AsnJob): string {
  return `https://fbn.noon.partners/en-ae/asn/createasn?project=${encodeURIComponent(job.projectCode)}`;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class BrowserAsnFallback {
  private readonly capture: CaptureWindow;
  private readonly stepTimeoutMs: number;
  private readonly pollDelaysMs: readonly number[];

  constructor(private readonly options: BrowserFallbackOptions) {
    this.capture = options.capture ?? noCapture;
    this.stepTimeoutMs = options.stepTimeoutMs ?? 90_000;
    this.pollDelaysMs = options.pollDelaysMs ?? [0, 1_000, 3_000];
  }

  private async launch(): Promise<BrowserContext> {
    await mkdir(this.options.profileDirectory, { recursive: true });
    return chromium.launchPersistentContext(this.options.profileDirectory, {
      executablePath: this.options.chromePath,
      headless: this.options.headless ?? false,
      viewport: { width: 1440, height: 960 },
      args: ["--disable-background-timer-throttling"],
    });
  }

  private async inject(context: BrowserContext, session: NoonSession): Promise<void> {
    if (this.options.injectSession) return this.options.injectSession(context, session);
    await injectNoonCookies(context, session.cookieHeader);
  }

  async createAndVerify(job: AsnJob, initialSession: NoonSession): Promise<AsnRecord> {
    const context = await this.launch();
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(this.stepTimeoutMs);
    let session = initialSession;
    try {
      await this.inject(context, session);
      const url = (this.options.createUrl ?? defaultCreateUrl)(job);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.stepTimeoutMs });

      const loginVisible = ASN_SELECTORS.loginUrl.test(page.url()) ||
        await page.getByText(ASN_SELECTORS.loginText).first().isVisible().catch(() => false);
      if (loginVisible) {
        session = await this.options.refreshSession(job.storeIndex);
        await context.clearCookies();
        await this.inject(context, session);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.stepTimeoutMs });
        if (ASN_SELECTORS.loginUrl.test(page.url())) {
          throw new AsnCreatorError("authentication", false, "browser", "Noon browser login was rejected after refresh");
        }
      }

      const catalogChoice = page.getByText(ASN_SELECTORS.catalogButton, { exact: true });
      let catalogReady = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        catalogReady = await catalogChoice.isVisible().catch(() => false);
        if (catalogReady) break;
        if (attempt < 2) {
          await page.reload({ waitUntil: "domcontentloaded", timeout: this.stepTimeoutMs });
          await page.waitForTimeout(Math.min(2_000, this.stepTimeoutMs));
        }
      }
      if (!catalogReady) throw new AsnCreatorError("browser", true, "catalog", "Noon catalog choice did not load");
      await catalogChoice.click();
      for (const item of job.items) {
        const search = page.getByPlaceholder("Search sku, code...", { exact: true });
        let row;
        if (await search.isVisible().catch(() => false)) {
          const responsePromise = page.waitForResponse((response) =>
            new URL(response.url()).pathname.endsWith("/asn/list_eligible_lines") && response.request().method() === "POST",
          { timeout: this.stepTimeoutMs });
          await search.fill(item.partnerSku);
          const response = await responsePromise;
          const body = await response.json() as { rows?: Array<{ partner_sku?: unknown }> };
          const matches = body.rows?.filter((candidate) => candidate.partner_sku === item.partnerSku) ?? [];
          if (matches.length !== 1) {
            throw new AsnCreatorError("verification", false, "catalog", `Catalog search did not return one exact match for SKU ${item.partnerSku}`);
          }
          row = page.locator("tbody tr");
        } else {
          row = page.locator("tr").filter({ has: page.getByText(item.partnerSku, { exact: true }) });
        }
        await row.waitFor({ state: "visible", timeout: this.stepTimeoutMs });
        if (await row.count() !== 1) throw new AsnCreatorError("browser", false, "catalog", `Catalog row is missing or duplicated for SKU ${item.partnerSku}`);
        await row.getByRole("checkbox").check();
        const quantity = row.locator("input:not([type=checkbox])");
        if (await quantity.count() === 1) await quantity.fill(String(item.quantity));
        else await row.getByRole("spinbutton").fill(String(item.quantity));
      }

      await page.getByRole("button", { name: ASN_SELECTORS.continueButton, exact: true }).click();
      const warning = page.getByRole("dialog").filter({ hasText: ASN_SELECTORS.penaltyWarning });
      const submit = await warning.isVisible().catch(() => false)
        ? warning.getByRole("button", { name: ASN_SELECTORS.agreeButton, exact: true })
        : page.getByRole("button", { name: ASN_SELECTORS.agreeButton, exact: true });
      await this.capture.during("create", async () => {
        await submit.click();
        await Promise.race([
          page.waitForURL(/\/asn\/details\//i, { timeout: this.stepTimeoutMs }),
          page.getByRole("heading", { name: ASN_SELECTORS.createdHeading }).waitFor({ state: "visible", timeout: this.stepTimeoutMs }),
        ]);
      });

      let matched: AsnRecord | undefined;
      for (const waitMs of this.pollDelaysMs) {
        if (waitMs > 0) await delay(waitMs);
        const records = await this.capture.during("find", () => this.options.gateway.findMatches(job, session));
        matched = reconcileUnique(job, records);
        if (matched) break;
      }
      if (!matched) {
        throw new AsnCreatorError("verification", true, "browser", "Browser submission completed but no exact ASN match was found");
      }

      const details = await this.capture.during(
        "details",
        () => this.options.gateway.getDetails(matched!.asnNumber, job, session),
      );
      if (details.projectCode !== job.projectCode || !itemsExactlyMatch(job.items, details.items)) {
        throw new AsnCreatorError("verification", false, "browser", "Noon ASN details do not exactly match the workbook");
      }
      return details;
    } catch (cause) {
      if (cause instanceof AsnCreatorError) throw cause;
      throw new AsnCreatorError("browser", true, "browser", "Noon browser fallback failed", { cause });
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}
