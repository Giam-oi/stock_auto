# Noon FBN ASN Creator EXE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a double-clickable Windows x64 EXE that selects a folder, creates one verified Noon UAE FBN ASN per valid workbook, writes the ASN number only to `约仓!C2`, resumes safely, and falls back to a visible browser when the captured internal API contract fails.

**Architecture:** A TypeScript coordinator parses workbooks into immutable jobs, persists a per-file state machine, authenticates each store with existing API JWT credentials, and runs an API-first `AsnGateway` backed by sanitized captured Noon web contracts. Uncertain create outcomes always enter server-side reconciliation before retry; a Playwright-driven Chrome state machine is the fallback and the source of refreshed request contracts.

**Tech Stack:** Node.js 22, TypeScript 7, Vitest, ExcelJS, `playwright-core`, native `fetch`, PowerShell folder picker, `@yao-pkg/pkg`, Google Chrome, Windows x64.

## Global Constraints

- Phase 1 supports UAE only: `countryCode=AE`, `locale=en-ae`, and `https://fbn.noon.partners/en-ae/...`.
- One `.xlsx` file is one ASN; automatic workbook splitting is out of scope.
- Process only top-level `.xlsx` files and ignore names beginning with `~$`.
- The filename must contain exactly one `店铺1` through `店铺6` mapping from the existing repository.
- The workbook sheet is `约仓`; required headers are `约仓SKU`, `数量`, `ASN`, `运单号`, `箱号`.
- `C2` is the only ASN write-back cell; an existing nonblank `C2` means skip.
- Phase 1 creates the ASN only; no appointment date/time, slot booking, waybill, box number, or label workflow.
- A file failure never stops later files.
- Never retry an uncertain create before reconciling against Noon.
- Never log or commit credential private keys, JWTs, Cookie headers, raw authenticated captures, or webhook values.
- The EXE must run on Windows x64 without a separately installed Node.js runtime and may require installed Google Chrome only for browser fallback.
- Preserve existing dirty worktree changes; every task stages only its listed files.

---

## File Structure

Create the application as an independent package:

```text
apps/noon-asn-creator/
  package.json                     dependencies, scripts, pkg metadata
  package-lock.json                locked dependency graph
  tsconfig.json                    editor/test configuration
  tsconfig.build.json              production compilation
  vitest.config.ts                 test discovery and timeouts
  src/
    main.ts                        EXE entrypoint and exit-code mapping
    contracts.ts                   domain types and six-store/UAE configuration
    errors.ts                      typed error taxonomy and retry classification
    launcher.ts                    Windows folder dialog and console/progress window
    workbook.ts                    workbook discovery, validation, fingerprint, C2 write-back
    journal.ts                     atomic persistent state machine
    retry.ts                       bounded backoff helper
    redaction.ts                   structured log redaction
    logger.ts                      JSONL run log
    noon/
      auth.ts                      JWT login and cookie refresh
      headers.ts                   per-store UAE web headers
      contract-schema.ts           sanitized captured-contract types and validation
      contract-loader.ts           load embedded versioned contract bundle
      contract-replay.ts           bind job values into sanitized request templates
      api-gateway.ts               API-first create/list/detail implementation
      verifier.ts                  unique ASN reconciliation and exact item matching
    browser/
      chrome.ts                    locate/launch installed Chrome via Playwright
      cookies.ts                   inject API-login cookies into isolated context
      capture.ts                   capture and sanitize Fetch/XHR request/response evidence
      selectors.ts                 semantic locator definitions
      fallback.ts                  visible browser state machine
    runner.ts                      per-file and per-folder orchestration
  contracts/
    noon-uae-asn.v1.json           sanitized, versioned live contract after capture gate
  scripts/
    build-exe.mjs                  compile and package portable EXE
    smoke-exe.ps1                  no-Node packaged executable smoke test
  docs/
    operations.md                  operator workflow, recovery, and credential safety
  tests/
    fixtures/
      workbooks/                    generated workbook fixtures, no business data
      web/                          local delayed/login/success browser pages
      contracts/                    sanitized synthetic contract fixtures
    contracts.test.ts
    workbook.test.ts
    journal.test.ts
    retry.test.ts
    redaction.test.ts
    auth.test.ts
    contract-schema.test.ts
    contract-replay.test.ts
    verifier.test.ts
    api-gateway.test.ts
    browser-fallback.test.ts
    runner.test.ts
    launcher.test.ts
    package.test.ts
```

Focused interfaces used throughout the plan:

```ts
export type StoreIndex = 1 | 2 | 3 | 4 | 5 | 6;

export interface AsnItem {
  partnerSku: string;
  quantity: number;
}

export interface AsnJob {
  filePath: string;
  fileName: string;
  fileFingerprint: string;
  storeIndex: StoreIndex;
  projectCode: `PRJ${string}`;
  partnerId: string;
  site: "UAE";
  items: readonly AsnItem[];
}

export interface NoonSession {
  cookieHeader: string;
  projectCode: `PRJ${string}`;
  authenticatedAt: string;
}

export interface AsnRecord {
  asnNumber: string;
  projectCode: `PRJ${string}`;
  status: string;
  createdAt?: string;
  items: readonly AsnItem[];
}

export interface AsnGateway {
  findMatches(job: AsnJob, session: NoonSession): Promise<readonly AsnRecord[]>;
  create(job: AsnJob, session: NoonSession): Promise<{ outcome: "accepted" | "uncertain" }>;
  getDetails(asnNumber: string, job: AsnJob, session: NoonSession): Promise<AsnRecord>;
}
```

