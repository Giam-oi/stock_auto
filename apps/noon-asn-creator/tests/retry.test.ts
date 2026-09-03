import { describe, expect, it, vi } from "vitest";
import { AsnCreatorError } from "../src/errors.js";
import { withRetry } from "../src/retry.js";

describe("withRetry", () => {
  it("retries retryable errors with injected delays", async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new AsnCreatorError("http", true, "find", "temporary", { status: 503 });
      return "ok";
    }, { delaysMs: [1000, 3000], sleep });
    expect(result).toEqual({ value: "ok", attempts: 3 });
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
  });

  it("does not retry non-retryable errors", async () => {
    const sleep = vi.fn(async () => undefined);
    await expect(withRetry(async () => {
      throw new AsnCreatorError("input", false, "input", "bad data");
    }, { delaysMs: [1000], sleep })).rejects.toThrow(/bad data/);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("honors capped retry-after delay", async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    await withRetry(async () => {
      calls += 1;
      if (calls === 1) throw new AsnCreatorError("http", true, "find", "limited", { status: 429, retryAfterMs: 90_000 });
      return true;
    }, { delaysMs: [1000], sleep, maximumDelayMs: 60_000 });
    expect(sleep).toHaveBeenCalledWith(60_000);
  });
});
