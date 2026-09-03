export function isRetryableSalesError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|timed out|timeout|HTTP 429|HTTP 5\d\d/i.test(message);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableSalesError(error)) throw error;
      await wait(2_000 * attempt);
    }
  }
  throw lastError;
}