### Task 1: Scaffold the independent application and domain contracts

**Files:**
- Create: `apps/noon-asn-creator/package.json`
- Create: `apps/noon-asn-creator/package-lock.json`
- Create: `apps/noon-asn-creator/tsconfig.json`
- Create: `apps/noon-asn-creator/tsconfig.build.json`
- Create: `apps/noon-asn-creator/vitest.config.ts`
- Create: `apps/noon-asn-creator/src/contracts.ts`
- Create: `apps/noon-asn-creator/src/errors.ts`
- Create: `apps/noon-asn-creator/tests/contracts.test.ts`

**Interfaces:**
- Consumes: Existing six-store mapping from `apps/noon-inventory-collector/src/contracts.ts` as authoritative evidence.
- Produces: `STORE_CONFIGS`, `UAE_SITE`, `AsnItem`, `AsnJob`, `NoonSession`, `AsnRecord`, `AsnGateway`, `AsnCreatorError`.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import { STORE_CONFIGS, UAE_SITE, parseStoreIndex } from "../src/contracts.js";

describe("ASN contracts", () => {
  it("keeps the established six-store project mapping", () => {
    expect(STORE_CONFIGS.map(({ index, projectCode, partnerId }) => ({ index, projectCode, partnerId }))).toEqual([
      { index: 1, projectCode: "PRJ42958", partnerId: "42958" },
      { index: 2, projectCode: "PRJ55651", partnerId: "55651" },
      { index: 3, projectCode: "PRJ61683", partnerId: "61683" },
      { index: 4, projectCode: "PRJ65553", partnerId: "65553" },
      { index: 5, projectCode: "PRJ75299", partnerId: "75299" },
      { index: 6, projectCode: "PRJ363826", partnerId: "363826" },
    ]);
  });

  it("fixes phase 1 to UAE", () => {
    expect(UAE_SITE).toEqual({ code: "UAE", locale: "en-ae", countryCode: "AE" });
  });

  it("requires exactly one store token", () => {
    expect(parseStoreIndex("01 店铺2 约仓文件 HL.xlsx")).toBe(2);
    expect(() => parseStoreIndex("店铺1 店铺2.xlsx")).toThrow(/exactly one/i);
    expect(() => parseStoreIndex("unknown.xlsx")).toThrow(/店铺1.*店铺6/);
  });
});
```

- [ ] **Step 2: Initialize dependencies and verify the test fails**

Run:

```powershell
cd D:\codex\stock_auto\apps\noon-asn-creator
npm.cmd install exceljs playwright-core
npm.cmd install --save-dev typescript vitest @types/node @yao-pkg/pkg
npm.cmd test -- --run tests/contracts.test.ts
```

Expected: FAIL because `src/contracts.ts` does not exist.

- [ ] **Step 3: Implement contracts and typed errors**

Define the interfaces in the File Structure section verbatim. Implement:

```ts
export function parseStoreIndex(fileName: string): StoreIndex {
  const matches = [...fileName.matchAll(/店铺([1-6])/g)].map((match) => Number(match[1]));
  if (matches.length !== 1) {
    throw new AsnCreatorError("input", false, "Filename must contain exactly one 店铺1 through 店铺6");
  }
  return matches[0] as StoreIndex;
}
```

`AsnCreatorError` carries `kind`, `retryable`, `stage`, optional `status`, and a safe message.

- [ ] **Step 4: Run the focused and static checks**

```powershell
npm.cmd test -- --run tests/contracts.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit only scaffold and contract files**

```powershell
git add apps/noon-asn-creator/package.json apps/noon-asn-creator/package-lock.json apps/noon-asn-creator/tsconfig.json apps/noon-asn-creator/tsconfig.build.json apps/noon-asn-creator/vitest.config.ts apps/noon-asn-creator/src/contracts.ts apps/noon-asn-creator/src/errors.ts apps/noon-asn-creator/tests/contracts.test.ts
git commit -m "feat: scaffold noon ASN creator"
```

### Task 2: Implement workbook discovery, validation, fingerprinting, and lossless C2 write-back

**Files:**
- Create: `apps/noon-asn-creator/src/workbook.ts`
- Create: `apps/noon-asn-creator/tests/workbook.test.ts`
- Create: `apps/noon-asn-creator/tests/fixtures/workbooks/generate-fixtures.ts`

**Interfaces:**
- Consumes: `AsnJob`, `StoreIndex`, `STORE_CONFIGS`, `parseStoreIndex`.
- Produces: `discoverWorkbookPaths(folderPath): Promise<string[]>`, `readAsnJob(filePath): Promise<AsnJob | { skippedAsn: string }>`, `writeAsnNumber(job, asnNumber): Promise<void>`.

