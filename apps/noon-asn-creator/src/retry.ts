import { AsnCreatorError } from "./errors.js";

export interface RetryOptions {
  delaysMs: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
  maximumDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

function defaultShouldRetry(error: unknown): boolean {
  return error instanceof AsnCreatorError && error.retryable;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryResult<T>> {
  const sleep = options.sleep ?? (async (milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const maximumDelayMs = options.maximumDelayMs ?? 60_000;
  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      return { value: await operation(attempts), attempts };
    } catch (error) {
      const fallbackDelay = options.delaysMs[attempts - 1];
      if (fallbackDelay === undefined || !shouldRetry(error)) throw error;
      const requestedDelay = error instanceof AsnCreatorError && error.retryAfterMs !== undefined
        ? error.retryAfterMs
        : fallbackDelay;
      await sleep(Math.min(Math.max(0, requestedDelay), maximumDelayMs));
    }
  }
}
