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

function compactDate(runDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(runDate);
  if (!match) {
    throw new Error(`Run date must use YYYY-MM-DD: ${runDate}`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Run date must be a real YYYY-MM-DD date: ${runDate}`);
  }
  return `${yearText}${monthText}${dayText}`;
}

export function outputFileName(site: SiteCode, storeIndex: StoreIndex, runDate: string): string {
  return `${SITE_CONFIGS[site].filePrefix}${storeIndex}.${compactDate(runDate)}.csv`;
}

export function outputDirectory(outputRoot: string, site: SiteCode, runDate: string): string {
  compactDate(runDate);
  const normalizedRoot = outputRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  return `${normalizedRoot}/${site}/${runDate}`;
}
