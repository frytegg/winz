import type { Logger } from "pino";

import type { Outcome } from "@winz/shared";

import type { CatalogCache } from "./catalog-cache";
import { CATALOG_LEAGUES, type CatalogLeague } from "./catalog-leagues";
import type { AwaitedEvent, CatalogStore } from "./catalog-store";
import { SettlementConflictError, SyncAbortedError, describeError } from "./errors";
import {
  LISTING_CAP,
  SPORTS_CATEGORY,
  type GeminiRestClient,
  type ListingRead,
} from "./gemini-rest-client";
import { normalizeCatalog, type NormalizedCatalog } from "./normalize";
import { systemClock, type Clock } from "./rate-limiter";
import type { RawEvent } from "./schemas";
import { INVALID_EVENT_STATUS, parseSettlements } from "./settlement";

// ---------------------------------------------------------------------------------------------
// Catalogue (MD-1)
// ---------------------------------------------------------------------------------------------

/** How one league's listing was read. */
export interface LeagueRead {
  league: string;
  sport: string;
  /** Read to its end, under the cap, without a gap: its games may be deactivated by this read. */
  complete: boolean;
  /** `pagination.total` of the listing; null when it could not be read. */
  total: number | null;
  /** Events read (top-level, each once). */
  events: number;
  requests: number;
  /** Why it is not complete; null when it is. */
  reason: string | null;
}

/** The catalogue built from one listing per league, and what each listing was worth. */
export interface SportsCatalog extends NormalizedCatalog {
  /**
   * The leagues read completely. Only games of these leagues are deactivated by this catalogue
   * when they are no longer in it (`storeCatalog`).
   */
  completeLeagues: string[];
  leagues: LeagueRead[];
  /** Gemini requests the load sent: league pages plus one per sport for the coverage check. */
  requests: number;
}

export interface LoadSportsCatalogOptions {
  /** Default `CATALOG_LEAGUES`. */
  leagues?: readonly CatalogLeague[];
  /** Events per request. Default 100 (see `GeminiRestClient.readActiveListing`). */
  pageSize?: number;
  /** Overlap between two pages. Default 10. */
  overlap?: number;
  /** Measures the load's duration for the log. Default the system clock. */
  now?: Clock;
  /** Checked before every request: once aborted, the load throws `SyncAbortedError`. */
  signal?: AbortSignal;
}

/**
 * Builds the sports catalogue from one Gemini listing per league (`CATALOG_LEAGUES`), read one
 * after the other, deduplicated by ticker (`normalizeCatalog`). This is the `load` of the
 * `CatalogCache`.
 *
 * Each league is read to its end and checked (`readActiveListing`). A league whose listing
 * reaches Gemini's cap is logged at ERROR with its name: what it served is kept (upserted), but
 * none of its games is deactivated (it is not in `completeLeagues`). A league whose read failed is
 * logged at ERROR with its name too, and contributes nothing this run; its stored games stay as
 * they are. Then each sport's own listing total is compared with the sum of its leagues' (one
 * `limit=1` request per sport): a sport with more events than its leagues hold is a league
 * missing from the list, logged at WARN.
 *
 * Never throws for a league that fails; throws when no league at all could be read (every
 * request failed), which the caller logs as a failed catalogue sync, and `SyncAbortedError` when
 * `signal` aborts (the engine stopping): an unfinished catalogue is never returned.
 *
 * Cost, measured on 19 Nov 2026 at 07:23 UTC (the README has the numbers): one request per 90
 * events of each league (pages of 100 overlapping by 10) plus one per sport, 26 in all, 21 s;
 * 27 and 43 s at 12:31 UTC. The time is the download (a page of 100 NCAAF events is about 7 MB),
 * which is why a listing page gets `LISTING_TIMEOUT_MS` per attempt and not the 10 s of a book.
 */
