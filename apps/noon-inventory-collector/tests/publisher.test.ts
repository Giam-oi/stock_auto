import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InventoryStats } from "../src/csv.js";
import { outputFileName, type SiteCode, type StoreIndex } from "../src/contracts.js";
import {
  publishSiteFiles,
  stageSiteFiles,
  type InventoryFile,
} from "../src/publisher.js";

const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noon-publisher-test-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function stats(partnerId: string): InventoryStats {
  return {
    partnerId,
    countryCode: "AE",
    snapshotAtUtc: new Date("2026-08-07T08:00:00Z"),
    rowCount: 1,
    saleableRowCount: 1,
    saleableSkuCount: 1,
    saleableQty: 1,
  };
}

function files(site: SiteCode = "UAE", indexes: StoreIndex[] = [1, 2, 3, 4, 5, 6]): InventoryFile[] {
  return indexes.map((storeIndex) => ({
    storeIndex,
    fileName: outputFileName(site, storeIndex, "2026-08-07"),
    csvText: `inventory_type,partner_sku,qty\r\nsaleable,SKU-${storeIndex},${storeIndex}\r\n`,
    stats: stats(String(storeIndex)),
  }));
}

describe("stageSiteFiles", () => {
  it("stages the exact production set outside the final date directory", async () => {
    const outputRoot = await temporaryRoot();
    const staged = await stageSiteFiles({
      outputRoot,
      runId: "run-1",
      runDate: "2026-08-07",
      site: "UAE",
      files: files(),
      expectedStoreIndexes: [1, 2, 3, 4, 5, 6],
    });

    expect(staged.stagingDirectory.replaceAll("\\", "/")).toContain("/.staging/run-1/UAE");
    expect((await readdir(staged.stagingDirectory)).sort()).toEqual(
      files().map((file) => file.fileName).sort(),
    );
    await expect(readdir(join(outputRoot, "UAE", "2026-08-07"))).rejects.toThrow();
  });

  it("allows an explicitly isolated one-store dry-run set", async () => {
    const outputRoot = await temporaryRoot();
    const staged = await stageSiteFiles({
      outputRoot,
      runId: "dry-1",
      runDate: "2026-08-07",
      site: "UAE",
      files: files("UAE", [1]),
      expectedStoreIndexes: [1],
    });
    expect(await readdir(staged.stagingDirectory)).toEqual(["UAE1.20260807.csv"]);
  });

  it.each([
    ["missing store", files("UAE", [1, 2, 3, 4, 5])],
    ["duplicate store", [...files("UAE", [1, 2, 3, 4, 5]), files("UAE", [5])[0]!]],
    ["wrong prefix", [{ ...files("UAE", [1])[0]!, fileName: "SA1.20260807.csv" }]],
    ["wrong date", [{ ...files("UAE", [1])[0]!, fileName: "UAE1.20260806.csv" }]],
  ])("rejects %s", async (_name, candidateFiles) => {
    const outputRoot = await temporaryRoot();
    await expect(
      stageSiteFiles({
        outputRoot,
        runId: "bad-1",
        runDate: "2026-08-07",
        site: "UAE",
        files: candidateFiles,
        expectedStoreIndexes: _name.includes("prefix") || _name.includes("date") ? [1] : [1, 2, 3, 4, 5, 6],
      }),
    ).rejects.toThrow("file set");
  });
});

