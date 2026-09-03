export type WaitFunction = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

async function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function runResidentLoop(
  check: () => Promise<void>,
  intervalMs: number,
  signal?: AbortSignal,
  wait: WaitFunction = defaultWait,
): Promise<void> {
  while (!signal?.aborted) {
    try { await check(); } catch { /* A temporary failure is retried next cycle. */ }
    if (signal?.aborted) break;
    await wait(intervalMs, signal);
  }
}
