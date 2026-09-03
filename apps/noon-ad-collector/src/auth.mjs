import { randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const LOGIN_URL = "https://noon-api-gateway.noon.partners/identity/public/v1/api/login";

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function loadCredential(path, expectedStore) {
  let source;
  try {
    source = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`Invalid credential ${basename(path)}`);
  }
  for (const field of ["key_id", "private_key", "project_code", "type"]) {
    if (typeof source[field] !== "string" || source[field].trim() === "") {
      throw new Error(`Credential ${basename(path)} is missing ${field}`);
    }
  }
  if (source.type !== "apijwt" || source.project_code !== expectedStore.projectCode) {
    throw new Error(`Credential ${basename(path)} does not match ${expectedStore.projectCode}`);
  }
  if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----\s*$/.test(source.private_key)) {
    throw new Error(`Credential ${basename(path)} has an invalid private key`);
  }
  return source;
}

function createJwt(credential) {
  const now = Math.floor(Date.now() / 1_000);
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({ sub: credential.key_id, iat: now, jti: randomUUID() });
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), credential.private_key).toString("base64url")}`;
}

export async function loginNoon(credential, fetchImpl = fetch) {
  const response = await fetchImpl(LOGIN_URL, {
    method: "POST",
    headers: { "User-Agent": "NoonAdCollector/1.0", "Content-Type": "application/json" },
    body: JSON.stringify({ token: createJwt(credential), default_project_code: credential.project_code }),
  });
  if (!response.ok) throw new Error(`Noon authentication failed with HTTP ${response.status}`);
  const extended = response.headers;
  const cookies = extended.getSetCookie?.() ?? [];
  const cookieHeader = cookies.map((cookie) => cookie.split(";", 1)[0]?.trim()).filter(Boolean).join("; ");
  if (!cookieHeader) throw new Error("Noon authentication did not return a session cookie");
  return cookieHeader;
}