- [ ] **Step 1: Generate synthetic workbook fixtures in the test lifecycle**

The generator must create files with sheet `约仓`, headers `约仓SKU/数量/ASN/运单号/箱号`, styled headers, a formula on a second sheet, and representative rows. Never copy user business data into Git.

```ts
await createFixture("01 店铺2 约仓文件 HL.xlsx", [
  ["TEST-SKU-001", 50, "", "", ""],
  ["TEST-SKU-002", 25, "", "", ""],
]);
```

- [ ] **Step 2: Write failing workbook tests**

Cover:

```ts
it("ignores nested files, non-xlsx files, and Excel temporary files");
it("parses SKU as text and positive integer quantity");
it("rejects a missing sheet, wrong headers, blank SKU, fractional quantity, zero quantity, and duplicate SKU");
it("returns skippedAsn when C2 is nonblank");
it("writes only C2 and preserves all other values, formulas, sheet names, and sampled styles");
it("refuses write-back when the file fingerprint changed");
```

Before write-back, snapshot every used cell's value, formula, number format, font, fill, border, alignment, row height, column width, merged ranges, sheet name, and sheet visibility. After write-back, assert equality except `约仓!C2`.

- [ ] **Step 3: Run the test to verify failures**

```powershell
npm.cmd test -- --run tests/workbook.test.ts
```

Expected: FAIL because workbook functions are missing.

- [ ] **Step 4: Implement workbook operations**

Use ExcelJS to load/save. Normalize items with `String(value).trim()` and `Number(value)`. Fingerprint the original bytes with SHA-256 plus the normalized job JSON. Save to a sibling temporary file, reopen it, verify `C2`, then replace the original using `rename`; on Windows replacement, move the original to a same-directory backup until the replacement succeeds, then remove the backup.

```ts
export async function writeAsnNumber(job: AsnJob, asnNumber: string): Promise<void> {
  const current = await readAndFingerprint(job.filePath);
  if (current.fingerprint !== job.fileFingerprint) throw changedWorkbookError(job.fileName);
  if (current.c2.trim() !== "") throw changedWorkbookError(job.fileName);
  // write C2 in a temp workbook, verify, then atomically replace
}
```

- [ ] **Step 5: Run workbook tests and typecheck**

```powershell
npm.cmd test -- --run tests/workbook.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit workbook support**

```powershell
git add apps/noon-asn-creator/src/workbook.ts apps/noon-asn-creator/tests/workbook.test.ts apps/noon-asn-creator/tests/fixtures/workbooks/generate-fixtures.ts
git commit -m "feat: validate and update ASN workbooks"
```

### Task 3: Add atomic journal, retry policy, logging, and redaction

**Files:**
- Create: `apps/noon-asn-creator/src/journal.ts`
- Create: `apps/noon-asn-creator/src/retry.ts`
- Create: `apps/noon-asn-creator/src/redaction.ts`
- Create: `apps/noon-asn-creator/src/logger.ts`
- Create: `apps/noon-asn-creator/tests/journal.test.ts`
- Create: `apps/noon-asn-creator/tests/retry.test.ts`
- Create: `apps/noon-asn-creator/tests/redaction.test.ts`

**Interfaces:**
- Consumes: `AsnJob`, `AsnCreatorError`.
- Produces: `JobStage`, `JobEntry`, `JournalStore`, `withRetry`, `redact`, `JsonLogger`.

- [ ] **Step 1: Write failing journal and retry tests**

```ts
expect(() => transition(entry, "written")).toThrow(/invalid transition/);
expect(transition(transition(entry, "validated"), "creating").stage).toBe("creating");
```

Test an interrupted atomic write leaves the previous journal parseable. Test retry delays for 429/5xx/network only, with injected `sleep`. Test redaction removes PEM blocks, JWT-shaped strings, `Cookie`, `set-cookie`, and credential field names recursively.

- [ ] **Step 2: Run tests and confirm failure**

```powershell
npm.cmd test -- --run tests/journal.test.ts tests/retry.test.ts tests/redaction.test.ts
```

Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement the persistent state machine**

Use `%LOCALAPPDATA%\NoonASNCreator\journal.json` by default. Allowed forward transitions are exactly:

```ts
const transitions = {
  discovered: ["validated", "skipped_existing", "invalid_input"],
  validated: ["creating", "failed"],
  creating: ["verifying"],
  verifying: ["confirmed", "needs_review", "failed", "creating"],
  confirmed: ["written", "needs_review"],
  written: [], skipped_existing: [], invalid_input: [], needs_review: [], failed: ["validated"],
} satisfies Record<JobStage, readonly JobStage[]>;
```

The journal key is SHA-256 of absolute path + file fingerprint + project code. Persist through `journal.json.tmp`, fsync/close, and rename.

- [ ] **Step 4: Implement bounded retry and safe JSONL logging**

Retry read-only calls with delays `[1_000, 3_000, 10_000]`; respect integer `Retry-After` seconds capped at 60 seconds. Create calls are never passed to generic retry. Logger writes redacted JSONL to `%LOCALAPPDATA%\NoonASNCreator\logs\YYYY-MM-DD.jsonl`.

- [ ] **Step 5: Run tests**

```powershell
npm.cmd test -- --run tests/journal.test.ts tests/retry.test.ts tests/redaction.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit recovery infrastructure**

