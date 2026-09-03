import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const scriptsDirectory = fileURLToPath(new URL("../scripts/", import.meta.url));

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("scheduled-task scripts", () => {
  it("previews the exact daily 08:00 non-overlapping task without registering it", () => {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", join(scriptsDirectory, "install-scheduled-task.ps1"),
      "-Preview",
    ], { encoding: "utf8" });

    expect(result.status).toBe(0);
    const preview = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(preview).toMatchObject({
      taskName: "NoonRealtimeInventoryCollector",
      startTime: "08:00",
      multipleInstances: "IgnoreNew",
      startWhenAvailable: true,
      logonType: "Interactive",
      runOnlyWhenUserLoggedOn: true,
    });
    expect(String(preview.actionScript)).toContain("run-collector.ps1");
  });

  it("runs the compiled CLI, records output, and returns the Node exit code", async () => {
    const appRoot = await mkdtemp(join(tmpdir(), "noon-wrapper-test-"));
    temporaryDirectories.push(appRoot);
    const cliDirectory = join(appRoot, "dist", "src");
    const logRoot = join(appRoot, "logs");
    await mkdir(cliDirectory, { recursive: true });
    await writeFile(
      join(cliDirectory, "cli.js"),
      'console.log(`wrapper-args:${process.argv.slice(2).join(",")}`); process.exit(7);\n',
      "utf8",
    );

    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", join(scriptsDirectory, "run-collector.ps1"),
      "-AppRoot", appRoot,
      "-NodePath", process.execPath,
      "-LogRoot", logRoot,
    ], { encoding: "utf8" });

    expect(result.status).toBe(7);
    const logFiles = await readdir(logRoot);
    expect(logFiles).toHaveLength(1);
    expect(await readFile(join(logRoot, logFiles[0]!), "utf8")).toContain("wrapper-args:run");
  });
});
