import { describe, expect, it } from "vitest";
import { withRetry } from "../src/retry.js";

describe("withRetry", () => {
  it("waits 30 and 90 seconds before succeeding on the third transient attempt", async () => {
    const attempts: number[] = [];
    const sleeps: number[] = [];
    const result = await withRetry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 3) {
          throw Object.assign(new Error("temporary"), { retryable: true });
        }
        return "ok";
      },
      {
        delaysMs: [30_000, 90_000],
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      },
    );

    expect(result).toEqual({ value: "ok", attempts: 3 });
    expect(attempts).toEqual([1, 2, 3]);
    expect(sleeps).toEqual([30_000, 90_000]);
  });

  it("stops immediately for a permanent error", async () => {
    let attempts = 0;
    const permanent = Object.assign(new Error("permanent"), { retryable: false });
    const rejection = withRetry(
      async () => { attempts += 1; throw permanent; },
      { delaysMs: [30_000, 90_000], sleep: async () => undefined },
    ).catch((error: unknown) => error);

    expect(await rejection).toBe(permanent);
    expect(attempts).toBe(1);
  });

  it("throws the original transient error after the third attempt", async () => {
    let attempts = 0;
    const transient = Object.assign(new Error("still failing"), { retryable: true });
    const rejection = withRetry(
      async () => { attempts += 1; throw transient; },
      { delaysMs: [1, 2], sleep: async () => undefined },
    ).catch((error: unknown) => error);

    expect(await rejection).toBe(transient);
    expect(attempts).toBe(3);
    expect(transient).toMatchObject({ attempts: 3 });
  });
});
