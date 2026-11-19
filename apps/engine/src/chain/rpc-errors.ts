/**
 * What a node's refusal means, read from the error viem throws (or from any error with the same
 * shape: `code`, `status`, `details`, `cause`). One reading for the whole engine: the log poller,
 * the request limiter and the transaction sender all ask these functions.
 */

/**
 * - `rate-limited`: the node refuses this client for now, whatever the request. Asking again at
 *   once feeds the limit: wait, then ask the same thing again.
 * - `too-large`: the node refuses the size of this request (block range or result size). Asking
 *   for less works; waiting does not.
 * - `other`: anything else (unreachable node, timeout, internal error, a revert).
 */
export type RpcRefusal = "rate-limited" | "too-large" | "other";

/** EIP-1474's "limit exceeded". Nodes use it for rate limits and for size limits alike. */
export const LIMIT_EXCEEDED_CODE = -32005;
/** Arc's public RPC: `{"code":-32012,"message":"requested range too large"}` (HTTP 200). */
export const RANGE_TOO_LARGE_CODE = -32012;
/** QuickNode's own rate-limit code ("N/second request limit reached"). */
export const QUICKNODE_RATE_LIMIT_CODE = -32007;

const MAX_CAUSE_DEPTH = 12;

/** Wordings of a rate limit, in the node's message. */
const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  /rate[\s_-]?limit/i,
  /too many requests/i,
  /request limit/i,
  /quota/i,
  /capacity/i,
  /throttl/i,
];

/** EIP-1474 / geth's code of a revert carrying revert data. */
export const EXECUTION_REVERTED_CODE = 3;

/** Wordings of a revert, in the node's message. */
const REVERT_PATTERNS: readonly RegExp[] = [/execution reverted/i, /\breverted\b/i];

/** Wordings of a refusal of the size of an `eth_getLogs` request. */
const SIZE_REFUSAL_PATTERNS: readonly RegExp[] = [
  // "block range", and QuickNode's "limited to a 10,000 blocks range" (plural).
  /blocks? range/i,
  /range (is )?too (large|wide|big)/i,
  /exceeds? .*range/i,
  /max(imum)? .*range/i,
  /too many (results|logs|blocks)/i,
  /more than \d+ (results|logs|blocks)/i,
  /query returned more than/i,
  /response (size|is too)/i,
  /log response size exceeded/i,
];

interface ChainFacts {
  codes: number[];
  statuses: number[];
  /** What the node said: `details` of viem's errors, `message` of any other error. */
  messages: string[];
}

/** Codes, HTTP statuses and node messages of an error and of every error of its `cause` chain. */
function factsOf(error: unknown): ChainFacts {
  const facts: ChainFacts = { codes: [], statuses: [], messages: [] };
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null;) {
    if (typeof current === "string") {
      facts.messages.push(current);
      break;
    }
    if (typeof current !== "object") break;
    const record = current as Record<string, unknown>;
    if (typeof record.code === "number") facts.codes.push(record.code);
    if (typeof record.status === "number") facts.statuses.push(record.status);
    // viem's `message` repeats the request body and the URL; its `details` is the node's own
    // words. An error without `shortMessage` is not viem's: its message is the node's.
    if (typeof record.details === "string") facts.messages.push(record.details);
    else if (typeof record.shortMessage !== "string" && typeof record.message === "string") {
      facts.messages.push(record.message);
    }
    current = record.cause;
    depth += 1;
  }
  return facts;
}

