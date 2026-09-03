import { describe, expect, it, vi } from "vitest";
import { runResidentLoop } from "../src/resident";

describe("resident monitor loop", () => {
  it("checks immediately and retries after a failed check", async () => {
    const controller = new AbortController();
    const checks: string[] = [];
    const check = vi.fn(async () => {
      checks.push("check");
      if (checks.length === 1) throw new Error("temporary failure");
      controller.abort();
    });
    const waits: number[] = [];
    const wait = async (milliseconds: number) => { waits.push(milliseconds); };

    await runResidentLoop(check, 600_000, controller.signal, wait);

    expect(checks).toEqual(["check", "check"]);
    expect(waits).toEqual([600_000]);
  });
});
