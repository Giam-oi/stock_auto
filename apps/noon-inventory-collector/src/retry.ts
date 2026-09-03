export interface RetryOptions {
  delaysMs: number[];
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

function isRetryable(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "retryable" in error && (error as { retryable?: unknown }).retryable === true;
}

function attachAttempts(error: unknown, attempts: number): void {
  if (typeof error !== "object" || error === null) {
    return;
  }
  try {
    Object.defineProperty(error, "attempts", {
      value: attempts,
      configurable: true,
      enumerable: true,
    });
  } catch {
    // The original error remains authoritative even if it is non-extensible.
  }
}

const defaultSleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const maximumAttempts = options.delaysMs.length + 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return { value: await operation(attempt), attempts: attempt };
    } catch (error) {
      attachAttempts(error, attempt);
      if (!isRetryable(error) || attempt === maximumAttempts) {
        throw error;
      }
      await sleep(options.delaysMs[attempt - 1]!);
    }
  }
  throw new Error("Retry loop exited unexpectedly");
}
