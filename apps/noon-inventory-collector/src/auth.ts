import { randomUUID, sign } from "node:crypto";
import type { NoonCredential } from "./credentials.js";

const LOGIN_URL = "https://noon-api-gateway.noon.partners/identity/public/v1/api/login";

export interface NoonSession {
  cookieHeader: string;
}

export class AuthenticationError extends Error {
  readonly kind = "authentication";
  readonly retryable = false;

  constructor(readonly status?: number, message?: string) {
    super(message ?? `Noon authentication failed${status === undefined ? "" : ` with HTTP ${status}`}`);
    this.name = "AuthenticationError";
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createJwt(
  credential: NoonCredential,
  nowSeconds = Math.floor(Date.now() / 1_000),
  jti: string = randomUUID(),
): string {
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({ sub: credential.key_id, iat: nowSeconds, jti });
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), credential.private_key);
  return `${signingInput}.${signature.toString("base64url")}`;
}

function getSetCookies(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const cookies = extendedHeaders.getSetCookie?.();
  if (cookies && cookies.length > 0) {
    return cookies;
  }

  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=[^;]*)/) : [];
}

export async function loginNoon(
  credential: NoonCredential,
  fetchImpl: typeof fetch = fetch,
): Promise<NoonSession> {
  const response = await fetchImpl(LOGIN_URL, {
    method: "POST",
    headers: {
      "User-Agent": "StockAuto/1.0",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: createJwt(credential),
      default_project_code: credential.project_code,
    }),
  });

  if (response.status !== 200) {
    throw new AuthenticationError(response.status);
  }

  const cookieHeader = getSetCookies(response.headers)
    .map((cookie) => cookie.split(";", 1)[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))
    .join("; ");
  if (!cookieHeader) {
    throw new AuthenticationError(undefined, "Noon authentication did not return a session cookie");
  }
  return { cookieHeader };
}
