import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, type CliDependencies } from "../src/cli.js";
import type { CollectorOptions, CollectorRunResult } from "../src/runner.js";

const temporaryDirectories: string[] = [];
const host = ["qyapi", "weixin", "qq", "com"].join(".");
const validEnvironment = {
  LOCALAPPDATA: "D:/local",
  WECOM_WEBHOOK_URL: `https://${host}/cgi-bin/webhook/send?key=test-key`,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function result(successful = true): CollectorRunResult {
  return {
    runId: "run-test",
    runDate: "2026-08-07",
    startedAt: "2026-08-07T00:00:00.000Z",
    completedAt: "2026-08-07T00:01:00.000Z",
    sites: {
      UAE: { site: "UAE", status: successful ? "success" : "failed", stores: [] },
      KSA: { site: "KSA", status: "success", stores: [] },
    },
    notificationStatus: "success",
    successful,
  };
}

async function dependencies(
  execute: (options: CollectorOptions) => Promise<CollectorRunResult>,
): Promise<CliDependencies> {
  const directory = await mkdtemp(join(tmpdir(), "noon-cli-test-"));
  temporaryDirectories.push(directory);
  return {
    execute,
    now: () => new Date("2026-08-07T00:30:00Z"),
    lockPath: join(directory, "collector.lock"),
  };
}

describe("CLI main", () => {
  it("runs both sites for today's Asia/Shanghai date by default", async () => {
    let captured: CollectorOptions | undefined;
    const deps = await dependencies(async (options) => { captured = options; return result(); });
    const exitCode = await main(["run"], validEnvironment, deps);
    expect(exitCode).toBe(0);
    expect(captured).toMatchObject({
      runDate: "2026-08-07",
      sites: ["UAE", "KSA"],
      storeIndexes: [1, 2, 3, 4, 5, 6],
      dryRun: false,
      credentialDir: "D:\\noon-api",
      outputRoot: "D:\\文件\\库存文件",
      oneDriveRoots: {
        KSA: expect.stringContaining("1. Pending表"),
        UAE: expect.stringContaining("1. 出入库"),
      },
    });
  });

  it("isolates a one-store dry run under the supplied output root", async () => {
    let captured: CollectorOptions | undefined;
    const deps = await dependencies(async (options) => { captured = options; return result(); });
    const exitCode = await main(
      ["dry-run", "--site", "UAE", "--store", "1", "--out", "D:/temp/noon"],
      {},
      deps,
    );
    expect(exitCode).toBe(0);
    expect(captured).toMatchObject({ sites: ["UAE"], storeIndexes: [1], dryRun: true, outputRoot: "D:/temp/noon" });
    expect(captured?.oneDriveRoots).toBeUndefined();
  });

  it.each([
    [[], "missing command"],
    [["bad"], "invalid command"],
    [["dry-run", "--site", "US"], "invalid site"],
    [["dry-run", "--store", "7"], "invalid store"],
    [["dry-run", "--store", "1"], "store requires site"],
    [["dry-run", "--site", "UAE", "--out"], "missing option value"],
  ] as const)("returns configuration exit 2 for %s", async (argv, _reason) => {
    let executed = false;
    const deps = await dependencies(async () => { executed = true; return result(); });
    expect(await main([...argv], validEnvironment, deps)).toBe(2);
    expect(executed).toBe(false);
  });

  it("returns 1 for a site or notification failure", async () => {
    const failed = result(false);
    expect(await main(["run"], validEnvironment, await dependencies(async () => failed))).toBe(1);
    const notificationFailed = result(true);
    notificationFailed.notificationStatus = "failed";
    notificationFailed.successful = false;
    expect(await main(["run"], validEnvironment, await dependencies(async () => notificationFailed))).toBe(1);
  });

  it("returns 2 before execution when production webhook configuration is missing", async () => {
    let executed = false;
    const deps = await dependencies(async () => { executed = true; return result(); });
    expect(await main(["run"], {}, deps)).toBe(2);
    expect(executed).toBe(false);
  });

  it("returns 3 when another process holds the lock", async () => {
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const deps = await dependencies(async () => {
      started();
      await releasePromise;
      return result();
    });
    const first = main(["run"], validEnvironment, deps);
    await startedPromise;
    expect(await main(["run"], validEnvironment, deps)).toBe(3);
    release();
    expect(await first).toBe(0);
  });
});
