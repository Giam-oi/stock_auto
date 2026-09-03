# UAE GRN Workbook Backfill Design

## Scope

Create a macro-enabled copy of the supplied UAE stock workbook on drive `D:`. Do not modify the OneDrive source. Search Noon UAE stores 1–6 for ASNs created from 2026-07-01 through 2026-08-12 whose current status is `GRN Completed`, compare them with the ASN values already present in each matching store sheet, and append only missing ASNs.

## Data mapping

- Date: ASN `created_at` date, not schedule date or GRN date.
- ASN: Noon ASN number.
- SKU: partner SKU.
- Qty: ASN requested/submitted quantity for that SKU.
- Status: successfully admitted GRN quantity for that SKU.
- Note: Noon rejection reason when rejected quantity exists.

Rows for multi-SKU ASNs use the source workbook's existing merge and style conventions. Store 4 retains its `A:F = Date/ASN/SKU/Qty/Status/Note` layout. Stores 1–3 and 5–6 retain their existing `A,C:F` core layout and do not repurpose the Scheduleddate column.

## Safety and preservation

The source is copied before editing. Workbook VBA parts, formulas, styles, drawings, relationships, defined names, and unrelated sheets remain unchanged. Editing is limited to the six store worksheet XML parts plus the workbook calculation metadata if required. Existing ASNs are never duplicated.

## Verification

Re-read the completed copy and confirm every planned ASN appears exactly once in its store sheet; quantities reconcile to Noon data; VBA project bytes match the source; unrelated ZIP parts have identical hashes; and the output opens as a valid `.xlsm` package.
