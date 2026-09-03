import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  discoverWorkbookPaths,
  isSkippedWorkbook,
  readAsnJob,
  writeAsnNumber,
} from "../src/workbook.js";
import { createPrefixedWorkbookFixture, createWorkbookFixture } from "./fixtures/workbooks/generate-fixtures.js";

async function tempFolder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "noon-asn-workbook-"));
}

async function workbookSnapshot(filePath: string): Promise<unknown> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    state: sheet.state,
    merges: [...sheet.model.merges].sort(),
    rows: sheet.getRows(1, sheet.actualRowCount)?.map((row) => {
      const styles: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        styles.push({ address: cell.address, style: cell.style, numFmt: cell.numFmt });
      });
      return { height: row.height, cells: row.values, styles };
    }),
    columns: sheet.columns.slice(0, 5).map((column) => ({ width: column.width, hidden: column.hidden })),
  }));
}

describe("workbook discovery", () => {
  it("ignores nested files, non-xlsx files, and Excel temporary files", async () => {
    const folder = await tempFolder();
    await createWorkbookFixture(join(folder, "02 店铺2 B.xlsx"));
    await createWorkbookFixture(join(folder, "01 店铺1 A.xlsx"));
    await writeFile(join(folder, "~$01 店铺1 A.xlsx"), "temporary");
    await writeFile(join(folder, "notes.txt"), "ignore");
    await mkdir(join(folder, "nested"));
    await createWorkbookFixture(join(folder, "nested", "03 店铺3 C.xlsx"));

    expect(await discoverWorkbookPaths(folder)).toEqual([
      join(folder, "01 店铺1 A.xlsx"),
      join(folder, "02 店铺2 B.xlsx"),
    ]);
  });
});

