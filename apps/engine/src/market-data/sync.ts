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

/** MD-1: writes the (cached) catalogue to the store. Events first, instruments reference them. */
export async function syncCatalog(
  cache: CatalogCache,
  store: CatalogStore,
): Promise<{ events: number; instruments: number }> {
  const catalog = await cache.get();
  await store.upsertEvents(catalog.events);
  await store.upsertInstruments(catalog.instruments);
  return { events: catalog.events.length, instruments: catalog.instruments.length };
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
