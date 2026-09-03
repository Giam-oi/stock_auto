import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { StoreConfig } from "./contracts.js";

export interface NoonCredential {
  key_id: string;
  private_key: string;
  project_code: string;
  type: "apijwt";
}

export async function loadCredential(filePath: string, expectedStore: StoreConfig): Promise<NoonCredential> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(filePath, "utf8")); }
  catch { throw new Error(`Invalid credential ${basename(filePath)}: unreadable JSON`); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid credential ${basename(filePath)}: root must be an object`);
  }
  const source = parsed as Record<string, unknown>;
  const read = (field: string): string => {
    const value = source[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Invalid credential ${basename(filePath)}: ${field} must be a non-empty string`);
    }
    return value;
  };
  const type = read("type");
  const keyId = read("key_id");
  const privateKey = read("private_key");
  const projectCode = read("project_code");
  if (type !== "apijwt") throw new Error(`Invalid credential ${basename(filePath)}: type must be apijwt`);
  if (projectCode !== expectedStore.projectCode) throw new Error(`Credential ${basename(filePath)} project mismatch`);
  if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----\s*$/.test(privateKey)) {
    throw new Error(`Invalid credential ${basename(filePath)}: invalid private key`);
  }
  return { type, key_id: keyId, private_key: privateKey, project_code: projectCode };
}
