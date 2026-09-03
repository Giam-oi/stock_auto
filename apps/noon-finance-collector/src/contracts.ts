export type SiteCode = "UAE" | "KSA";
export type ReportCode = "statements" | "transactionviewreportonitemlevelwithcontractselection";

export interface StoreConfig {
  index: number;
  credentialFile: string;
  projectCode: `PRJ${string}`;
}

export interface SiteConfig {
  code: SiteCode;
  countryCode: "AE" | "SA";
  currency: "AED" | "SAR";
  primaryContractTitle: "NOON-AE" | "NOON-SA";
}

export const STORE_CONFIGS: readonly StoreConfig[] = [
  { index: 1, credentialFile: "noon1-API.json", projectCode: "PRJ42958" },
  { index: 2, credentialFile: "noon2-API.json", projectCode: "PRJ55651" },
  { index: 3, credentialFile: "noon3-API.json", projectCode: "PRJ61683" },
  { index: 4, credentialFile: "noon4-API.json", projectCode: "PRJ65553" },
  { index: 5, credentialFile: "noon5-API.json", projectCode: "PRJ75299" },
  { index: 6, credentialFile: "noon6-API.json", projectCode: "PRJ363826" },
];

export const SITE_CONFIGS: Record<SiteCode, SiteConfig> = {
  UAE: { code: "UAE", countryCode: "AE", currency: "AED", primaryContractTitle: "NOON-AE" },
  KSA: { code: "KSA", countryCode: "SA", currency: "SAR", primaryContractTitle: "NOON-SA" },
};

export const REPORT_CODES: readonly ReportCode[] = [
  "statements",
  "transactionviewreportonitemlevelwithcontractselection",
];

export function outputFileName(site: SiteCode, storeIndex: number, report: ReportCode): string {
  return `${site} 店铺${storeIndex}noon_financeweb_${report}.csv`;
}

export function monthDirectory(fromDate: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(fromDate);
  if (!match) throw new Error(`Invalid finance start date: ${fromDate}`);
  return `${match[1]}.${match[2]}`;
}
