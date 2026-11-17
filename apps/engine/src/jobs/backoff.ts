import { JobConfigError } from "./errors";

/**
 * Delay in milliseconds before the next try, given the number of the attempt that just failed
 * (1 for the first run of the job).
 */
export type BackoffFn = (attempt: number) => number;

export interface ExponentialBackoffOptions {
  /** Delay after the first failure, before jitter. */
  baseMs: number;
  /** Upper bound of the delay, whatever the attempt. */
  maxMs: number;
  /** Growth between two attempts. Default 2. */
  factor?: number;
  /**
   * Share of the delay that is randomised, between 0 (none) and 1 (full jitter). With 0.5 the
   * delay falls uniformly in [50 %, 100 %] of the exponential value. Default 0.5. Jitter only
   * ever shortens the delay, so `maxMs` stays a true cap.
   */
  jitter?: number;
  /** Source of randomness in [0, 1). Injected by tests. */
  random?: () => number;
}

/**
 * Exponential backoff with jitter, capped: `min(maxMs, baseMs * factor^(attempt - 1))`, then
 * shortened by a random share. The jitter keeps jobs that failed together (an outage of Stripe or
 * of the RPC) from all coming back in the same instant.
 */
export function exponentialBackoff(options: ExponentialBackoffOptions): BackoffFn {
  const { baseMs, maxMs } = options;
  const factor = options.factor ?? 2;
  const jitter = options.jitter ?? 0.5;
  const random = options.random ?? Math.random;
  if (!Number.isFinite(baseMs) || baseMs < 0) {
    throw new JobConfigError(`backoff baseMs must be a finite number >= 0, got ${String(baseMs)}`);
  }
  if (!Number.isFinite(maxMs) || maxMs < baseMs) {
    throw new JobConfigError(
      `backoff maxMs must be a finite number >= baseMs, got ${String(maxMs)}`,
    );
  }
  if (!Number.isFinite(factor) || factor < 1) {
    throw new JobConfigError(`backoff factor must be a finite number >= 1, got ${String(factor)}`);
  }
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
    throw new JobConfigError(`backoff jitter must be between 0 and 1, got ${String(jitter)}`);
  }
  return (attempt: number): number => {
    const exponent = Math.max(0, Math.floor(attempt) - 1);
    // factor^exponent overflows to Infinity for large attempts; min() brings it back to the cap.
    const raw = Math.min(maxMs, baseMs * Math.pow(factor, exponent));
    return Math.round(raw * (1 - jitter * random()));
  };
}

/** Production default: 2 s, 4 s, 8 s, ... capped at 5 min, each shortened by up to half. */
export const defaultBackoff: BackoffFn = exponentialBackoff({ baseMs: 2_000, maxMs: 300_000 });
