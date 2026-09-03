export interface LoginStateResult {
  valid: boolean;
  finalUrl: string;
  title: string;
}

export function isConfirmedLogout(result: LoginStateResult): boolean {
  if (result.valid) return false;
  let host = "";
  try { host = new URL(result.finalUrl).hostname; } catch { /* Empty or malformed URL is inconclusive. */ }
  return host === "login.noon.partners" || /Partners Login/i.test(result.title);
}

export function shouldOpenLoginPage(
  previousLogoutConfirmed: boolean,
  result: LoginStateResult,
): boolean {
  return !previousLogoutConfirmed && isConfirmedLogout(result) && result.finalUrl.length > 0;
}
