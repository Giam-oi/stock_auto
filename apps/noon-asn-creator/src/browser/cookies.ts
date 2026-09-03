import type { BrowserContext } from "playwright-core";

export interface ParsedCookie {
  name: string;
  value: string;
}

export function parseCookieHeader(cookieHeader: string): ParsedCookie[] {
  return cookieHeader.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) throw new Error("Invalid Noon Cookie header");
    return { name: part.slice(0, separator).trim(), value: part.slice(separator + 1) };
  });
}

export async function injectNoonCookies(context: BrowserContext, cookieHeader: string): Promise<void> {
  await context.addCookies(parseCookieHeader(cookieHeader).map((cookie) => ({
    ...cookie,
    domain: ".noon.partners",
    path: "/",
    secure: true,
    sameSite: "Lax" as const,
  })));
}
