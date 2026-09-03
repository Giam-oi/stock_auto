import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { outputCsvName, outputDirectoryName, STORE_CONFIGS, summaryWorkbookName } from "../src/contracts.js";
import { runSite, type CollectorOptions } from "../src/runner.js";

const dates = { fromDate: "2026-08-19", toDate: "2026-08-19" };

async function options(root: string): Promise<CollectorOptions> {
  return { sites: ["UAE"], ...dates, credentialDir: join(root, "credentials"), outputRoot: root };
}

describe("sales site publication guard", () => {
  it("rejects an existing incomplete target without calling Noon", async () => {
    const root = await mkdtemp(join(tmpdir(), "sales-runner-"));
    try {
      const target = join(root, "UAE", outputDirectoryName(dates.fromDate, dates.toDate));
      await mkdir(target, { recursive: true });
      await writeFile(join(target, outputCsvName("UAE", "42958")), "partial");
      await expect(runSite(await options(root), "UAE")).rejects.toThrow(/incomplete/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips an existing complete seven-file target", async () => {
    const root = await mkdtemp(join(tmpdir(), "sales-runner-"));
    try {
      const target = join(root, "UAE", outputDirectoryName(dates.fromDate, dates.toDate));
      await mkdir(target, { recursive: true });
      for (const store of STORE_CONFIGS) {
        await writeFile(join(target, outputCsvName("UAE", store.partnerId)), "placeholder");
      }
      await writeFile(join(target, summaryWorkbookName("UAE")), "placeholder");
      await expect(runSite(await options(root), "UAE")).resolves.toMatchObject({ status: "skipped" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
