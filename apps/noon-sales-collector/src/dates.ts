function shanghaiDate(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)));
}

function daysBefore(date: Date, days: number): string {
  return new Date(date.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function defaultReportRange(now = new Date()): { fromDate: string; toDate: string } | null {
  const today = shanghaiDate(now);
  const dayOfWeek = today.getUTCDay();
  if (dayOfWeek === 1) {
    return { fromDate: daysBefore(today, 3), toDate: daysBefore(today, 1) };
  }
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;
  const yesterday = daysBefore(today, 1);
  return { fromDate: yesterday, toDate: yesterday };
}
