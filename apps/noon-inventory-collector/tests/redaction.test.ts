import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { redactSecrets } from "../src/redaction.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("redactSecrets", () => {
  it("masks structured secret fields recursively while preserving diagnostics", () => {
    const result = redactSecrets({
      projectCode: "PRJ42958",
      status: 429,
      private_key: "sensitive-pem",
      key_id: "secret-id",
      nested: { token: "secret-token", cookieHeader: "session=secret" },
    });
    expect(result).toEqual({
      projectCode: "PRJ42958",
      status: 429,
      private_key: "[REDACTED]",
      key_id: "[REDACTED]",
      nested: { token: "[REDACTED]", cookieHeader: "[REDACTED]" },
    });
  });

  it("masks PEM blocks, JWTs, cookies, and webhook key values in free text", () => {
    const pem = ["-----BEGIN PRIVATE KEY-----", "abc", "-----END PRIVATE KEY-----"].join("\n");
    const jwt = ["eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiJrZXkifQ", "signature123"].join(".");
    const input = `${pem} ${jwt} Cookie: session=abc; auth=def key=webhook-secret`;
    const output = String(redactSecrets(input));
    expect(output).not.toContain("abc");
    expect(output).not.toContain("signature123");
    expect(output).not.toContain("webhook-secret");
    expect(output).toContain("[REDACTED]");
  });

  it("returns JSON-safe output for circular objects", () => {
    const input: Record<string, unknown> = { name: "safe" };
    input.self = input;
    expect(redactSecrets(input)).toEqual({ name: "safe", self: "[Circular]" });
  });
});

describe("createLogger", () => {
  it("writes redacted JSONL and removes only matching logs older than 30 days", async () => {
    const root = await mkdtemp(join(tmpdir(), "noon-logger-test-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "2026-06-01.jsonl"), "old", "utf8");
    await writeFile(join(root, "keep.txt"), "unrelated", "utf8");
    const logger = await createLogger({ root, now: new Date("2026-08-07T08:00:00Z") });

    await logger.info("authentication", { projectCode: "PRJ42958", token: "secret-token" });

    const current = JSON.parse(await readFile(join(root, "2026-08-07.jsonl"), "utf8")) as Record<string, unknown>;
    expect(current).toMatchObject({ level: "info", event: "authentication" });
    expect(JSON.stringify(current)).toContain("PRJ42958");
    expect(JSON.stringify(current)).not.toContain("secret-token");
    expect(await readdir(root)).toEqual(expect.arrayContaining(["2026-08-07.jsonl", "keep.txt"]));
    expect(await readdir(root)).not.toContain("2026-06-01.jsonl");
  });
});
