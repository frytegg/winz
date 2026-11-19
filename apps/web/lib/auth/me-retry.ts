import { isAbortError, isApiError } from "@/lib/api/client";

/**
 * What a failed `GET /api/me` means for the session (review 2.2). Shared by both sign-in providers,
 * so that neither decides on its own.
 *
 * - `401` or `403`: the API says this person is not signed in for us. Only then is the session
 *   ended and the person anonymous.
 * - Anything else (no answer, a `5xx`, the `503` the server sends when it cannot check a token, an
 *   answer of an unexpected shape): the API could not say. The session is kept, the request is
 *   asked again after 1 s, 2 s and 4 s, and after that the person sees « can't reach Winz » with a
 *   retry. A cold start of the API must never sign a merchant out.
 */

export const ME_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

export type MeFailure = "anonymous" | "unreachable";

/** `401` and `403` only: every other failure says nothing about who the person is. */
export function classifyMeFailure(error: unknown): MeFailure {
  if (isApiError(error) && (error.status === 401 || error.status === 403)) return "anonymous";
  return "unreachable";
}

export type MeRetryStep =
  { kind: "anonymous" } | { kind: "retry"; delayMs: number } | { kind: "unreachable" };

/**
 * The step after the `failedAttempts`-th failure in a row (1 for the first), `error` being the last
 * one: end the session, wait and ask again, or give up and show « can't reach Winz ».
 */
export function nextMeRetryStep(error: unknown, failedAttempts: number): MeRetryStep {
  if (classifyMeFailure(error) === "anonymous") return { kind: "anonymous" };
  const delayMs = ME_RETRY_DELAYS_MS[failedAttempts - 1];
  return delayMs === undefined ? { kind: "unreachable" } : { kind: "retry", delayMs };
}

/** The end of `loadMeWithRetry` when it has no `me` to give: `failure` says what to do. */
export class MeLoadError extends Error {
  readonly failure: MeFailure;
  readonly attempts: number;

  constructor(failure: MeFailure, attempts: number, cause: unknown) {
    super(
      failure === "anonymous"
        ? "The API refused this session"
        : `The API could not be reached after ${attempts.toString()} attempts`,
      { cause },
    );
    this.name = "MeLoadError";
    this.failure = failure;
    this.attempts = attempts;
  }
}

export interface MeRetryOptions {
  /** Waits `ms` (injected, so that the tests run without real time). */
  sleep: (ms: number) => Promise<void>;
  /** Stops between attempts: the provider unmounted, or a newer load replaced this one. */
  signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException("The load of /api/me was cancelled", "AbortError");
}

/**
 * Runs `load` until it answers, following `nextMeRetryStep`. Throws a `MeLoadError` with the
 * failure, or an `AbortError` when `signal` stops it.
 */
export async function loadMeWithRetry<T>(
  load: () => Promise<T>,
  { sleep, signal }: MeRetryOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    if (signal?.aborted === true) throw abortError();
    try {
      return await load();
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      const step = nextMeRetryStep(error, attempt);
      if (step.kind !== "retry") throw new MeLoadError(step.kind, attempt, error);
      await sleep(step.delayMs);
    }
  }
}

/** `setTimeout` as a promise: the real `sleep` of the providers. */
export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
