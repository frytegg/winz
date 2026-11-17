/**
 * What the event ingestion logs about an error. Never the error object itself: viem puts the
 * full RPC URL in an `HttpRequestError`'s message, stack and `url` property, and a provider such
 * as QuickNode carries its API token in the URL's path. Only basic-auth credentials are stripped
 * by viem, so every URL is reduced here to its origin (scheme, host and port).
 */

/** Longest message kept per error of the chain, in characters. */
const MAX_MESSAGE_LENGTH = 300;

/** Errors of the `cause` chain kept in a summary. */
const MAX_CAUSE_DEPTH = 4;

/** Anything shaped like an absolute URL: `scheme://` followed by non-blank characters. */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+/gi;

/** `text` with every URL replaced by its origin, or by `[url]` when it cannot be parsed. */
export function redactUrls(text: string): string {
  return text.replace(URL_PATTERN, (match: string): string => {
    try {
      const url = new URL(match);
      return url.host === "" ? `${url.protocol}[redacted]` : `${url.protocol}//${url.host}`;
    } catch {
      return "[url]";
    }
  });
}

export interface ErrorSummary {
  type: string;
  message: string;
  code?: string | number;
  /** Origin of the URL the error was about (viem's `url`), without its path or query. */
  origin?: string;
  cause?: ErrorSummary;
}

function summarizeAt(error: unknown, depth: number): ErrorSummary {
  if (error instanceof Error || (typeof error === "object" && error !== null)) {
    const record = error as Record<string, unknown>;
    const type =
      typeof record.name === "string"
        ? record.name
        : error instanceof Error
          ? error.constructor.name
          : "object";
    // viem's `shortMessage` is the first line of its message, without the URL and request body.
    const raw =
      typeof record.shortMessage === "string"
        ? record.shortMessage
        : typeof record.message === "string"
          ? record.message
          : "";
    const summary: ErrorSummary = {
      type: redactUrls(type),
      message: redactUrls(raw).slice(0, MAX_MESSAGE_LENGTH),
    };
    if (typeof record.code === "number") summary.code = record.code;
    else if (typeof record.code === "string") summary.code = redactUrls(record.code);
    if (typeof record.url === "string") summary.origin = redactUrls(record.url);
    if (depth < MAX_CAUSE_DEPTH && record.cause !== undefined && record.cause !== null) {
      summary.cause = summarizeAt(record.cause, depth + 1);
    }
    return summary;
  }
  return { type: typeof error, message: redactUrls(String(error)).slice(0, MAX_MESSAGE_LENGTH) };
}

/**
 * A loggable summary of `error`: type, short message and code of it and of its causes, with
 * every URL reduced to its origin. No stack, no request body, no raw properties.
 */
export function summarizeError(error: unknown): ErrorSummary {
  return summarizeAt(error, 0);
}
