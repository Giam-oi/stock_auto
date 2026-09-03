import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from "@xmldom/xmldom";
import JSZip from "jszip";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

export interface OoxmlSheetData {
  values: ReadonlyMap<string, string | number>;
  sheetPath: string;
}

function parseXml(source: string, label: string): XmlDocument {
  const normalized = source.replace(/^\uFEFF/, "").trimStart();
  const document = new DOMParser({ errorHandler: () => undefined }).parseFromString(normalized, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`Invalid OOXML ${label}`);
  }
  return document;
}

async function requiredText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`OOXML part is missing: ${path}`);
  return file.async("string");
}

function elements(document: XmlDocument | XmlElement, namespace: string, localName: string): XmlElement[] {
  return Array.from(document.getElementsByTagNameNS(namespace, localName));
}

function normalizePartPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1).replaceAll("\\", "/");
  const parts: string[] = [];
  for (const part of `xl/${target}`.replaceAll("\\", "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

async function locateSheet(zip: JSZip, sheetName: string): Promise<string> {
  const workbook = parseXml(await requiredText(zip, "xl/workbook.xml"), "workbook");
  const sheet = elements(workbook, MAIN_NS, "sheet").find((candidate) => candidate.getAttribute("name") === sheetName);
  if (!sheet) throw new Error(`OOXML sheet is missing: ${sheetName}`);
  const relationshipId = sheet.getAttributeNS(OFFICE_REL_NS, "id") ?? sheet.getAttribute("r:id");
  if (!relationshipId) throw new Error("OOXML sheet relationship is missing");
  const relationships = parseXml(await requiredText(zip, "xl/_rels/workbook.xml.rels"), "workbook relationships");
  const relationship = elements(relationships, PACKAGE_REL_NS, "Relationship").find(
    (candidate) => candidate.getAttribute("Id") === relationshipId,
  );
  const target = relationship?.getAttribute("Target");
  if (!target) throw new Error("OOXML worksheet target is missing");
  return normalizePartPath(target);
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const part = zip.file("xl/sharedStrings.xml");
  if (!part) return [];
  const document = parseXml(await part.async("string"), "shared strings");
  return elements(document, MAIN_NS, "si").map((item) => elements(item, MAIN_NS, "t").map((text) => text.textContent ?? "").join(""));
}

function cellValue(cell: XmlElement, strings: readonly string[]): string | number {
  const type = cell.getAttribute("t") ?? "n";
  if (type === "inlineStr") return elements(cell, MAIN_NS, "t").map((node) => node.textContent ?? "").join("");
  const raw = elements(cell, MAIN_NS, "v")[0]?.textContent ?? "";
  if (type === "s") return strings[Number(raw)] ?? "";
  if (type === "n" && raw !== "") {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
  }
  return raw;
}

export async function readOoxmlSheet(bytes: Buffer, sheetName: string): Promise<OoxmlSheetData> {
  const zip = await JSZip.loadAsync(bytes);
  const sheetPath = await locateSheet(zip, sheetName);
  const document = parseXml(await requiredText(zip, sheetPath), "worksheet");
  const strings = await sharedStrings(zip);
  const values = new Map<string, string | number>();
  for (const cell of elements(document, MAIN_NS, "c")) {
    const address = cell.getAttribute("r");
    if (address) values.set(address.toUpperCase(), cellValue(cell, strings));
  }
  return { values, sheetPath };
}

function qualified(document: XmlDocument, localName: string): XmlElement {
  const prefix = document.documentElement?.prefix;
  return document.createElementNS(MAIN_NS, prefix ? `${prefix}:${localName}` : localName);
}

export async function updateOoxmlTextCell(
  bytes: Buffer,
  sheetName: string,
  address: string,
  value: string,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const sheetPath = await locateSheet(zip, sheetName);
  const document = parseXml(await requiredText(zip, sheetPath), "worksheet");
  const normalizedAddress = address.toUpperCase();
  const cell = elements(document, MAIN_NS, "c").find((candidate) => candidate.getAttribute("r")?.toUpperCase() === normalizedAddress);
  if (!cell) throw new Error(`OOXML cell is missing: ${normalizedAddress}`);
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.setAttribute("t", "inlineStr");
  const inlineString = qualified(document, "is");
  const text = qualified(document, "t");
  text.appendChild(document.createTextNode(value));
  inlineString.appendChild(text);
  cell.appendChild(inlineString);
  zip.file(sheetPath, new XMLSerializer().serializeToString(document));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