export async function loadSportsCatalog(
  client: GeminiRestClient,
  logger: Logger,
  options: LoadSportsCatalogOptions = {},
): Promise<SportsCatalog> {
  const leagues = options.leagues ?? CATALOG_LEAGUES;
  const now = options.now ?? systemClock;
  const startedAtMs = now();
  const rawEvents: RawEvent[] = [];
  const reads: LeagueRead[] = [];
  const failures: { league: CatalogLeague; error: unknown }[] = [];
  let requests = 0;

  for (const league of leagues) {
    if (options.signal?.aborted) throw new SyncAbortedError();
    let listing: ListingRead;
    try {
      listing = await client.readActiveListing({
        category: SPORTS_CATEGORY,
        sport: league.sport,
        search: league.league,
        pageSize: options.pageSize,
        overlap: options.overlap,
        signal: options.signal,
      });
    } catch (error: unknown) {
      if (error instanceof SyncAbortedError) throw error;
      failures.push({ league, error });
      // The client's retries are spent: at least one request went out.
      requests += 1;
      reads.push({
        league: league.league,
        sport: league.sport,
        complete: false,
        total: null,
        events: 0,
        requests: 1,
        reason: `the listing could not be read: ${describeError(error)}`,
      });
      continue;
    }
    requests += listing.requests;
    rawEvents.push(...listing.events);
    reads.push({
      league: league.league,
      sport: league.sport,
      complete: listing.complete,
      total: listing.total,
      events: listing.events.length,
      requests: listing.requests,
      reason: listing.incompleteReason,
    });
    if (listing.total >= LISTING_CAP) {
      logger.error(
        {
          league: league.league,
          sport: league.sport,
          total: listing.total,
          cap: LISTING_CAP,
          read: listing.events.length,
        },
        "gemini league listing at the cap: games of this league are missing from the catalogue, " +
          "none of its games is deactivated; split the league in CATALOG_LEAGUES",
      );
    } else if (!listing.complete) {
      logger.warn(
        { league: league.league, sport: league.sport, reason: listing.incompleteReason },
        "gemini league listing incomplete: none of its games is deactivated this time",
      );
    }
  }

  const firstFailure = failures[0];
  if (firstFailure !== undefined && failures.length === reads.length) {
    // Not one league answered (Gemini down): the catalogue sync fails as a whole, logged once by
    // the caller, and is retried next run. Nothing is written, nothing deactivated.
    throw firstFailure.error instanceof Error
      ? firstFailure.error
      : new Error(`every gemini league listing failed: ${describeError(firstFailure.error)}`);
  }
  for (const { league, error } of failures) {
    logger.error(
      { league: league.league, sport: league.sport, err: describeError(error) },
      "gemini league listing failed: its games are kept as they are, none is deactivated",
    );
  }

  if (options.signal?.aborted) throw new SyncAbortedError();
  requests += await checkSportCoverage(client, logger, reads, options.signal);
  // A stop during the coverage check ends the load like any other: nothing is returned, so
  // nothing is written by a run that was told to stop (the lease may be another engine's now).
  if (options.signal?.aborted) throw new SyncAbortedError();

  const catalog = normalizeCatalog(rawEvents);
  for (const item of catalog.skipped) {
    logger.debug({ ref: item.ref, reason: item.reason }, "gemini catalogue item skipped");
  }
  const completeLeagues = reads.filter((read) => read.complete).map((read) => read.league);
  const incomplete = reads.filter((read) => !read.complete);
  logger.info(
    {
      rawEvents: rawEvents.length,
      events: catalog.events.length,
      instruments: catalog.instruments.length,
      skipped: catalog.skipped.length,
      leagues: reads.length,
      completeLeagues: completeLeagues.length,
      incompleteLeagues: incomplete.map((read) => read.league),
      requests,
      durationMs: now() - startedAtMs,
    },
    "gemini sports catalogue loaded",
  );
  return { ...catalog, completeLeagues, leagues: reads, requests };
}

/**
 * Compares each sport's own listing total with the sum of its leagues' totals, and warns when the
 * sport holds more: those events belong to a league the catalogue does not read. Skipped for a
 * sport with a league that could not be read. Returns the requests sent.
 */