/**
 * Tells a rate limit from a size refusal. In this order:
 *
 * 1. HTTP 429, or code 429 or -32007 (QuickNode): rate limited, whatever the message.
 * 1b. A revert (code 3, or a message saying "execution reverted" / "reverted"): `other`. The
 *    revert string is the contract's words, not the node's, so "execution reverted: capacity
 *    exceeded" must not read as a rate limit (which would cool down every request of the process
 *    and send the call again before its caller sees the revert).
 * 2. A message that speaks of a rate limit, too many requests, a request limit, a quota, a
 *    capacity or throttling: rate limited.
 * 3. A message that speaks of a block range or of too many results, or code -32012: too large.
 *    Infura answers a range with too many logs with -32005 and "query returned more than 10000
 *    results": the message is what tells it apart.
 * 4. A bare -32005 whose message says neither: **rate limited**. EIP-1474 names it "limit
 *    exceeded", and Arc's public RPC uses it for its rate limit (and -32012 for its range limit).
 *    Read as a rate limit, a refusal that never ends makes the poller wait longer and longer at
 *    the same range: slower, never faster. Read as a size refusal, it made the poller halve its
 *    range and ask again at once, which is how one rate limit became thousands of requests.
 */
export function classifyRpcRefusal(error: unknown): RpcRefusal {
  const { codes, statuses, messages } = factsOf(error);
  if (statuses.includes(429)) return "rate-limited";
  if (codes.includes(429) || codes.includes(QUICKNODE_RATE_LIMIT_CODE)) return "rate-limited";
  if (
    codes.includes(EXECUTION_REVERTED_CODE) ||
    messages.some((message) => REVERT_PATTERNS.some((pattern) => pattern.test(message)))
  ) {
    return "other";
  }
  if (messages.some((message) => RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message)))) {
    return "rate-limited";
  }
  if (codes.includes(RANGE_TOO_LARGE_CODE)) return "too-large";
  if (messages.some((message) => SIZE_REFUSAL_PATTERNS.some((pattern) => pattern.test(message)))) {
    return "too-large";
  }
  if (codes.includes(LIMIT_EXCEEDED_CODE)) return "rate-limited";
  return "other";
}

/** True when the node refuses this client for now (see `classifyRpcRefusal`). */
export function isRateLimitedError(error: unknown): boolean {
  return classifyRpcRefusal(error) === "rate-limited";
}

/** `Retry-After` of the HTTP answer carried by the error, in milliseconds, when there is one. */
export function retryAfterMs(error: unknown, nowMs: number): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === "object" && current !== null;) {
    const record = current as Record<string, unknown>;
    const headers = record.headers;
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      const value = headers.get("Retry-After");
      if (value !== null) {
        const seconds = Number.parseInt(value, 10);
        if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
        const date = Date.parse(value);
        if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
      }
    }
    current = record.cause;
    depth += 1;
  }
  return undefined;
}

/** HTTP statuses viem retries (`shouldRetry` in viem/utils/buildRequest.ts), 429 excepted. */
const RETRIED_STATUSES = new Set([403, 408, 413, 500, 502, 503, 504]);

/**
 * Whether a failed request is worth sending again after a short delay, rate limits and size
 * refusals excepted (the caller handles those first). The rule of viem's own retry
 * (`shouldRetry` in viem/utils/buildRequest.ts, viem 2.58), read on the outermost error as viem
 * does:
 *
 * - an abort is never retried;
 * - a JSON-RPC error is retried for code -1 (unknown) and -32603 (internal error), never for
 *   -32601 / -32004 (method not served); any other code only by its HTTP status, if it has one;
 * - an HTTP error is retried for 403, 408, 413, 500, 502, 503 and 504;
 * - anything else (network failure, timeout) is retried.
 *
 * One change: -32005, 429 and -32007 are not retried here, since `classifyRpcRefusal` reads them
 * first (a rate limit is retried after a cool-down, a size refusal not at all).
 */
export function isRetryableRpcError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return true;
  const record = error as Record<string, unknown>;
  if (record.name === "AbortError") return false;
  const status = factsOf(error).statuses[0];
  if (typeof record.code === "number") {
    const code = record.code;
    if (code === -1 || code === -32603) return true;
    if (code === LIMIT_EXCEEDED_CODE || code === 429 || code === QUICKNODE_RATE_LIMIT_CODE) {
      return false;
    }
    if (code === -32601 || code === -32004) return false;
    if (status === undefined) return false;
  }
  if (status !== undefined) return RETRIED_STATUSES.has(status);
  return true;
}