```powershell
git add apps/noon-asn-creator/src/journal.ts apps/noon-asn-creator/src/retry.ts apps/noon-asn-creator/src/redaction.ts apps/noon-asn-creator/src/logger.ts apps/noon-asn-creator/tests/journal.test.ts apps/noon-asn-creator/tests/retry.test.ts apps/noon-asn-creator/tests/redaction.test.ts
git commit -m "feat: persist recoverable ASN jobs"
```

### Task 4: Implement API JWT authentication and UAE web headers

**Files:**
- Create: `apps/noon-asn-creator/src/noon/auth.ts`
- Create: `apps/noon-asn-creator/src/noon/headers.ts`
- Create: `apps/noon-asn-creator/tests/auth.test.ts`

**Interfaces:**
- Consumes: `STORE_CONFIGS`, `NoonSession`, `AsnCreatorError`.
- Produces: `loadCredential`, `createJwt`, `loginNoon`, `SessionManager.get(storeIndex)`, `webHeaders(job, session)`.

- [ ] **Step 1: Write failing auth tests from the proven collector behavior**

Test deterministic JWT header/payload, project-code mismatch, missing cookie, HTTP failure, session cache, and one forced refresh. Assert web headers include:

```ts
expect(webHeaders(job, session)).toMatchObject({
  "X-Locale": "en-ae",
  "X-Platform": "web",
  "X-Project": job.projectCode,
  "Country-Code": "ae",
  "Id-Partner": job.partnerId,
});
```

- [ ] **Step 2: Run the test to verify failure**

```powershell
npm.cmd test -- --run tests/auth.test.ts
```

Expected: FAIL because authentication modules are absent.

- [ ] **Step 3: Implement credentials and login**

Port the already-tested behavior from `apps/noon-inventory-collector/src/credentials.ts` and `src/auth.ts`, changing only the user agent to `NoonASNCreator/1.0`. Default credential files are `D:\noon-api\noon1-API.json` through `noon6-API.json`; allow `NOON_CREDENTIAL_DIR` override.

- [ ] **Step 4: Run auth tests plus the existing collector regression suite**

```powershell
npm.cmd test -- --run tests/auth.test.ts
cd D:\codex\stock_auto\apps\noon-inventory-collector
npm.cmd test
```

Expected: both PASS; inventory collector behavior is unchanged.

- [ ] **Step 5: Commit authentication**

```powershell
git add apps/noon-asn-creator/src/noon/auth.ts apps/noon-asn-creator/src/noon/headers.ts apps/noon-asn-creator/tests/auth.test.ts
git commit -m "feat: authenticate ASN jobs with noon"
```

### Task 5: Build the sanitized web-contract capture and replay engine

**Files:**
- Create: `apps/noon-asn-creator/src/noon/contract-schema.ts`
- Create: `apps/noon-asn-creator/src/noon/contract-loader.ts`
- Create: `apps/noon-asn-creator/src/noon/contract-replay.ts`
- Create: `apps/noon-asn-creator/src/browser/capture.ts`
- Create: `apps/noon-asn-creator/tests/contract-schema.test.ts`
- Create: `apps/noon-asn-creator/tests/contract-replay.test.ts`
- Create: `apps/noon-asn-creator/tests/fixtures/contracts/synthetic.v1.json`

**Interfaces:**
- Consumes: `AsnJob`, `NoonSession`, `webHeaders`.
- Produces: `CapturedExchange`, `SanitizedContractBundle`, `validateContractBundle`, `sanitizeExchange`, `bindOperation`, `ContractCapture`.

- [ ] **Step 1: Define and test a concrete contract schema**

The bundle contains operations `find`, `create`, and `details`. Each operation stores method, URL template, allowed header names, JSON body template, success statuses, and JSON response selectors:

```ts
interface ContractOperation {
  method: "GET" | "POST" | "PUT";
  urlTemplate: string;
  allowedHeaders: readonly string[];
  bodyTemplate?: unknown;
  successStatuses: readonly number[];
  response: {
    recordsPath?: string;
    asnNumberPaths: readonly string[];
    statusPaths: readonly string[];
    itemArrayPaths: readonly string[];
    skuPaths: readonly string[];
    quantityPaths: readonly string[];
  };
}
```

Supported template variables are exactly `${projectCode}`, `${partnerId}`, `${countryCode}`, `${locale}`, `${asnNumber}`, and `${itemsJson}`. Contract validation rejects literal Cookie/JWT/private-key values and unknown variables.

- [ ] **Step 2: Write sanitizer and replay failing tests**

Test that sanitizer replaces known project, partner, locale, country, ASN, SKU/quantity item arrays with variables, drops cookie/auth headers, and rejects a remaining credential-like value. Test replay binds synthetic fixtures to a job without mutating the bundle.

