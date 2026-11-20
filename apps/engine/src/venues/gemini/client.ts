import type { Logger } from "pino";
import type { z } from "zod";

import {
  GeminiAbortedError,
  GeminiNetworkError,
  GeminiNonceError,
  GeminiRateLimitError,
  GeminiResponseError,
  GeminiServerError,
  errorFromResponse,
  type GeminiVenueError,
} from "./errors";
import { NonceGuard, type NonceMode } from "./nonce";
import {
  geminiAcceptTermsSchema,
  geminiBookSchema,
  geminiCancelSchema,
  geminiEventsSchema,
  geminiOrderSchema,
  geminiOrdersSchema,
  geminiTermsStatusSchema,
  parseGeminiJson,
  type GeminiListedEvent,
  type GeminiOrder,
  type GeminiOrders,
  type GeminiTermsStatus,
} from "./schemas";
import { privateHeaders, type GeminiPayload, type PayloadValue } from "./signer";

/** The part of a `fetch` response the client reads. The global `Response` satisfies it. */
export interface GeminiFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** The part of `fetch` the client uses. The global `fetch` satisfies it. */
export type GeminiFetch = (
  url: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<GeminiFetchResponse>;

export interface GeminiPrivateClientOptions {
  /** `GEMINI_SANDBOX_API_URL`, e.g. "https://api.sandbox.gemini.com". */
  baseUrl: string;
  /** Kept in this object only: never logged, never put in an error. */
  apiKey: string;
  apiSecret: string;
  logger: Logger;
  /** How the key checks nonces (see `NonceGuard`). Default `incremental`. */
  nonceMode?: NonceMode;
  fetch?: GeminiFetch;
  /** Epoch milliseconds. Default `Date.now`. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Per attempt. Default 10 000 ms. */
  timeoutMs?: number;
  /** Tries of a request answered 429, the first one included. Default 5. */
  rateLimitAttempts?: number;
  /** First wait after a 429 when Gemini gives no `Retry-After`; doubled each time. Default 1 000. */
  rateLimitBaseDelayMs?: number;
  /** Longest wait after a 429. Default 16 000. */
  rateLimitMaxDelayMs?: number;
  /**
   * Smallest gap between two private requests. Gemini allows 600 a minute and recommends at most
   * 5 a second (developer.gemini.com/rate-limit): default 250 ms, 4 a second.
   */
  minIntervalMs?: number;
  /** Tries of a READ that got no answer (network error, 5xx), the first included. Default 3. */
  readAttempts?: number;
}

export interface CallOptions {
  signal?: AbortSignal;
}

/** Fields of `POST /v1/prediction-markets/order` (`OrderRequest`). */
export interface GeminiOrderRequest {
  symbol: string;
  orderType: "limit";
  side: "buy" | "sell";
  /** Contracts, as a decimal string ("1.00"). */
  quantity: string;
  /** Dollars, 0 to 1 ("0.65"). */
  price: string;
  outcome: "yes" | "no";
  timeInForce: "good-til-cancel" | "immediate-or-cancel" | "fill-or-kill";
  makerOrCancel?: boolean;
}

export interface OrderHistoryQuery {
  symbol?: string;
  status?: "filled" | "cancelled";
  /** Inclusive, epoch ms, on the order's close time. */
  from?: number;
  /** Exclusive, epoch ms. */
  to?: number;
  limit?: number;
  offset?: number;
}

export interface PublicBookLevel {
  price: string;
  amount: string;
}

export const PM_ORDER_PATH = "/v1/prediction-markets/order";
export const PM_CANCEL_PATH = "/v1/prediction-markets/order/cancel";
export const PM_ACTIVE_ORDERS_PATH = "/v1/prediction-markets/orders/active";
export const PM_ORDER_HISTORY_PATH = "/v1/prediction-markets/orders/history";
export const PM_TERMS_STATUS_PATH = "/v1/prediction-markets/terms/status";
export const PM_TERMS_ACCEPT_PATH = "/v1/prediction-markets/terms/accept";
export const PM_EVENTS_PATH = "/v1/prediction-markets/events";

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted === true || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/** A function, not an inline test: TypeScript would keep a narrowing across the awaits. */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function describeCause(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

/**
 * Gemini's private REST API for Prediction Markets orders, with the key of one account.
 *
 * - Every private request is signed (`signer.ts`) and carries a nonce from one `NonceGuard`;
 *   requests are sent one at a time, so nonces reach Gemini in the order they were made.
 * - HTTP 429: waits (`Retry-After`, else 1 s doubled each time up to 16 s) and sends again with a
 *   new nonce, up to `rateLimitAttempts` tries; a 429 means the request was not processed.
 * - `InvalidNonce`: sent once more with a fresh nonce; refused again, it is thrown.
 * - No answer or a 5xx: a READ is tried again (`readAttempts`); a WRITE (placement, cancel) is
 *   never sent twice, because Gemini may have processed it: the error says the outcome is unknown.
 * - Logs name the path, the status, the attempt and the time taken. The key, the secret, the
 *   payload and the signature are never logged nor put in an error.
 */
export class GeminiPrivateClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly logger: Logger;
  private readonly guard: NonceGuard;
  private readonly fetchImpl: GeminiFetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly rateLimitAttempts: number;
  private readonly rateLimitBaseDelayMs: number;
  private readonly rateLimitMaxDelayMs: number;
  private readonly minIntervalMs: number;
  private readonly readAttempts: number;
  /** The tail of the queue of private requests: each one starts when the previous has ended. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastSentMs = Number.NEGATIVE_INFINITY;

  constructor(options: GeminiPrivateClientOptions) {
    if (options.apiKey.length === 0 || options.apiSecret.length === 0) {
      throw new RangeError("GeminiPrivateClient: the API key and secret must not be empty");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.logger = options.logger;
    this.guard = new NonceGuard(options.nonceMode ?? "incremental");
    this.fetchImpl =
      options.fetch ?? ((url, init) => fetch(url, init) as Promise<GeminiFetchResponse>);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.rateLimitAttempts = options.rateLimitAttempts ?? 5;
    this.rateLimitBaseDelayMs = options.rateLimitBaseDelayMs ?? 1_000;
    this.rateLimitMaxDelayMs = options.rateLimitMaxDelayMs ?? 16_000;
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.readAttempts = options.readAttempts ?? 3;
  }

  /** The base URL requests go to, e.g. for a log line. */
  get url(): string {
    return this.baseUrl;
  }

  // -------------------------------------------------------------------------------------------
  // Prediction Markets endpoints
  // -------------------------------------------------------------------------------------------

  /** `POST /v1/prediction-markets/order`. A write: never sent twice. */
  async placeOrder(request: GeminiOrderRequest, options: CallOptions = {}): Promise<GeminiOrder> {
    const fields: Record<string, PayloadValue> = {
      symbol: request.symbol,
      orderType: request.orderType,
      side: request.side,
      quantity: request.quantity,
      price: request.price,
      outcome: request.outcome,
      timeInForce: request.timeInForce,
    };
    if (request.makerOrCancel !== undefined) fields.makerOrCancel = request.makerOrCancel;
    return this.privateCall("POST", PM_ORDER_PATH, fields, geminiOrderSchema, {
      ...options,
      write: true,
    });
  }

  /** `POST /v1/prediction-markets/order/cancel`. A write: never sent twice. */
  async cancelOrder(orderId: string, options: CallOptions = {}): Promise<{ result: string }> {
    if (!/^\d+$/.test(orderId)) throw new RangeError(`not a Gemini order id: ${orderId}`);
    return this.privateCall(
      "POST",
      PM_CANCEL_PATH,
      { orderId: BigInt(orderId) },
      geminiCancelSchema,
      { ...options, write: true },
    );
  }

  /** `POST /v1/prediction-markets/orders/active`: one page (at most 100). */
  async activeOrders(
    query: { symbol?: string; limit?: number; offset?: number } = {},
    options: CallOptions = {},
  ): Promise<GeminiOrders> {
    const fields: Record<string, PayloadValue> = {};
    if (query.symbol !== undefined) fields.symbol = query.symbol;
    if (query.limit !== undefined) fields.limit = query.limit;
    if (query.offset !== undefined) fields.offset = query.offset;
    return this.privateCall("POST", PM_ACTIVE_ORDERS_PATH, fields, geminiOrdersSchema, options);
  }

  /** Every active order, page after page of 100. */
  async allActiveOrders(symbol?: string, options: CallOptions = {}): Promise<GeminiOrder[]> {
    const pageSize = 100;
    const orders: GeminiOrder[] = [];
    for (let offset = 0; offset < 10_000; offset += pageSize) {
      const page = await this.activeOrders(
        { ...(symbol === undefined ? {} : { symbol }), limit: pageSize, offset },
        options,
      );
      orders.push(...page.orders);
      if (page.orders.length < pageSize) return orders;
    }
    return orders;
  }

  /** `POST /v1/prediction-markets/orders/history`. */
  async orderHistory(query: OrderHistoryQuery, options: CallOptions = {}): Promise<GeminiOrders> {
    const fields: Record<string, PayloadValue> = {};
    for (const key of ["symbol", "status", "from", "to", "limit", "offset"] as const) {
      const value = query[key];
      if (value !== undefined) fields[key] = value;
    }
    return this.privateCall("POST", PM_ORDER_HISTORY_PATH, fields, geminiOrdersSchema, options);
  }

  /** `GET /v1/prediction-markets/terms/status` (private: signed like the others). */
  async termsStatus(options: CallOptions = {}): Promise<GeminiTermsStatus> {
    return this.privateCall("GET", PM_TERMS_STATUS_PATH, {}, geminiTermsStatusSchema, options);
  }

  /** `POST /v1/prediction-markets/terms/accept`. */
  async acceptTerms(options: CallOptions = {}): Promise<{ success: boolean }> {
    return this.privateCall("POST", PM_TERMS_ACCEPT_PATH, {}, geminiAcceptTermsSchema, {
      ...options,
      write: true,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Public endpoints (no key)
  // -------------------------------------------------------------------------------------------

  /** `GET /v1/prediction-markets/events?status=active&category=…`: one page. */
  async listActiveEvents(
    query: { category: string; limit: number; offset: number },
    options: CallOptions = {},
  ): Promise<{ events: GeminiListedEvent[]; total: number | null }> {
    const params = new URLSearchParams({
      status: "active",
      category: query.category,
      limit: query.limit.toString(),
      offset: query.offset.toString(),
    });
    const body = await this.publicGet(
      `${PM_EVENTS_PATH}?${params.toString()}`,
      geminiEventsSchema,
      options,
    );
    return { events: body.data, total: body.pagination?.total ?? null };
  }

  /** `GET /v1/book/{symbol}`: price levels, best first, as Gemini sends them. */
  async getBook(
    symbol: string,
    options: CallOptions = {},
  ): Promise<{ bids: PublicBookLevel[]; asks: PublicBookLevel[] }> {
    return this.publicGet(`/v1/book/${encodeURIComponent(symbol)}`, geminiBookSchema, options);
  }

  // -------------------------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------------------------

  private async publicGet<T extends z.ZodType>(
    pathAndQuery: string,
    schema: T,
    options: CallOptions,
  ): Promise<z.infer<T>> {
    const path = pathAndQuery.split("?")[0] ?? pathAndQuery;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const { status, text, retryAfterMs } = await this.send(
          "GET",
          pathAndQuery,
          { Accept: "application/json" },
          options,
          path,
        );
        if (status >= 200 && status < 300) return this.parse(path, text, schema);
        const error = errorFromResponse(path, status, text, attempt, retryAfterMs);
        if (!(await this.retryable(error, attempt, true, options))) throw error;
      } catch (error: unknown) {
        if (!(error instanceof GeminiNetworkError)) throw error;
        if (!(await this.retryable(error, attempt, true, options))) throw error;
      }
    }
  }

  /**
   * One private request, through the queue: nonce, signature, send, and the retries described on
   * the class. `write` requests are never re-sent after a network error or a 5xx.
   */
  private privateCall<T extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    fields: Record<string, PayloadValue>,
    schema: T,
    options: CallOptions & { write?: boolean },
  ): Promise<z.infer<T>> {
    const run = async (): Promise<z.infer<T>> => {
      let attempt = 0;
      let nonceRetried = false;
      for (;;) {
        attempt += 1;
        if (aborted(options.signal)) throw new GeminiAbortedError(path);
        const gap = this.lastSentMs + this.minIntervalMs - this.now();
        if (gap > 0) await this.sleep(gap, options.signal);
        const next = this.guard.next(this.now());
        if (next.waitMs > 0) await this.sleep(next.waitMs, options.signal);
        if (aborted(options.signal)) throw new GeminiAbortedError(path);
        const payload: GeminiPayload = { request: path, nonce: next.nonce, ...fields };
        const headers = privateHeaders(this.apiKey, this.apiSecret, payload);
        let answer: { status: number; text: string; retryAfterMs: number | null };
        try {
          answer = await this.send(method, path, headers, options, path);
        } catch (error: unknown) {
          if (
            error instanceof GeminiNetworkError &&
            options.write !== true &&
            (await this.retryable(error, attempt, true, options))
          ) {
            continue;
          }
          throw error;
        }
        const { status, text, retryAfterMs } = answer;
        if (status >= 200 && status < 300) return this.parse(path, text, schema);
        const error = errorFromResponse(path, status, text, attempt, retryAfterMs);
        if (error instanceof GeminiNonceError && !nonceRetried) {
          nonceRetried = true;
          this.logger.warn(
            { path, status, reason: error.reason },
            "gemini refused the nonce: sending once more with a fresh one",
          );
          continue;
        }
        if (await this.retryable(error, attempt, options.write !== true, options)) continue;
        throw error;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Whether to try again after `error`, having waited as needed. 429: always (until the tries
   * run out). Network and 5xx: only when `canRepeat` (reads).
   */
  private async retryable(
    error: GeminiVenueError,
    attempt: number,
    canRepeat: boolean,
    options: CallOptions,
  ): Promise<boolean> {
    if (aborted(options.signal)) return false;
    if (error instanceof GeminiRateLimitError) {
      if (attempt >= this.rateLimitAttempts) return false;
      const delayMs = error.retryAfterMs ?? this.backoff(attempt);
      this.logger.warn(
        { path: error.path, attempt, delayMs },
        "gemini answered 429 (rate limit): waiting before sending again",
      );
      await this.sleep(delayMs, options.signal);
      return !aborted(options.signal);
    }
    if (canRepeat && (error instanceof GeminiNetworkError || error instanceof GeminiServerError)) {
      if (attempt >= this.readAttempts) return false;
      const delayMs = this.backoff(attempt);
      this.logger.warn(
        { path: error.path, attempt, delayMs, err: error.message },
        "gemini read failed: trying again",
      );
      await this.sleep(delayMs, options.signal);
      return !aborted(options.signal);
    }
    return false;
  }

  private backoff(attempt: number): number {
    return Math.min(this.rateLimitBaseDelayMs * 2 ** (attempt - 1), this.rateLimitMaxDelayMs);
  }

  private async send(
    method: "GET" | "POST",
    pathAndQuery: string,
    headers: Record<string, string>,
    options: CallOptions,
    path: string,
  ): Promise<{ status: number; text: string; retryAfterMs: number | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const startedMs = this.now();
    this.lastSentMs = startedMs;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, {
        method,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      const elapsedMs = this.now() - startedMs;
      this.logger.debug({ method, path, status: response.status, elapsedMs }, "gemini answered");
      let retryAfterMs: number | null = null;
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
          retryAfterMs = Math.min(seconds * 1000, this.rateLimitMaxDelayMs);
        }
      }
      return { status: response.status, text, retryAfterMs };
    } catch (error: unknown) {
      if (aborted(options.signal)) throw new GeminiAbortedError(path);
      const timedOut = controller.signal.aborted;
      throw new GeminiNetworkError(
        {
          path,
          status: null,
          reason: timedOut ? "Timeout" : null,
          detail: timedOut
            ? `no answer within ${this.timeoutMs.toString()} ms`
            : describeCause(error),
        },
        error,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  private parse<T extends z.ZodType>(path: string, text: string, schema: T): z.infer<T> {
    let body: unknown;
    try {
      body = parseGeminiJson(text);
    } catch (error: unknown) {
      throw new GeminiResponseError(
        { path, status: 200, reason: "InvalidJson", detail: "the answer is not JSON" },
        error,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new GeminiResponseError(
        { path, status: 200, reason: "UnexpectedShape", detail: issues },
        parsed.error,
      );
    }
    return parsed.data as z.infer<T>;
  }
}
