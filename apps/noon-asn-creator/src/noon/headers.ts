import type { AsnJob, NoonSession } from "../contracts.js";
import { AsnCreatorError } from "../errors.js";

export function webHeaders(job: AsnJob, session: NoonSession): Record<string, string> {
  if (session.projectCode !== job.projectCode) {
    throw new AsnCreatorError(
      "authentication",
      false,
      "authentication",
      "Noon session project does not match the workbook store",
    );
  }

  return {
    "User-Agent": "NoonASNCreator/1.0",
    Accept: "application/json",
    "Content-Type": "application/json",
    Cookie: session.cookieHeader,
    "X-Locale": "en-ae",
    "X-Platform": "web",
    "X-Project": job.projectCode,
    "Country-Code": "ae",
    "Id-Partner": job.partnerId,
  };
}
