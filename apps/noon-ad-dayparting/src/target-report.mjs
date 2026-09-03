import ExcelJS from "exceljs";

const numeric = (value) => {
  const resolved = value && typeof value === "object" && "result" in value ? value.result : value;
  return Number.isFinite(Number(resolved)) ? Number(resolved) : 0;
};

const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function targetMetricKey({ campaignName, targetingType, targetValue, strategy }) {
  return [campaignName, targetingType, targetValue, strategy].map(normalized).join("|");
}

export function indexTargetMetrics(rows) {
  const index = new Map();
  for (const row of rows) {
    const key = targetMetricKey(row);
    const existing = index.get(key) ?? [];
    existing.push(row);
    index.set(key, existing);
  }
  return index;
}

export function aggregateTargetMetrics(rows) {
  const total = rows.reduce((output, row) => {
    for (const key of ["views", "clicks", "orders", "spends", "revenue"]) output[key] += Number(row[key] ?? 0);
    return output;
  }, { views: 0, clicks: 0, orders: 0, spends: 0, revenue: 0 });
  total.roas = total.spends > 0 ? total.revenue / total.spends : 0;
  return total;
}

export async function targetMetricsFromReport(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("(Product) Target");
  if (!sheet) throw new Error("Advertising report is missing (Product) Target");
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value ?? ""));
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const source = Object.fromEntries(headers.map((header, index) => [header, row.getCell(index + 1).value ?? null]));
    const spends = numeric(source.Spends);
    const revenue = numeric(source.Revenue);
    rows.push({
      campaignName: String(source["Campaign Name"] ?? ""),
      targetingType: String(source["Targeting Type"] ?? "").toLowerCase(),
      targetValue: String(source["Target Value"] ?? ""),
      strategy: String(source.Strategy ?? "").toLowerCase(),
      views: numeric(source.Views), clicks: numeric(source.Clicks), orders: numeric(source.Orders),
      spends, revenue, roas: spends > 0 ? revenue / spends : 0,
    });
  });
  return { rows, index: indexTargetMetrics(rows), total: aggregateTargetMetrics(rows) };
}
