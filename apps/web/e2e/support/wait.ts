/** Waiting helpers of the e2e harness: bounded waits that leave no timer behind. */

/** A wait of the harness ran out of time; every other failure is the thing waited on failing. */
export class WaitTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaitTimeoutError";
  }
}

/**
 * Resolves as `promise` does, or rejects with `WaitTimeoutError` after `ms` milliseconds. The
 * timer is cleared as soon as the race settles, so nothing outlives the wait.
 */
export async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new WaitTimeoutError(`timed out after ${ms.toString()} ms waiting for ${what}`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
