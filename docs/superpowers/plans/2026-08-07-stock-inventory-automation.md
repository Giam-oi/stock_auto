# UAE/KSA Stock Inventory Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a Power Automate + Office Scripts solution that backs up and updates the UAE and KSA SharePoint inventory workbooks from six daily CSV files per site.

**Architecture:** A single Office Script owns CSV parsing, `saleable` aggregation, workbook layout discovery, snapshot rotation, zero-stock retention, and batched writes. A scheduled Power Automate flow handles daily backup, cloud-file discovery, and invocation at 09:00; a manual flow accepts test source and target paths while calling the same script. Pure TypeScript helpers are locally unit-tested, and a generated deployable script removes test-only exports.

**Tech Stack:** TypeScript, Office Scripts Excel API, Node.js, Vitest, Power Automate, OneDrive for Business, SharePoint Online

## Global Constraints

- The production flow runs every day at `09:00` in timezone `Asia/Shanghai`.
- Backup is the first task for each site and runs even when the daily CSV set is missing.
- Existing same-day backups are kept unchanged and skipped.
- UAE input root is `库存文件/UAE`; files are `UAE1.YYYYMMDD.csv` through `UAE6.YYYYMMDD.csv`.
- KSA input root is `库存文件/KSA`; files are `SA1.YYYYMMDD.csv` through `SA6.YYYYMMDD.csv`.
- File numbers `1` through `6` map to worksheets `店铺1` through `店铺6`.
- Only rows whose trimmed, case-normalized `inventory_type` equals `saleable` are included.
- Inventory is grouped by trimmed text `partner_sku` and summed from numeric `qty`.
- A SKU present in the previous snapshot but absent from the new `saleable` data is retained with quantity `0` and is therefore sold out.
- New SKUs are appended to the current inventory snapshot.
- UAE target remains `.xlsm`; KSA target remains `.xlsx`; VBA is never executed.
- Any backup, source, schema, parsing, workbook-layout, lock, timeout, or write error stops that site.
- UAE and KSA are isolated: failure in one site does not stop the other.
- No separate result-validation report is generated; Power Automate run history is the operating record.
- Production and manual test flows invoke the same Office Script and business rules.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Local build and test commands. |
| `tsconfig.json` | Strict TypeScript settings for pure logic and Office Script source. |
| `office-scripts/excel-script.d.ts` | Minimal local declarations for the ExcelScript APIs used by tests and compilation. |
| `office-scripts/update-inventory.ts` | Single source for pure domain helpers and Office Script `main`. |
| `scripts/build-office-script.mjs` | Produces a deployable script with test-only exports removed. |
| `dist/update-inventory.office-script.ts` | Generated script pasted into Office Scripts. |
| `tests/site-config.test.ts` | Site naming, store mapping, and backup-name tests. |
| `tests/csv.test.ts` | CSV parsing and schema-validation tests. |
| `tests/inventory.test.ts` | `saleable`, aggregation, zero-stock, and new-SKU tests. |
| `tests/workbook.test.ts` | Workbook block discovery and batched snapshot-write tests using mocks. |
| `tests/fixtures/*.csv` | Sanitized CSV fixtures with no production SKUs or business data. |
| `power-automate/production-flow.md` | Exact scheduled-flow construction and expressions. |
| `power-automate/manual-test-flow.md` | Exact manual-flow inputs and action configuration. |
| `power-automate/deployment-checklist.md` | Office Script deployment, connection, copy-test, and production-switch checklist. |
| `docs/operations.md` | Daily operation, failure interpretation, and backup recovery runbook. |

---

### Task 1: Establish the TypeScript Harness and Site Contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `office-scripts/excel-script.d.ts`
- Create: `office-scripts/update-inventory.ts`
- Create: `tests/site-config.test.ts`

**Interfaces:**
- Produces: `SiteCode`, `SiteConfig`, `SITE_CONFIGS`, `expectedSourceNames()`, and `backupFileName()` used by all later tasks.

