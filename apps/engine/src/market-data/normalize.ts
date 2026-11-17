import { SALES_CLOSE_BEFORE_START_MS, parsePriceBps } from "@winz/shared";
import type { Bps, InstrumentType, Sport } from "@winz/shared";

import type { RawChildEvent, RawContract, RawEvent } from "./schemas";

/** Which side of the game a contract pays on. Same strings as Gemini's `sportsSide`. */
export const INSTRUMENT_SIDES = ["home", "away", "tie"] as const;
export type InstrumentSide = (typeof INSTRUMENT_SIDES)[number];

export interface NormalizedTeam {
  /** As Gemini gives it: "Texas Longhorns" in college sports, "Baltimore" in the NFL. */
  name: string;
  abbreviation: string;
}

/** One game. Its `ticker` is the ticker of the full-game moneyline event. */
export interface NormalizedEvent {
  ticker: string;
  title: string;
  sport: Sport;
  /** Ticker prefix: "NCAAF", "NBA", "NHL", "EPL". */
  league: string;
  startsAt: Date;
  /** `startsAt` minus 5 minutes (SPEC 4.5). No sale after this. */
  salesCloseAt: Date;
  home: NormalizedTeam;
  away: NormalizedTeam;
  /** Gemini's own status string. Seen: "active", "settled"; documented: "invalid". */
  status: string;
}

/** One tradable YES contract of a game. */
export interface NormalizedInstrument {
  /** Gemini `instrumentSymbol`, the key of books and orders. */
  symbol: string;
  /** Ticker of the game (`NormalizedEvent.ticker`), not of the child market. */
  eventTicker: string;
  type: InstrumentType;
  /** "13.5" for spreads and totals, null for moneylines. */
  strike: string | null;
  /** Short human condition: "Texas wins", "Texas wins by 14+", "Over 45.5 points". */
  label: string;
  /**
   * The team the contract pays on, or "tie" for the draw of a three-way moneyline.
   * Null when unknown, and always null on totals, which belong to neither team.
   */
  side: InstrumentSide | null;
  bestBidBps: Bps | null;
  bestAskBps: Bps | null;
}

export interface SkippedItem {
  /** Event ticker or instrument symbol. */
  ref: string;
  reason: string;
}

export interface NormalizedCatalog {
  events: NormalizedEvent[];
  instruments: NormalizedInstrument[];
  /** What was dropped and why, for the caller to log at debug level. */
  skipped: SkippedItem[];
}

/** Gemini `sportsMarket.sport` → shared `Sport`. Anything unknown is "other". */
export function mapSport(geminiSport: string): Sport {
  switch (geminiSport) {
    case "american_football":
      return "football";
    case "basketball":
      return "basketball";
    case "hockey":
    case "ice_hockey":
      return "hockey";
    case "baseball":
      return "baseball";
    case "soccer":
      return "soccer";
    default:
      return "other";
  }
}

/** "NCAAF-2611212030-ARK-TEX-M" → "NCAAF". */
export function leagueFromTicker(ticker: string): string {
  return ticker.split("-")[0] ?? ticker;
}

export function salesCloseAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() - SALES_CLOSE_BEFORE_START_MS);
}

/**
 * Smallest whole margin strictly above a strike: "13.5" → 14, "2.5" → 3, "7" → 8.
 * Null when the strike is not a plain non-negative decimal.
 */
export function smallestMarginAbove(strike: string): number | null {
  const match = /^(\d+)(?:\.\d+)?$/.exec(strike.trim());
  if (!match?.[1]) return null;
  return Number(match[1]) + 1;
}

/** "Texas" → "Texas wins"; the tie contract of a three-way moneyline → "Draw". */
export function moneylineLabel(contract: Pick<RawContract, "label" | "sportsSide">): string {
  return contract.sportsSide === "tie" ? "Draw" : `${contract.label} wins`;
}

/**
 * "Texas wins by more than 13.5 points" → "Texas wins by 14+".
 * Soccer prefixes the label ("Reg Time: Arsenal wins by more than 1.5 goals"); the prefix is dropped.
 * Null when the label or the strike is not in the expected form.
 */
export function spreadLabel(rawLabel: string, strike: string): string | null {
  const team = /^(?:[^:]*:\s*)?(.+?) wins by more than /.exec(rawLabel)?.[1];
  const margin = smallestMarginAbove(strike);
  if (team === undefined || margin === null) return null;
  return `${team} wins by ${margin.toString()}+`;
}

