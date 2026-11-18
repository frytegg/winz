import {
  isBookStale,
  midBps,
  promoTemplates,
  type PromoTemplateData,
  type TemplateInstrument,
} from "@winz/pricing";
import type {
  Book,
  EventSummary,
  EventTeam,
  EventsQuery,
  EventsResponse,
  InstrumentType,
  PromoTemplate,
  Sport,
  TeamSide,
} from "@winz/shared";

import {
  conditionSubject,
  conditionTeam,
  conditionText,
  parseCondition,
  type InstrumentSide,
} from "./condition";
import type { Db } from "./db";
import { isoDate, percentLabel, safeUrl } from "./wire";

/** Most games listed on screen M3. */
export const MAX_EVENTS = 50;

/**
 * Conditions less likely than 5 % are not offered (product default). `promoTemplates` only ranks
 * them last, which would still let one fill a free card, so `eventTemplates` drops them first; the
 * option is passed as well so the library ranks consistently.
 */
export const MIN_TEMPLATE_PROBABILITY_BPS = 500n;

/**
 * The catalogue quote (`instruments.best_bid_bps` / `best_ask_bps`) is refreshed by the engine once
 * a minute, so it is never as fresh as a live book (10 s). It is accepted for the estimates of the
 * cards while it is at most two sync periods old; the real price is checked on the preview.
 */
export const CATALOGUE_STALE_AFTER_MS = 2 * 60_000;

/**
 * The catalogue knows the best prices, not the quantity behind them. The one-level book built from
 * it carries this nominal quantity (one contract) so the pricing library sees a quoted side; depth
 * is only checked on the preview, against the real book.
 */
export const NOMINAL_LEVEL_QTY = 1_000_000n;

export interface CatalogueInstrument extends TemplateInstrument {
  label: string;
  /** `instruments.side`: the team the contract pays on, "tie", or null when unknown. */
  side: InstrumentSide | null;
}

interface EventRow {
  ticker: string;
  title: string;
  sport: Sport;
  league: string;
  home_name: string;
  home_abbreviation: string;
  home_logo_url: string | null;
  away_name: string;
  away_abbreviation: string;
  away_logo_url: string | null;
  starts_at: Date;
  sales_close_at: Date;
}

export interface CatalogueInstrumentRow {
  symbol: string;
  event_ticker: string;
  label: string;
  type: InstrumentType;
  side: InstrumentSide | null;
  best_bid_bps: number | null;
  best_ask_bps: number | null;
  synced_at: Date | null;
}

/** A one-level book from the catalogue quote; null when the instrument was never synced. */
export function catalogueBook(row: CatalogueInstrumentRow): Book | null {
  if (row.synced_at === null) return null;
  return {
    instrumentSymbol: row.symbol,
    bids:
      row.best_bid_bps === null
        ? []
        : [{ priceBps: BigInt(row.best_bid_bps), qty: NOMINAL_LEVEL_QTY }],
    asks:
      row.best_ask_bps === null
        ? []
        : [{ priceBps: BigInt(row.best_ask_bps), qty: NOMINAL_LEVEL_QTY }],
    observedAtMs: row.synced_at.getTime(),
  };
}

/** The card title of a promo: "Free if …", "Half back if …", otherwise "<N>% back if …". */
export function templateHeadline(refundBps: bigint | number, conditionLabel: string): string {
  const refund = BigInt(refundBps);
  if (refund === 10_000n) return `Free if ${conditionLabel}`;
  if (refund === 5_000n) return `Half back if ${conditionLabel}`;
  return `${percentLabel(refund)}% back if ${conditionLabel}`;
}

/**
 * One template of `promoTemplates` on the wire (`promoTemplateSchema`). The condition label, its
 * team's name and its side all come from one reading of the instrument's label (`condition.ts`).
 */
export function toPromoTemplate(template: PromoTemplateData<CatalogueInstrument>): PromoTemplate {
  const condition = parseCondition(template.type, template.instrument.label);
  const label = conditionText(condition);
  return {
    id: template.id,
    instrumentSymbol: template.instrumentSymbol,
    type: template.type,
    conditionLabel: label,
    headline: templateHeadline(template.refundBps, label),
    subjectName: conditionSubject(condition),
    team: conditionTeam(condition, template.instrument.side),
    refundBps: Number(template.refundBps),
    probabilityBps: template.probabilityBps === null ? null : Number(template.probabilityBps),
    costBps: template.costBps === null ? null : Number(template.costBps),
    available: template.available,
    unavailableReason: template.unavailableReason,
  };
}

/**
 * True when the catalogue quotes both sides and their mid (computed as the pricing library does:
 * (bid + ask) / 2, rounded down) is under `MIN_TEMPLATE_PROBABILITY_BPS`. Such a condition is not
 * offered at all. Without a two-sided quote the probability is unknown, so the condition stays and
 * is shown disabled.
 */
export function belowMinimumProbability(row: CatalogueInstrumentRow): boolean {
  if (row.best_bid_bps === null || row.best_ask_bps === null) return false;
  const mid = (BigInt(row.best_bid_bps) + BigInt(row.best_ask_bps)) / 2n;
  return mid < MIN_TEMPLATE_PROBABILITY_BPS;
}