- [ ] **Step 3: Run tests to verify failure**

```powershell
npm.cmd test -- --run tests/contract-schema.test.ts tests/contract-replay.test.ts
```

Expected: FAIL because contract modules are absent.

- [ ] **Step 4: Implement capture, schema validation, and replay**

`ContractCapture` listens to Playwright `request`/`response` events only during named action windows (`find`, `create`, `details`). Raw authenticated evidence is written only to an ACL-restricted `%LOCALAPPDATA%\NoonASNCreator\capture\<run-id>` directory. `sanitizeExchange` produces a candidate bundle and runs the redaction scanner before any file is eligible for `contracts/`.

- [ ] **Step 5: Run contract tests**

```powershell
npm.cmd test -- --run tests/contract-schema.test.ts tests/contract-replay.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the generic capture/replay engine only**

```powershell
git add apps/noon-asn-creator/src/noon/contract-schema.ts apps/noon-asn-creator/src/noon/contract-loader.ts apps/noon-asn-creator/src/noon/contract-replay.ts apps/noon-asn-creator/src/browser/capture.ts apps/noon-asn-creator/tests/contract-schema.test.ts apps/noon-asn-creator/tests/contract-replay.test.ts apps/noon-asn-creator/tests/fixtures/contracts/synthetic.v1.json
git commit -m "feat: capture sanitized noon ASN contracts"
```

### Task 6: Implement exact server-side reconciliation and the API gateway

**Files:**
- Create: `apps/noon-asn-creator/src/noon/verifier.ts`
- Create: `apps/noon-asn-creator/src/noon/api-gateway.ts`
- Create: `apps/noon-asn-creator/tests/verifier.test.ts`
- Create: `apps/noon-asn-creator/tests/api-gateway.test.ts`

**Interfaces:**
- Consumes: `AsnGateway`, `AsnJob`, `AsnRecord`, `NoonSession`, `bindOperation`, `withRetry`.
- Produces: `normalizeItems`, `itemsExactlyMatch`, `reconcileUnique`, `ContractApiGateway`.

- [ ] **Step 1: Write failing verifier tests**

```ts
expect(itemsExactlyMatch(
  [{ partnerSku: "A", quantity: 2 }, { partnerSku: "B", quantity: 1 }],
  [{ partnerSku: "B", quantity: 1 }, { partnerSku: "A", quantity: 2 }],
)).toBe(true);
```

Cover missing items, extra items, quantity mismatch, duplicate response items, wrong project, zero matches, one match, and multiple matches.

- [ ] **Step 2: Write failing API gateway tests**

Use synthetic contract fixtures and mocked fetch to cover list/detail parsing, 401 refresh callback, 429 read retry, accepted create, timeout create returning `uncertain`, nonretryable 4xx, malformed JSON, and response-schema drift.

- [ ] **Step 3: Run tests and confirm failure**

```powershell
npm.cmd test -- --run tests/verifier.test.ts tests/api-gateway.test.ts
```

Expected: FAIL because verifier and gateway are absent.

- [ ] **Step 4: Implement exact matching and API calls**

Canonicalize items as sorted `SKU\u0000quantity` strings. `findMatches` may retry read-only calls. `create` performs one HTTP request and maps transport timeout/connection loss to `{ outcome: "uncertain" }`; it never invokes `withRetry`.

- [ ] **Step 5: Run focused tests**

```powershell
npm.cmd test -- --run tests/verifier.test.ts tests/api-gateway.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit gateway and verifier**

```powershell
git add apps/noon-asn-creator/src/noon/verifier.ts apps/noon-asn-creator/src/noon/api-gateway.ts apps/noon-asn-creator/tests/verifier.test.ts apps/noon-asn-creator/tests/api-gateway.test.ts
git commit -m "feat: reconcile noon ASN creation"
```

### Task 7: Implement visible Chrome fallback as a semantic state machine

**Files:**
- Create: `apps/noon-asn-creator/src/browser/chrome.ts`
- Create: `apps/noon-asn-creator/src/browser/cookies.ts`
- Create: `apps/noon-asn-creator/src/browser/selectors.ts`
- Create: `apps/noon-asn-creator/src/browser/fallback.ts`
- Create: `apps/noon-asn-creator/tests/browser-fallback.test.ts`
- Create: `apps/noon-asn-creator/tests/fixtures/web/server.ts`

**Interfaces:**
- Consumes: `AsnJob`, `NoonSession`, `AsnGateway`, `ContractCapture`, `itemsExactlyMatch`.
- Produces: `locateChrome`, `injectNoonCookies`, `BrowserAsnFallback.createAndVerify(job, session)`.

- [ ] **Step 1: Build a local deterministic Noon-like test server**

Expose fixture modes for delayed product table, spinner that never reaches network idle, login redirect, disabled Continue button, penalty modal, delayed success response, and generated ASN detail page. The fixture must use labels from the observed workflow: `Choose from Your Catalog`, `Continue`, `Penalty Warning`, `Agree & Proceed`.

