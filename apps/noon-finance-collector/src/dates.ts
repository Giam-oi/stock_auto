function shanghaiDate(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function defaultFinanceRange(now = new Date()): { fromDate: string; toDate: string } {
  const today = shanghaiDate(now);
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 24));
  return { fromDate: formatDate(from), toDate: formatDate(to) };
}

export function validateDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Date must use YYYY-MM-DD: ${value}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (formatDate(date) !== value) throw new Error(`Date must be a real calendar date: ${value}`);
  return value;
}

export function validateRange(fromDate: string, toDate: string): void {
  validateDate(fromDate);
  validateDate(toDate);
  if (fromDate > toDate) throw new Error("fromDate must not be after toDate");
}