/**
 * Gemini lists totals as "over" contracts only ("More than 45.5 points scored"); there is
 * no under contract, the under is the NO side of the over. → "Over 45.5 points".
 */
export function totalLabel(strike: string, metric: string | null | undefined): string {
  return `Over ${strike} ${metric ?? "points"}`;
}

function isInstrumentSide(value: string): value is InstrumentSide {
  return (INSTRUMENT_SIDES as readonly string[]).includes(value);
}

/**
 * Side of a moneyline or spread contract: Gemini's `sportsSide` when it is there. Most spread
 * contracts come without it; their symbol ends with the team abbreviation and the strike
 * ("…-S-TEX13"), which is matched against the two participants. Null when neither tells.
 */
export function contractSide(
  contract: Pick<RawContract, "instrumentSymbol" | "sportsSide">,
  type: InstrumentType,
  teams: { home: string; away: string },
): InstrumentSide | null {
  if (type === "total") return null;
  if (contract.sportsSide && isInstrumentSide(contract.sportsSide)) return contract.sportsSide;
  if (type !== "spread" || teams.home === teams.away) return null;
  const lastSegment = contract.instrumentSymbol.split("-").pop() ?? "";
  const abbreviation = lastSegment.replace(/\d+$/, "");
  if (abbreviation === "") return null;
  if (abbreviation === teams.home) return "home";
  if (abbreviation === teams.away) return "away";
  return null;
}

/** Full game: "full_contest", or "regulation" for soccer where 90 minutes is the standard market. */
function isFullGame(event: RawChildEvent): boolean {
  const scope = event.sportsMarket?.scope?.type;
  return scope === "full_contest" || scope === "regulation";
}

function isGame(event: RawChildEvent): boolean {
  return event.sportsMarket?.type === "moneyline" && isFullGame(event);
}

/** Full-game point spread or game total. Team totals (subject "team") are a different market. */
function supportedChildType(event: RawChildEvent): "spread" | "total" | null {
  const market = event.sportsMarket;
  if (!market || !isFullGame(event)) return null;
  if (market.type === "spread") return "spread";
  if (market.type === "total" && market.subject === "contest") return "total";
  return null;
}

function priceOrNull(value: string | null | undefined): Bps | null {
  return value === null || value === undefined ? null : parsePriceBps(value);
}

function normalizeContract(
  contract: RawContract,
  market: RawChildEvent,
  type: InstrumentType,
  eventTicker: string,
  teams: { home: string; away: string },
): NormalizedInstrument | SkippedItem {
  const skip = (reason: string): SkippedItem => ({ ref: contract.instrumentSymbol, reason });
  if (contract.isCombo === true) return skip("combo contract");
  if (contract.status !== "active") return skip(`contract status is "${contract.status}"`);

  let strike: string | null = null;
  let label: string;
  if (type === "moneyline") {
    label = moneylineLabel(contract);
  } else if (type === "spread") {
    if (contract.strike?.type !== "spread") return skip("spread contract without a spread strike");
    const built = spreadLabel(contract.label, contract.strike.value);
    if (built === null) return skip(`unrecognised spread label "${contract.label}"`);
    strike = contract.strike.value;
    label = built;
  } else {
    if (contract.strike?.type !== "over") return skip("total contract without an over strike");
    if (smallestMarginAbove(contract.strike.value) === null) {
      return skip(`unrecognised total strike "${contract.strike.value}"`);
    }
    strike = contract.strike.value;
    label = totalLabel(strike, market.sportsMarket?.metric);
  }

  return {
    symbol: contract.instrumentSymbol,
    eventTicker,
    type,
    strike,
    label,
    side: contractSide(contract, type, teams),
    bestBidBps: priceOrNull(contract.prices?.bestBid),
    bestAskBps: priceOrNull(contract.prices?.bestAsk),
  };
}

function isSkipped(value: NormalizedInstrument | SkippedItem): value is SkippedItem {
  return "reason" in value;
}

/**
 * Raw Gemini events (any mix of pages, top-level and nested, with duplicates) → games and
 * their instruments. Pure: nothing is logged, what was dropped is returned in `skipped`.
 *
 * A game is a full-game moneyline event. Its spread and total markets are found in its
 * `events` array and, for markets that only appear at top level, by shared `gameId`.
 * First-half and quarter markets, props, team totals, futures and combos are left out.
 */
