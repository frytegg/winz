/** Base class of everything the job queue throws or expects handlers to throw on purpose. */
export class JobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobError";
  }
}

/**
 * Thrown by a handler when retrying cannot help (the input is wrong, the business state forbids
 * it). The job goes to `dead` at once, whatever attempts it has left.
 */
export class PermanentJobError extends JobError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermanentJobError";
  }
}

/**
 * Thrown by a handler that is not failing but cannot proceed yet (a dependency is not ready, a
 * rate limit asks to come back later). The job is retried `delayMs` from now and the event is
 * logged as a deferral, not as an error. It still consumes an attempt, so a job that keeps
 * deferring ends up `dead` like any other.
 */
export class RetryLaterError extends JobError {
  public readonly delayMs: number;

  constructor(delayMs: number, message?: string, options?: { cause?: unknown }) {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new JobConfigError(
        `RetryLaterError needs a finite delay >= 0 ms, got ${String(delayMs)}`,
      );
    }
    super(message ?? `retry in ${delayMs.toString()} ms`, options);
    this.name = "RetryLaterError";
    this.delayMs = delayMs;
  }
}

/** The payload of a job does not match the schema its handler was registered with. */
export class InvalidJobPayloadError extends PermanentJobError {
  constructor(kind: string, details: string) {
    super(`invalid payload for job kind "${kind}": ${details}`);
    this.name = "InvalidJobPayloadError";
  }
}

/**
 * Reason of the `AbortSignal` given to a handler: the worker is stopping, or it no longer owns
 * the job (another worker took it over after the visibility timeout).
 */
export class JobAbortedError extends JobError {
  constructor(
    public readonly reason: "worker-stopping" | "lock-lost",
    message: string,
  ) {
    super(message);
    this.name = "JobAbortedError";
  }
}

/** `enqueueJob` was given something it cannot store, or could not resolve an idempotency key. */
export class JobEnqueueError extends JobError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobEnqueueError";
  }
}

/** The worker was configured or used wrongly: a programming error, never retried. */
export class JobConfigError extends JobError {
  constructor(message: string) {
    super(message);
    this.name = "JobConfigError";
  }
}

/** `Name: message`, followed by the chain of causes. This is what `jobs.last_error` stores. */
export function describeJobError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === undefined ? "" : ` (caused by ${describeJobError(error.cause)})`;
  return `${error.name}: ${error.message}${cause}`;
}
