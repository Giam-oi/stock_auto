import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import JSZip from "jszip";

const folder = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Fixture folder argument is required");
await mkdir(folder, { recursive: true });
const zip = new JSZip();
zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>`);
zip.file("xl/workbook.xml", `<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="约仓" sheetId="1" r:id="R1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></x:sheets></x:workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>`);
zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>约仓SKU</x:v></x:c><x:c r="B1" t="str"><x:v>数量</x:v></x:c><x:c r="C1" t="str"><x:v>ASN</x:v></x:c><x:c r="D1" t="str"><x:v>运单号</x:v></x:c><x:c r="E1" t="str"><x:v>箱号</x:v></x:c></x:row><x:row r="2"><x:c r="A2" t="str"><x:v>SMOKE-SKU</x:v></x:c><x:c r="B2" t="n"><x:v>1</x:v></x:c><x:c r="C2" t="str"><x:v>ASN-SMOKE-DONE</x:v></x:c></x:row></x:sheetData></x:worksheet>`);
await writeFile(join(folder, "01 店铺1 completed.xlsx"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