- [ ] **Step 1: Write the failing site-contract tests**

```ts
import { describe, expect, it } from "vitest";
import { backupFileName, expectedSourceNames, SITE_CONFIGS } from "../office-scripts/update-inventory";

describe("site contracts", () => {
  it("maps UAE files to six stores", () => {
    expect(expectedSourceNames("UAE", "2026-08-07")).toEqual([
      "UAE1.20260807.csv", "UAE2.20260807.csv", "UAE3.20260807.csv",
      "UAE4.20260807.csv", "UAE5.20260807.csv", "UAE6.20260807.csv",
    ]);
    expect(SITE_CONFIGS.UAE.storeSheets).toEqual(["店铺1", "店铺2", "店铺3", "店铺4", "店铺5", "店铺6"]);
  });

  it("uses SA prefix and KSA backup punctuation", () => {
    expect(expectedSourceNames("KSA", "2025-12-09")[0]).toBe("SA1.20251209.csv");
    expect(backupFileName("KSA", "2026-08-07")).toBe("2.1 SA Orders & Stock V2025 7-0807.xlsx");
  });

  it("uses UAE backup punctuation and extension", () => {
    expect(backupFileName("UAE", "2026-08-07")).toBe("2.2_UAE_Orders_&_Stock_V2025_7 0807.xlsm");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/site-config.test.ts`

Expected: FAIL because `package.json` and `update-inventory.ts` do not exist.

- [ ] **Step 3: Add the minimal harness and contracts**

Create `package.json` with scripts `test`, `typecheck`, and `build:office-script`; add dev dependencies `typescript`, `vitest`, and `tsx`.

Define these exact contracts in `office-scripts/update-inventory.ts`:

```ts
export type SiteCode = "UAE" | "KSA";

export interface SiteConfig {
  sourcePrefix: "UAE" | "SA";
  sourceRoot: string;
  storeSheets: readonly string[];
  backupPrefix: string;
  backupSeparator: " " | "-";
  targetExtension: ".xlsm" | ".xlsx";
}

export const SITE_CONFIGS: Record<SiteCode, SiteConfig> = {
  UAE: {
    sourcePrefix: "UAE",
    sourceRoot: "库存文件/UAE",
    storeSheets: ["店铺1", "店铺2", "店铺3", "店铺4", "店铺5", "店铺6"],
    backupPrefix: "2.2_UAE_Orders_&_Stock_V2025_7",
    backupSeparator: " ",
    targetExtension: ".xlsm",
  },
  KSA: {
    sourcePrefix: "SA",
    sourceRoot: "库存文件/KSA",
    storeSheets: ["店铺1", "店铺2", "店铺3", "店铺4", "店铺5", "店铺6"],
    backupPrefix: "2.1 SA Orders & Stock V2025 7",
    backupSeparator: "-",
    targetExtension: ".xlsx",
  },
};
```

Implement `expectedSourceNames(site, isoDate)` and `backupFileName(site, isoDate)` by validating `YYYY-MM-DD`, removing hyphens for source filenames, and using `MMDD` for backups.

- [ ] **Step 4: Run tests and type checking**

Run: `npm install && npm test -- tests/site-config.test.ts && npm run typecheck`