describe("publishSiteFiles", () => {
  it("publishes all six files into a new date directory and removes staging", async () => {
    const outputRoot = await temporaryRoot();
    const staged = await stageSiteFiles({
      outputRoot,
      runId: "publish-new",
      runDate: "2026-08-07",
      site: "UAE",
      files: files(),
      expectedStoreIndexes: [1, 2, 3, 4, 5, 6],
    });

    const result = await publishSiteFiles(staged);

    expect(result.fileNames).toHaveLength(6);
    expect((await readdir(result.finalDirectory)).sort()).toEqual(result.fileNames.slice().sort());
    await expect(readdir(staged.stagingDirectory)).rejects.toThrow();
    await expect(readdir(join(outputRoot, ".staging"))).rejects.toThrow();
  });

  it("replaces only matching files and preserves unrelated files", async () => {
    const outputRoot = await temporaryRoot();
    const finalDirectory = join(outputRoot, "UAE", "2026-08-07");
    await mkdir(finalDirectory, { recursive: true });
    for (const file of files()) {
      await writeFile(join(finalDirectory, file.fileName), `old-${file.fileName}`, "utf8");
    }
    await writeFile(join(finalDirectory, "运行录屏.mp4"), "unrelated", "utf8");
    const staged = await stageSiteFiles({
      outputRoot,
      runId: "replace",
      runDate: "2026-08-07",
      site: "UAE",
      files: files(),
      expectedStoreIndexes: [1, 2, 3, 4, 5, 6],
    });

    await publishSiteFiles(staged);

    expect(await readFile(join(finalDirectory, "UAE1.20260807.csv"), "utf8")).toContain("SKU-1");
    expect(await readFile(join(finalDirectory, "运行录屏.mp4"), "utf8")).toBe("unrelated");
  });

  it("restores all old files and retains the complete staged set after a mid-publish failure", async () => {
    const outputRoot = await temporaryRoot();
    const finalDirectory = join(outputRoot, "UAE", "2026-08-07");
    await mkdir(finalDirectory, { recursive: true });
    for (const file of files()) {
      await writeFile(join(finalDirectory, file.fileName), `old-${file.fileName}`, "utf8");
    }
    const staged = await stageSiteFiles({
      outputRoot,
      runId: "rollback",
      runDate: "2026-08-07",
      site: "UAE",
      files: files(),
      expectedStoreIndexes: [1, 2, 3, 4, 5, 6],
    });
    let newMoves = 0;
    const { rename } = await import("node:fs/promises");

    await expect(
      publishSiteFiles(staged, {
        rename: async (source, destination) => {
          if (
            source.startsWith(staged.stagingDirectory) &&
            !source.includes(`${join(".previous", "")}`) &&
            basename(destination).endsWith(".csv")
          ) {
            newMoves += 1;
            if (newMoves === 4) {
              throw new Error("injected fourth-file failure");
            }
          }
          await rename(source, destination);
        },
      }),
    ).rejects.toThrow("injected fourth-file failure");

    for (const file of files()) {
      expect(await readFile(join(finalDirectory, file.fileName), "utf8")).toBe(`old-${file.fileName}`);
    }
    expect((await readdir(staged.stagingDirectory)).filter((name) => name.endsWith(".csv")).sort())
      .toEqual(files().map((file) => file.fileName).sort());
  });

  it("refuses to publish a partial dry-run set", async () => {
    const outputRoot = await temporaryRoot();
    const staged = await stageSiteFiles({
      outputRoot,
      runId: "partial",
      runDate: "2026-08-07",
      site: "UAE",
      files: files("UAE", [1]),
      expectedStoreIndexes: [1],
    });
    await expect(publishSiteFiles(staged)).rejects.toThrow("exactly stores 1-6");
  });

  it("publishes to an explicit historical OneDrive target directory", async () => {
    const outputRoot = await temporaryRoot();
    const targetDirectory = join(outputRoot, "2026", "2026.8", "2026.08.09");
    const staged = await stageSiteFiles({
      outputRoot,
      targetDirectory,
      runId: "onedrive",
      runDate: "2026-08-09",
      site: "KSA",
      files: files("KSA").map((file) => ({
        ...file,
        fileName: file.fileName.replace("20260807", "20260809"),
      })),
      expectedStoreIndexes: [1, 2, 3, 4, 5, 6],
    });

    const result = await publishSiteFiles(staged);

    expect(result.finalDirectory).toBe(targetDirectory);
    expect((await readdir(targetDirectory)).sort()).toEqual(
      [1, 2, 3, 4, 5, 6].map((index) => `SA${index}.20260809.csv`),
    );
  });
});