- [ ] **Step 2: Write failing browser tests**

Test that fallback:

```ts
it("waits for the product table rather than networkidle");
it("selects rows by exact SKU text and fills quantities");
it("refreshes authentication after login redirect");
it("times out one job without blocking a second job");
it("opens capture windows around create/list/detail actions");
it("does not report success until server detail items exactly match");
```

Assert no `mouse.click(x, y)` or coordinate-based selector appears in `src/browser`.

- [ ] **Step 3: Run browser tests and confirm failure**

```powershell
npm.cmd test -- --run tests/browser-fallback.test.ts
```

Expected: FAIL because fallback modules are absent.

- [ ] **Step 4: Implement Chrome location, isolated context, and step runner**

Probe standard Chrome paths under Program Files and LocalAppData. Launch a visible persistent context under `%LOCALAPPDATA%\NoonASNCreator\browser-profile`. Parse the login Cookie header into `context.addCookies` entries scoped to `.noon.partners`.

The runner starts at:

```ts
const createUrl = `https://fbn.noon.partners/en-ae/asn/createasn?project=${job.projectCode}`;
```

Each step waits for a semantic locator or a relevant response, with an overall 90-second step timeout and at most one refresh/re-entry. On login redirect, close the context, refresh the API session, inject cookies, and resume from the pre-submit checkpoint.

- [ ] **Step 5: Run browser tests**

```powershell
npm.cmd test -- --run tests/browser-fallback.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit browser fallback**

```powershell
git add apps/noon-asn-creator/src/browser/chrome.ts apps/noon-asn-creator/src/browser/cookies.ts apps/noon-asn-creator/src/browser/selectors.ts apps/noon-asn-creator/src/browser/fallback.ts apps/noon-asn-creator/tests/browser-fallback.test.ts apps/noon-asn-creator/tests/fixtures/web/server.ts
git commit -m "feat: add recoverable ASN browser fallback"
```

### Task 8: Orchestrate per-file idempotency and folder-level continuation

**Files:**
- Create: `apps/noon-asn-creator/src/runner.ts`
- Create: `apps/noon-asn-creator/tests/runner.test.ts`

**Interfaces:**
- Consumes: workbook functions, `JournalStore`, `SessionManager`, `AsnGateway`, `BrowserAsnFallback`, `writeAsnNumber`.
- Produces: `runFile`, `runFolder`, `FileRunResult`, `FolderRunResult`.

- [ ] **Step 1: Write failing orchestration tests**

Cover these exact cases:

```ts
it("skips a workbook with C2 populated");
it("adopts one exact pre-existing server match without creating");
it("marks multiple matches needs_review without writing");
it("reconciles after uncertain create before any second create");
it("uses browser only after explicit API failure and zero matches");
it("stores confirmed ASN when Excel is locked and writes it on the next run");
it("continues remaining files after invalid input or failed creation");
it("refuses C2 write-back when the source fingerprint changed");
```

- [ ] **Step 2: Run tests and confirm failure**

```powershell
npm.cmd test -- --run tests/runner.test.ts
```

Expected: FAIL because runner is absent.

- [ ] **Step 3: Implement the safe ordering**

`runFile` order is fixed:

```ts
read workbook
-> skip existing C2
-> load/recover journal
-> if journal confirmed, write C2 only
-> authenticate
-> find exact matches
-> zero: create once; one: verify; multiple: needs_review
-> uncertain create: find exact matches, never immediate create
-> explicit API failure + zero matches: browser fallback
-> get details and exact-match verify
-> persist confirmed ASN
-> write and reopen workbook
-> persist written
```

`runFolder` processes sorted file names sequentially and catches errors per file.

- [ ] **Step 4: Run runner and all unit tests**

