/** Base class of everything the Gemini market-data client throws on purpose. */
export class GeminiError extends Error {
  constructor(
    message: string,
    /** Path and query of the request, without the host. */
    public readonly endpoint: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GeminiError";
  }
}

/** Gemini answered with a non-2xx status. Retried only for 429 and 5xx. */
export class GeminiHttpError extends GeminiError {
  constructor(
    endpoint: string,
    public readonly status: number,
    /** First characters of the response body, for the log. */
    public readonly bodySnippet: string,
  ) {
    super(`Gemini ${endpoint} answered HTTP ${status.toString()}: ${bodySnippet}`, endpoint);
    this.name = "GeminiHttpError";
  }
}

/** The request never produced a response (DNS, reset, timeout), after every attempt. */
export class GeminiNetworkError extends GeminiError {
  constructor(
    endpoint: string,
    public readonly attempts: number,
    cause: unknown,
  ) {
    super(
      `Gemini ${endpoint} unreachable after ${attempts.toString()} attempt(s): ${describeError(cause)}`,
      endpoint,
      { cause },
    );
    this.name = "GeminiNetworkError";
  }
}

/**
 * Gemini answered 2xx with a body we cannot trust: not JSON, or not the shape we rely on.
 * Never retried: a schema mismatch does not heal on its own.
 */
export class GeminiResponseError extends GeminiError {
  constructor(
    endpoint: string,
    /** Where the first problem is, e.g. `data[3].contracts[0].instrumentSymbol`; `$` is the root. */
    public readonly path: string,
    /** Every problem found, as `path: message`. */
    public readonly issues: readonly string[],
  ) {
    super(
      `Gemini ${endpoint} returned an unexpected payload at ${path}: ${issues[0] ?? "unknown"}`,
      endpoint,
    );
    this.name = "GeminiResponseError";
  }
}

/** An instrument was reported settled twice with two different outcomes. Needs a human. */
export class SettlementConflictError extends Error {
  constructor(
    public readonly instrumentSymbol: string,
    public readonly recorded: string,
    public readonly received: string,
  ) {
    super(
      `Instrument ${instrumentSymbol} is already settled "${recorded}", refusing to overwrite with "${received}"`,
    );
    this.name = "SettlementConflictError";
  }
}

/** "TypeError: fetch failed (caused by Error: getaddrinfo ENOTFOUND …)": `fetch` hides the reason in `cause`. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === undefined ? "" : ` (caused by ${describeError(error.cause)})`;
  return `${error.name}: ${error.message}${cause}`;
}
