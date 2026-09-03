import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateContractBundle, type SanitizedContractBundle } from "./contract-schema.js";

export async function loadContractBundle(path: string | URL): Promise<SanitizedContractBundle> {
  const filePath = path instanceof URL ? fileURLToPath(path) : path;
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  return validateContractBundle(parsed);
}
