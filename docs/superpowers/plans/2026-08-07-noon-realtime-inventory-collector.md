# Noon Realtime Inventory Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local scheduled collector that uses six Noon API JWT credentials to download UAE and KSA real-time inventory CSVs at 08:00, validates and publishes twelve correctly named files, and reports success or failure to WeCom.

**Architecture:** A standalone TypeScript/Node.js application lives under `apps/noon-inventory-collector` so it does not conflict with the root Office Script project being built by the downstream task. It uses Noon Identity for JWT authentication, calls the Seller Lab real-time inventory export endpoint, validates the returned CSV before publishing, and exposes a deterministic CLI installed as a Windows Scheduled Task. The collector and the 09:00 downstream workbook updater communicate only through the confirmed CSV filename and field contract.

**Tech Stack:** Node.js 22+, TypeScript 5, native `fetch`/`crypto`/`fs`, Vitest, PowerShell, Windows Task Scheduler

## Global Constraints

- Production runs every day at `08:00` in timezone `Asia/Shanghai` with no overlapping runs.
- Credential files stay in `D:\noon-api`; source control and logs must never contain private keys, JWTs, session cookies, or webhook URLs.
- Credential mapping is fixed: `noon1-API.json`/`PRJ42958` through `noon6-API.json`/`PRJ363826` in the confirmed store order.
- UAE requests use `X-Locale: en-ae` and must return only `country_code=AE`.
- KSA requests use `X-Locale: en-sa` and must return only `country_code=SA`.
- Every inventory request also sends Noon's page-native `Country-Code` (`ae`/`sa`) and `Id-Partner` headers; `X-Locale` alone does not select the inventory country.
- The real-time endpoint is `POST https://fbn.noon.partners/_svc/sc-fbn/api/v5/seller-lab/fbn-inventory` with body `{"inventory_tab_name":"export"}`.
- The public login endpoint is `POST https://noon-api-gateway.noon.partners/identity/public/v1/api/login`.
- Output roots are `D:\文件\库存文件\UAE\YYYY-MM-DD` and `D:\文件\库存文件\KSA\YYYY-MM-DD`.
- UAE filenames are `UAE1.YYYYMMDD.csv` through `UAE6.YYYYMMDD.csv`; KSA filenames are `SA1.YYYYMMDD.csv` through `SA6.YYYYMMDD.csv`.
- Preserve Noon's complete CSV response. At minimum it must contain `inventory_type`, `partner_sku`, `qty`, `id_partner`, `inventory_snapshot_at`, and `country_code`.
- A file is publishable only when project, country, schema, snapshot age, saleable rows, SKU values, and quantities all validate.
- Maximum accepted snapshot age is 60 minutes relative to request completion, comparing Noon timestamps as UTC.
- Each store gets at most three attempts with waits of 30 and 90 seconds for timeouts, HTTP 429, HTTP 5xx, and transient download errors.
- Do not retry authentication, project mismatch, country mismatch, schema mismatch, invalid CSV, or stale snapshots indefinitely.
- Never fall back to Aging, Ledger Summary, Ledger Detailed, an earlier date directory, or a partially successful store set.
- A failed UAE run does not stop KSA; a failed KSA run does not stop UAE.
- Success and failure both notify WeCom using `WECOM_WEBHOOK_URL`; notifications must be secret-free.
- The current collector writes local files only. OneDrive transfer is a separate integration boundary and must be explicit when merging with the 09:00 cloud flow.

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/noon-inventory-collector/package.json` | Isolated build, test, typecheck, and CLI scripts. |
| `apps/noon-inventory-collector/package-lock.json` | Locked development dependencies. |
| `apps/noon-inventory-collector/tsconfig.json` | Strict NodeNext TypeScript configuration. |
| `apps/noon-inventory-collector/src/contracts.ts` | Site/store mappings and shared result/error types. |
| `apps/noon-inventory-collector/src/credentials.ts` | Safe credential loading and metadata validation. |
| `apps/noon-inventory-collector/src/auth.ts` | RS256 JWT construction and Noon Identity login. |
| `apps/noon-inventory-collector/src/realtime-client.ts` | Seller Lab real-time inventory request. |
| `apps/noon-inventory-collector/src/csv.ts` | RFC 4180 parser, inventory validation, and statistics. |
| `apps/noon-inventory-collector/src/publisher.ts` | Staging, replacement, rollback, and cleanup. |
| `apps/noon-inventory-collector/src/retry.ts` | Retry classification and backoff. |
| `apps/noon-inventory-collector/src/redaction.ts` | Secret-safe error and log text. |
| `apps/noon-inventory-collector/src/logger.ts` | Structured 30-day rotating local logs. |
| `apps/noon-inventory-collector/src/wecom.ts` | WeCom success/failure notification. |
| `apps/noon-inventory-collector/src/runner.ts` | Store/site orchestration and aggregate result. |
| `apps/noon-inventory-collector/src/cli.ts` | Production and dry-run command-line entry point. |
| `apps/noon-inventory-collector/tests/*.test.ts` | Unit and orchestration tests. |
| `apps/noon-inventory-collector/tests/fixtures/*.csv` | Sanitized CSV fixtures with no production data. |
| `apps/noon-inventory-collector/scripts/run-collector.ps1` | Scheduled-task wrapper and process exit handling. |
| `apps/noon-inventory-collector/scripts/install-scheduled-task.ps1` | Idempotent 08:00 task installation. |
| `apps/noon-inventory-collector/docs/operations.md` | Setup, dry run, recovery, key rotation, and notification runbook. |
| `.gitignore` | Excludes app runtime, logs, staging, `.env`, and secrets. |

---

### Task 1: Establish the Isolated TypeScript Project and Site Contracts

**Files:**
- Create: `apps/noon-inventory-collector/package.json`
- Create: `apps/noon-inventory-collector/tsconfig.json`
- Create: `apps/noon-inventory-collector/src/contracts.ts`
- Create: `apps/noon-inventory-collector/tests/contracts.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `SiteCode`, `StoreConfig`, `SiteConfig`, `STORE_CONFIGS`, `SITE_CONFIGS`, `outputFileName()`, `outputDirectory()`.
- Consumes: no earlier task interfaces.

- [ ] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  outputDirectory,
  outputFileName,
  SITE_CONFIGS,
  STORE_CONFIGS,
} from "../src/contracts.js";

describe("collector contracts", () => {
  it("maps credential files to confirmed project codes", () => {
    expect(STORE_CONFIGS.map((s) => [s.index, s.credentialFile, s.projectCode])).toEqual([
      [1, "noon1-API.json", "PRJ42958"],
      [2, "noon2-API.json", "PRJ55651"],
      [3, "noon3-API.json", "PRJ61683"],
      [4, "noon4-API.json", "PRJ65553"],
      [5, "noon5-API.json", "PRJ75299"],
      [6, "noon6-API.json", "PRJ363826"],
    ]);
  });

  it("uses UAE and SA downstream filenames", () => {
    expect(outputFileName("UAE", 1, "2026-08-07")).toBe("UAE1.20260807.csv");
    expect(outputFileName("KSA", 6, "2026-08-07")).toBe("SA6.20260807.csv");
    expect(SITE_CONFIGS.KSA.locale).toBe("en-sa");
    expect(SITE_CONFIGS.KSA.countryCode).toBe("SA");
  });

  it("builds local dated output paths", () => {
    expect(outputDirectory("D:/文件/库存文件", "UAE", "2026-08-07"))
      .toBe("D:/文件/库存文件/UAE/2026-08-07");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `apps/noon-inventory-collector`:

```powershell
npm install
npm test -- tests/contracts.test.ts
```

Expected: FAIL because `src/contracts.ts` does not exist.

- [ ] **Step 3: Add the package and strict compiler configuration**

Create `package.json` with `type: module`, Node `>=22`, scripts `test`, `typecheck`, `build`, and `start`, plus dev dependencies `typescript`, `vitest`, and `@types/node`. Configure `tsconfig.json` with `module`/`moduleResolution: NodeNext`, `target: ES2022`, `strict: true`, `noUncheckedIndexedAccess: true`, `rootDir: .`, and `outDir: dist`.

- [ ] **Step 4: Implement the exact contracts**

```ts
export type SiteCode = "UAE" | "KSA";

export interface StoreConfig {
  index: 1 | 2 | 3 | 4 | 5 | 6;
  credentialFile: string;
  projectCode: `PRJ${string}`;
  partnerId: string;
}

export interface SiteConfig {
  code: SiteCode;
  locale: "en-ae" | "en-sa";
  countryCode: "AE" | "SA";
  filePrefix: "UAE" | "SA";
}

export const STORE_CONFIGS: readonly StoreConfig[] = [
  { index: 1, credentialFile: "noon1-API.json", projectCode: "PRJ42958", partnerId: "42958" },
  { index: 2, credentialFile: "noon2-API.json", projectCode: "PRJ55651", partnerId: "55651" },
  { index: 3, credentialFile: "noon3-API.json", projectCode: "PRJ61683", partnerId: "61683" },
  { index: 4, credentialFile: "noon4-API.json", projectCode: "PRJ65553", partnerId: "65553" },
  { index: 5, credentialFile: "noon5-API.json", projectCode: "PRJ75299", partnerId: "75299" },
  { index: 6, credentialFile: "noon6-API.json", projectCode: "PRJ363826", partnerId: "363826" },
];

export const SITE_CONFIGS: Record<SiteCode, SiteConfig> = {
  UAE: { code: "UAE", locale: "en-ae", countryCode: "AE", filePrefix: "UAE" },
  KSA: { code: "KSA", locale: "en-sa", countryCode: "SA", filePrefix: "SA" },
};
```

Implement strict `YYYY-MM-DD` validation in `outputFileName()` and normalize returned paths to forward slashes for deterministic tests.

- [ ] **Step 5: Add secret/runtime exclusions**

Append these exact patterns to `.gitignore` without removing existing entries:

```gitignore
apps/noon-inventory-collector/dist/
apps/noon-inventory-collector/node_modules/
apps/noon-inventory-collector/.runtime/
apps/noon-inventory-collector/.env
apps/noon-inventory-collector/*.log
**/noon*-API.json
```

- [ ] **Step 6: Run tests and type checking**

Run:

```powershell
npm test -- tests/contracts.test.ts
npm run typecheck
```

Expected: all contract tests PASS and TypeScript exits `0`.

- [ ] **Step 7: Commit**

```powershell
git add .gitignore apps/noon-inventory-collector
git commit -m "build: scaffold noon inventory collector"
```

---

### Task 2: Load Credentials Safely and Authenticate with Noon Identity

**Files:**
- Create: `apps/noon-inventory-collector/src/credentials.ts`
- Create: `apps/noon-inventory-collector/src/auth.ts`
- Create: `apps/noon-inventory-collector/tests/credentials.test.ts`
- Create: `apps/noon-inventory-collector/tests/auth.test.ts`

**Interfaces:**
- Consumes: `StoreConfig` from Task 1.
- Produces: `NoonCredential`, `loadCredential(path, expectedStore)`, `createJwt(credential, nowSeconds, jti)`, `loginNoon(credential, fetchImpl)`.

- [ ] **Step 1: Write failing credential validation tests**

```ts
it("rejects a credential for the wrong project without exposing the key", async () => {
  const file = await writeCredential({
    key_id: "key-test",
    private_key: TEST_PRIVATE_KEY,
    project_code: "PRJ99999",
    type: "apijwt",
  });
  await expect(loadCredential(file, STORE_CONFIGS[0]!)).rejects.toThrow("project_code mismatch");
});

