import { randomUUID, sign } from "node:crypto";
import type { NoonCredential } from "./credentials.js";

const LOGIN_URL = "https://noon-api-gateway.noon.partners/identity/public/v1/api/login";

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createJwt(credential: NoonCredential, nowSeconds = Math.floor(Date.now() / 1_000), jti = randomUUID()): string {
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({ sub: credential.key_id, iat: nowSeconds, jti });
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), credential.private_key);
  return `${signingInput}.${signature.toString("base64url")}`;
}

export async function loginNoon(credential: NoonCredential, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(LOGIN_URL, {
    method: "POST",
    headers: { "User-Agent": "NoonFinanceCollector/1.0", "Content-Type": "application/json" },
    body: JSON.stringify({ token: createJwt(credential), default_project_code: credential.project_code }),
  });
  if (!response.ok) throw new Error(`Noon authentication failed with HTTP ${response.status}`);
  const extended = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeader = (extended.getSetCookie?.() ?? [])
    .map((cookie) => cookie.split(";", 1)[0]?.trim()).filter(Boolean).join("; ");
  if (!cookieHeader) throw new Error("Noon authentication returned no session cookie");
  return cookieHeader;
}
