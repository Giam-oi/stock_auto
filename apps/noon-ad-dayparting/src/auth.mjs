import { randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const LOGIN_URL = "https://noon-api-gateway.noon.partners/identity/public/v1/api/login";
const encodeJson = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

export async function loadCredential(path, store) {
  let value;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch { throw new Error(`Invalid credential ${basename(path)}`); }
  for (const field of ["key_id", "private_key", "project_code", "type"]) {
    if (typeof value[field] !== "string" || value[field].trim() === "") throw new Error(`Credential is missing ${field}`);
  }
  if (value.type !== "apijwt" || value.project_code !== store.projectCode) throw new Error("Credential project mismatch");
  return value;
}

function createJwt(credential, now = Date.now()) {
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({ sub: credential.key_id, iat: Math.floor(now / 1000), jti: randomUUID() });
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), credential.private_key).toString("base64url")}`;
}

export async function loginNoon(credential, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetchImpl(LOGIN_URL, {
      method: "POST", signal: controller.signal,
      headers: { "User-Agent": "NoonAdDayparting/1.0", "Content-Type": "application/json" },
      body: JSON.stringify({ token: createJwt(credential), default_project_code: credential.project_code }),
    });
  } finally { clearTimeout(timer); }
  if (!response.ok) throw new Error(`Noon authentication failed with HTTP ${response.status}`);
  const cookies = response.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map((item) => item.split(";", 1)[0]?.trim()).filter(Boolean).join("; ");
  if (!cookie) throw new Error("Noon authentication did not return a session cookie");
  return cookie;
}