it("accepts only apijwt credentials with all required string fields", async () => {
  const credential = await loadCredential(validFile, STORE_CONFIGS[0]!);
  expect(credential.project_code).toBe("PRJ42958");
  expect(JSON.stringify({ project_code: credential.project_code })).not.toContain("PRIVATE KEY");
});
```

- [ ] **Step 2: Run the credential tests and verify failure**

Run: `npm test -- tests/credentials.test.ts`

Expected: FAIL because `loadCredential` is missing.

- [ ] **Step 3: Implement strict credential loading**

Define:

```ts
export interface NoonCredential {
  key_id: string;
  private_key: string;
  project_code: string;
  type: "apijwt";
}
```

Read UTF-8 JSON, reject unknown/non-object input, validate the four fields, require `type === "apijwt"`, require the PEM markers, and compare `project_code` with the store contract. Error messages may mention the filename and expected project only; never interpolate credential values other than `project_code`.

- [ ] **Step 4: Write failing JWT and login tests**

Generate an RSA test key pair with `generateKeyPairSync("rsa", { modulusLength: 2048 })`. Decode the JWT header/payload and verify `alg`, `typ`, `sub`, `iat`, and `jti`. Stub `fetchImpl` to return two `Set-Cookie` values and assert `loginNoon()` returns only `name=value` pairs.

```ts
expect(request.url).toBe("https://noon-api-gateway.noon.partners/identity/public/v1/api/login");
expect(request.body.default_project_code).toBe("PRJ42958");
expect(session.cookieHeader).toBe("session=a; auth=b");
```

- [ ] **Step 5: Verify the authentication tests fail**

Run: `npm test -- tests/auth.test.ts`

Expected: FAIL because `createJwt` and `loginNoon` are missing.

- [ ] **Step 6: Implement RS256 JWT and login**

Use `crypto.sign("RSA-SHA256", ...)`, base64url encoding, and claims `{ sub, iat, jti }`. `loginNoon()` sends `User-Agent: StockAuto/1.0` and `Content-Type: application/json`, rejects non-200 responses with a status-only `AuthenticationError`, and parses cookies without logging the response headers.

- [ ] **Step 7: Run focused and full tests**

Run:

```powershell
npm test -- tests/credentials.test.ts tests/auth.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/noon-inventory-collector/src apps/noon-inventory-collector/tests
git commit -m "feat: authenticate noon service accounts"
```

---

### Task 3: Implement the Real-Time Seller Lab Inventory Client

**Files:**
- Create: `apps/noon-inventory-collector/src/realtime-client.ts`
- Create: `apps/noon-inventory-collector/tests/realtime-client.test.ts`

**Interfaces:**
- Consumes: `StoreConfig`, `SiteConfig`, and the cookie returned by `loginNoon()`.
- Produces: `fetchRealtimeInventory(input, fetchImpl): Promise<InventoryDownload>`.

- [ ] **Step 1: Write failing request-contract tests**

```ts
it("requests the exact UAE real-time export contract", async () => {
  const download = await fetchRealtimeInventory({
    store: STORE_CONFIGS[0]!,
    site: SITE_CONFIGS.UAE,
    cookieHeader: "session=test",
  }, fakeFetchReturningCsv(SAMPLE_CSV));

  expect(captured.url).toBe(
    "https://fbn.noon.partners/_svc/sc-fbn/api/v5/seller-lab/fbn-inventory",
  );
  expect(captured.headers["X-Locale"]).toBe("en-ae");
  expect(captured.headers["X-Project"]).toBe("PRJ42958");
  expect(captured.headers["X-Platform"]).toBe("web");
  expect(captured.headers["Country-Code"]).toBe("ae");
  expect(captured.headers["Id-Partner"]).toBe("42958");
  expect(captured.body).toEqual({ inventory_tab_name: "export" });
  expect(download.contentType).toContain("text/csv");
});

