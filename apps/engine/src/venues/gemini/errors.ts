import { VenueError } from "../errors";

/**
 * What went wrong with a request to Gemini's private API, in the terms the caller acts on:
 *
 * - `auth`: the key, its signature or its role was refused. Nothing works until a human fixes the
 *   key: never retried.
 * - `nonce`: the nonce was refused (not above the previous one, or outside the server's window).
 *   Retried once by the client with a nonce above the clock; thrown when that fails too.
 * - `insufficient_funds`: the account cannot pay for the order.
 * - `terms`: the account has not accepted the latest Prediction Markets terms.
 * - `rate_limit`: HTTP 429, still refused after the client's backoff.
 * - `network`: no answer (connection refused, reset, timeout). For an order placement or a cancel
 *   the outcome is unknown: the order may exist.
 * - `server`: a 5xx answer (also unknown for a placement).
 * - `not_found`: the order (or the endpoint) does not exist.
 * - `refused`: any other 4xx about the request itself (invalid price, unknown symbol, market not
 *   open, an order that cannot be cancelled): definitive, nothing was created.
 * - `response`: a 2xx answer that is not what the documentation describes.
 * - `aborted`: the caller's signal stopped the request.
 */
export const GEMINI_FAILURE_KINDS = [
  "auth",
  "nonce",
  "insufficient_funds",
  "terms",
  "rate_limit",
  "network",
  "server",
  "not_found",
  "refused",
  "response",
  "aborted",
] as const;
export type GeminiFailureKind = (typeof GEMINI_FAILURE_KINDS)[number];

export interface GeminiErrorDetails {
  /** The private API path, e.g. "/v1/prediction-markets/order". Never the payload. */
  path: string;
  /** HTTP status, or null when no answer came back. */
  status: number | null;
  /** Gemini's machine-readable reason (`reason`, `code` or `error` of the body), when given. */
  reason: string | null;
  /** Gemini's human-readable message, cut to 300 characters, when given. */
  detail: string | null;
}

/**
 * Base class of everything the Gemini order adapter throws on purpose. Its message names the path,
 * the status and Gemini's reason, never the key, the secret, the payload or the signature.
 */
export class GeminiVenueError extends VenueError {
  readonly path: string;
  readonly status: number | null;
  readonly reason: string | null;
  readonly detail: string | null;

  constructor(
    readonly kind: GeminiFailureKind,
    details: GeminiErrorDetails,
    options?: { cause?: unknown; summary?: string },
  ) {
    const status = details.status === null ? "no answer" : `HTTP ${details.status.toString()}`;
    const reason = details.reason === null ? "" : ` ${details.reason}`;
    const detail = details.detail === null ? "" : `: ${details.detail}`;
    super(options?.summary ?? `gemini ${details.path} ${status}${reason}${detail}`, {
      cause: options?.cause,
    });
    this.name = "GeminiVenueError";
    this.path = details.path;
    this.status = details.status;
    this.reason = details.reason;
    this.detail = details.detail;
  }
}

export class GeminiAuthError extends GeminiVenueError {
  constructor(details: GeminiErrorDetails) {
    super("auth", details);
    this.name = "GeminiAuthError";
  }
}

export class GeminiNonceError extends GeminiVenueError {
  constructor(details: GeminiErrorDetails) {
    super("nonce", details);
    this.name = "GeminiNonceError";
  }
}

export class GeminiInsufficientFundsError extends GeminiVenueError {
  constructor(details: GeminiErrorDetails) {
    super("insufficient_funds", details);
    this.name = "GeminiInsufficientFundsError";
  }
}

export class GeminiTermsNotAcceptedError extends GeminiVenueError {
  constructor(details: GeminiErrorDetails) {
    super("terms", details);
    this.name = "GeminiTermsNotAcceptedError";
  }
}

export class GeminiRateLimitError extends GeminiVenueError {
  constructor(
    details: GeminiErrorDetails,
    /** Tries made, the first one included, all answered 429. */
    readonly attempts: number,
    /** Gemini's `Retry-After`, in milliseconds, when it sent one. */
    readonly retryAfterMs: number | null = null,
  ) {
    super("rate_limit", details);
    this.name = "GeminiRateLimitError";
  }
}

export class GeminiNetworkError extends GeminiVenueError {
  constructor(details: GeminiErrorDetails, cause: unknown) {
    super("network", details, { cause });
    this.name = "GeminiNetworkError";
  }
}

