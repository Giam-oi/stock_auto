import type { SiteConfig } from "./contracts.js";

interface ContractRecord {
  contractTitle?: string;
  contractOrderNr?: string;
}

export async function resolvePrimaryContract(
  projectCode: string,
  cookieHeader: string,
  site: SiteConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = new URL("https://finance.noon.partners/_svc/mp-finplatform-api-legalentity/invoices-and-creditnotes/partner-contract-order-nrs");
  url.searchParams.set("country_code", site.countryCode);
  const response = await fetchImpl(url, {
    headers: { Cookie: cookieHeader, "X-Project": projectCode, "X-Locale": "en", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Finance contracts failed for ${projectCode} ${site.code}: HTTP ${response.status}`);
  const payload = await response.json() as { contractOrderNrs?: ContractRecord[]; data?: { contractOrderNrs?: ContractRecord[] } };
  const contracts = payload.contractOrderNrs ?? payload.data?.contractOrderNrs ?? [];
  const normalize = (value: string | undefined): string => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const expectedTitle = normalize(site.primaryContractTitle);
  const exact = contracts.filter((contract) => normalize(contract.contractTitle) === expectedTitle);
  if (exact.length !== 1 || !exact[0]?.contractOrderNr) {
    throw new Error(`Expected exactly one ${site.primaryContractTitle} contract for ${projectCode}`);
  }
  return exact[0].contractOrderNr;
}