Expected: all site-contract tests PASS and TypeScript exits `0`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json office-scripts tests/site-config.test.ts
git commit -m "build: establish inventory automation contracts"
```

---

### Task 2: Parse CSV Safely and Reject Invalid Input

**Files:**
- Modify: `office-scripts/update-inventory.ts`
- Create: `tests/csv.test.ts`
- Create: `tests/fixtures/quoted.csv`
- Create: `tests/fixtures/missing-qty.csv`

**Interfaces:**
- Consumes: `SiteCode` from Task 1.
- Produces: `parseCsv(text): string[][]` and `parseInventoryCsv(text, fileName): InventoryRow[]`.

- [ ] **Step 1: Add failing parser tests**

Test BOM handling, CRLF/LF, escaped quotes, commas inside quoted titles, blank files, duplicate headers, and missing required headers. Use sanitized rows such as SKU `SKU-A` and title `Sample, item`.

```ts
expect(parseCsv('\uFEFFa,b\r\n"x,y","z""q"')).toEqual([
  ["a", "b"],
  ["x,y", 'z"q'],
]);
expect(() => parseInventoryCsv("partner_sku,inventory_type\nSKU-A,saleable", "UAE1.20260807.csv"))
  .toThrow("missing required header: qty");
```

- [ ] **Step 2: Verify the parser tests fail**

Run: `npm test -- tests/csv.test.ts`

Expected: FAIL because `parseCsv` and `parseInventoryCsv` are not defined.

- [ ] **Step 3: Implement a state-machine CSV parser**

Implement character-by-character parsing with states `inQuotes`, `field`, `row`, and `rows`. Treat `""` inside quoted fields as a literal quote. Reject unclosed quotes and rows wider than the header. Normalize the first header by removing BOM.

Define:

```ts
export interface InventoryRow {
  inventoryType: string;
  partnerSku: string;
  qtyRaw: string;
  sourceFile: string;
  sourceRow: number;
}
```

`parseInventoryCsv` must locate headers by exact trimmed names and return only these fields while retaining source row metadata for error messages.

- [ ] **Step 4: Run parser tests**

Run: `npm test -- tests/csv.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add office-scripts/update-inventory.ts tests/csv.test.ts tests/fixtures
git commit -m "feat: parse and validate inventory CSV files"
```

---

### Task 3: Aggregate Saleable Inventory and Merge Zero-Stock SKUs

**Files:**
- Modify: `office-scripts/update-inventory.ts`
- Create: `tests/inventory.test.ts`

**Interfaces:**
- Consumes: `InventoryRow` from Task 2.
- Produces: `aggregateSaleable(rows): InventoryEntry[]` and `mergeWithPrevious(current, previous): InventoryEntry[]`.

- [ ] **Step 1: Add failing business-rule tests**

Cover these exact cases:

- `saleable` values are matched after trimming and case normalization.
- Non-saleable rows are excluded.
- Duplicate `partner_sku` rows are summed.
- SKU values remain text.
- Blank SKU, non-finite quantity, or negative quantity throws an error containing file and row.
- A previous SKU missing from current data is retained with `qty: 0`.
- A new current SKU is appended.

```ts
expect(mergeWithPrevious(
  [{ sku: "SKU-NEW", qty: 3 }],
  [{ sku: "SKU-OLD", qty: 8 }],
)).toEqual([
  { sku: "SKU-NEW", qty: 3 },
  { sku: "SKU-OLD", qty: 0 },
]);
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- tests/inventory.test.ts`

Expected: FAIL because the aggregation functions do not exist.

- [ ] **Step 3: Implement aggregation and zero-stock merging**

Define:

```ts
export interface InventoryEntry { sku: string; qty: number }
```

Use `Map<string, number>` for grouping. Preserve current SKU order by first appearance, then append missing previous SKUs in their previous order with quantity `0`.

- [ ] **Step 4: Run all pure-domain tests**

Run: `npm test -- tests/site-config.test.ts tests/csv.test.ts tests/inventory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add office-scripts/update-inventory.ts tests/inventory.test.ts
git commit -m "feat: aggregate saleable inventory snapshots"
```

---

### Task 4: Discover Workbook Blocks and Rotate Snapshots

**Files:**
- Modify: `office-scripts/excel-script.d.ts`
- Modify: `office-scripts/update-inventory.ts`
- Create: `tests/workbook.test.ts`

**Interfaces:**
- Consumes: `InventoryEntry[]`, `SiteConfig.storeSheets`.
- Produces: `discoverStoreLayout(worksheet): StoreLayout` and `updateStoreSheet(worksheet, entries, runDate): StoreUpdateSummary`.

- [ ] **Step 1: Add failing workbook-layout tests with in-memory mocks**

Create minimal mock workbook, worksheet, used range, and range classes supporting only the methods used by the script. Test:

- Exact worksheets `店铺1` through `店铺6` are required.
- Two `FBN现有SKU` headers and paired `剩余数量` headers are found.
- The previous block is the pair associated with `上次更新库存状态:`.
- Header ambiguity or missing date cell throws before any `setValues` call.
- Current values and date are copied to the previous block before new values are written.
- Existing current rows are cleared without clearing headers.
- Batched `setValues` calls write the union of current and previous SKUs.

- [ ] **Step 2: Verify the workbook tests fail**

Run: `npm test -- tests/workbook.test.ts`

Expected: FAIL because workbook functions are missing.

- [ ] **Step 3: Implement deterministic layout discovery**

Define:

```ts
export interface CellRef { row: number; column: number }
export interface StoreLayout {
  currentSkuHeader: CellRef;
  currentQtyHeader: CellRef;
  currentDateCell: CellRef;
  previousSkuHeader: CellRef;
  previousQtyHeader: CellRef;
  previousDateCell: CellRef;
}
```

Read the used range text once. Locate exact header labels. Identify the previous pair by proximity to `上次更新库存状态:` and require the second pair to be unique. Require quantity headers immediately adjacent to SKU headers. All discovery must complete for all six sheets before any worksheet is changed.

- [ ] **Step 4: Implement snapshot rotation and batched writes**

For each sheet:

1. Read current SKU/qty values below the current headers.
2. Read the current date.
3. Calculate the new union with zero-stock previous SKUs.
4. Write the old current values and date to the previous block.
5. Clear old data cells only.
6. Write new current values and the run date with one `setValues` per block.

Do not alter formulas or cells outside the discovered snapshot columns.

- [ ] **Step 5: Run workbook and full unit tests**

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add office-scripts/update-inventory.ts office-scripts/excel-script.d.ts tests/workbook.test.ts
git commit -m "feat: rotate and update store inventory snapshots"
```

