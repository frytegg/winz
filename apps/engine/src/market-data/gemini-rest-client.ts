import type { Logger } from "pino";
import type { z } from "zod";

import { parseContracts, parsePriceBps } from "@winz/shared";
import type { Book, BookLevel } from "@winz/shared";

import { GeminiHttpError, GeminiNetworkError, GeminiResponseError, describeError } from "./errors";
import {
  GEMINI_BUCKET_DEFAULTS,
  TokenBucket,
  systemClock,
  systemSleep,
  type Clock,
  type RateLimiter,
  type Sleep,
} from "./rate-limiter";
import {
  bookResponseSchema,
  eventsResponseSchema,
  type Pagination,
  type RawEvent,
} from "./schemas";

/** The part of a `fetch` response the client reads. The global `Response` satisfies it. */
export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** The part of `fetch` the client uses. The global `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal },
) => Promise<FetchResponseLike>;

export interface GeminiRestClientOptions {
  /** `GEMINI_API_URL`, e.g. "https://api.gemini.com". */
  baseUrl: string;
  logger: Logger;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
  now?: Clock;
  sleep?: Sleep;
  /** Source of jitter in [0, 1); defaults to `Math.random`. */
  random?: () => number;
  /** Shared limiter, when several clients must stay under one budget. */
  limiter?: RateLimiter;
  /** Total tries per request, the first one included. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

export interface ListEventsParams {
  /** Gemini category, e.g. "Sports". */
  category?: string;
  /** Free-text search on the event title. */
  search?: string;
  limit: number;
  offset: number;
}

export interface ListSettledParams {
  category?: string;
  limit?: number;
  offset?: number;
}

export interface ListAllParams {
  category?: string;
  search?: string;
  pageSize?: number;
  /** Safety stop if `pagination.total` keeps growing or lies. */
  maxPages?: number;
}

export interface EventsPage {
  events: RawEvent[];
  pagination: Pagination;
}

export const SPORTS_CATEGORY = "Sports";
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 60;
/** A `Retry-After` longer than this is not honoured in-request; the caller's next poll retries. */
const MAX_RETRY_AFTER_MS = 60_000;
/** Generic on purpose: nothing about the project or its owner leaves the machine. */
const USER_AGENT = "node";

const EVENTS_PATH = "/v1/prediction-markets/events";
const RECENTLY_SETTLED_PATH = "/v1/prediction-markets/events/recently-settled";

/**
 * Read-only client of the public Gemini Prediction Markets REST API (no API key).
 *
 * Every request takes a token from the rate limiter, every response is validated,
 * 429 / 5xx / network failures are retried with exponential backoff and jitter,
 * any other 4xx fails at once.
 */
export class GeminiRestClient {
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly fetchImpl: FetchLike;
  private readonly now: Clock;
  private readonly sleep: Sleep;
  private readonly random: () => number;
  private readonly limiter: RateLimiter;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;

  constructor(options: GeminiRestClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.logger = options.logger;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? systemClock;
    this.sleep = options.sleep ?? systemSleep;
    this.random = options.random ?? Math.random;
    this.limiter =
      options.limiter ??
      new TokenBucket({ ...GEMINI_BUCKET_DEFAULTS, now: this.now, sleep: this.sleep });
    this.maxAttempts = options.maxAttempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 8_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (this.maxAttempts < 1) throw new RangeError("GeminiRestClient: maxAttempts must be >= 1");
  }

  /** One page of active events. Games carry their other markets in `events`. */
  async listActiveEvents(params: ListEventsParams): Promise<EventsPage> {
    const body = await this.request(
      EVENTS_PATH,
      {
        limit: params.limit.toString(),
        offset: params.offset.toString(),
        status: "active",
        category: params.category,
        search: params.search,
      },
      eventsResponseSchema,
    );
    return { events: body.data, pagination: body.pagination };
  }

  /** Every active event matching the filter, all pages, in API order (duplicates included). */
  async listAllActiveEvents(params: ListAllParams = {}): Promise<RawEvent[]> {
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES;
    const events: RawEvent[] = [];
    let offset = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.listActiveEvents({
        category: params.category,
        search: params.search,
        limit: pageSize,
        offset,
      });
      events.push(...result.events);
      offset += result.events.length;
      if (result.events.length === 0 || offset >= result.pagination.total) return events;
    }
    this.logger.warn(
      { maxPages, pageSize, fetched: events.length },
      "gemini events listing truncated: page limit reached",
    );
    return events;
  }

  /** Every active sports event, all pages. About 20 requests for ~950 events. */
  listAllSportsEvents(): Promise<RawEvent[]> {
    return this.listAllActiveEvents({ category: SPORTS_CATEGORY });
  }

  /** Most recently settled events first. Without a category the list is mostly 5-minute crypto markets. */
  async listRecentlySettled(params: ListSettledParams = {}): Promise<EventsPage> {
    const body = await this.request(
      RECENTLY_SETTLED_PATH,
      {
        limit: (params.limit ?? DEFAULT_PAGE_SIZE).toString(),
        offset: params.offset === undefined ? undefined : params.offset.toString(),
        category: params.category,
      },
      eventsResponseSchema,
    );
    return { events: body.data, pagination: body.pagination };
  }

  /** YES-side order book of one instrument, stamped with the time the response was read. */
  async getBook(instrumentSymbol: string): Promise<Book> {
    const body = await this.request(
      `/v1/book/${encodeURIComponent(instrumentSymbol)}`,
      {},
      bookResponseSchema,
    );
    const toLevel = (level: { price: string; amount: string }): BookLevel => ({
      priceBps: parsePriceBps(level.price),
      qty: parseContracts(level.amount),
    });
    const hasQuantity = (level: BookLevel): boolean => level.qty > 0n;
    // Gemini already sorts best first; sorting again makes the `Book` contract unconditional.
    const bids = body.bids
      .map(toLevel)
      .filter(hasQuantity)
      .sort((a, b) => Number(b.priceBps - a.priceBps));
    const asks = body.asks
      .map(toLevel)
      .filter(hasQuantity)
      .sort((a, b) => Number(a.priceBps - b.priceBps));
    return { instrumentSymbol, bids, asks, observedAtMs: this.now() };
  }

  private async request<S extends z.ZodType>(
    path: string,
    query: Record<string, string | undefined>,
    schema: S,
  ): Promise<z.infer<S>> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") search.set(key, value);
    }
    const queryString = search.toString();
    const endpoint = queryString === "" ? path : `${path}?${queryString}`;
    const text = await this.fetchText(endpoint);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error: unknown) {
      throw new GeminiResponseError(endpoint, "$", [
        `$: body is not JSON (${describeError(error)})`,
      ]);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`,
      );
      const first = parsed.error.issues[0];
      throw new GeminiResponseError(endpoint, formatIssuePath(first?.path ?? []), issues);
    }
    return parsed.data;
  }

  /** Returns the body of a 2xx response, retrying what is worth retrying. */
  private async fetchText(endpoint: string): Promise<string> {
    const url = `${this.baseUrl}${endpoint}`;
    for (let attempt = 1; ; attempt += 1) {
      const isLastAttempt = attempt >= this.maxAttempts;
      await this.limiter.acquire();

      let status: number;
      let text: string;
      let retryAfterMs: number | null;
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json", "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        status = response.status;
        retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        text = await response.text();
      } catch (error: unknown) {
        if (isLastAttempt) throw new GeminiNetworkError(endpoint, attempt, error);
        const delayMs = this.backoffMs(attempt);
        this.logger.warn(
          { endpoint, attempt, delayMs, err: describeError(error) },
          "gemini request failed, retrying",
        );
        await this.sleep(delayMs);
        continue;
      }

      if (status >= 200 && status < 300) return text;

      const retryable = status === 429 || status >= 500;
      if (!retryable || isLastAttempt) {
        throw new GeminiHttpError(endpoint, status, text.slice(0, 300));
      }
      const delayMs =
        retryAfterMs !== null && retryAfterMs <= MAX_RETRY_AFTER_MS
          ? Math.max(retryAfterMs, this.backoffMs(attempt))
          : this.backoffMs(attempt);
      this.logger.warn(
        { endpoint, attempt, status, delayMs },
        "gemini answered an error, retrying",
      );
      await this.sleep(delayMs);
    }
  }

  /** Exponential backoff with "equal jitter": between half and the whole of the capped step. */
  private backoffMs(attempt: number): number {
    const step = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
    return Math.round(step / 2 + this.random() * (step / 2));
  }
}

/** `Retry-After` in seconds (the only form Gemini would send); anything else is ignored. */
function parseRetryAfterMs(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim()) * 1000;
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "$";
  return path
    .map((segment, index) => {
      if (typeof segment === "number") return `[${segment.toString()}]`;
      return index === 0 ? String(segment) : `.${String(segment)}`;
    })
    .join("");
}