describe("workbook validation", () => {
  it("parses SKU as text and positive integer quantity", async () => {
    const folder = await tempFolder();
    const filePath = join(folder, "01 店铺2 约仓文件 HL.xlsx");
    await createWorkbookFixture(filePath, { rows: [["  TEST-SKU-001  ", "50", "", "", ""]] });

    const result = await readAsnJob(filePath);
    expect(isSkippedWorkbook(result)).toBe(false);
    if (!isSkippedWorkbook(result)) {
      expect(result.storeIndex).toBe(2);
      expect(result.items).toEqual([{ partnerSku: "TEST-SKU-001", quantity: 50 }]);
      expect(result.fileFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("ignores all headers and values after the ASN column", async () => {
    const folder = await tempFolder();
    const filePath = join(folder, "01 店铺5 extra-columns.xlsx");
    await createWorkbookFixture(filePath, {
      headers: ["约仓SKU", "数量", "ASN", "任意列", "完全无关"],
      rows: [["TEST-SKU-001", 50, "", "任意内容", "任意内容"]],
    });

    const result = await readAsnJob(filePath);
    expect(isSkippedWorkbook(result)).toBe(false);
    if (!isSkippedWorkbook(result)) expect(result.items).toEqual([{ partnerSku: "TEST-SKU-001", quantity: 50 }]);
  });

  it("accepts a template containing only SKU, quantity, and ASN columns", async () => {
    const folder = await tempFolder();
    const filePath = join(folder, "01 店铺5 minimal.xlsx");
    await createWorkbookFixture(filePath, {
      headers: ["约仓SKU", "数量", "ASN"],
      rows: [["TEST-SKU-001", 50, ""]],
    });

    await expect(readAsnJob(filePath)).resolves.toMatchObject({ items: [{ partnerSku: "TEST-SKU-001", quantity: 50 }] });
  });

  it.each([
    ["missing sheet", { sheetName: "Wrong" }, /sheet.*约仓/i],
    ["wrong headers", { headers: ["SKU", "数量", "ASN", "运单号", "箱号"] }, /header/i],
    ["blank SKU", { rows: [["", 1, "", "", ""]] }, /SKU/i],
    ["fractional quantity", { rows: [["TEST-SKU", 1.5, "", "", ""]] }, /positive integer/i],
    ["zero quantity", { rows: [["TEST-SKU", 0, "", "", ""]] }, /positive integer/i],
    ["duplicate SKU", { rows: [["TEST-SKU", 1, "", "", ""], ["test-sku", 2, "", "", ""]] }, /duplicate/i],
  ])("rejects %s", async (_name, options, expected) => {
    const folder = await tempFolder();
    const filePath = join(folder, "01 店铺1 invalid.xlsx");
    await createWorkbookFixture(filePath, options);
    await expect(readAsnJob(filePath)).rejects.toThrow(expected);
  });

  it("returns skippedAsn when C2 is nonblank", async () => {
    const folder = await tempFolder();
    const filePath = join(folder, "01 店铺1 complete.xlsx");
    await createWorkbookFixture(filePath, { c2: "ASN-B-123N" });
    await expect(readAsnJob(filePath)).resolves.toMatchObject({ skippedAsn: "ASN-B-123N", filePath });
  });
});

describe("workbook write-back", () => {
  it("writes only C2 and preserves all other workbook content and sampled styles", async () => {
    const folder = await tempFolder();
    const filePath = join(folder, "01 店铺3 preserve.xlsx");
    await createWorkbookFixture(filePath);
    const job = await readAsnJob(filePath);
    if (isSkippedWorkbook(job)) throw new Error("unexpected skipped fixture");
    const before = await workbookSnapshot(filePath) as Array<{ rows: Array<{ cells: unknown[] }> }>;

    await writeAsnNumber(job, "ASN-B-987N");

    const after = await workbookSnapshot(filePath) as Array<{ rows: Array<{ cells: unknown[] }> }>;
    const beforeComparable = structuredClone(before);
    const afterComparable = structuredClone(after);
    beforeComparable[0]!.rows[1]!.cells[3] = "ASN-B-987N";
    expect(afterComparable).toEqual(beforeComparable);

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.readFile(filePath);
    expect(reopened.getWorksheet("约仓")?.getCell("C2").text).toBe("ASN-B-987N");
  });

  it("writes only C2 in the six-column template", async () => {
    const folder = await tempFolder();
    const filePath = join(folder, "01 店铺5 spacer-preserve.xlsx");
    await createWorkbookFixture(filePath, {
      headers: ["约仓SKU", "数量", "ASN", "", "运单号", "箱号"],
      rows: [["TEST-SKU-001", 50, "", "", "TRACKING", "BOX-1"]],
    });
    const job = await readAsnJob(filePath);
    if (isSkippedWorkbook(job)) throw new Error("unexpected skipped fixture");
    const before = await workbookSnapshot(filePath) as Array<{ rows: Array<{ cells: unknown[] }> }>;

    await writeAsnNumber(job, "ASN-SPACER-1");

    const after = await workbookSnapshot(filePath) as Array<{ rows: Array<{ cells: unknown[] }> }>;
    const expected = structuredClone(before);
    expected[0]!.rows[1]!.cells[3] = "ASN-SPACER-1";
    expect(after).toEqual(expected);
  });

  it("refuses write-back when the file fingerprint changed", async () => {
    const folder = await tempFolder();
    const filePath = join(folder, "01 店铺4 changed.xlsx");
    await createWorkbookFixture(filePath);
    const job = await readAsnJob(filePath);
    if (isSkippedWorkbook(job)) throw new Error("unexpected skipped fixture");
    const bytes = await readFile(filePath);
    await writeFile(filePath, Buffer.concat([bytes, Buffer.from("changed")]));
    await expect(writeAsnNumber(job, "ASN-B-111N")).rejects.toThrow(/changed/i);
  });

  it("reads WPS namespace-prefixed OOXML and changes only C2 while retaining its style", async () => {
    const folder = await tempFolder();
    const filePath = join(folder, "01 店铺1 WPS.xlsx");
    await createPrefixedWorkbookFixture(filePath);
    const beforeZip = await JSZip.loadAsync(await readFile(filePath));
    const beforeStyles = await beforeZip.file("xl/styles.xml")!.async("string");
    const job = await readAsnJob(filePath);
    if (isSkippedWorkbook(job)) throw new Error("unexpected skipped fixture");
    expect(job.items).toEqual([{ partnerSku: "TEST-WPS-SKU", quantity: 3 }]);

    await writeAsnNumber(job, "ASN-WPS-1");

    await expect(readAsnJob(filePath)).resolves.toMatchObject({ filePath, skippedAsn: "ASN-WPS-1" });
    const afterZip = await JSZip.loadAsync(await readFile(filePath));
    expect(await afterZip.file("xl/styles.xml")!.async("string")).toBe(beforeStyles);
    const sheetXml = await afterZip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheetXml).toMatch(/r="C2" s="7" t="inlineStr"/);
    expect(sheetXml).toContain("ASN-WPS-1");
  });
});
