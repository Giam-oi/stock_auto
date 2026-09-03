const SENSITIVE_FIELD = /^(?:privatekey|keyid|token|cookie|cookieheader|setcookie|authorization|webhook|webhookurl|wecomwebhookurl)$/i;

function redactText(value: string): string {
  return value
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, "[REDACTED_PEM]")
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, "Cookie: [REDACTED]")
    .replace(/([?&]|\b)key=[^&\s"']+/gi, "$1key=[REDACTED]")
    .replace(/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^\s"']+/gi, "[REDACTED_WEBHOOK_URL]");
}

function normalizeFieldName(value: string): string {
  return value.replace(/[-_]/g, "").toLowerCase();
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value ?? null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...redact(Object.fromEntries(Object.entries(value)), seen) as Record<string, unknown>,
    };
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_FIELD.test(normalizeFieldName(key))
      ? "[REDACTED]"
      : redact(item, seen);
  }
  return output;
}

export function redactSecrets(value: unknown): unknown {
  return redact(value, new WeakSet());
}
