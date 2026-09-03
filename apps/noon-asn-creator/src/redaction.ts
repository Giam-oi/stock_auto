const SENSITIVE_KEY = /^(?:private[_-]?key|key[_-]?id|cookie|set-cookie|authorization|token|jwt|password|secret)$/i;
const PEM = /-----BEGIN(?: RSA)? PRIVATE KEY-----[\s\S]*?-----END(?: RSA)? PRIVATE KEY-----/g;
const JWT = /\b[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{3,}\b/g;

function redactString(value: string): string {
  return value.replace(PEM, "[REDACTED]").replace(JWT, "[REDACTED]");
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item),
    ]));
  }
  return value;
}