/** The templates of one game, from its instruments' catalogue quotes. */
export function eventTemplates(
  instruments: readonly CatalogueInstrumentRow[],
  now: Date,
): PromoTemplate[] {
  const offered = instruments.filter((row) => !belowMinimumProbability(row));
  const candidates: CatalogueInstrument[] = offered.map((row) => ({
    symbol: row.symbol,
    type: row.type,
    label: row.label,
    side: row.side,
    book: catalogueBook(row),
  }));
  return promoTemplates(candidates, {
    nowMs: now.getTime(),
    staleAfterMs: CATALOGUE_STALE_AFTER_MS,
    minProbabilityBps: MIN_TEMPLATE_PROBABILITY_BPS,
  }).map(toPromoTemplate);
}

/** `search` as an ILIKE pattern matching anywhere, with the wildcards of the input escaped. */
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * A team's chance of winning (`eventTeamSchema.winProbabilityBps`): the mid of the game's moneyline
 * contract on that team (`instruments.side`), from the same catalogue quote and with the same
 * freshness rule as the templates (`CATALOGUE_STALE_AFTER_MS`), computed by the pricing library's
 * `midBps` like a template's `probabilityBps`. Null without such a contract, without a two-sided
 * quote, with a stale one, or when two moneyline contracts claim the same team (it cannot tell
 * which one is the game's). Unlike the templates, a contract under 5 % still gives its chance.
 * The home and away chances come from two separate books: they need not add up to 100 %.
 */
export function teamWinProbabilityBps(
  instruments: readonly CatalogueInstrumentRow[],
  team: TeamSide,
  now: Date,
): number | null {
  const contracts = instruments.filter((row) => row.type === "moneyline" && row.side === team);
  const [contract] = contracts;
  if (contract === undefined || contracts.length > 1) return null;
  const book = catalogueBook(contract);
  if (book === null || isBookStale(book, now.getTime(), CATALOGUE_STALE_AFTER_MS)) return null;
  const mid = midBps(book);
  return mid === null ? null : Number(mid);
}

function toEventSummary(
  row: EventRow,
  instruments: readonly CatalogueInstrumentRow[],
  now: Date,
): EventSummary {
  const team = (side: TeamSide): EventTeam => ({
    name: side === "home" ? row.home_name : row.away_name,
    abbreviation: side === "home" ? row.home_abbreviation : row.away_abbreviation,
    logoUrl: safeUrl(side === "home" ? row.home_logo_url : row.away_logo_url),
    winProbabilityBps: teamWinProbabilityBps(instruments, side, now),
  });
  return {
    ticker: row.ticker,
    title: row.title,
    sport: row.sport,
    league: row.league,
    startsAt: isoDate(row.starts_at),
    salesCloseAt: isoDate(row.sales_close_at),
    home: team("home"),
    away: team("away"),
    templates: eventTemplates(instruments, now),
  };
}

/**
 * GET /api/events (A-01, screens M3 and M4): the next games whose sales are still open (status
 * `active` or `upcoming`, `sales_close_at` in the future), soonest first, at most 50, filtered by
 * sport and by a search on the title, the league and the team names, each with its ready-made
 * promos. Settled and delisted contracts are left out of the templates.
 */
export async function listEvents(db: Db, query: EventsQuery, now: Date): Promise<EventsResponse> {
  const sport = query.sport ?? null;
  const search = query.search?.trim() ? containsPattern(query.search.trim()) : null;
  const events = await db<EventRow[]>`
    select ticker, title, sport, league,
      home_name, home_abbreviation, home_logo_url,
      away_name, away_abbreviation, away_logo_url,
      starts_at, sales_close_at
    from events
    where status in ('active', 'upcoming')
      and sales_close_at > ${now}
      and (${sport}::text is null or sport = ${sport}::text)
      and (
        ${search}::text is null
        or title ilike ${search}::text
        or league ilike ${search}::text
        or home_name ilike ${search}::text
        or away_name ilike ${search}::text
        or home_abbreviation ilike ${search}::text
        or away_abbreviation ilike ${search}::text
      )
    order by starts_at, ticker
    limit ${MAX_EVENTS}
  `;
  if (events.length === 0) return { events: [] };

  const instruments = await db<CatalogueInstrumentRow[]>`
    select symbol, event_ticker, label, type, side, best_bid_bps, best_ask_bps, synced_at
    from instruments
    where event_ticker in ${db(events.map((event) => event.ticker))}
      and active
      and outcome is null
    order by symbol
  `;
  const byEvent = new Map<string, CatalogueInstrumentRow[]>();
  for (const instrument of instruments) {
    const list = byEvent.get(instrument.event_ticker) ?? [];
    list.push(instrument);
    byEvent.set(instrument.event_ticker, list);
  }

  return {
    events: events.map((event) => toEventSummary(event, byEvent.get(event.ticker) ?? [], now)),
  };
}
