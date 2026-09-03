# Cloud Output Verification

Verification date: 2026-08-13 (Asia/Shanghai)

Method: signed-in Microsoft Edge only. SharePoint folders were inspected without changing or deleting files. Both formal workbooks were opened in Excel for the web and explicitly put in **Viewing** (`正在查看`) mode before cell inspection.

## Result

PASS. The exact KSA and UAE backups exist once in their required history folders, both formal workbooks contain the expected marker dates on `店铺1` through `店铺6`, and no same-day backup-name variants are present in either history folder.

## Backup files

### KSA

- Folder: `/Shared Documents/2.0 中东/1.1 Noon/1.3 运营日常资料/1. KSA资料/1. 出入库/2. 库存表/2026.08`
- Exact file: `2.1 SA Orders & Stock V2025 7-0813.xlsx`
- SharePoint details-pane size: **20.4 MB** (rounded display value)
- SharePoint details-pane modified: **8/13/2026 10:03 AM**
- SharePoint details-pane created: **8/12/2026 07:03 PM**
- The folder list's modified-time column is explicitly labelled `(UTC-08:00) Pacific Time (US & Canada)` and its exact tooltip is **8/12/2026 7:03 PM (UTC-08:00)**.
- The complete visible `0813` filename set contains exactly one item: `2.1 SA Orders & Stock V2025 7-0813.xlsx`.

### UAE

- Folder: `/Shared Documents/2.0 中东/1.1 Noon/1.3 运营日常资料/2. UAE资料/2. 库存/2026/2026.08`
- Exact file: `2.2_UAE_Orders_&_Stock_V2025_7 0813.xlsm`
- SharePoint details-pane size: **12.5 MB** (rounded display value)
- SharePoint details-pane modified: **8/13/2026 06:52 PM**
- SharePoint details-pane created: **8/13/2026 03:52 AM**
- The folder list's modified-time column is explicitly labelled `(UTC-08:00) Pacific Time (US & Canada)` and its exact tooltip is **8/13/2026 3:52 AM (UTC-08:00)**.
- The complete visible `0813` filename set contains exactly one item: `2.2_UAE_Orders_&_Stock_V2025_7 0813.xlsm`.

The details pane does not label its timezone. Its displayed modified values are therefore recorded verbatim rather than interpreted; the list tooltip above is the unambiguous timezone-labelled evidence.

## Formal workbooks

Formal folder: `/Shared Documents/2.0 中东/1.1 Noon/1.1 发货与库存管理/2. 发货与库存`

- KSA formal file: `2.1 SA Orders & Stock V2025 7.xlsx`; folder-list modified tooltip: **8/13/2026 3:25 AM (UTC-08:00)**.
- UAE formal file: `2.2_UAE_Orders_&_Stock_V2025_7.xlsm`; folder-list modified tooltip: **8/13/2026 3:04 AM (UTC-08:00)**.

Direct Excel-web read-only inspection produced the same result for every store sheet:

| Workbook | Sheet | J1 | O1 |
|---|---|---|---|
| KSA | 店铺1 | 8/13/2026 | 8/12/2026 |
| KSA | 店铺2 | 8/13/2026 | 8/12/2026 |
| KSA | 店铺3 | 8/13/2026 | 8/12/2026 |
| KSA | 店铺4 | 8/13/2026 | 8/12/2026 |
| KSA | 店铺5 | 8/13/2026 | 8/12/2026 |
| KSA | 店铺6 | 8/13/2026 | 8/12/2026 |
| UAE | 店铺1 | 8/13/2026 | 8/12/2026 |
| UAE | 店铺2 | 8/13/2026 | 8/12/2026 |
| UAE | 店铺3 | 8/13/2026 | 8/12/2026 |
| UAE | 店铺4 | 8/13/2026 | 8/12/2026 |
| UAE | 店铺5 | 8/13/2026 | 8/12/2026 |
| UAE | 店铺6 | 8/13/2026 | 8/12/2026 |

These dates correspond to the expected Excel serials: `2026-08-13 = 46247` and `2026-08-12 = 46246`.

## Idempotency and limitations

- Same-day duplicate execution is consistent with idempotent output: all twelve sheets retain one current-day marker in `J1` and the prior-day marker in `O1`; neither history folder contains an additional `0813` backup-name variant.
- This verifies the final cloud state, not the internal branch taken by the duplicate run. Power Automate run-output evidence was not needed because direct workbook inspection succeeded.
- Excel for the web exposed the cells as formatted dates in the formula bar and accessibility readout. It did not expose the raw stored serials in viewing mode, so the serial values above are the standard Excel date equivalents rather than raw-number UI readings.
- Excel-web sheet switching occasionally left a stale name-box/accessibility address for a fraction of a second. Values were accepted only after explicit `Go To` navigation to `J1` or `O1`; ambiguous reads were repeated, including a clean confirmation of UAE `店铺1!J1`.
- SharePoint reports sizes only as rounded MB values in the web details pane; byte-exact sizes were not exposed without downloading, which was outside this read-only verification.

