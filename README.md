# Noon Operations Automation

Private automation workspace for Noon UAE/KSA operational workflows. The repository contains source code, tests, operational documentation, and portable setup tooling. Runtime credentials and business outputs are intentionally excluded.

## Applications

- `apps/noon-asn-creator`: create, verify, seal, recover, and schedule FBN ASNs.
- `apps/noon-inventory-collector`: collect and publish inventory data.
- `apps/noon-sales-collector`: collect sales data and update reporting workbooks.
- `apps/noon-finance-collector`: collect Noon finance exports.
- `apps/noon-ad-collector`: collect advertising reports.
- `apps/noon-ad-dayparting`: evaluate and apply advertising dayparting policies.
- `apps/noon-store-login`: maintain authenticated Noon store browser sessions.

## Portable Setup

See `migration/noon-asn-portable/` for the installation scripts and Chinese handoff documentation used to set up the ASN workflow on another computer.

## Security

Do not commit Noon session files, browser cookies, API credentials, WeCom webhook URLs, `.env` files, generated workbooks, PDFs, logs, or runtime audit data. Configure those locally after cloning.

## Development

Each application is self-contained. Run its package-manager install command, then use the scripts declared in that application's `package.json`.
