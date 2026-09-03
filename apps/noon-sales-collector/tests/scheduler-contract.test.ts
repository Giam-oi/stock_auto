import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const scriptsDirectory = fileURLToPath(new URL("../scripts/", import.meta.url));

describe("sales scheduled task", () => {
  it("previews the exact weekday 09:20 non-overlapping task", () => {
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", join(scriptsDirectory, "install-scheduled-task.ps1"), "-Preview",
    ], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const preview = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(preview).toMatchObject({
      taskName: "NoonSalesReportCollector",
      startTime: "09:20",
      schedule: "Weekly:Monday-Friday",
      multipleInstances: "IgnoreNew",
      startWhenAvailable: true,
      executionTimeLimit: "PT2H",
      logonType: "Interactive",
      runOnlyWhenUserLoggedOn: true,
    });
    expect(String(preview.actionScript)).toContain("run-collector.ps1");
  });
});