---

### Task 5: Implement Office Script Entry Point and Build Artifact

**Files:**
- Modify: `office-scripts/update-inventory.ts`
- Create: `scripts/build-office-script.mjs`
- Create: `tests/main.test.ts`
- Generate: `dist/update-inventory.office-script.ts`

**Interfaces:**
- Consumes: all pure helpers and workbook functions from Tasks 1–4.
- Produces: `main(workbook, site, runDateIso, csvTexts, sourceNames): UpdateResult` and the deployable `dist` artifact.

- [ ] **Step 1: Add failing entry-point tests**

Test exact parameter lengths, source filename order, ISO date validation, all-input validation before write, site isolation metadata, and returned summary.

```ts
export interface UpdateResult {
  site: SiteCode;
  runDate: string;
  storesUpdated: number;
  skuCounts: number[];
}
```

Require `csvTexts.length === 6`, `sourceNames` to equal `expectedSourceNames(site, runDateIso)`, and `storesUpdated === 6` on success.

- [ ] **Step 2: Verify the entry-point tests fail**

Run: `npm test -- tests/main.test.ts`

Expected: FAIL because `main` is incomplete.

- [ ] **Step 3: Implement `main`**

The entry point must parse and aggregate all six files, discover all six workbook layouts, and only then call `updateStoreSheet` for each store. No writes are allowed during parsing or discovery.

- [ ] **Step 4: Implement the build script**

`scripts/build-office-script.mjs` reads `office-scripts/update-inventory.ts`, removes test-only `export` keywords, writes `dist/update-inventory.office-script.ts`, and fails if the output lacks exactly one `function main(` declaration.

- [ ] **Step 5: Verify tests and artifact**

