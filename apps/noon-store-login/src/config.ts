export type StoreIndex = 1 | 2 | 3 | 4 | 5 | 6;
export type SiteCode = "UAE" | "KSA";
export type Destination = "dashboard" | "inventory" | "fbn";

export interface StoreConfig {
  index: StoreIndex;
  projectCode: `PRJ${string}`;
}

export const STORES: readonly StoreConfig[] = [
  { index: 1, projectCode: "PRJ42958" },
  { index: 2, projectCode: "PRJ55651" },
  { index: 3, projectCode: "PRJ61683" },
  { index: 4, projectCode: "PRJ65553" },
  { index: 5, projectCode: "PRJ75299" },
  { index: 6, projectCode: "PRJ363826" },
];

const LOCALES: Record<SiteCode, string> = { UAE: "en-ae", KSA: "en-sa" };

export function destinationUrl(
  store: StoreConfig,
  site: SiteCode,
  destination: Destination,
): string {
  const locale = LOCALES[site];
  const project = encodeURIComponent(store.projectCode);
  if (destination === "dashboard") {
    const partner = store.projectCode.slice(3);
    const storeCode = `STR${partner}-N${site === "UAE" ? "AE" : "SA"}`;
    return `https://noon-store.noon.partners/en/${storeCode}/home?project=${project}&tabs=dashboard`;
  }
  if (destination === "inventory") {
    return `https://fbn.noon.partners/${locale}/inventory?mp=noon&project=${project}`;
  }
  return `https://fbn.noon.partners/${locale}/?mp=noon&project=${project}`;
}

export function findStores(selection: string): readonly StoreConfig[] {
  if (selection.trim().toLowerCase() === "all") {
    return STORES;
  }
  const indexes = [...new Set(selection.split(",").map((value) => Number(value.trim())))];
  if (indexes.length === 0 || indexes.some((value) => !Number.isInteger(value) || value < 1 || value > 6)) {
    throw new Error("店铺必须是 1-6、逗号分隔的多个编号，或 all");
  }
  return indexes.map((index) => STORES[index - 1]!);
}
