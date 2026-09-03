import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

function worksheetRows(sheet) {
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value ?? ""));
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    rows.push(Object.fromEntries(headers.map((header, index) => [header, row.getCell(index + 1).value ?? null])));
  });
  return rows;
}

export async function loadSaleableInventory(inventoryRoot, reportDate, store) {
  const compactDate = reportDate.replaceAll("-", "");
  const path = join(inventoryRoot, reportDate, `UAE${store.index}.${compactDate}.csv`);
  const workbook = new ExcelJS.Workbook();
  const sheet = await workbook.csv.read(Readable.from(await readFile(path)));
  const quantities = new Map();
  let snapshotAt = null;
  for (const row of worksheetRows(sheet)) {
    if (String(row.id_partner) !== store.partnerId || String(row.inventory_type).toLowerCase() !== "saleable") continue;
    const sku = String(row.sku ?? "").trim();
    const qty = Number(row.qty ?? 0);
    if (!sku || !Number.isFinite(qty)) continue;
    quantities.set(sku, (quantities.get(sku) ?? 0) + qty);
    if (row.inventory_snapshot_at && (!snapshotAt || String(row.inventory_snapshot_at) > snapshotAt)) {
      snapshotAt = String(row.inventory_snapshot_at);
    }
  }
  return { path, quantities, snapshotAt };
}

export function hasSaleableFbnProduct(details, inventory) {
  const products = details?.selectedProducts?.products ?? details?.data?.selectedProducts?.products ?? [];
  return products.some((product) => product?.isActive === true
    && product.flags?.includes("fbn")
    && Number(inventory.quantities.get(String(product.productSku)) ?? 0) > 0);
}