Run: `npm test && npm run typecheck && npm run build:office-script`

Expected: tests PASS; `dist/update-inventory.office-script.ts` exists and contains no `import` or `export` statements.

- [ ] **Step 6: Commit**

```bash
git add office-scripts/update-inventory.ts scripts tests/main.test.ts dist
git commit -m "feat: produce deployable inventory Office Script"
```

---

### Task 6: Document and Deploy the Shared Office Script

**Files:**
- Create: `power-automate/deployment-checklist.md`
- Create: `docs/operations.md`

**Interfaces:**
- Consumes: `dist/update-inventory.office-script.ts` from Task 5.
- Produces: a deployed Office Script named `Update UAE KSA Inventory` callable by both flows.

- [ ] **Step 1: Write the deployment checklist**

Include exact steps to open Excel on the web, create a new Office Script, paste the `dist` artifact, save it as `Update UAE KSA Inventory`, and record its owner and SharePoint/OneDrive script location.

- [ ] **Step 2: Deploy the script using a test workbook copy**

Use the connected Microsoft 365 account. Select a copied UAE or KSA workbook, call the script manually with six sanitized CSV strings, and confirm the script reports six updated stores.

- [ ] **Step 3: Inspect the test workbook**

Confirm snapshot headers remain unchanged, prior current inventory moved to the previous block, dates rotated correctly, missing old SKUs became zero, and new fake SKUs were appended. Restore or delete the test copy after inspection.

- [ ] **Step 4: Record deployment details and commit**

```bash
git add power-automate/deployment-checklist.md docs/operations.md
git commit -m "docs: add Office Script deployment procedure"
```

---

### Task 7: Build the Manual Test Power Automate Flow

**Files:**
- Create: `power-automate/manual-test-flow.md`

**Interfaces:**
- Consumes: deployed `Update UAE KSA Inventory` script.
- Produces: instant cloud flow `Inventory Update - Manual Test`.

- [ ] **Step 1: Define exact trigger inputs**

Document and create these manual-trigger inputs:

- `Site`: choice `UAE` or `KSA`.
- `SourceDate`: date in `YYYY-MM-DD`.
- `SourceFolderPath`: OneDrive folder path selected/copied by the tester.
- `TargetWorkbookPath`: SharePoint or OneDrive target-copy path selected/copied by the tester.
- `TestBackupFolderPath`: backup folder for that target copy.

- [ ] **Step 2: Add backup-first actions**

Construct backup name with `MMDD` and the site rules. Ensure the `YYYY.MM` folder exists. Query for the same-day backup; copy only when absent. Configure backup failure to terminate the flow with status `Failed`.

- [ ] **Step 3: Add six-file discovery and validation actions**

Build the expected filename array from `Site` and `SourceDate`. List the chosen folder once, filter to exact names, and terminate when the count is not six. Retrieve each file by identifier in index order and convert content to UTF-8 text.

- [ ] **Step 4: Invoke the Office Script once**

Configure `Run script` with the selected target file identifier and parameters:

- `site`: trigger `Site`.
- `runDateIso`: trigger `SourceDate`.
- `csvTexts`: ordered array of six decoded CSV strings.
- `sourceNames`: ordered expected-name array.

Disable automatic retries on the script action so a timeout cannot repeat a partial workbook write.

- [ ] **Step 5: Test UAE and KSA copies**

Run the flow once with the OneDrive-synced `库存文件/UAE/2026-08-07` folder and once with a sanitized KSA test folder in OneDrive. Confirm the source files are untouched and only the selected workbook copies change.

- [ ] **Step 6: Commit the flow definition document**

```bash
git add power-automate/manual-test-flow.md
git commit -m "docs: define manual inventory test flow"
```

---

### Task 8: Build the 09:00 Production Power Automate Flow

**Files:**
- Create: `power-automate/production-flow.md`
- Modify: `docs/operations.md`

