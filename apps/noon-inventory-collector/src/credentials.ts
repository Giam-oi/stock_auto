import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { StoreConfig } from "./contracts.js";

export interface NoonCredential {
  key_id: string;
  private_key: string;
  project_code: string;
  type: "apijwt";
}

function invalidCredential(filePath: string, reason: string): Error {
  return new Error(`Invalid credential ${basename(filePath)}: ${reason}`);
}

function requiredString(
  value: Record<string, unknown>,
  field: keyof NoonCredential,
  filePath: string,
): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw invalidCredential(filePath, `${field} must be a non-empty string`);
  }
  return candidate;
}

export async function loadCredential(
  filePath: string,
  expectedStore: StoreConfig,
): Promise<NoonCredential> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw invalidCredential(filePath, "file is not readable JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidCredential(filePath, "root must be an object");
  }

  const source = parsed as Record<string, unknown>;
  const type = requiredString(source, "type", filePath);
  const keyId = requiredString(source, "key_id", filePath);
  const privateKey = requiredString(source, "private_key", filePath);
  const projectCode = requiredString(source, "project_code", filePath);

  if (type !== "apijwt") {
    throw invalidCredential(filePath, "type must be apijwt");
  }
  if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----\s*$/.test(privateKey)) {
    throw invalidCredential(filePath, "private_key must be a PEM private key");
  }
  if (projectCode !== expectedStore.projectCode) {
    throw new Error(
      `Credential ${basename(filePath)} project_code mismatch: expected ${expectedStore.projectCode}, received ${projectCode}`,
    );
  }

  return {
    type: "apijwt",
    key_id: keyId,
    private_key: privateKey,
    project_code: projectCode,
  };
}
