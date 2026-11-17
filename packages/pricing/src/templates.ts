import { BPS, INSTRUMENT_TYPES, mulDivUp } from "@winz/shared";
import type { Book, Bps, InstrumentType } from "@winz/shared";

import { bestAsk, bestBid, isBookStale } from "./book";
import { PricingInputError, assertInRange } from "./errors";
import { costPerContractBps } from "./fees";

/** "Free if …" */
export const FULL_REFUND_BPS = 10_000n;
/** "Half back if …" */
export const HALF_REFUND_BPS = 5_000n;

/** One contract of the event. Extra descriptive fields are carried through untouched. */
export interface TemplateInstrument {
  symbol: string;
  type: InstrumentType;
  /** Latest book, or null when none was received. */
  book: Book | null;
}

export interface PromoTemplateOptions {
  /** Current time, epoch milliseconds. */
  nowMs: number;
  /** Age after which a book is stale. Defaults to `BOOK_STALE_AFTER_MS` (10 s). */
  staleAfterMs?: number;
  /** Most templates returned. Defaults to 5. */
  maxTemplates?: number;
  /**
   * Fewest templates aimed for. Defaults to 3. When fewer conditions are quoted, the other refund
   * rate of the conditions already chosen fills the gap.
   */
  minTemplates?: number;
  /**
   * A condition is offered with a full refund while that costs at most this share of the price,
   * and with a half refund above it. Defaults to 2 500 (25 %).
   */
  fullRefundMaxCostBps?: Bps;
  /** A book is "well quoted" when its bid-ask spread is at most this. Defaults to 500 ($0.05). */
  wellQuotedSpreadBps?: Bps;
  /**
   * Conditions less likely than this are ranked after the others, as if badly quoted. Defaults
   * to 0, which ranks on spread and cost alone.
   */
  minProbabilityBps?: Bps;
}

export type TemplateUnavailableReason = "no_book" | "stale_book";

interface TemplateBase<T extends TemplateInstrument> {
  /** Stable for a given condition and refund rate: `<symbol>:<refundBps>`. */
  id: string;
  /** The instrument as it was passed in, for the caller to build its labels from. */
  instrument: T;
  instrumentSymbol: string;
  type: InstrumentType;
  refundBps: Bps;
}

export interface AvailableTemplate<T extends TemplateInstrument> extends TemplateBase<T> {
  available: true;
  unavailableReason: null;
  /** Market probability of the condition: the mid price. */
  probabilityBps: Bps;
  /**
   * Estimated cost of one sale as a share of its price, fees included, rounded up:
   * refundBps × (bestAsk + takerFee(bestAsk)) / 10 000.
   */
  costBps: Bps;
  /** Best ask minus best bid. */
  spreadBps: Bps;
}

export interface UnavailableTemplate<T extends TemplateInstrument> extends TemplateBase<T> {
  available: false;
  /** `no_book`: no two-sided quote. `stale_book`: a two-sided quote, but too old to price. */
  unavailableReason: TemplateUnavailableReason;
  probabilityBps: null;
  costBps: null;
  spreadBps: null;
}

export type PromoTemplateData<T extends TemplateInstrument = TemplateInstrument> =
  AvailableTemplate<T> | UnavailableTemplate<T>;

