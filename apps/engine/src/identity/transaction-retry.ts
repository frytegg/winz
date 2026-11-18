import type { Logger } from "pino";

/**
 * Postgres errors after which a whole transaction is safe to run again: Postgres rolled it back
 * and nothing it did is left. The same two codes the web sign-in retries
 * (apps/web/lib/server/auth.ts, `writeUsersRow`).
 */
export const RETRYABLE_TRANSACTION_CODES: ReadonlySet<string> = new Set([
  "40P01", // deadlock_detected
  "40001", // serialization_failure
]);

/** Attempts of one transaction, the first included, before a retryable error is given up on. */
export const TRANSACTION_ATTEMPTS = 5;
/** Wait before the second attempt; doubled for each later one (10, 20, 40, 80 ms). */
export const TRANSACTION_BACKOFF_MS = 10;

/** The `code` of a Postgres error, or undefined for anything else. */
export function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error;
  return typeof code === "string" ? code : undefined;
}

/**
 * A transaction failed with a deadlock or a serialization failure on every one of its attempts.
 * `cause` is the last attempt's error. The message names the work and the code only: never the
 * data the transaction wrote.
 */
export class TransactionRetryExhaustedError extends Error {
  constructor(
    readonly what: string,
    readonly attempts: number,
    readonly code: string,
    options: { cause: unknown },
  ) {
    super(`${what} failed with ${code} on each of its ${String(attempts)} attempts`, options);
    this.name = "TransactionRetryExhaustedError";
  }
}

export interface TransactionRetryOptions {
  /** Short name of the work, for the logs and the error: never personal data. */
  what: string;
  /** Receives one warning per retry. */
  logger: Logger;
  /** Default `TRANSACTION_ATTEMPTS`. */
  attempts?: number;
  /** Default `TRANSACTION_BACKOFF_MS`. */
  backoffMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `run` (one whole transaction, begun inside it) and runs it again when it fails with a
 * deadlock or a serialization failure, at most `attempts` times in all, waiting `backoffMs` before
 * the second attempt and twice as long before each later one. Every retry is logged as a warning
 * with the code and the attempt that failed. Any other error is let through at once, unchanged;
 * a retryable error on the last attempt becomes `TransactionRetryExhaustedError`.
 */
export async function retryTransaction<T>(
  run: () => Promise<T>,
  options: TransactionRetryOptions,
): Promise<T> {
  const attempts = options.attempts ?? TRANSACTION_ATTEMPTS;
  const backoffMs = options.backoffMs ?? TRANSACTION_BACKOFF_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error: unknown) {
      const code = postgresErrorCode(error);
      if (code === undefined || !RETRYABLE_TRANSACTION_CODES.has(code)) throw error;
      if (attempt >= attempts) {
        throw new TransactionRetryExhaustedError(options.what, attempt, code, { cause: error });
      }
      options.logger.warn(
        { what: options.what, code, attempt, of: attempts },
        "transaction retried after a deadlock or a serialization failure",
      );
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
}