async function checkSportCoverage(
  client: GeminiRestClient,
  logger: Logger,
  reads: readonly LeagueRead[],
  signal: AbortSignal | undefined,
): Promise<number> {
  let requests = 0;
  for (const sport of new Set(reads.map((read) => read.sport))) {
    if (signal?.aborted) break;
    const ofSport = reads.filter((read) => read.sport === sport);
    if (ofSport.some((read) => read.total === null)) continue;
    const leaguesTotal = ofSport.reduce((sum, read) => sum + (read.total ?? 0), 0);
    requests += 1;
    let sportTotal: number;
    try {
      const page = await client.listActiveEvents({
        category: SPORTS_CATEGORY,
        sport,
        limit: 1,
        offset: 0,
        signal,
      });
      sportTotal = page.pagination.total;
    } catch (error: unknown) {
      // The stop, once every league is read: the check ends there, as between two requests.
      if (error instanceof SyncAbortedError) break;
      logger.warn(
        { sport, err: describeError(error) },
        "gemini sport listing could not be read: league coverage not checked this time",
      );
      continue;
    }
    if (sportTotal > leaguesTotal) {
      logger.warn(
        {
          sport,
          sportTotal,
          leaguesTotal,
          outside: sportTotal - leaguesTotal,
          leagues: ofSport.map((read) => read.league),
        },
        "gemini lists events of this sport outside the catalogue's leagues: a league is " +
          "probably missing from CATALOG_LEAGUES",
      );
    }
  }
  return requests;
}

export interface CatalogSyncResult {
  /** Games in the catalogue just written. */
  events: number;
  /** Tradable instruments in the catalogue just written. */
  instruments: number;
  /** Instruments already stored that the catalogue no longer lists, newly marked inactive. */
  delisted: number;
}

/**
 * Writes one catalogue to the store: events first (instruments reference them), then the
 * instruments, then marks inactive what the catalogue no longer lists, but ONLY in the leagues it
 * read completely (`completeLeagues`): a game is deactivated only by a complete read of its own
 * league that no longer lists it. A league cut at the cap, failed or not read keeps its games.
 * An empty catalogue (no instrument at all) is a Gemini incident: nothing is deactivated on it.
 */
export async function storeCatalog(
  catalog: SportsCatalog,
  store: CatalogStore,
): Promise<CatalogSyncResult> {
  await store.upsertEvents(catalog.events);
  await store.upsertInstruments(catalog.instruments);
  const delisted =
    catalog.instruments.length === 0 || catalog.completeLeagues.length === 0
      ? 0
      : await store.markDelisted(
          catalog.instruments.map((instrument) => instrument.symbol),
          catalog.completeLeagues,
        );
  return { events: catalog.events.length, instruments: catalog.instruments.length, delisted };
}

/** MD-1: writes the (cached) catalogue to the store. */
export async function syncCatalog(
  cache: CatalogCache<SportsCatalog>,
  store: CatalogStore,
): Promise<CatalogSyncResult> {
  return storeCatalog(await cache.get(), store);
}

// ---------------------------------------------------------------------------------------------
// Results (MD-3)
// ---------------------------------------------------------------------------------------------

/** Pages of settled events one run may read at most: 20 × 50 = 1 000 events. */
export const SETTLED_MAX_PAGES = 20;
const SETTLED_PAGE_SIZE = 50;
/**
 * A run reads back to the start of the last complete run minus this: it absorbs the difference
 * between Gemini's clock (`resolvedAt`) and ours, and a result listed a little after its
 * `resolvedAt`. Results read twice are applied once.
 */
export const SETTLED_OVERLAP_MS = 10 * 60_000;
/** Games asked one by one per run, at most (`readAwaitedResults`). */
export const DIRECT_READS_PER_RUN = 5;

export interface SyncSettlementsOptions {
  /**
   * Read back until an event resolved before this time (epoch ms) has been read. Null or
   * omitted: the whole list, which Gemini keeps for about a day (280 events, 18 Nov 07:46 to
   * 19 Nov 06:15 UTC, read 19 Nov 2026 07:13 UTC).
   */
  sinceMs?: number | null;
  /** Bound, in pages of `pageSize`. Default `SETTLED_MAX_PAGES`. */
  maxPages?: number;
  /** Default 50. */
  pageSize?: number;
  now?: Clock;
  /**
   * The stop, checked before each page and passed to the request in flight: once aborted, what
   * was read is recorded, the read not complete, and nothing is logged as a failure.
   */
  signal?: AbortSignal;
}

