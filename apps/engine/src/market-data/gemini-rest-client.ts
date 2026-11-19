import type { Logger } from "pino";
import type { z } from "zod";

import { parseContracts, parsePriceBps } from "@winz/shared";
import type { Book, BookLevel } from "@winz/shared";

import {
  GeminiHttpError,
  GeminiNetworkError,
  GeminiResponseError,
  SyncAbortedError,
  describeError,
} from "./errors";
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
  rawEventSchema,
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
  /**
   * Per attempt, for the small requests: an order book, one event's own page. Default 10 000.
   */
  timeoutMs?: number;
  /**
   * Per attempt, for the listing requests (active events, recently settled), whose pages are
   * large: a page of 100 NCAAF events is about 7 MB. Default `LISTING_TIMEOUT_MS`.
   */
  listingTimeoutMs?: number;
}

/** What a request of the client may carry besides its parameters. */
export interface RequestOptions {
  /**
   * The caller's stop (the engine stopping, the lease lost). Once aborted, the request in flight
   * is aborted with it, its download included, a backoff or a rate-limiter wait is abandoned, and
   * the call throws `SyncAbortedError`: never retried, never logged as a failed request.
   */
  signal?: AbortSignal;
}

export interface ListEventsParams {
  /** Gemini category, e.g. "Sports". */
  category?: string;
  /**
   * Gemini `sportsMarket.sport`, e.g. "american_football". Checked by Gemini: an unknown value
   * is answered HTTP 400 `invalid sport` (19 Nov 2026).
   */
  sport?: string;
  /** Free-text search: it matches the ticker ("NCAAF" finds every NCAAF event) and the title. */
  search?: string;
  limit: number;
  offset: number;
  /** See `RequestOptions.signal`. */
  signal?: AbortSignal;
}

export interface ListSettledParams {
  category?: string;
  limit?: number;
  offset?: number;
  /** See `RequestOptions.signal`. */
  signal?: AbortSignal;
}

export interface ListAllParams {
  category?: string;
  sport?: string;
  search?: string;
  pageSize?: number;
  /** Safety stop if `pagination.total` keeps growing or lies. */
  maxPages?: number;
}

export interface ReadListingParams {
  category?: string;
  sport?: string;
  search?: string;
  /** Events per request. Default 100; Gemini serves at most 500 (a larger `limit` is cut). */
  pageSize?: number;
  /**
   * Each page after the first starts this many events before the end of the previous one, and
   * must contain one of them: proof that no event slid between two pages. Default 10.
   */
  overlap?: number;
  /** Safety stop. Default 20 (1 810 events at the defaults, more than the cap). */
  maxPages?: number;
  /**
   * The caller's stop: once aborted, the read throws `SyncAbortedError`, at once, the page in
   * flight included (see `RequestOptions.signal`).
   */
  signal?: AbortSignal;
}

/**
 * A listing read to its end, and whether it can be trusted as the WHOLE of what Gemini lists for
 * that filter. Only a complete listing may be used to decide that something is no longer listed.
 */
export interface ListingRead {
  /** Every event read, in API order, each once. */
  events: RawEvent[];
  /** `pagination.total` of the last page read (0 when nothing was read). */
  total: number;
  /** Requests sent (each page once; the client's retries are not counted). */
  requests: number;
  complete: boolean;
  /** Why it is not complete; null when it is. */
  incompleteReason: string | null;
}

export interface EventsPage {
  events: RawEvent[];
  pagination: Pagination;
}

export const SPORTS_CATEGORY = "Sports";
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 60;

/**
 * Gemini's events listing stops at about 1 000 events, whatever the filter (measured 19 Nov 2026,
 * 06:47 to 07:15 UTC: `status=active&category=Sports` and `status=active` alone both report
 * `pagination.total` 1003 and serve nothing past offset 1003, while the per-sport listings of the
 * same moment add up to 1 359; the listing is sorted by start time, so the cut drops the games
 * furthest out). A listing whose `total` reaches this value is treated as cut: it is never the
 * whole of anything.
 */
