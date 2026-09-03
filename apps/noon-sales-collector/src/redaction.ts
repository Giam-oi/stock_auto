function redactText(value: string): string {
  return value
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, "[REDACTED_PEM]")
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, "Cookie: [REDACTED]")
    .replace(/([?&]|\b)key=[^&\s\"']+/gi, "$1key=[REDACTED]")
    .replace(/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^\s\"']+/gi, "[REDACTED_WEBHOOK_URL]");
}

export function redactSecrets(value: unknown): string {
  if (value instanceof Error) return redactText(value.message);
  return redactText(String(value));
}
