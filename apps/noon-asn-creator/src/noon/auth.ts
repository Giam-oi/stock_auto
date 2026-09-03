import { randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { NoonSession, StoreConfig, StoreIndex } from "../contracts.js";
import { storeConfig } from "../contracts.js";
import { AsnCreatorError } from "../errors.js";

const LOGIN_URL = "https://noon-api-gateway.noon.partners/identity/public/v1/api/login";

export interface NoonCredential {
  type: "apijwt";
  key_id: string;
  project_code: `PRJ${string}`;
  private_key: string;
}

function credentialError(filePath: string, reason: string): AsnCreatorError {
  return new AsnCreatorError(
    "configuration",
    false,
    "authentication",
    `Invalid credential ${basename(filePath)}: ${reason}`,
  );
}

function requiredString(source: Record<string, unknown>, key: string, filePath: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw credentialError(filePath, `${key} must be a non-empty string`);
  }
  return value;
}

export async function loadCredential(
  filePath: string,
  expectedStore: StoreConfig,
): Promise<NoonCredential> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw credentialError(filePath, "file is not readable JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw credentialError(filePath, "root must be an object");
  }

  const source = parsed as Record<string, unknown>;
  const type = requiredString(source, "type", filePath);
  const keyId = requiredString(source, "key_id", filePath);
  const projectCode = requiredString(source, "project_code", filePath);
  const privateKey = requiredString(source, "private_key", filePath);

  if (type !== "apijwt") {
    throw credentialError(filePath, "type must be apijwt");
  }
  if (!projectCode.startsWith("PRJ")) {
    throw credentialError(filePath, "project_code must start with PRJ");
  }
  if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----\s*$/.test(privateKey)) {
    throw credentialError(filePath, "private_key must be a PEM private key");
  }
  if (projectCode !== expectedStore.projectCode) {
    throw credentialError(
      filePath,
      `project_code mismatch: expected ${expectedStore.projectCode}, received ${projectCode}`,
    );
  }

  return {
    type: "apijwt",
    key_id: keyId,
    project_code: projectCode as `PRJ${string}`,
    private_key: privateKey,
  };
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
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const cookies = extended.getSetCookie?.();
  if (cookies && cookies.length > 0) {
    return cookies;
  }
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=[^;]*)/) : [];
}

export async function loginNoon(
  credential: NoonCredential,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<NoonSession> {
  let response: Response;
  try {
    response = await fetchImpl(LOGIN_URL, {
      method: "POST",
      headers: {
        "User-Agent": "NoonASNCreator/1.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: createJwt(credential),
        default_project_code: credential.project_code,
      }),
    });
  } catch (cause) {
    throw new AsnCreatorError(
      "authentication",
      false,
      "authentication",
      "Noon authentication request failed",
      { cause },
    );
  }

  if (response.status !== 200) {
    throw new AsnCreatorError(
      "authentication",
      false,
      "authentication",
      `Noon authentication failed with HTTP ${response.status}`,
      { status: response.status },
    );
  }

  const cookieHeader = getSetCookies(response.headers)
    .map((cookie) => cookie.split(";", 1)[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))
    .join("; ");
  if (!cookieHeader) {
    throw new AsnCreatorError(
      "authentication",
      false,
      "authentication",
      "Noon authentication did not return a session cookie",
    );
  }

  return {
    cookieHeader,
    projectCode: credential.project_code,
    authenticatedAt: now().toISOString(),
  };
}

interface SessionManagerDependencies {
  loadCredential?: typeof loadCredential;
  login?: typeof loginNoon;
}

export class SessionManager {
  private readonly sessions = new Map<StoreIndex, NoonSession>();
  private readonly load: typeof loadCredential;
  private readonly login: typeof loginNoon;

  constructor(
    private readonly credentialDirectory: string,
    dependencies: SessionManagerDependencies = {},
  ) {
    this.load = dependencies.loadCredential ?? loadCredential;
    this.login = dependencies.login ?? loginNoon;
  }

  async get(storeIndex: StoreIndex): Promise<NoonSession> {
    const cached = this.sessions.get(storeIndex);
    return cached ?? this.refresh(storeIndex);
  }

  async refresh(storeIndex: StoreIndex): Promise<NoonSession> {
    const store = storeConfig(storeIndex);
    const credential = await this.load(join(this.credentialDirectory, store.credentialFile), store);
    const session = await this.login(credential);
    this.sessions.set(storeIndex, session);
    return session;
  }
}
