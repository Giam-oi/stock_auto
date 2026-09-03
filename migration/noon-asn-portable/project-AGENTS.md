# Noon ASN Project Guidance

- Use the installed `$noon-asn-operations` skill for Noon ASN, appointment, green-channel, GRN, notification, and PDF tasks.
- Never commit or package Noon credentials, private keys, JWTs, cookies, WeCom webhook keys, business workbooks, PDFs, raw captures, journals, or logs.
- Preserve exact SKU and quantity verification before creating, sealing, writing back, or scheduling an ASN.
- Treat live mutations as separately authorized actions. Capacity queries are read-only; scheduling is not.
- For workbooks inside OneDrive or SharePoint sync folders, avoid whole-file replacement. Use an Office-aware save path, verify the written cells after save, release the handle, and wait for OneDrive to report sync completion before opening the workbook.
- Run `npm test`, `npm run typecheck`, and `npm run build` in `apps/noon-asn-creator` after source changes.
- Do not use `.tmp-*` operational scripts as durable product code. Move reusable behavior into the application or skill with tests.
