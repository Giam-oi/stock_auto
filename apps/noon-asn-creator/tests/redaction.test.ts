import { describe, expect, it } from "vitest";
import { redact } from "../src/redaction.js";

describe("redact", () => {
  it("recursively removes credential fields and credential-shaped strings", () => {
    const value = {
      private_key: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
      key_id: "kid-123",
      headers: {
        Cookie: "session=secret",
        authorization: "Bearer secret",
        harmless: "keep",
      },
      nested: ["aaa.bbb.ccc", { token: "secret-token" }],
    };
    const result = redact(value) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("kid-123");
    expect(result).toMatchObject({
      private_key: "[REDACTED]",
      key_id: "[REDACTED]",
      headers: { Cookie: "[REDACTED]", authorization: "[REDACTED]", harmless: "keep" },
    });
  });
});
