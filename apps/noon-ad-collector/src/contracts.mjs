export const STORES = [
  { index: 1, credentialFile: "noon1-API.json", projectCode: "PRJ42958", partnerId: "42958" },
  { index: 2, credentialFile: "noon2-API.json", projectCode: "PRJ55651", partnerId: "55651" },
  { index: 3, credentialFile: "noon3-API.json", projectCode: "PRJ61683", partnerId: "61683" },
  { index: 4, credentialFile: "noon4-API.json", projectCode: "PRJ65553", partnerId: "65553" },
  { index: 5, credentialFile: "noon5-API.json", projectCode: "PRJ75299", partnerId: "75299" },
  { index: 6, credentialFile: "noon6-API.json", projectCode: "PRJ363826", partnerId: "363826" },
];

export const SITES = {
  UAE: { code: "UAE", locale: "en-ae", startDay: 4, endDay: 3 },
  KSA: { code: "KSA", locale: "en-sa", startDay: 5, endDay: 4 },
};

export function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Date must use YYYY-MM-DD: ${value}`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return value;
}

export function validateRange(siteCode, fromDate, toDate) {
  const site = SITES[siteCode];
  if (!site) throw new Error(`Unsupported advertising site: ${siteCode}`);
  validateDate(fromDate);
  validateDate(toDate);
  if (fromDate > toDate) throw new Error("fromDate must not be after toDate");
  const days = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000;
  const startDay = new Date(`${fromDate}T00:00:00Z`).getUTCDay();
  const endDay = new Date(`${toDate}T00:00:00Z`).getUTCDay();
  if (days !== 6 || startDay !== site.startDay || endDay !== site.endDay) {
    throw new Error(`${siteCode} advertising range has invalid weekdays`);
  }
}
