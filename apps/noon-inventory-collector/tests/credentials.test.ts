import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCredential } from "../src/credentials.js";
import { STORE_CONFIGS } from "../src/contracts.js";

const TEST_PRIVATE_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "test-only-key-material",
  "-----END PRIVATE KEY-----",
].join("\n");

const temporaryDirectories: string[] = [];

async function writeCredential(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "noon-credential-test-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "noon1-API.json");
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("loadCredential", () => {
  it("accepts a real credential shape while returning only required fields", async () => {
    const file = await writeCredential({
      type: "apijwt",
      key_id: "key-test",
      private_key: TEST_PRIVATE_KEY,
      project_code: "PRJ42958",
      channel_identifier: "documented-extra-field",
      issued_at: "2026-08-07T00:00:00Z",
    });

    const credential = await loadCredential(file, STORE_CONFIGS[0]!);

    expect(credential).toEqual({
      type: "apijwt",
      key_id: "key-test",
      private_key: TEST_PRIVATE_KEY,
      project_code: "PRJ42958",
    });
    expect(Object.keys(credential).sort()).toEqual([
      "key_id",
      "private_key",
      "project_code",
      "type",
    ]);
  });

  it("rejects a credential for the wrong project without exposing its key", async () => {
    const file = await writeCredential({
      type: "apijwt",
      key_id: "key-test",
      private_key: TEST_PRIVATE_KEY,
      project_code: "PRJ99999",
    });

    const rejection = loadCredential(file, STORE_CONFIGS[0]!).catch((error: unknown) => error);
    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("project_code mismatch");
    expect((error as Error).message).not.toContain("test-only-key-material");
  });

  it.each([
    null,
    [],
    { type: "password", key_id: "a", private_key: TEST_PRIVATE_KEY, project_code: "PRJ42958" },
    { type: "apijwt", key_id: "", private_key: TEST_PRIVATE_KEY, project_code: "PRJ42958" },
    { type: "apijwt", key_id: "a", private_key: "not-pem", project_code: "PRJ42958" },
  ])("rejects malformed credential input %#", async (value) => {
    const file = await writeCredential(value);
    await expect(loadCredential(file, STORE_CONFIGS[0]!)).rejects.toThrow("Invalid credential");
  });
});
