export type SiteCode = "UAE" | "KSA";
export type StoreIndex = 1 | 2 | 3 | 4 | 5 | 6;

export interface StoreConfig {
  index: StoreIndex;
  credentialFile: string;
  projectCode: `PRJ${string}`;
  partnerId: string;
}

export interface SiteConfig {
  code: SiteCode;
  locale: "en-ae" | "en-sa";
  countryCode: "AE" | "SA";
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
  UAE: { code: "UAE", locale: "en-ae", countryCode: "AE" },
  KSA: { code: "KSA", locale: "en-sa", countryCode: "SA" },
};

export function validateDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Date must use YYYY-MM-DD: ${value}`);
  const [, yearText, monthText, dayText] = match;
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  if (
    date.getUTCFullYear() !== Number(yearText) ||
    date.getUTCMonth() + 1 !== Number(monthText) ||
    date.getUTCDate() !== Number(dayText)
  ) {
    throw new Error(`Date must be a real calendar date: ${value}`);
  }
  return value;
}

export function validateRange(fromDate: string, toDate: string): void {
  validateDate(fromDate);
  validateDate(toDate);
  if (fromDate > toDate) throw new Error("fromDate must not be after toDate");
}

export function outputDirectoryName(fromDate: string, toDate: string): string {
  validateRange(fromDate, toDate);
  return `${fromDate}至${toDate}销售数据`;
}

export function outputCsvName(site: SiteCode, partnerId: string): string {
  return `${partnerId}销售数据-${site}.csv`;
}

export function summaryWorkbookName(site: SiteCode): string {
  return `${site}数据整合.xlsx`;
}