it("uses en-sa for KSA", async () => {
  await fetchRealtimeInventory(ksaInput, fakeFetchReturningCsv(SAMPLE_CSV));
  expect(captured.headers["X-Locale"]).toBe("en-sa");
  expect(captured.headers["Country-Code"]).toBe("sa");
});
```

- [ ] **Step 2: Verify the client tests fail**

Run: `npm test -- tests/realtime-client.test.ts`

Expected: FAIL because the client is missing.

- [ ] **Step 3: Implement the client**

Define:

```ts
export interface InventoryDownload {
  csvText: string;
  contentType: string;
  requestedAt: Date;
  completedAt: Date;
  httpStatus: number;
}
```

Use an `AbortController` with a 60-second timeout. Require HTTP 200, a non-empty body, and a content type containing `text/csv`; classify 429/5xx/timeouts as transient errors and 401/403/404/schema-like responses as permanent errors. Never include the Cookie header in thrown errors.

- [ ] **Step 4: Add failure classification tests**

Test HTTP 429, 500, 401, HTML bodies, empty CSV, timeout, and a response whose body begins with `{` despite HTTP 200. Assert every error exposes `{ kind, status, retryable }` without request headers.

- [ ] **Step 5: Run tests and type checking**

Run:

```powershell
npm test -- tests/realtime-client.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/noon-inventory-collector/src/realtime-client.ts apps/noon-inventory-collector/tests/realtime-client.test.ts
git commit -m "feat: call noon realtime inventory export"
```

---

### Task 4: Parse and Validate Inventory CSVs

**Files:**
- Create: `apps/noon-inventory-collector/src/csv.ts`
- Create: `apps/noon-inventory-collector/tests/csv.test.ts`
- Create: `apps/noon-inventory-collector/tests/fixtures/valid-ae.csv`
- Create: `apps/noon-inventory-collector/tests/fixtures/quoted-title.csv`
- Create: `apps/noon-inventory-collector/tests/fixtures/stale.csv`

**Interfaces:**
- Consumes: `InventoryDownload`, `StoreConfig`, and `SiteConfig`.
- Produces: `parseCsv(text)`, `validateInventoryCsv(download, store, site, now)`, `InventoryStats`.

- [ ] **Step 1: Write failing RFC 4180 parser tests**

Cover UTF-8 BOM, CRLF/LF, quoted commas, escaped quotes, empty trailing fields, malformed quotes, duplicate headers, and rows wider than the header.

```ts
expect(parseCsv('\uFEFFa,b\r\n"x,y","z""q"')).toEqual([
  ["a", "b"],
  ["x,y", 'z"q'],
]);
```

- [ ] **Step 2: Verify parser tests fail**

Run: `npm test -- tests/csv.test.ts -t "parser"`

Expected: FAIL because `parseCsv` is missing.

- [ ] **Step 3: Implement a state-machine CSV parser**

Use explicit `inQuotes`, `field`, `row`, and `rows` state. Treat `""` as one literal quote. Reject an unclosed quote and normalize a BOM only on the first header.

- [ ] **Step 4: Write failing business validation tests**

```ts
it("validates store, AE site, freshness, and saleable quantities", () => {
  const result = validateInventoryCsv(download("valid-ae.csv"), STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, NOW);
  expect(result.stats.partnerId).toBe("42958");
  expect(result.stats.countryCode).toBe("AE");
  expect(result.stats.saleableQty).toBe(15);
  expect(result.stats.saleableSkuCount).toBe(2);
});

it.each([
  ["wrong partner", { id_partner: "55651" }],
  ["wrong country", { country_code: "SA" }],
  ["negative qty", { qty: "-1" }],
  ["blank sku", { partner_sku: "" }],
])("rejects %s", (_name, mutation) => {
  expect(() => validateInventoryCsv(mutatedDownload(mutation), STORE_CONFIGS[0]!, SITE_CONFIGS.UAE, NOW))
    .toThrow();
});
```

Test that `2026-08-07, 09:58:08` is parsed as UTC and accepted at `2026-08-07T10:30:00Z`, but rejected at `2026-08-07T11:00:00Z` under the 60-minute rule. Require at least one saleable row.

- [ ] **Step 5: Implement validation and statistics**

Define:

```ts
export interface InventoryStats {
  partnerId: string;
  countryCode: "AE" | "SA";
  snapshotAtUtc: Date;
  rowCount: number;
  saleableRowCount: number;
  saleableSkuCount: number;
  saleableQty: number;
}
```

Locate headers by exact trimmed name, validate all non-empty `id_partner`/`country_code` values, select the newest unique snapshot timestamp, check age in both directions with a five-minute clock-skew allowance, and aggregate saleable SKU counts and quantities without altering the returned CSV text. Require total rows, saleable rows, distinct saleable SKUs, and summed saleable quantity all to be greater than zero.

- [ ] **Step 6: Run parser/validation tests and type checking**

Run:

```powershell
npm test -- tests/csv.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/noon-inventory-collector/src/csv.ts apps/noon-inventory-collector/tests/csv.test.ts apps/noon-inventory-collector/tests/fixtures
git commit -m "feat: validate realtime inventory csvs"
```

---

### Task 5: Stage and Publish Complete Site File Sets

**Files:**
- Create: `apps/noon-inventory-collector/src/publisher.ts`
- Create: `apps/noon-inventory-collector/tests/publisher.test.ts`

**Interfaces:**
- Consumes: validated `{ fileName, csvText, stats }` objects for one site.
- Produces: `stageSiteFiles()`, `publishSiteFiles()`, `rollbackPublish()`, `PublishedSiteResult`.
- Production invariant: `publishSiteFiles()` accepts exactly stores 1–6; `stageSiteFiles()` accepts an explicit expected-store set so an isolated dry run may stage only the requested subset.

- [ ] **Step 1: Write failing staging tests**

Use a temporary directory and assert that production staging writes exactly six UTF-8 CSVs beneath `.staging/<runId>/<site>`, never inside the final date directory. Reject duplicate names, a file set that differs from the supplied expected-store indexes, wrong prefixes, and mismatched dates. Add a separate assertion that an isolated dry run may stage exactly store 1 when its expected-store set is `[1]`.

- [ ] **Step 2: Verify staging tests fail**

Run: `npm test -- tests/publisher.test.ts -t "staging"`

Expected: FAIL because publisher functions are missing.

- [ ] **Step 3: Implement staging**

Write each CSV to `<name>.partial`, `fsync` the file, rename it to the expected staged filename, then verify size and reread the first line. Use the output root's `.staging` directory so staging and final files remain on drive `D:`.

- [ ] **Step 4: Write failing replacement and rollback tests**

Cover:

1. First publication into an absent date directory.
2. Same-day replacement when six valid files already exist.
3. Failure on the fourth replacement restores all six original files.
4. Unrelated files in the date directory, such as `运行录屏.mp4`, remain untouched.
5. Staging is retained on failure and removed on success.

- [ ] **Step 5: Implement transactional six-file replacement**

Before replacing, move existing matching final CSVs to `.staging/<runId>/<site>/.previous`. Move all staged files to final names. If any move fails, remove newly moved files and restore all `.previous` files. Do not move, delete, or rename unrelated directory contents. Delete `.previous` only after all six final files exist with their expected byte sizes.

- [ ] **Step 6: Run publisher tests**

Run:

```powershell
npm test -- tests/publisher.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/noon-inventory-collector/src/publisher.ts apps/noon-inventory-collector/tests/publisher.test.ts
git commit -m "feat: publish complete inventory file sets"
```

---

### Task 6: Add Retry, Secret Redaction, Logs, and WeCom Notifications

**Files:**
- Create: `apps/noon-inventory-collector/src/retry.ts`
- Create: `apps/noon-inventory-collector/src/redaction.ts`
- Create: `apps/noon-inventory-collector/src/logger.ts`
- Create: `apps/noon-inventory-collector/src/wecom.ts`
- Create: `apps/noon-inventory-collector/tests/retry.test.ts`
- Create: `apps/noon-inventory-collector/tests/redaction.test.ts`
- Create: `apps/noon-inventory-collector/tests/wecom.test.ts`

**Interfaces:**
- Consumes: typed errors and site/store results from Tasks 2–5.
- Produces: `withRetry()`, `redactSecrets()`, `createLogger()`, `sendWeComNotification()`.

- [ ] **Step 1: Write failing retry tests**

Use injected `sleep` and assert delays `[30_000, 90_000]`, maximum three attempts, success on a transient third attempt, and immediate stop for permanent errors.

```ts
expect(await withRetry(operation, { delaysMs: [30_000, 90_000], sleep })).toBe("ok");
expect(sleep).toHaveBeenNthCalledWith(1, 30_000);
expect(sleep).toHaveBeenNthCalledWith(2, 90_000);
```

- [ ] **Step 2: Implement retry behavior**

Retry only errors whose typed `retryable` property is `true`; attach attempt count without wrapping or stringifying request headers.

- [ ] **Step 3: Write failing redaction tests**

Assert masking of PEM blocks, JWT-shaped strings, `Cookie`/`Set-Cookie` values, `key=` webhook query values, and fields named `private_key`, `key_id`, `token`, or `cookieHeader`. Preserve project codes and HTTP status codes.

- [ ] **Step 4: Implement recursive redaction and JSONL logging**

`redactSecrets()` accepts unknown input and returns JSON-safe data. `createLogger()` writes one JSON object per line under `%LOCALAPPDATA%/NoonInventoryCollector/logs/YYYY-MM-DD.jsonl`, creates directories, and deletes only matching log files older than 30 days.

- [ ] **Step 5: Write failing WeCom tests**

Assert the exact endpoint comes only from the injected URL/environment, the payload uses `msgtype: "markdown"`, successful messages contain both sites and per-store stats, failure messages contain store/stage/attempts, and serialized payloads contain no secret patterns.

- [ ] **Step 6: Implement WeCom notification**

Use a 15-second timeout. Treat missing/invalid `WECOM_WEBHOOK_URL` as a preflight configuration error. A notification failure must be logged locally and set process exit code non-zero, but it must not delete already published inventory files.

- [ ] **Step 7: Run tests and type checking**

Run:

```powershell
npm test -- tests/retry.test.ts tests/redaction.test.ts tests/wecom.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/noon-inventory-collector/src apps/noon-inventory-collector/tests
git commit -m "feat: add resilient secret-safe operations"
```

---

### Task 7: Orchestrate Stores and Sites Through a Production CLI

**Files:**
- Create: `apps/noon-inventory-collector/src/runner.ts`
- Create: `apps/noon-inventory-collector/src/cli.ts`
- Create: `apps/noon-inventory-collector/tests/runner.test.ts`
- Create: `apps/noon-inventory-collector/tests/cli.test.ts`

**Interfaces:**
- Consumes: all services from Tasks 1–6.
- Produces: `runStore()`, `runSite()`, `runCollector()`, CLI commands `run` and `dry-run`.

- [ ] **Step 1: Write failing store orchestration tests**

Inject fake credential/auth/client/validator services. Assert the exact per-store order `load credential -> login -> download -> validate`, a fresh login per attempt, and that successful results contain file name, untouched CSV text, and inventory statistics. Staging occurs at site scope only after all expected stores validate.

- [ ] **Step 2: Write failing site isolation tests**

Test six-store success, one-store failure preventing that site's publication, UAE failure with KSA success, and KSA failure with UAE success. Assert `stageSiteFiles` and `publishSiteFiles` each receive exactly six validated production files and neither is called for an incomplete site.

- [ ] **Step 3: Implement runner result types and orchestration**

Define:

```ts
export interface StoreRunResult {
  site: SiteCode;
  storeIndex: number;
  projectCode: string;
  fileName: string;
  attempts: number;
  status: "success" | "failed";
  stats?: InventoryStats;
  error?: { kind: string; stage: string; message: string };
}

export interface CollectorRunResult {
  runId: string;
  runDate: string;
  startedAt: string;
  completedAt: string;
  sites: Record<SiteCode, { status: "success" | "failed"; stores: StoreRunResult[] }>;
}
```

Process stores sequentially within each site to reduce auth/load pressure. In production, keep validated downloads in memory until all six stores succeed, then stage and publish the complete site set. Process UAE then KSA; a failed site still yields a result and does not throw past `runCollector()` until notification and logging complete. In dry-run mode, stage the explicitly selected store/site set beneath the caller-provided output root, skip formal publication, and retain those files for inspection.

- [ ] **Step 4: Write failing CLI tests**

Cover:

- `run` defaults to both sites and today's `Asia/Shanghai` date.
- `dry-run --site UAE --store 1 --out <temp>` never publishes to the formal root.
- invalid dates/sites/stores exit `2` before reading credentials.
- any site or notification failure exits `1`; total success exits `0`.
- a lock file prevents an overlapping second process and exits `3`.

- [ ] **Step 5: Implement CLI and process locking**

Accept:

```text
node dist/src/cli.js run
node dist/src/cli.js dry-run --site UAE --store 1 --out D:\temp\noon-dry-run
```

Read configuration from `NOON_CREDENTIAL_DIR`, `NOON_OUTPUT_ROOT`, `WECOM_WEBHOOK_URL`, and optional `NOON_SNAPSHOT_MAX_AGE_MINUTES`. Defaults are `D:\noon-api`, `D:\文件\库存文件`, and `60`. Create `%LOCALAPPDATA%/NoonInventoryCollector/collector.lock` with exclusive mode and always release it in `finally`.

- [ ] **Step 6: Run all tests and build**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all tests PASS and `dist/src/cli.js` exists.

- [ ] **Step 7: Commit**

```powershell
git add apps/noon-inventory-collector/src apps/noon-inventory-collector/tests
git commit -m "feat: orchestrate realtime inventory collection"
```

---

### Task 8: Install the 08:00 Windows Scheduled Task and Operations Runbook

**Files:**
- Create: `apps/noon-inventory-collector/scripts/run-collector.ps1`
- Create: `apps/noon-inventory-collector/scripts/install-scheduled-task.ps1`
- Create: `apps/noon-inventory-collector/docs/operations.md`
- Create: `apps/noon-inventory-collector/tests/scheduler-contract.test.ts`

**Interfaces:**
- Consumes: compiled CLI from Task 7.
- Produces: scheduled task `NoonRealtimeInventoryCollector` running daily at 08:00.

- [ ] **Step 1: Write failing script contract tests**

Read the PowerShell scripts as text and assert:

- Task name is exactly `NoonRealtimeInventoryCollector`.
- Trigger uses `08:00` daily.
- Settings prevent overlapping instances and run missed starts when the machine resumes.
- Action invokes `run-collector.ps1`, not `npm`.
- Wrapper runs `node dist/src/cli.js run`, redirects stdout/stderr to the local log directory, and returns the Node exit code.
- No script contains a literal `qyapi.weixin.qq.com` URL or private-key text.

- [ ] **Step 2: Verify scheduler tests fail**

Run: `npm test -- tests/scheduler-contract.test.ts`

Expected: FAIL because scripts do not exist.

- [ ] **Step 3: Implement the runtime wrapper**

`run-collector.ps1` resolves its app root, uses `$env:NOON_NODE_PATH` when set, otherwise uses `C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`, verifies `dist/src/cli.js`, creates the log directory, runs the CLI, and exits with `$LASTEXITCODE`.

- [ ] **Step 4: Implement idempotent scheduled-task installation**

`install-scheduled-task.ps1` accepts `-TaskName` and `-StartTime` with the confirmed defaults. It builds a daily trigger at 08:00, sets `MultipleInstances = IgnoreNew`, `StartWhenAvailable = true`, and replaces only the same named task after printing its current action/trigger for confirmation. It runs under the current Windows user without embedding passwords.

- [ ] **Step 5: Write the exact setup and recovery runbook**

Document:

1. Build command and expected artifact.
2. ACL command granting only the current user access to `D:\noon-api`.
3. Secure local entry of the rotated webhook:

```powershell
$secure = Read-Host "Paste the rotated WeCom webhook" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  [Environment]::SetEnvironmentVariable("WECOM_WEBHOOK_URL", $plain, "User")
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Variable plain, secure -ErrorAction SilentlyContinue
}
```

4. `dry-run` commands for one store and all stores.
5. Installation, manual task start, status inspection, disable, uninstall, and key rotation.
6. Failure meanings for auth, 429, stale snapshot, country mismatch, schema change, publish rollback, and notification failure.
7. Explicit warning that local `D:\文件` is not currently a OneDrive link.

- [ ] **Step 6: Run tests and static checks**

Run:

```powershell
npm test -- tests/scheduler-contract.test.ts
npm run typecheck
git grep -n -E "qyapi\.weixin\.qq\.com|BEGIN (RSA )?PRIVATE KEY|f31fd868" -- apps/noon-inventory-collector
```

Expected: scheduler tests PASS; secret scan returns no matches.

- [ ] **Step 7: Commit**

```powershell
git add apps/noon-inventory-collector/scripts apps/noon-inventory-collector/docs apps/noon-inventory-collector/tests/scheduler-contract.test.ts
git commit -m "ops: schedule daily noon inventory collection"
```

---

### Task 9: Live Acceptance, Downstream Handoff, and Cutover

**Files:**
- Modify: `apps/noon-inventory-collector/docs/operations.md`
- Create: `apps/noon-inventory-collector/docs/acceptance-2026-08-07.md`

**Interfaces:**
- Consumes: production collector and existing downstream CSV contract.
- Produces: verified live collection, installed schedule, and documented merge boundary.

- [ ] **Step 1: Build and run a one-store UAE dry run**

Run:

```powershell
cd D:\codex\stock_auto\apps\noon-inventory-collector
npm ci
npm test
npm run typecheck
npm run build
node dist/src/cli.js dry-run --site UAE --store 1 --out "$env:TEMP\noon-collector-acceptance"
```

Expected: authentication and real-time export succeed; country is `AE`; project is `PRJ42958`; snapshot age is at most 60 minutes; generated saleable quantity matches the Seller Lab page when checked at the same time.

- [ ] **Step 2: Run a one-store KSA dry run**

Run the same command with `--site KSA --store 1`. Expected: country is `SA`, project remains `PRJ42958`, and output filename begins `SA1.`.

- [ ] **Step 3: Run all twelve downloads into a temporary acceptance root**

```powershell
node dist/src/cli.js dry-run --out "$env:TEMP\noon-collector-all-stores"
```

Expected: six UAE and six KSA files; every file passes project/country/freshness/schema checks; no formal output directory is modified.

- [ ] **Step 4: Reconcile the downstream contract**

For every acceptance CSV, assert the required headers `inventory_type`, `partner_sku`, and `qty`. Run the downstream parser/aggregator tests or manual test flow against the acceptance set and compare its per-store saleable SKU count and quantity with the collector's recorded statistics.

- [ ] **Step 5: Test failure boundaries**

Use dependency injection/unit tests rather than production mutations to verify 401, 429, 500, stale snapshot, wrong country, wrong project, missing required header, publish failure, and WeCom failure. Confirm no test reads or rewrites production credential JSONs.

- [ ] **Step 6: Publish a formal manual run before 09:00 integration**

Run `node dist/src/cli.js run` manually. Confirm the two dated directories contain exactly the twelve expected CSV names plus any pre-existing unrelated files, all files are current, and WeCom receives a secret-free success notification.

- [ ] **Step 7: Install and verify the scheduled task**

Run `scripts/install-scheduled-task.ps1`, start the task manually once, inspect the last result, then confirm the next trigger is 08:00 China time and overlapping starts are ignored.

- [ ] **Step 8: Document the local-to-OneDrive handoff**

In `acceptance-2026-08-07.md`, record that the collector writes `D:\文件\库存文件` while the downstream cloud flow reads OneDrive. Choose and record one merge mechanism before production handoff:

- copy the validated twelve files into the configured OneDrive-synced source root after collection; or
- move the downstream updater to a local runner that reads the collector output directly.

Do not enable the 09:00 production updater until the chosen handoff has an end-to-end test.

- [ ] **Step 9: Run final verification and secret scan**

```powershell
npm test
npm run typecheck
npm run build
git status --short
git grep -n -E "qyapi\.weixin\.qq\.com|BEGIN (RSA )?PRIVATE KEY|f31fd868" -- apps/noon-inventory-collector
```

Expected: tests/build PASS, no secret matches, and only the intended acceptance/runbook updates remain.

- [ ] **Step 10: Commit**

```powershell
git add apps/noon-inventory-collector/docs
git commit -m "docs: accept realtime inventory collector"
```