```powershell
npm.cmd test -- --run tests/runner.test.ts
npm.cmd test
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit runner**

```powershell
git add apps/noon-asn-creator/src/runner.ts apps/noon-asn-creator/tests/runner.test.ts
git commit -m "feat: orchestrate idempotent ASN jobs"
```

### Task 9: Add Windows folder launcher, executable entrypoint, and operator reporting

**Files:**
- Create: `apps/noon-asn-creator/src/launcher.ts`
- Create: `apps/noon-asn-creator/src/main.ts`
- Create: `apps/noon-asn-creator/tests/launcher.test.ts`
- Create: `apps/noon-asn-creator/docs/operations.md`

**Interfaces:**
- Consumes: `runFolder`, `FolderRunResult`, `JsonLogger`.
- Produces: `chooseFolder`, `formatSummary`, `main`.

- [ ] **Step 1: Write failing launcher tests**

Mock child-process execution and test selected folder, cancel, path with Chinese/spaces, PowerShell failure, and summary counts. Exit codes are fixed: `0` all processed/skipped successfully, `1` one or more file failures/needs-review, `2` configuration/input-folder error, `3` user canceled.

- [ ] **Step 2: Run the launcher test and confirm failure**

```powershell
npm.cmd test -- --run tests/launcher.test.ts
```

Expected: FAIL because launcher is absent.

- [ ] **Step 3: Implement the Windows folder dialog**

Invoke Windows PowerShell with `System.Windows.Forms.FolderBrowserDialog`, return the selected path over stdout as UTF-8, and distinguish cancel from process failure. Do not interpolate a user path into PowerShell source.

- [ ] **Step 4: Implement main and operations guide**

`main` checks credential directory and Chrome availability, calls the picker, runs the folder, prints a concise table, writes JSONL, and keeps the final console visible when launched by double-click until the user presses Enter. `docs/operations.md` documents credentials, C2 behavior, statuses, recovery, logs, and safe rerun.

- [ ] **Step 5: Run tests and a source-mode dry launch**

```powershell
npm.cmd test -- --run tests/launcher.test.ts
npm.cmd run typecheck
npm.cmd run build
node .\dist\src\main.js --folder-cancel-test
```

Expected: tests PASS, build succeeds, cancel-test exits `3` without changing workbooks.

- [ ] **Step 6: Commit launcher and docs**

```powershell
git add apps/noon-asn-creator/src/launcher.ts apps/noon-asn-creator/src/main.ts apps/noon-asn-creator/tests/launcher.test.ts apps/noon-asn-creator/docs/operations.md
git commit -m "feat: add Windows ASN creator launcher"
```

### Task 10: Run the controlled live contract capture and promote the verified API bundle

**Files:**
- Create: `apps/noon-asn-creator/contracts/noon-uae-asn.v1.json`
- Create: `apps/noon-asn-creator/tests/fixtures/contracts/noon-uae-asn.v1.sanitized.json`
- Modify: `apps/noon-asn-creator/tests/api-gateway.test.ts`
- Create: `apps/noon-asn-creator/docs/live-acceptance.md`

**Interfaces:**
- Consumes: Browser fallback, `ContractCapture`, sanitizer, API gateway, one user-authorized small real workbook copy.
- Produces: A credential-free validated `noon-uae-asn.v1` bundle supporting `find`, `create`, and `details`.

- [ ] **Step 1: Build and run all offline gates before any live side effect**

```powershell
cd D:\codex\stock_auto\apps\noon-asn-creator
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 2: Select the smallest authorized workbook and make a protected acceptance copy**

Copy one SKU-small workbook to `%TEMP%\NoonASNCreatorAcceptance\`. Compute and record its SHA-256 and initial `C2` state in the local acceptance log. Do not commit this workbook.

- [ ] **Step 3: Run capture mode for one real ASN creation**

```powershell
node .\dist\src\main.js --capture-contract --folder "$env:TEMP\NoonASNCreatorAcceptance"
```

Expected: visible Chrome performs one authorized creation, Noon shows a generated ASN, the server detail matches all SKUs/quantities, and the copied workbook receives the ASN in `C2`.

- [ ] **Step 4: Sanitize and inspect the captured operations**

Run the built-in promotion command. The literal `latest` resolves the most recent completed capture directory:

```powershell
node .\dist\src\main.js --promote-capture latest --out .\contracts\noon-uae-asn.v1.json
```

Expected: bundle validation succeeds; a recursive scan finds no `PRIVATE KEY`, JWT-shaped token, `Cookie`, `set-cookie`, raw project-specific ASN, or untemplated business SKU.

- [ ] **Step 5: Add the sanitized bundle fixture and API-first regression assertions**

Copy the sanitized structural fixture with fake IDs/SKUs into tests and assert all three operations bind and parse. The test must make `BrowserAsnFallback.createAndVerify` throw if called, proving the API path handles the fixture.

- [ ] **Step 6: Verify idempotency against the same acceptance copy**

Run the normal command twice against the same acceptance directory. Expected: both runs skip the populated `C2`; Noon ASN count does not increase.

- [ ] **Step 7: Delete raw authenticated capture after promotion and document evidence**

Record ASN number in redacted form, project/store index, item count, server verification result, C2 result, rerun result, and raw-capture deletion confirmation in `docs/live-acceptance.md`. Never include SKU values or credentials.

- [ ] **Step 8: Commit only sanitized contract and acceptance evidence**

```powershell
git add apps/noon-asn-creator/contracts/noon-uae-asn.v1.json apps/noon-asn-creator/tests/fixtures/contracts/noon-uae-asn.v1.sanitized.json apps/noon-asn-creator/tests/api-gateway.test.ts apps/noon-asn-creator/docs/live-acceptance.md
git commit -m "feat: promote verified noon ASN API contract"
```

### Task 11: Package and verify the Windows EXE

**Files:**
- Create: `apps/noon-asn-creator/scripts/build-exe.mjs`
- Create: `apps/noon-asn-creator/scripts/smoke-exe.ps1`
- Create: `apps/noon-asn-creator/tests/package.test.ts`
- Modify: `apps/noon-asn-creator/package.json`
- Modify: `apps/noon-asn-creator/docs/operations.md`

**Interfaces:**
- Consumes: compiled `dist/src/main.js`, embedded sanitized contract, installed Chrome only for fallback.
- Produces: `release/NoonASNCreator/NoonASNCreator.exe` and operator documentation.

- [ ] **Step 1: Write failing packaging tests**

Test package metadata includes the entry script and contract asset. Test `build-exe.mjs --dry-run` prints the exact `@yao-pkg/pkg` target and output path without executing packaging.

- [ ] **Step 2: Run packaging test and confirm failure**

```powershell
npm.cmd test -- --run tests/package.test.ts
```

Expected: FAIL because packaging scripts are absent.

- [ ] **Step 3: Implement repeatable packaging**

Build TypeScript, copy the sanitized contract into the staged application, invoke `pkg` for `node22-win-x64`, and write to `release\NoonASNCreator\NoonASNCreator.exe`. Fail if the contract bundle is missing or does not pass validation. Include `LICENSES.txt` and `操作说明.txt`; never copy credential files.

- [ ] **Step 4: Implement packaged smoke test**

`smoke-exe.ps1` creates a synthetic already-completed workbook with fake `C2`, clears `PATH` of Node locations for the child process, runs:

```powershell
.\release\NoonASNCreator\NoonASNCreator.exe --folder "$tempFixture" --non-interactive
```

Expected: exit `0`, reports one skipped workbook, does not start Chrome, and leaves the workbook unchanged.

- [ ] **Step 5: Run full offline and packaging verification**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package:win
powershell.exe -ExecutionPolicy Bypass -File .\scripts\smoke-exe.ps1
```

