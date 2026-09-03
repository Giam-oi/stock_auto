# UAE GRN Workbook Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a verified macro-enabled workbook copy on drive D containing every missing UAE GRN Completed ASN created from 2026-07-01 through 2026-08-12.

**Architecture:** Use authenticated Noon read-only endpoints to build a normalized JSON manifest, then patch only the copied XLSM worksheet XML parts while preserving all macro and unrelated package parts. Verify the package and data independently after writing.

**Tech Stack:** Node.js 24, existing Noon authentication modules, JSZip, OOXML, bundled spreadsheet renderer when feasible.

## Global Constraints

- Do not modify the OneDrive source workbook.
- Output must remain `.xlsm` and retain VBA.
- Operate only on UAE stores 1–6.
- Date filtering and output date both use ASN creation time.
- Append only ASNs absent from the corresponding store sheet.

---

### Task 1: Build the normalized missing-ASN manifest

**Files:**
- Create: `.tmp-artifact-runtime/uae-grn-backfill.json`

**Interfaces:**
- Consumes: Noon credentials and existing ASN inventory extracted from the source workbook.
- Produces: per-store ASN, created date, partner SKU, requested quantity, admitted quantity, rejected quantity, and reason.

- [ ] Fetch all GRN Completed list pages for each store.
- [ ] Filter by ASN `created_at` within the approved date window.
- [ ] Remove ASNs already present in the matching workbook sheet.
- [ ] Fetch and normalize detail data for every missing ASN.
- [ ] Reconcile requested quantity with admitted plus rejected/short quantities.

### Task 2: Create and patch the D-drive XLSM copy

**Files:**
- Create: `D:/2.2_UAE_Orders_&_Stock_V2025_7_GRN补充_20260812.xlsm`

**Interfaces:**
- Consumes: normalized manifest from Task 1.
- Produces: macro-preserving workbook copy with appended rows in 店铺1–店铺6.

- [ ] Copy the source workbook to the final D-drive path.
- [ ] Append rows using each sheet's existing column and style conventions.
- [ ] Merge Date and ASN cells for multi-SKU ASNs where the source convention does so.
- [ ] Save the patched OOXML package without changing unrelated parts.

### Task 3: Verify package preservation and workbook content

**Files:**
- Verify: `D:/2.2_UAE_Orders_&_Stock_V2025_7_GRN补充_20260812.xlsm`

**Interfaces:**
- Consumes: source workbook, output workbook, normalized manifest.
- Produces: validation evidence and discrepancy-free completion report.

- [ ] Confirm the output is a valid ZIP/OOXML package.
- [ ] Confirm VBA project bytes and unrelated package parts match the source.
- [ ] Re-extract all six sheets and confirm each missing ASN appears exactly once.
- [ ] Confirm all written dates, SKUs, Qty, Status, and rejection notes match the manifest.
- [ ] Render representative appended ranges for visual inspection when supported.
