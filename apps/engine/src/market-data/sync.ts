import type { Logger } from "pino";

import type { CatalogCache } from "./catalog-cache";
import type { CatalogStore } from "./catalog-store";
import { SPORTS_CATEGORY, type GeminiRestClient } from "./gemini-rest-client";
import { normalizeCatalog, type NormalizedCatalog } from "./normalize";
import { systemClock, type Clock } from "./rate-limiter";
import { parseSettlements } from "./settlement";

/** Fetches every active sports event and normalizes it. This is the `load` of the `CatalogCache`. */
export async function loadSportsCatalog(
  client: GeminiRestClient,
  logger: Logger,
): Promise<NormalizedCatalog> {
  const rawEvents = await client.listAllSportsEvents();
  const catalog = normalizeCatalog(rawEvents);
  for (const item of catalog.skipped) {
    logger.debug({ ref: item.ref, reason: item.reason }, "gemini catalogue item skipped");
  }
  logger.info(
    {
      rawEvents: rawEvents.length,
      events: catalog.events.length,
      instruments: catalog.instruments.length,
      skipped: catalog.skipped.length,
    },
    "gemini sports catalogue loaded",
  );
  return catalog;
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
 * Writes one complete catalogue to the store: events first (instruments reference them), then
 * the instruments, then whatever the catalogue no longer lists is marked inactive.
 * `catalog` must be the whole catalogue, not a search result.
 */
export async function storeCatalog(
  catalog: NormalizedCatalog,
  store: CatalogStore,
): Promise<CatalogSyncResult> {
  await store.upsertEvents(catalog.events);
  await store.upsertInstruments(catalog.instruments);
  // An empty catalogue is a Gemini incident, not the end of every market: delist nothing on it.
  const delisted =
    catalog.instruments.length === 0
      ? 0
      : await store.markDelisted(catalog.instruments.map((instrument) => instrument.symbol));
  return { events: catalog.events.length, instruments: catalog.instruments.length, delisted };
}

/** MD-1: writes the (cached) catalogue to the store. */
export async function syncCatalog(
  cache: CatalogCache,
  store: CatalogStore,
): Promise<CatalogSyncResult> {
  return storeCatalog(await cache.get(), store);
}

export interface SyncSettlementsOptions {
  /** Pages of 50 settled sports events to read, newest first. One covers a normal 60 s poll. */
  pages?: number;
  now?: Clock;
}

/** MD-3: reads the recently settled sports events and records the outcomes. Returns the newly settled count. */
export async function syncSettlements(
  client: GeminiRestClient,
  store: CatalogStore,
  logger: Logger,
  options: SyncSettlementsOptions = {},
): Promise<number> {
  const pages = options.pages ?? 1;
  const now = options.now ?? systemClock;
  const pageSize = 50;
  const rawEvents = [];
  for (let page = 0; page < pages; page += 1) {
    const result = await client.listRecentlySettled({
      category: SPORTS_CATEGORY,
      limit: pageSize,
      offset: page * pageSize,
    });
    rawEvents.push(...result.events);
    if (result.events.length < pageSize) break;
  }
  const outcomes = parseSettlements(rawEvents);
  const newlySettled = await store.markSettled(outcomes, new Date(now()));
  logger.info(
    { settledEvents: rawEvents.length, outcomes: outcomes.size, newlySettled },
    "gemini settlements synced",
  );
  return newlySettled;
}

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
  cache?: CatalogCache;
  /** Pages of settled events read per run, see `SyncSettlementsOptions.pages`. */
  settlementPages?: number;
  now?: Clock;
}

export interface CatalogSyncService {
  /** Resolves once the service has stopped: the signal is aborted and no run is in flight. */
  stopped: Promise<void>;
}

/**
 * Keeps the stored catalogue in step with Gemini: every `intervalMs`, one catalogue sync (MD-1)
 * then one settlement sync (MD-3). The first run starts at once.
 *
 * Runs never overlap: the next one is scheduled when the current one ends, `intervalMs` after
 * the current one started, or at once when it took longer than that. A failed step is logged
 * and the service carries on; the settlement step runs even when the catalogue step failed.
 */
export function startCatalogSync(options: CatalogSyncServiceOptions): CatalogSyncService {
  const { client, store, logger, signal, cache } = options;
  const intervalMs = options.intervalMs ?? 60_000;
  const now = options.now ?? systemClock;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("startCatalogSync: intervalMs must be a positive number");
  }

  const runOnce = async (): Promise<void> => {
    try {
      const result = cache
        ? await syncCatalog(cache, store)
        : await storeCatalog(await loadSportsCatalog(client, logger), store);
      logger.info(result, "catalogue synced");
    } catch (error: unknown) {
      logger.error({ err: error }, "catalogue sync failed, next run retries");
    }
    if (signal.aborted) return;
    try {
      await syncSettlements(client, store, logger, { pages: options.settlementPages, now });
    } catch (error: unknown) {
      logger.error({ err: error }, "settlement sync failed, next run retries");
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