Expected: all PASS and EXE exists.

- [ ] **Step 6: Run a clean-environment manual EXE check**

On Windows x64 without Node.js on `PATH`, double-click the EXE, cancel the folder picker, and confirm clean cancel behavior. Then select a fixture folder containing only completed/invalid synthetic workbooks and confirm correct summary without Noon side effects.

- [ ] **Step 7: Commit packaging**

Do not commit the generated EXE unless the repository release policy explicitly requires binaries. Commit scripts, tests, package metadata, lockfile, and docs:

```powershell
git add apps/noon-asn-creator/scripts/build-exe.mjs apps/noon-asn-creator/scripts/smoke-exe.ps1 apps/noon-asn-creator/tests/package.test.ts apps/noon-asn-creator/package.json apps/noon-asn-creator/package-lock.json apps/noon-asn-creator/docs/operations.md
git commit -m "build: package noon ASN creator for Windows"
```

### Task 12: Final full-folder acceptance and completion audit

**Files:**
- Modify: `apps/noon-asn-creator/docs/live-acceptance.md`
- Modify: `apps/noon-asn-creator/docs/operations.md`

**Interfaces:**
- Consumes: packaged EXE, user-selected real folder, verified contract, all test evidence.
- Produces: requirement-by-requirement acceptance evidence and final operator handoff.

- [ ] **Step 1: Back up the selected real input directory**

Create a dated backup outside the input directory. Record file count, filenames, SHA-256 values, store distribution, and which files already have `C2`. Do not commit workbook contents or hashes tied to credentials.

- [ ] **Step 2: Run the packaged EXE on the real directory**

Select the directory through the actual folder dialog. Expected: each valid blank-C2 file reaches `written` or an explicit per-file failure; later files continue after any failure.

- [ ] **Step 3: Reconcile every reported success**

For each successful file, query Noon details and compare project, complete SKU set, and all quantities. Reopen every workbook and confirm `C2` matches. Check that no other sampled workbook value/formula/style differs from backup.

- [ ] **Step 4: Repeat-run duplicate audit**

Run the same folder again. Expected: all successful workbooks are `skipped_existing`, zero create requests occur, and Noon ASN count is unchanged.

- [ ] **Step 5: Run final automated gates**

```powershell
cd D:\codex\stock_auto\apps\noon-asn-creator
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package:win
powershell.exe -ExecutionPolicy Bypass -File .\scripts\smoke-exe.ps1
git diff --check
git status --short
```

Expected: all checks pass; status shows only known pre-existing user changes plus intentional acceptance documentation changes.

- [ ] **Step 6: Complete the acceptance matrix**

In `docs/live-acceptance.md`, map each of the 12 design acceptance criteria to command output, test name, file inspection, or live Noon verification. Mark unproven criteria as incomplete and continue work; do not infer completion.

- [ ] **Step 7: Commit acceptance documentation**

```powershell
git add apps/noon-asn-creator/docs/live-acceptance.md apps/noon-asn-creator/docs/operations.md
git commit -m "docs: record ASN creator acceptance"
```

---

## Plan Self-Review Checklist

- Every design acceptance criterion maps to Tasks 1-12.
- The uncertain-create path reconciles before retry in Tasks 6 and 8.
- Browser fallback, login refresh, long-load behavior, and semantic selectors are covered in Task 7.
- C2-only preservation and source-change protection are covered in Task 2.
- One-file failure continuation and rerun behavior are covered in Task 8.
- The live contract is captured, sanitized, validated, and raw evidence deleted in Task 10.
- EXE packaging without Node.js and installed-Chrome fallback are covered in Task 11.
- Full live-folder and duplicate audits are mandatory in Task 12.
