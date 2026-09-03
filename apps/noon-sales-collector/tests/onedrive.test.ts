import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { oneDriveWorkbookName, syncSummaryToOneDrive } from "../src/onedrive.js";

describe("OneDrive sales summary publication", () => {
  const contentHasher = async (path: string): Promise<string> =>
    createHash("sha256").update(await readFile(path)).digest("hex");

  it("uses the date-folder convention as the workbook name", () => {
    expect(oneDriveWorkbookName("2026-08-14", "2026-08-16")).toBe("2026-08-14至2026-08-16销售数据.xlsx");
  });

  it("publishes once and skips an identical rerun", async () => {
    const root = await mkdtemp(join(tmpdir(), "sales-onedrive-"));
    try {
      const source = join(root, "source.xlsx");
      const destination = join(root, "od");
      await writeFile(source, "workbook-content");
      const first = await syncSummaryToOneDrive({
        sourcePath: source, destinationRoot: destination,
        fromDate: "2026-08-19", toDate: "2026-08-19",
        contentHasher,
      });
      const second = await syncSummaryToOneDrive({
        sourcePath: source, destinationRoot: destination,
        fromDate: "2026-08-19", toDate: "2026-08-19",
        contentHasher,
      });
      expect(first.status).toBe("published");
      expect(second.status).toBe("skipped");
      await expect(readFile(first.path, "utf8")).resolves.toBe("workbook-content");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite different content", async () => {
    const root = await mkdtemp(join(tmpdir(), "sales-onedrive-"));
    try {
      const source = join(root, "source.xlsx");
      const destination = join(root, "od");
      await mkdir(destination, { recursive: true });
      await writeFile(source, "new-content");
      await writeFile(join(destination, oneDriveWorkbookName("2026-08-19", "2026-08-19")), "old-content");
      await expect(syncSummaryToOneDrive({
        sourcePath: source, destinationRoot: destination,
        fromDate: "2026-08-19", toDate: "2026-08-19",
        contentHasher,
      })).rejects.toThrow(/different content/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