export interface SettlementSyncResult {
  newlySettled: number;
  /**
   * Games whose reported outcome contradicts a recorded one: none of their outcomes is applied,
   * each is logged at ERROR for a human, and every other game of the read is applied.
   */
  conflicts: number;
  /** Settled events read. */
  events: number;
  pages: number;
  /** Read back to `sinceMs` or to the end of the list: no result in between was skipped. */
  complete: boolean;
  /** `resolvedAt` of the oldest event read, epoch ms; null when none carried one. */
  oldestResolvedAtMs: number | null;
}

function resolvedAtMs(event: RawEvent): number | null {
  if (!event.resolvedAt) return null;
  const ms = Date.parse(event.resolvedAt);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * MD-3: reads the recently settled sports events, newest first, page after page until it has
 * read an event resolved before `sinceMs`, the end of the list, or `maxPages`; then records the
 * outcomes (`markSettled`, idempotent: a result read twice is applied once).
 *
 * When a page fails part-way, what was read is recorded first and the error is thrown: the run is
 * not complete, and the caller reads the same span again next time.
 */
export async function syncSettlements(
  client: GeminiRestClient,
  store: CatalogStore,
  logger: Logger,
  options: SyncSettlementsOptions = {},
): Promise<SettlementSyncResult> {
  const sinceMs = options.sinceMs ?? null;
  const maxPages = options.maxPages ?? SETTLED_MAX_PAGES;
  const pageSize = options.pageSize ?? SETTLED_PAGE_SIZE;
  const now = options.now ?? systemClock;
  const rawEvents: RawEvent[] = [];
  let pages = 0;
  let complete = false;
  let oldestResolvedAtMs: number | null = null;
  let failure: unknown = null;

  while (pages < maxPages && options.signal?.aborted !== true) {
    let page: RawEvent[];
    try {
      const result = await client.listRecentlySettled({
        category: SPORTS_CATEGORY,
        limit: pageSize,
        offset: pages * pageSize,
        signal: options.signal,
      });
      page = result.events;
    } catch (error: unknown) {
      // The stop: what was read is recorded, the read is not complete, nothing failed.
      if (error instanceof SyncAbortedError) break;
      failure = error;
      break;
    }
    pages += 1;
    rawEvents.push(...page);
    let pageOldest: number | null = null;
    for (const event of page) {
      const at = resolvedAtMs(event);
      if (at !== null && (pageOldest === null || at < pageOldest)) pageOldest = at;
    }
    if (pageOldest !== null && (oldestResolvedAtMs === null || pageOldest < oldestResolvedAtMs)) {
      oldestResolvedAtMs = pageOldest;
    }
    if (page.length < pageSize) {
      complete = true;
      break;
    }
    if (sinceMs !== null && pageOldest !== null && pageOldest < sinceMs) {
      complete = true;
      break;
    }
  }

  const outcomes = parseSettlements(rawEvents);
  const applied = await applyOutcomes(store, logger, rawEvents, outcomes, new Date(now()));
  const newlySettled = applied.newlySettled;
  const summary = {
    settledEvents: rawEvents.length,
    pages,
    complete,
    sinceMs,
    oldestResolvedAt:
      oldestResolvedAtMs === null ? null : new Date(oldestResolvedAtMs).toISOString(),
    outcomes: outcomes.size,
    newlySettled,
    conflicts: applied.conflicts,
  };
  if (failure !== null) {
    logger.warn(summary, "gemini settled list read failed part-way: what was read is recorded");
    throw failure;
  }
  if (!complete && options.signal?.aborted === true) {
    logger.info(summary, "gemini settled list read stopped by the stop: what was read is recorded");
  } else if (!complete) {
    logger.warn(
      { ...summary, maxPages },
      "gemini settled list catch-up stopped at its bound: older results are left to the direct " +
        "reads of the games campaigns wait on",
    );
  } else {
    logger.info(summary, "gemini settlements synced");
  }
  return {
    newlySettled,
    conflicts: applied.conflicts,
    events: rawEvents.length,
    pages,
    complete,
    oldestResolvedAtMs,
  };
}

/**
 * Records `outcomes` in one batch. When the batch is refused for a contradiction
 * (`SettlementConflictError`, which applies nothing), applies it again game by game, so that one
 * contradicted game, left for a human, does not hold back every other result of the read.
 */
async function applyOutcomes(
  store: CatalogStore,
  logger: Logger,
  rawEvents: readonly RawEvent[],
  outcomes: ReadonlyMap<string, Outcome>,
  settledAt: Date,
): Promise<{ newlySettled: number; conflicts: number }> {
  if (outcomes.size === 0) return { newlySettled: 0, conflicts: 0 };
  try {
    return { newlySettled: await store.markSettled(outcomes, settledAt), conflicts: 0 };
  } catch (error: unknown) {
    if (!(error instanceof SettlementConflictError)) throw error;
  }
  let newlySettled = 0;
  let conflicts = 0;
  const seen = new Set<string>();
  for (const event of rawEvents) {
    if (seen.has(event.ticker)) continue;
    seen.add(event.ticker);
    const ofEvent = parseSettlements([event]);
    if (ofEvent.size === 0) continue;
    try {
      newlySettled += await store.markSettled(ofEvent, settledAt);
    } catch (error: unknown) {
      if (!(error instanceof SettlementConflictError)) throw error;
      conflicts += 1;
      logger.error(
        {
          event: event.ticker,
          instrument: error.instrumentSymbol,
          recorded: error.recorded,
          received: error.received,
        },
        "gemini reports an outcome that contradicts the recorded one: nothing of this game is " +
          "applied, a human must check it",
      );
    }
  }
  return { newlySettled, conflicts };
}

export interface ReadAwaitedResultsOptions {
  /** Games asked at most. Default `DIRECT_READS_PER_RUN`. */
  maxReads?: number;
  /**
   * When each game was last asked, epoch ms, kept by the caller across runs: the games asked
   * least recently go first, so every awaited game is asked in turn. Updated in place; games no
   * longer awaited are removed from it.
   */
  lastReadAt?: Map<string, number>;
  now?: Clock;
  /** The stop, checked before each read and passed to the one in flight: no further game is asked. */
  signal?: AbortSignal;
}

export interface AwaitedResultsRun {
  /** Games waited on. */
  awaited: number;
  /** Games asked this run. */
  reads: number;
  /** Reads that failed (logged one by one). */
  failed: number;
  newlySettled: number;
}

/** Statuses of a game that has not ended its life on Gemini: no result is expected yet. */
const OPEN_EVENT_STATUSES = new Set(["active", "approved", "closed"]);

/**
 * The direct read: for each game a campaign past its sales close still waits on, asks Gemini for
 * that game's own page (`GET /v1/prediction-markets/events/{ticker}`, which holds every market
 * of the game with its contracts' `resolutionSide`) and records what is resolved. A result the
 * recently-settled list never showed still arrives this way, at the latest one run after Gemini
 * publishes it, as long as fewer than `maxReads` games are waited on (otherwise in turn).
 *
 * Nothing is invented: only `resolutionSide` and Gemini's documented `invalid` status count
 * (`parseSettlements`). A game Gemini reports in another final state without a result for an
 * awaited instrument (status "settled" without a side, or a status we do not know, such as
 * "cancelled") is logged at WARN with its symbols for a human, and asked again next run.
 * A failed read is logged at WARN and the next game is asked.
 */
export async function readAwaitedResults(
  client: GeminiRestClient,
  store: CatalogStore,
  logger: Logger,
  options: ReadAwaitedResultsOptions = {},
): Promise<AwaitedResultsRun> {
  const maxReads = options.maxReads ?? DIRECT_READS_PER_RUN;
  const lastReadAt = options.lastReadAt ?? new Map<string, number>();
  const now = options.now ?? systemClock;
  const awaited = await store.listAwaitedEvents(new Date(now()));
  const waiting = new Set(awaited.map((event) => event.eventTicker));
  for (const ticker of [...lastReadAt.keys()]) {
    if (!waiting.has(ticker)) lastReadAt.delete(ticker);
  }
  // Never asked first, then the one asked longest ago; the store's order breaks ties.
  const order = awaited
    .map((event, index) => ({ event, index, at: lastReadAt.get(event.eventTicker) ?? -Infinity }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .slice(0, Math.max(0, maxReads))
    .map((entry) => entry.event);

  let failed = 0;
  let newlySettled = 0;
  for (const target of order) {
    if (options.signal?.aborted) break;
    lastReadAt.set(target.eventTicker, now());
    let event: RawEvent;
    try {
      event = await client.getEvent(target.eventTicker, { signal: options.signal });
    } catch (error: unknown) {
      if (error instanceof SyncAbortedError) break;
      failed += 1;
      logger.warn(
        { event: target.eventTicker, err: describeError(error) },
        "direct read of a game a campaign waits on failed: asked again next run",
      );
      continue;
    }
    const outcomes = parseSettlements([event]);
    try {
      newlySettled += await store.markSettled(outcomes, new Date(now()));
    } catch (error: unknown) {
      failed += 1;
      if (error instanceof SettlementConflictError) {
        logger.error(
          { event: target.eventTicker, err: error.message },
          "direct read contradicts a recorded outcome: nothing of this game is applied",
        );
        continue;
      }
      throw error;
    }
    logUnresolved(logger, target, event, outcomes);
  }

  if (order.length > 0) {
    logger.info(
      { awaited: awaited.length, reads: order.length, failed, newlySettled },
      "direct reads of awaited games done",
    );
  }
  return { awaited: awaited.length, reads: order.length, failed, newlySettled };
}

/** Warns when Gemini says the game is over but gives no result for an awaited instrument. */
function logUnresolved(
  logger: Logger,
  target: AwaitedEvent,
  event: RawEvent,
  outcomes: ReadonlyMap<string, unknown>,
): void {
  const missing = target.symbols.filter((symbol) => !outcomes.has(symbol));
  if (missing.length === 0) return;
  if (OPEN_EVENT_STATUSES.has(event.status)) return;
  logger.warn(
    {
      event: target.eventTicker,
      status: event.status,
      symbols: missing,
      voidStatus: INVALID_EVENT_STATUS,
    },
    "gemini reports this game over but publishes no result for instruments a campaign waits on: " +
      "nothing is recorded; a human must decide (a forced demo result, or wait)",
  );
}

// ---------------------------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------------------------

export interface CatalogSyncServiceOptions {
  client: GeminiRestClient;
  store: CatalogStore;
  logger: Logger;
  /** Time between the starts of two runs (SPEC MD-1 and MD-3: 60 s). */
  intervalMs?: number;
  /** Aborting it stops the service; a run in flight finishes first. */
  signal: AbortSignal;
  /**
   * The catalogue cache the rest of the engine reads, so one Gemini load serves both.
   * Without it every run loads the catalogue itself.
   */
  cache?: CatalogCache<SportsCatalog>;
  /** Leagues read by the catalogue step. Default `CATALOG_LEAGUES`. */
  leagues?: readonly CatalogLeague[];
  /** Bound of the settled-list read per run, in pages of 50. Default `SETTLED_MAX_PAGES`. */
  settlementMaxPages?: number;
  /** Games asked one by one per run. Default `DIRECT_READS_PER_RUN`. */
  directReadsPerRun?: number;
  now?: Clock;
}

export interface CatalogSyncService {
  /** Resolves once the service has stopped: the signal is aborted and no run is in flight. */
  stopped: Promise<void>;
}

/**
 * Keeps the stored catalogue and results in step with Gemini. Every `intervalMs`, one run:
 *
 * 1. the catalogue (MD-1): one listing per league, written, games deactivated only by a complete
 *    read of their league;
 * 2. the results (MD-3): the recently-settled list, read back to the start of the last complete
 *    run (minus `SETTLED_OVERLAP_MS`); the first run of a service reads the whole list, so a
 *    period without a leader (a deploy, a sleep, a lost lease) is caught up by the next leader;
 * 3. the direct reads: each game a campaign past its sales close still waits on, asked on its
 *    own (`readAwaitedResults`), skipped in a run whose settled-list read failed (Gemini down:
 *    the next run catches up).
 *
 * Runs never overlap: the next one is scheduled when the current one ends, `intervalMs` after
 * the current one started, or at once when it took longer than that. A failed step is logged
 * and the service carries on; the result steps run even when the catalogue step failed.
 *
 * A stop (the signal) ends a run at once: the request in flight is aborted with it (its download
 * included), a retry wait is abandoned, and no further request is sent. A run sends up to about
 * 30 requests and lasts 20 to 45 s (measured, README), longer than the engine's 15 s stop grace
 * and the lease's 5 s fence margin, so it is never waited for: what is left after a stop is the
 * database write of the results read so far (milliseconds). A catalogue stopped part-way is not
 * written; results read so far are. An aborted request is neither retried nor logged as failed.
 */
export function startCatalogSync(options: CatalogSyncServiceOptions): CatalogSyncService {
  const { client, store, logger, signal, cache } = options;
  const intervalMs = options.intervalMs ?? 60_000;
  const now = options.now ?? systemClock;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("startCatalogSync: intervalMs must be a positive number");
  }
  /** Start of the last run whose settled-list read was complete, minus the overlap. */
  let settledSinceMs: number | null = null;
  const lastDirectReadAt = new Map<string, number>();

  const runOnce = async (): Promise<void> => {
    const runStartedAtMs = now();
    try {
      const result = cache
        ? await syncCatalog(cache, store)
        : await storeCatalog(
            await loadSportsCatalog(client, logger, { leagues: options.leagues, now, signal }),
            store,
          );
      logger.info(result, "catalogue synced");
    } catch (error: unknown) {
      if (error instanceof SyncAbortedError) {
        logger.info("catalogue sync stopped part-way by the stop: nothing written");
        return;
      }
      logger.error({ err: error }, "catalogue sync failed, next run retries");
    }
    if (signal.aborted) return;
    let settledReadOk = false;
    try {
      const settled = await syncSettlements(client, store, logger, {
        sinceMs: settledSinceMs,
        maxPages: options.settlementMaxPages,
        now,
        signal,
      });
      settledReadOk = true;
      if (settled.complete) settledSinceMs = runStartedAtMs - SETTLED_OVERLAP_MS;
    } catch (error: unknown) {
      logger.error({ err: error }, "settlement sync failed, next run retries");
    }
    if (signal.aborted || !settledReadOk) return;
    try {
      await readAwaitedResults(client, store, logger, {
        maxReads: options.directReadsPerRun,
        lastReadAt: lastDirectReadAt,
        now,
        signal,
      });
    } catch (error: unknown) {
      logger.error({ err: error }, "direct reads of awaited games failed, next run retries");
    }
  };

  const stopped = new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let running = false;
    let finished = false;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      logger.info("catalogue sync stopped");
      resolve();
    };

    const tick = (): void => {
      timer = null;
      running = true;
      const startedAtMs = now();
      // `runOnce` catches what its steps throw; this catch is for a logger that throws.
      runOnce()
        .catch(() => undefined)
        .finally(() => {
          running = false;
          if (signal.aborted) {
            finish();
            return;
          }
          const elapsedMs = now() - startedAtMs;
          if (elapsedMs > intervalMs) {
            logger.warn(
              { elapsedMs, intervalMs },
              "catalogue sync run took longer than its interval",
            );
          }
          timer = setTimeout(tick, Math.max(0, intervalMs - elapsedMs));
        });
    };

    function onAbort(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (!running) finish();
    }

    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    tick();
  });

  return { stopped };
}