export class GeminiServerError extends GeminiVenueError {
  constructor(details: GeminiErrorDetails) {
    super("server", details);
    this.name = "GeminiServerError";
  }
}

export class GeminiNotFoundError extends GeminiVenueError {
  constructor(details: GeminiErrorDetails) {
    super("not_found", details);
    this.name = "GeminiNotFoundError";
  }
}

export class GeminiRefusedError extends GeminiVenueError {
  constructor(details: GeminiErrorDetails) {
    super("refused", details);
    this.name = "GeminiRefusedError";
  }
}

export class GeminiResponseError extends GeminiVenueError {
  constructor(details: GeminiErrorDetails, cause?: unknown) {
    super("response", details, { cause });
    this.name = "GeminiResponseError";
  }
}

export class GeminiAbortedError extends GeminiVenueError {
  constructor(path: string) {
    super("aborted", { path, status: null, reason: null, detail: null });
    this.name = "GeminiAbortedError";
  }
}

/**
 * An order the adapter placed whose state Gemini cannot show yet: the placement got no answer, or
 * it is not listed yet among the active orders nor in the history. The caller asks again later.
 */
export class GeminiOrderUnknownYetError extends GeminiVenueError {
  constructor(clientOrderId: string, why: string) {
    super(
      "not_found",
      { path: "(order lookup)", status: null, reason: null, detail: null },
      { summary: `order ${clientOrderId} cannot be read back yet: ${why}` },
    );
    this.name = "GeminiOrderUnknownYetError";
  }
}

/** Reasons of the authentication layer (developer.gemini.com/authentication/api-key, /roles). */
const AUTH_REASONS = new Set([
  "InvalidSignature",
  "InvalidApiKey",
  "MissingRole",
  "MissingApikeyHeader",
  "MissingPayloadHeader",
  "MissingSignatureHeader",
  "MissingSecurityHeaders",
  "AmbiguousAuthentication",
  "ACCOUNT_GROUP_BLOCKED",
  "RemoteAddressForbidden",
  "AccountClosed",
]);

const DETAIL_MAX = 300;

function cut(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX)}…` : flat;
}

/**
 * Gemini's error body, in either documented shape: `{result: "error", reason, message}` (the
 * authentication layer and the classic API, developer.gemini.com/error-codes) or
 * `{error, message, code?, field?}` (Prediction Markets errors, the `Error` and
 * `PredictionMarketsError` schemas of prediction-markets.yaml). Anything else gives nulls.
 */
export function readErrorBody(text: string): { reason: string | null; detail: string | null } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { reason: null, detail: text.trim() === "" ? null : cut(text) };
  }
  if (typeof body !== "object" || body === null) return { reason: null, detail: null };
  const record = body as Record<string, unknown>;
  const pick = (key: string): string | null =>
    typeof record[key] === "string" && record[key] !== "" ? (record[key] as string) : null;
  const reason = pick("reason") ?? pick("code") ?? pick("error");
  const message = pick("message");
  // In the `{error: "...", code: "..."}` shape the error field is the message itself.
  const detail = message ?? (pick("code") !== null ? pick("error") : null);
  return { reason, detail: detail === null ? null : cut(detail) };
}

/** The typed error for a non-2xx answer. */
export function errorFromResponse(
  path: string,
  status: number,
  bodyText: string,
  attempts = 1,
  retryAfterMs: number | null = null,
): GeminiVenueError {
  const { reason, detail } = readErrorBody(bodyText);
  const details: GeminiErrorDetails = { path, status, reason, detail };
  if (status === 429 || reason === "RateLimit") {
    return new GeminiRateLimitError(details, attempts, retryAfterMs);
  }
  if (reason === "InvalidNonce" || reason === "MissingNonce") return new GeminiNonceError(details);
  if (reason !== null && AUTH_REASONS.has(reason)) return new GeminiAuthError(details);
  if (status === 401 || status === 403) return new GeminiAuthError(details);
  if (reason === "InsufficientFunds" || status === 406) {
    return new GeminiInsufficientFundsError(details);
  }
  if (reason === "TERMS_NOT_ACCEPTED") return new GeminiTermsNotAcceptedError(details);
  if (status === 404 || reason === "OrderNotFound") return new GeminiNotFoundError(details);
  if (status >= 500 || reason === "Maintenance" || reason === "System") {
    return new GeminiServerError(details);
  }
  return new GeminiRefusedError(details);
}
