function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

const END_DAY = { UAE: 3, KSA: 4 };

export function latestCompletedWeek(siteCode, now = new Date()) {
  const endDay = END_DAY[siteCode];
  if (endDay === undefined) throw new Error(`Unsupported advertising site: ${siteCode}`);
  const shanghai = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const today = new Date(Date.UTC(shanghai.getFullYear(), shanghai.getMonth(), shanghai.getDate()));
  const daysSinceEnd = (today.getUTCDay() - endDay + 7) % 7;
  let end = new Date(today);
  end.setUTCDate(end.getUTCDate() - daysSinceEnd);
  if (end.getTime() >= today.getTime()) end.setUTCDate(end.getUTCDate() - 7);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { fromDate: isoDate(start), toDate: isoDate(end) };
}

export function latestCompletedUaeWeek(now = new Date()) {
  return latestCompletedWeek("UAE", now);
}