export const LISTING_CAP = 1_000;
/** Gemini answers at most this many events per request (`limit=1000` came back `limit: 500`). */
export const MAX_PAGE_SIZE = 500;
const DEFAULT_LISTING_PAGE_SIZE = 100;
const DEFAULT_LISTING_OVERLAP = 10;
const DEFAULT_LISTING_MAX_PAGES = 20;
/** Timeout of one attempt of a small request (an order book, one event). */
export const REQUEST_TIMEOUT_MS = 10_000;
/**
 * Timeout of one attempt of a listing request. A page of 100 NCAAF events is about 7 MB: 5.4 s
 * on 19 Nov 2026 at 12:33 UTC, 2.4 s at 14:07 UTC (1.5 s to the first byte), against the old
 * 10 s. 30 s still accepts a link about five times slower than the slowest one measured
 * (about 250 kB/s) before the page is given up and downloaded again.
 */
export const LISTING_TIMEOUT_MS = 30_000;
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
  private readonly listingTimeoutMs: number;

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
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.listingTimeoutMs = options.listingTimeoutMs ?? LISTING_TIMEOUT_MS;
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
        sport: params.sport,
        search: params.search,
      },
      eventsResponseSchema,
      { timeoutMs: this.listingTimeoutMs, signal: params.signal },
    );
    return { events: body.data, pagination: body.pagination };
  }

  /**
   * Reads an active listing to its end and says whether it is the whole of it. Pages overlap by
   * `overlap` events, and each page must contain one of the previous page's last `overlap`
   * tickers: the listing is sorted (start time, then a stable tie-break, checked 19 Nov 2026),
   * so an event that ended between two requests can shift the rest by one, which the overlap
   * absorbs, and a shift larger than the overlap is detected instead of silently skipping events.
   *
   * Complete only when nothing can have been skipped. An empty page proves the end only as the
   * first page (offset 0: nothing is listed). Every later page is asked at `overlap` events
   * before the end of the previous one, which itself ended before the `total` it reported: if
   * the listing had not moved, that page would hold at least `overlap + 1` events. Empty, it
   * means more than `overlap` events left the listing between the two requests, and events that
   * were never read may have slid into positions already read (a finished game removes 10 to 15
   * events at once). So an empty page after the first is never the end: the read is not
   * complete, whatever `total` says. A non-empty page proves that nothing slid past it by
   * containing one of the previous page's last `overlap` tickers.
   *
   * A listing at the cap is still read to its end (what it serves is kept) and is not complete.
   * Not complete when: `total` reaches `LISTING_CAP`, a page breaks the overlap, a page after the
   * first comes back empty, the first page comes back empty before `total`, or `maxPages` is
   * reached. Not complete is safe: none of the league's games is deactivated this run, and the
   * next run reads it again; the read is not repeated at once (it would download the whole league
   * again, about 50 MB for NCAAF). A failed request throws (the caller decides), and so does an
   * aborted `signal`, at once (`SyncAbortedError`).
   */
  async readActiveListing(params: ReadListingParams = {}): Promise<ListingRead> {
    const pageSize = params.pageSize ?? DEFAULT_LISTING_PAGE_SIZE;
    const overlap = params.overlap ?? DEFAULT_LISTING_OVERLAP;
    const maxPages = params.maxPages ?? DEFAULT_LISTING_MAX_PAGES;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new RangeError(`readActiveListing: pageSize must be 1 to ${MAX_PAGE_SIZE.toString()}`);
    }
    if (!Number.isInteger(overlap) || overlap < 0 || overlap >= pageSize) {
      throw new RangeError("readActiveListing: overlap must be 0 or more and under pageSize");
    }
    const byTicker = new Map<string, RawEvent>();
    let previousTail: string[] = [];
    let offset = 0;
    let total = 0;
    let requests = 0;
    const result = (complete: boolean, incompleteReason: string | null): ListingRead => ({
      events: [...byTicker.values()],
      total,
      requests,
      complete,
      incompleteReason,
    });

    for (let page = 0; page < maxPages; page += 1) {
      if (params.signal?.aborted) throw new SyncAbortedError();
      const answer = await this.listActiveEvents({
        category: params.category,
        sport: params.sport,
        search: params.search,
        limit: pageSize,
        offset,
        signal: params.signal,
      });
      requests += 1;
      total = answer.pagination.total;
      const tickers = answer.events.map((event) => event.ticker);
      if (page > 0 && previousTail.length > 0 && answer.events.length > 0) {
        const tail = new Set(previousTail);
        if (!tickers.some((ticker) => tail.has(ticker))) {
          for (const event of answer.events) byTicker.set(event.ticker, event);
          return result(
            false,
            `the page at offset ${offset.toString()} does not overlap the previous one: ` +
              "the listing moved by more than the overlap while it was read",
          );
        }
      }
      for (const event of answer.events) {
        if (!byTicker.has(event.ticker)) byTicker.set(event.ticker, event);
      }
      if (page > 0 && answer.events.length === 0) {
        return result(
          false,
          `an empty page at offset ${offset.toString()} after a page that ended before its total ` +
            `(now ${total.toString()}): more than the overlap left the listing between two ` +
            "requests, and unread events may have slid into positions already read",
        );
      }
      const end = offset + answer.events.length;
      if (end >= total) {
        // Read to the end of what is served; at the cap, that is not the whole listing.
        return total >= LISTING_CAP
          ? result(
              false,
              `the listing reports ${total.toString()} events, at Gemini's cap of about ` +
                `${LISTING_CAP.toString()}: what lies past the cap is never served`,
            )
          : result(true, null);
      }
      if (answer.events.length === 0) {
        return result(
          false,
          `an empty page at offset ${offset.toString()} before the reported total of ${total.toString()}`,
        );
      }
      // An answer shorter than asked, before the total: the listing shrank while it was read.
      previousTail = tickers.slice(Math.max(0, tickers.length - overlap));
      offset = Math.max(offset + 1, end - overlap);
    }
    return result(false, `stopped after ${maxPages.toString()} pages, before the end`);
  }

  /**
   * One event by ticker, as Gemini serves it on its own page: a game comes with its other markets
   * in `events`, each with its contracts and, once resolved, their `resolutionSide` (checked on a
   * settled NBA game, 19 Nov 2026). Throws `GeminiHttpError` (404) for an unknown ticker.
   */
  async getEvent(ticker: string, options: RequestOptions = {}): Promise<RawEvent> {
    return this.request(`${EVENTS_PATH}/${encodeURIComponent(ticker)}`, {}, rawEventSchema, {
      timeoutMs: this.timeoutMs,
      signal: options.signal,
    });
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
        sport: params.sport,
        search: params.search,
        limit: pageSize,
        offset,
      });
      events.push(...result.events);
      offset += result.events.length;
      if (result.events.length === 0 || offset >= result.pagination.total) {
        if (result.pagination.total >= LISTING_CAP) {
          this.logger.error(
            {
              category: params.category,
              sport: params.sport,
              search: params.search,
              total: result.pagination.total,
              cap: LISTING_CAP,
            },
            "gemini events listing cut at its cap: events past it are missing",
          );
        }
        return events;
      }
    }
    this.logger.warn(
      { maxPages, pageSize, fetched: events.length },
      "gemini events listing truncated: page limit reached",
    );
    return events;
  }

  /**
   * The single Sports listing, all pages. It is CUT at about 1 000 events (`LISTING_CAP`): on
   * 19 Nov 2026 it held 193 of the games, and not Saturday's. The catalogue no longer uses it
   * (see `loadSportsCatalog`, one listing per league); kept for tools that want a quick look.
   */
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
      { timeoutMs: this.listingTimeoutMs, signal: params.signal },
    );
    return { events: body.data, pagination: body.pagination };
  }

  /** YES-side order book of one instrument, stamped with the time the response was read. */
  async getBook(instrumentSymbol: string): Promise<Book> {
    const body = await this.request(
      `/v1/book/${encodeURIComponent(instrumentSymbol)}`,
      {},
      bookResponseSchema,
      { timeoutMs: this.timeoutMs },
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
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<z.infer<S>> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") search.set(key, value);
    }
    const queryString = search.toString();
    const endpoint = queryString === "" ? path : `${path}?${queryString}`;
    const text = await this.fetchText(endpoint, options);

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

  /**
   * Returns the body of a 2xx response, retrying what is worth retrying. Each attempt has
   * `timeoutMs`, the download of the body included. Once `signal` aborts, throws
   * `SyncAbortedError` at once: the attempt in flight is aborted, a wait is abandoned, nothing is
   * retried and nothing is logged.
   */
  private async fetchText(
    endpoint: string,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<string> {
    const url = `${this.baseUrl}${endpoint}`;
    const stop = options.signal;
    for (let attempt = 1; ; attempt += 1) {
      if (isStopped(stop)) throw new SyncAbortedError();
      const isLastAttempt = attempt >= this.maxAttempts;
      await unlessStopped(this.limiter.acquire(), stop);

      const timeout = new AbortController();
      const timer = setTimeout(() => {
        timeout.abort(
          new DOMException(
            `no complete answer within ${options.timeoutMs.toString()} ms`,
            "TimeoutError",
          ),
        );
      }, options.timeoutMs);
      // Linked to the stop by hand for this attempt only, and unlinked in `finally`.
      // `AbortSignal.any([timeout.signal, stop])` would keep every attempt's composite signal
      // referenced by the stop, which lives as long as the leadership: about 180 bytes per
      // request on Node 22, never released (measured, README).
      const onStop = (): void => {
        timeout.abort(stop?.reason);
      };
      stop?.addEventListener("abort", onStop, { once: true });
      if (isStopped(stop)) onStop();
      const signal = timeout.signal;
      let status: number;
      let text: string;
      let retryAfterMs: number | null;
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json", "user-agent": USER_AGENT },
          signal,
        });
        status = response.status;
        retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        text = await response.text();
      } catch (error: unknown) {
        // This attempt is over: its timeout must not stay armed through the backoff below.
        clearTimeout(timer);
        stop?.removeEventListener("abort", onStop);
        // The stop aborted this attempt: not a failure of the request, nothing to retry.
        if (isStopped(stop)) throw new SyncAbortedError();
        if (isLastAttempt) throw new GeminiNetworkError(endpoint, attempt, error);
        const delayMs = this.backoffMs(attempt);
        this.logger.warn(
          { endpoint, attempt, delayMs, err: describeError(error) },
          "gemini request failed, retrying",
        );
        await unlessStopped(this.sleep(delayMs), stop);
        continue;
      } finally {
        clearTimeout(timer);
        stop?.removeEventListener("abort", onStop);
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
      await unlessStopped(this.sleep(delayMs), stop);
    }
  }

  /** Exponential backoff with "equal jitter": between half and the whole of the capped step. */
  private backoffMs(attempt: number): number {
    const step = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
    return Math.round(step / 2 + this.random() * (step / 2));
  }
}

/** Read through a call, so that a check made before an `await` does not narrow a later one. */
function isStopped(stop: AbortSignal | undefined): boolean {
  return stop?.aborted === true;
}

/**
 * Waits for `promise`, or throws `SyncAbortedError` as soon as `stop` aborts. An abandoned
 * promise runs on (a sleep ends, a limiter token is taken) and its failure is ignored.
 */
async function unlessStopped(promise: Promise<void>, stop: AbortSignal | undefined): Promise<void> {
  if (stop === undefined) return promise;
  if (stop.aborted) {
    promise.catch(() => undefined);
    throw new SyncAbortedError();
  }
  // Removes the abort listener once the wait is over, whichever way it ends.
  const done = new AbortController();
  const aborted = new Promise<never>((_resolve, reject) => {
    stop.addEventListener(
      "abort",
      () => {
        reject(new SyncAbortedError());
      },
      { once: true, signal: done.signal },
    );
  });
  promise.catch(() => undefined);
  try {
    await Promise.race([promise, aborted]);
  } finally {
    done.abort();
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