**Interfaces:**
- Consumes: deployed Office Script and validated manual-flow action pattern.
- Produces: scheduled cloud flow `Inventory Update - UAE KSA - 09h00`.

- [ ] **Step 1: Add the recurrence trigger**

Set frequency `Day`, interval `1`, timezone `China Standard Time`, and start time `09:00`. Disable overlapping runs by setting trigger concurrency to `1`.

- [ ] **Step 2: Add independent UAE and KSA parallel branches**

Create parallel branches containing `Scope - UAE` and `Scope - KSA`. Each scope contains backup, source validation, six-file retrieval, and one script invocation. Do not use a flow-level `Terminate` action inside either branch; a failed or skipped UAE branch must not cancel KSA, and vice versa.

- [ ] **Step 3: Make backup the first action in each scope**

Use configured formal target identifiers and archive roots. Create/find `YYYY.MM`; copy with the exact backup name only when absent. No CSV-related action may precede this backup scope.

- [ ] **Step 4: Add current-date source discovery**

Build current date with:

```text
formatDateTime(convertTimeZone(utcNow(),'UTC','China Standard Time'),'yyyy-MM-dd')
```

Use the site root plus this date. Require six exact files; do not search earlier folders and do not retry with old data.

- [ ] **Step 5: Invoke the script and set failure behavior**

Pass the six ordered CSV texts and expected names. Disable retries on `Run script`. Route validation failures to a site-local error action and skip that branch's script action. Allow action failures to mark only their branch as failed while the parallel site branch continues.

- [ ] **Step 6: Run a scheduled-flow dry run against formal-file copies**

Temporarily point both target identifiers to copies, trigger the flow manually, and confirm backup precedes source discovery in run history. Confirm missing source files still leave a backup and prevent workbook updates.

- [ ] **Step 7: Commit the flow definition document**

```bash
git add power-automate/production-flow.md docs/operations.md
git commit -m "docs: define scheduled UAE KSA inventory flow"
```

---

### Task 9: Production Acceptance and Cutover

**Files:**
- Modify: `power-automate/deployment-checklist.md`
- Modify: `docs/operations.md`

**Interfaces:**
- Consumes: test and production flows from Tasks 7–8.
- Produces: enabled production automation and an operator recovery procedure.

- [ ] **Step 1: Run acceptance cases on copies**

Execute and record these cases in the checklist:

1. Existing backup: backup is skipped, update continues.
2. Missing one CSV: backup succeeds, workbook is unchanged.
3. Invalid `qty`: site stops before workbook writes.
4. Non-saleable row: quantity is excluded.
5. Duplicate saleable SKU: quantities are summed.
6. Previous-only SKU: current quantity becomes zero.
7. New SKU: row appears in current snapshot.
8. UAE failure: KSA still executes.
9. Locked target: site stops and run history shows the lock error.

- [ ] **Step 2: Verify workbook-format compatibility**

Run against one `.xlsm` UAE copy and one `.xlsx` KSA copy. Confirm UAE macros remain embedded but never execute, and formulas/formatting outside snapshot blocks remain unchanged.

- [ ] **Step 3: Switch the production flow to formal targets**

Use the Power Automate file picker to select the exact formal UAE and KSA SharePoint workbooks. Keep the manual flow pointed at copies by default.

- [ ] **Step 4: Enable the schedule and observe the first 09:00 run**

Verify both monthly backup filenames, each site run result, and SharePoint version history. If a write-stage failure occurs, disable the flow and restore the corresponding same-day backup according to `docs/operations.md`.

- [ ] **Step 5: Run final local verification**

Run: `npm test && npm run typecheck && npm run build:office-script && git status --short`

Expected: all tests PASS, build succeeds, and the worktree has only the intended operations/checklist updates.

- [ ] **Step 6: Commit final deployment state**

```bash
git add power-automate/deployment-checklist.md docs/operations.md
git commit -m "docs: complete inventory automation cutover"
```
