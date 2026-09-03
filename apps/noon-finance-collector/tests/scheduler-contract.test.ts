import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));

describe("finance scheduled task", () => {
  it("previews the monthly day-24 15:00 contract", () => {
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(scripts, "install-scheduled-task.ps1"), "-Preview",
    ], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      taskName: "NoonFinanceReportCollector", schedule: "Monthly:Day24", startTime: "15:00",
      multipleInstances: "IgnoreNew", startWhenAvailable: true, executionTimeLimit: "PT2H",
    });
  });
});
