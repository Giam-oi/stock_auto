import { describe, expect, it, vi } from "vitest";
import { isRetryableSalesError, withRetry } from "../src/retry.js";

describe("sales retry", () => {
  it("retries transient network failures", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue("ok");
    await expect(withRetry(operation, 3, async () => undefined)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry validation or authentication 4xx failures", async () => {
    expect(isRetryableSalesError(new Error("Invalid sales country"))).toBe(false);
    expect(isRetryableSalesError(new Error("HTTP 401"))).toBe(false);
    expect(isRetryableSalesError(new Error("HTTP 503"))).toBe(true);
  });
});
