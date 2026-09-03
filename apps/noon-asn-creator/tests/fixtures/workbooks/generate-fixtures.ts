import ExcelJS from "exceljs";
import JSZip from "jszip";
import { writeFile } from "node:fs/promises";

export interface FixtureOptions {
  sheetName?: string;
  headers?: string[];
  rows?: unknown[][];
  c2?: string;
}

export async function createWorkbookFixture(filePath: string, options: FixtureOptions = {}): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NoonASNCreator tests";
  const sheet = workbook.addWorksheet(options.sheetName ?? "约仓");
  const headers = options.headers ?? ["约仓SKU", "数量", "ASN", "运单号", "箱号"];
  sheet.addRow(headers);
  for (const row of options.rows ?? [["TEST-SKU-001", 50, "", "", ""], ["TEST-SKU-002", 25, "", "", ""]]) {
    sheet.addRow(row);
  }
  if (options.c2 !== undefined) sheet.getCell("C2").value = options.c2;

  sheet.getRow(1).height = 24;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 20;
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const audit = workbook.addWorksheet("核对");
  audit.getCell("A1").value = "合计";
  audit.getCell("B1").value = { formula: "SUM('约仓'!B2:B100)", result: 75 };
  audit.getCell("B1").numFmt = "0";
  await workbook.xlsx.writeFile(filePath);
}

export async function createPrefixedWorkbookFixture(filePath: string): Promise<void> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `\uFEFF<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="约仓" sheetId="1" r:id="R1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></x:sheets></x:workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `\uFEFF<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="R1"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="utf-8"?><x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>约仓SKU</x:v></x:c><x:c r="B1" t="str"><x:v>数量</x:v></x:c><x:c r="C1" t="str"><x:v>ASN</x:v></x:c><x:c r="D1" t="str"><x:v>运单号</x:v></x:c><x:c r="E1" t="str"><x:v>箱号</x:v></x:c></x:row><x:row r="2"><x:c r="A2" s="5" t="str"><x:v>TEST-WPS-SKU</x:v></x:c><x:c r="B2" s="8" t="n"><x:v>3</x:v></x:c><x:c r="C2" s="7"/></x:row></x:sheetData></x:worksheet>`);
  await writeFile(filePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
