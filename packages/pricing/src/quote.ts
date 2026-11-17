import { BPS, DEFAULT_RISK_PARAMS, TICK_BPS, mulDivUp, refundableAmount } from "@winz/shared";
import type { Book, Bps, MicroContracts, MicroUsdc, SaleState } from "@winz/shared";

import { isBookStale } from "./book";
import { PricingInputError, assertInRange, assertNonNegative } from "./errors";
import { marginalTakerFill } from "./marginal-cost";

/** Why no quote can be signed right now (SPEC 9.2, step 3). */
export type QuoteRefusalReason = "stale_book" | "no_depth" | "above_threshold" | "over_budget";

/** What the market looks like when a sale is priced. Shared by `computeQuote` and `limits`. */
export interface MarketInput {
  /** Latest book of the campaign's instrument; null when none was ever received. */
  book: Book | null;
  /**
   * Exposure already sold on this instrument and not hedged yet, in micro-contracts. That part of
   * the asks is promised to earlier sales, so this sale is priced on the slice behind it.
   */
  pending: MicroContracts;
  /** Current time, epoch milliseconds. The library never reads the clock itself. */
  nowMs: number;
  /** Age after which the book is stale. Defaults to `BOOK_STALE_AFTER_MS` (10 s). */
  staleAfterMs?: number;
  /** Guarantee tolerance in price ticks. Defaults to `DEFAULT_RISK_PARAMS.toleranceTicks` (1). */
  toleranceTicks?: number;
}

export interface QuoteInput extends MarketInput {
  /** Units bought, at least 1. */
  qty: bigint;
  /** Price of one unit, micro-USDC. */
  unitPrice: MicroUsdc;
  /** The campaign's fixed refund rate. */
  refundBps: Bps;
  /** The campaign's pause threshold `p_max` (see `pauseThresholdBps`). */
  pauseThresholdBps: Bps;
  /** Hedge budget still free: budget − spent − reserved, micro-USDC. */
  availableBudget: MicroUsdc;
}

export interface AcceptedQuote {
  ok: true;
  /**
   * Refundable amount of the ticket in micro-USDC, which is also the number of micro-contracts
   * that hedge it: qty × unitPrice × refundBps / 10 000, as the contract computes it.
   */
  exposure: MicroContracts;
  /** Taker cost of that slice of the asks, fees included, rounded up. */
  hedgeCost: MicroUsdc;
  /**
   * Guaranteed maximum cost, reserved on the merchant's budget and signed in the quote:
   * `hedgeCost` plus the tolerance (toleranceTicks × one tick × exposure, rounded up).
   */
  maxHedgeCost: MicroUsdc;
  /**
   * Marginal price `p_eff`: the highest ask level this sale consumes. Null when the exposure is
   * zero (refund rate of 0, or a dust amount), because nothing has to be bought.
   */
  effectivePriceBps: Bps | null;
}

export interface RefusedQuote {
  ok: false;
  reason: QuoteRefusalReason;
}

export type Quote = AcceptedQuote | RefusedQuote;

/** The sale state each refusal puts the campaign in (SPEC CA-5). */
export const QUOTE_REFUSAL_SALE_STATE = {
  stale_book: "paused_stale",
  no_depth: "paused_depth",
  above_threshold: "paused_price",
  over_budget: "paused_budget",
} as const satisfies Record<QuoteRefusalReason, SaleState>;

/** The sale states pricing alone can decide; breaker, manual pause and closing are decided elsewhere. */
export type QuoteSaleState = "open" | (typeof QUOTE_REFUSAL_SALE_STATE)[QuoteRefusalReason];

/** `open` for an accepted quote, the matching `paused_*` state for a refused one. */
export function saleStateForQuote(quote: Quote): QuoteSaleState {
  return quote.ok ? "open" : QUOTE_REFUSAL_SALE_STATE[quote.reason];
}

/** Tolerance ticks as a bigint, after checking it is a whole, non-negative number. */
export function resolveToleranceTicks(toleranceTicks: number | undefined): bigint {
  const ticks = toleranceTicks ?? DEFAULT_RISK_PARAMS.toleranceTicks;
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new PricingInputError(
      `toleranceTicks must be a non-negative integer, got ${String(ticks)}`,
    );
  }
  return BigInt(ticks);
}

/** Tolerance added to the cost of a slice of `exposure` micro-contracts, rounded up. */
export function toleranceCost(exposure: MicroContracts, toleranceTicks: bigint): MicroUsdc {
  return mulDivUp(exposure, toleranceTicks * TICK_BPS, BPS);
}

/**
 * Prices one purchase at the moment it goes on-chain (SPEC 9.2). The checks run in this order and
 * the first that fails gives the reason:
 *
 * 1. no book was ever received → `no_depth`; the book is older than 10 s → `stale_book`;
 * 2. the asks behind `pending` do not hold the exposure → `no_depth`;
 * 3. the highest ask level the sale consumes is above the pause threshold → `above_threshold`;
 * 4. the guaranteed cost exceeds the available budget → `over_budget`.
 *
 * Otherwise the quote is accepted with `maxHedgeCost = hedgeCost + tolerance`. A sale with no
 * exposure (refund rate of 0) needs no contract: it is accepted at zero cost on any fresh book.
 */
export function computeQuote(input: QuoteInput): Quote {
  if (input.qty <= 0n) {
    throw new PricingInputError(`qty must be at least 1 unit, got ${input.qty.toString()}`);
  }
  if (input.unitPrice <= 0n) {
    throw new PricingInputError(`unitPrice must be positive, got ${input.unitPrice.toString()}`);
  }
  assertInRange("refundBps", input.refundBps, 0n, BPS);
  assertInRange("pauseThresholdBps", input.pauseThresholdBps, 0n, BPS);
  assertNonNegative("pending", input.pending);
  const ticks = resolveToleranceTicks(input.toleranceTicks);

  if (input.book === null) return { ok: false, reason: "no_depth" };
  if (isBookStale(input.book, input.nowMs, input.staleAfterMs)) {
    return { ok: false, reason: "stale_book" };
  }

  const exposure = refundableAmount(input.qty, input.unitPrice, input.refundBps);
  const fill = marginalTakerFill(input.book, input.pending, exposure);
  if (fill === null) return { ok: false, reason: "no_depth" };
  if (fill.topPriceBps !== null && fill.topPriceBps > input.pauseThresholdBps) {
    return { ok: false, reason: "above_threshold" };
  }

  const maxHedgeCost = fill.cost + toleranceCost(exposure, ticks);
  if (maxHedgeCost > input.availableBudget) return { ok: false, reason: "over_budget" };

  return {
    ok: true,
    exposure,
    hedgeCost: fill.cost,
    maxHedgeCost,
    effectivePriceBps: fill.topPriceBps,
  };
}
