import { join } from "node:path";
import { outputFileName, type SiteCode } from "./contracts.js";

export interface OneDriveRoots {
  KSA: string;
  UAE: string;
}

export function oneDriveInventoryDirectory(
  site: SiteCode,
  runDate: string,
  roots: OneDriveRoots,
): string {
  outputFileName(site, 1, runDate);
  const [year, month, day] = runDate.split("-") as [string, string, string];
  const dottedDate = `${year}.${month}.${day}`;

  if (site === "KSA") {
    return join(roots.KSA, year, `${year}.${Number(month)}`, dottedDate);
  }
  return join(roots.UAE, `4.${year}`, `${year}.${month}`, dottedDate);
}
