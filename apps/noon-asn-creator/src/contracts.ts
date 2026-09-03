import { AsnCreatorError } from "./errors.js";

export type StoreIndex = 1 | 2 | 3 | 4 | 5 | 6;

export interface StoreConfig {
  index: StoreIndex;
  credentialFile: string;
  projectCode: `PRJ${string}`;
  partnerId: string;
}

export interface SiteConfig {
  code: "UAE";
  locale: "en-ae";
  countryCode: "AE";
}

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
  create(job: AsnJob, session: NoonSession): Promise<{ outcome: "accepted" | "uncertain"; asnNumber?: string }>;
  resume?(job: AsnJob, session: NoonSession, asnNumber: string): Promise<void>;
  seal?(asnNumber: string, job: AsnJob, session: NoonSession): Promise<AsnRecord>;
  getDetails(asnNumber: string, job: AsnJob, session: NoonSession): Promise<AsnRecord>;
}

export const STORE_CONFIGS: readonly StoreConfig[] = [
  { index: 1, credentialFile: "noon1-API.json", projectCode: "PRJ42958", partnerId: "42958" },
  { index: 2, credentialFile: "noon2-API.json", projectCode: "PRJ55651", partnerId: "55651" },
  { index: 3, credentialFile: "noon3-API.json", projectCode: "PRJ61683", partnerId: "61683" },
  { index: 4, credentialFile: "noon4-API.json", projectCode: "PRJ65553", partnerId: "65553" },
  { index: 5, credentialFile: "noon5-API.json", projectCode: "PRJ75299", partnerId: "75299" },
  { index: 6, credentialFile: "noon6-API.json", projectCode: "PRJ363826", partnerId: "363826" },
];

export const UAE_SITE: SiteConfig = {
  code: "UAE",
  locale: "en-ae",
  countryCode: "AE",
};

export function parseStoreIndex(fileName: string): StoreIndex {
  const matches = [...fileName.matchAll(/店铺([1-6])/g)].map((match) => Number(match[1]));
  if (matches.length !== 1) {
    throw new AsnCreatorError(
      "input",
      false,
      "discovery",
      "Filename must contain exactly one 店铺1 through 店铺6 token",
    );
  }
  return matches[0] as StoreIndex;
}

export function storeConfig(index: StoreIndex): StoreConfig {
  const config = STORE_CONFIGS[index - 1];
  if (!config) {
    throw new AsnCreatorError("configuration", false, "configuration", `Unknown store index: ${index}`);
  }
  return config;
}