interface QuotedCondition<T extends TemplateInstrument> {
  instrument: T;
  probabilityBps: Bps;
  spreadBps: Bps;
  /** Cost of one contract at the best ask, fees included. */
  contractCostBps: Bps;
  /** The refund rate this condition is offered with first. */
  primaryRefundBps: Bps;
  primaryCostBps: Bps;
  preferred: boolean;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareBigint(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unavailableRank(reason: TemplateUnavailableReason): number {
  return reason === "stale_book" ? 0 : 1;
}

function resolveCount(name: string, value: number | undefined, fallback: number): number {
  const count = value ?? fallback;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new PricingInputError(`${name} must be a non-negative integer, got ${String(count)}`);
  }
  return count;
}

function availableTemplate<T extends TemplateInstrument>(
  condition: QuotedCondition<T>,
  refundBps: Bps,
): AvailableTemplate<T> {
  return {
    id: `${condition.instrument.symbol}:${refundBps.toString()}`,
    instrument: condition.instrument,
    instrumentSymbol: condition.instrument.symbol,
    type: condition.instrument.type,
    refundBps,
    available: true,
    unavailableReason: null,
    probabilityBps: condition.probabilityBps,
    costBps: mulDivUp(refundBps, condition.contractCostBps, BPS),
    spreadBps: condition.spreadBps,
  };
}

function unavailableTemplate<T extends TemplateInstrument>(
  instrument: T,
  reason: TemplateUnavailableReason,
): UnavailableTemplate<T> {
  return {
    id: `${instrument.symbol}:${FULL_REFUND_BPS.toString()}`,
    instrument,
    instrumentSymbol: instrument.symbol,
    type: instrument.type,
    refundBps: FULL_REFUND_BPS,
    available: false,
    unavailableReason: reason,
    probabilityBps: null,
    costBps: null,
    spreadBps: null,
  };
}

/**
 * Proposes the ready-made promos of one event for screen M4 (SPEC 5.1, CA-1), as structured data:
 * the caller writes the labels.
 *
 * - A condition is **available** when its book is fresh and quoted on both sides. Without a
 *   two-sided quote it is `no_book`; with one that is too old it is `stale_book`. Unavailable
 *   conditions carry no probability and no cost: a stale book is not priced.
 * - Each available condition is offered with a full refund when that costs at most
 *   `fullRefundMaxCostBps` of the price, and with a half refund otherwise.
 * - Well-quoted conditions (tight spread) come before the others, then the cheapest first. The
 *   best condition of each type (moneyline, spread, total) is chosen first so the cards differ,
 *   then the remaining places go to the next best, up to `maxTemplates`.
 * - When fewer than `minTemplates` conditions are available, the other refund rate of the chosen
 *   conditions is added. Places still free go to unavailable conditions, shown disabled.
 *
 * The result holds at most `maxTemplates` entries, and fewer than `minTemplates` only when the
 * event does not have enough instruments. Order: available first, cheapest first; then stale
 * books, then missing books.
 */
export function promoTemplates<T extends TemplateInstrument>(
  instruments: readonly T[],
  options: PromoTemplateOptions,
): PromoTemplateData<T>[] {
  const maxTemplates = resolveCount("maxTemplates", options.maxTemplates, 5);
  const minTemplates = Math.min(
    resolveCount("minTemplates", options.minTemplates, 3),
    maxTemplates,
  );
  const fullRefundMaxCostBps = options.fullRefundMaxCostBps ?? 2_500n;
  const wellQuotedSpreadBps = options.wellQuotedSpreadBps ?? 500n;
  const minProbabilityBps = options.minProbabilityBps ?? 0n;
  assertInRange("fullRefundMaxCostBps", fullRefundMaxCostBps, 0n, BPS);
  assertInRange("wellQuotedSpreadBps", wellQuotedSpreadBps, 0n, BPS);
  assertInRange("minProbabilityBps", minProbabilityBps, 0n, BPS);

  const seen = new Set<string>();
  const quoted: QuotedCondition<T>[] = [];
  const unavailable: UnavailableTemplate<T>[] = [];
  for (const instrument of instruments) {
    if (seen.has(instrument.symbol)) {
      throw new PricingInputError(`instrument ${instrument.symbol} is listed twice`);
    }
    seen.add(instrument.symbol);

    const book = instrument.book;
    const bid = book === null ? null : bestBid(book);
    const ask = book === null ? null : bestAsk(book);
    if (book === null || bid === null || ask === null) {
      unavailable.push(unavailableTemplate(instrument, "no_book"));
      continue;
    }
    if (isBookStale(book, options.nowMs, options.staleAfterMs)) {
      unavailable.push(unavailableTemplate(instrument, "stale_book"));
      continue;
    }

    const contractCostBps = costPerContractBps(ask.priceBps);
    const probabilityBps = (bid.priceBps + ask.priceBps) / 2n;
    const spread = ask.priceBps - bid.priceBps;
    const primaryRefundBps =
      contractCostBps <= fullRefundMaxCostBps ? FULL_REFUND_BPS : HALF_REFUND_BPS;
    quoted.push({
      instrument,
      probabilityBps,
      spreadBps: spread,
      contractCostBps,
      primaryRefundBps,
      primaryCostBps: mulDivUp(primaryRefundBps, contractCostBps, BPS),
      preferred: spread <= wellQuotedSpreadBps && probabilityBps >= minProbabilityBps,
    });
  }

  // Best first: well quoted, then cheap, then by symbol so the result never depends on input order.
  const ranked = [...quoted].sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      compareBigint(a.primaryCostBps, b.primaryCostBps) ||
      compareText(a.instrument.symbol, b.instrument.symbol),
  );

  // One condition per type first, then the next best whatever their type.
  const chosen: QuotedCondition<T>[] = [];
  for (const type of INSTRUMENT_TYPES) {
    const best = ranked.find((condition) => condition.instrument.type === type);
    if (best !== undefined && chosen.length < maxTemplates) chosen.push(best);
  }
  for (const condition of ranked) {
    if (chosen.length >= maxTemplates) break;
    if (!chosen.includes(condition)) chosen.push(condition);
  }

  const offered: AvailableTemplate<T>[] = chosen.map((condition) =>
    availableTemplate(condition, condition.primaryRefundBps),
  );

  // Too few quoted conditions: offer the chosen ones with the other refund rate as well.
  const chosenByRank = ranked.filter((condition) => chosen.includes(condition));
  for (const condition of chosenByRank) {
    if (offered.length >= minTemplates) break;
    const otherRefundBps =
      condition.primaryRefundBps === FULL_REFUND_BPS ? HALF_REFUND_BPS : FULL_REFUND_BPS;
    offered.push(availableTemplate(condition, otherRefundBps));
  }
  offered.sort(
    (a, b) =>
      compareBigint(a.costBps, b.costBps) ||
      compareText(a.instrumentSymbol, b.instrumentSymbol) ||
      compareBigint(b.refundBps, a.refundBps),
  );

  // Places left go to conditions that cannot be sold now: stale books first, they may come back.
  const disabled = [...unavailable]
    .sort(
      (a, b) =>
        unavailableRank(a.unavailableReason) - unavailableRank(b.unavailableReason) ||
        compareText(a.instrumentSymbol, b.instrumentSymbol),
    )
    .slice(0, maxTemplates - offered.length);

  return [...offered, ...disabled];
}