export function normalizeCatalog(rawEvents: readonly RawEvent[]): NormalizedCatalog {
  // The same market appears nested under its game and again at top level: keep the first.
  const byTicker = new Map<string, RawChildEvent>();
  const nestedUnder = new Map<string, string[]>();
  for (const event of rawEvents) {
    if (!byTicker.has(event.ticker)) byTicker.set(event.ticker, event);
    const children = event.events ?? [];
    if (children.length > 0 && !nestedUnder.has(event.ticker)) {
      nestedUnder.set(
        event.ticker,
        children.map((child) => child.ticker),
      );
    }
    for (const child of children) {
      if (!byTicker.has(child.ticker)) byTicker.set(child.ticker, child);
    }
  }

  const byGameId = new Map<string, string[]>();
  for (const event of byTicker.values()) {
    if (!event.gameId) continue;
    const tickers = byGameId.get(event.gameId) ?? [];
    tickers.push(event.ticker);
    byGameId.set(event.gameId, tickers);
  }

  const events: NormalizedEvent[] = [];
  const instruments: NormalizedInstrument[] = [];
  const skipped: SkippedItem[] = [];
  const seenSymbols = new Set<string>();
  const attached = new Set<string>();

  const addContracts = (
    market: RawChildEvent,
    type: InstrumentType,
    eventTicker: string,
    teams: { home: string; away: string },
  ): void => {
    for (const contract of market.contracts) {
      const result = normalizeContract(contract, market, type, eventTicker, teams);
      if (isSkipped(result)) {
        skipped.push(result);
      } else if (!seenSymbols.has(result.symbol)) {
        seenSymbols.add(result.symbol);
        instruments.push(result);
      }
    }
  };

  for (const game of byTicker.values()) {
    if (!isGame(game) || !game.sportsMarket) continue;
    attached.add(game.ticker);

    const childTickers = new Set<string>([
      ...(nestedUnder.get(game.ticker) ?? []),
      ...(game.gameId ? (byGameId.get(game.gameId) ?? []) : []),
    ]);
    childTickers.delete(game.ticker);
    const children: { market: RawChildEvent; type: "spread" | "total" }[] = [];
    for (const ticker of childTickers) {
      const market = byTicker.get(ticker);
      const type = market ? supportedChildType(market) : null;
      if (!market || type === null) continue;
      attached.add(ticker);
      children.push({ market, type });
    }

    if (!game.startTime) {
      skipped.push({ ref: game.ticker, reason: "game without startTime" });
      continue;
    }
    const home = game.participants?.find((participant) => participant.side === "home");
    const away = game.participants?.find((participant) => participant.side === "away");
    if (!home || !away) {
      skipped.push({ ref: game.ticker, reason: "game without a home and an away participant" });
      continue;
    }

    const startsAt = new Date(game.startTime);
    events.push({
      ticker: game.ticker,
      title: game.title,
      sport: mapSport(game.sportsMarket.sport),
      league: leagueFromTicker(game.ticker),
      startsAt,
      salesCloseAt: salesCloseAt(startsAt),
      home: { name: home.name, abbreviation: home.abbreviation },
      away: { name: away.name, abbreviation: away.abbreviation },
      status: game.status,
    });

    const teams = { home: home.abbreviation, away: away.abbreviation };
    addContracts(game, "moneyline", game.ticker, teams);
    for (const { market, type } of children) {
      if (market.status !== "active") {
        // "approved" markets are listed before they trade; they come back once active.
        skipped.push({ ref: market.ticker, reason: `market status is "${market.status}"` });
        continue;
      }
      addContracts(market, type, game.ticker, teams);
    }
  }

  for (const event of byTicker.values()) {
    if (attached.has(event.ticker)) continue;
    if (supportedChildType(event) !== null) {
      skipped.push({ ref: event.ticker, reason: "no full-game moneyline for this market" });
    } else if (!event.sportsMarket && (!event.startTime || !event.participants?.length)) {
      skipped.push({ ref: event.ticker, reason: "not a game: no startTime or no participants" });
    }
    // Everything else is a market we do not sell on: periods, props, team totals, to-advance.
  }

  return { events, instruments, skipped };
}
