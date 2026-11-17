import { BPS, TICK_BPS, mulDivDown, mulDivUp, refundableAmount } from "@winz/shared";
import type { Book, Bps, MicroContracts, MicroUsdc } from "@winz/shared";

import { assertValidAsks, isBookStale, midBps } from "./book";
import { PricingInputError, assertInRange, assertNonNegative } from "./errors";
import { costPerContractBps } from "./fees";
import { marginalTakerCost } from "./marginal-cost";
import { computeQuote, resolveToleranceTicks, saleStateForQuote, toleranceCost } from "./quote";
import type { MarketInput, QuoteSaleState } from "./quote";

/**
 * Largest cost of a sale the merchant accepts, in basis points of the price:
 * usual margin − minimum margin (`c_max`, SPEC 4.3). Zero when the minimum is not below the usual.
 */
export function maxCostBps(usualMarginBps: Bps, minMarginBps: Bps): Bps {
  assertInRange("usualMarginBps", usualMarginBps, 0n, BPS);
  assertInRange("minMarginBps", minMarginBps, 0n, BPS);
  if (minMarginBps >= usualMarginBps) return 0n;
  return usualMarginBps - minMarginBps;
}

/**
 * Pause threshold `p_max` (SPEC 4.3): the largest price, on the $0.01 tick grid, such that
 * `refundBps × (p + takerFee(p)) ≤ costBps × 10 000`; 0 when even one tick costs too much.
 * A contract never trades at $1.00, so the result is at most 9 900 (reached when `refundBps` is 0).
 */
export function pauseThresholdBps(costBps: Bps, refundBps: Bps): Bps {
  assertNonNegative("costBps", costBps);
  assertInRange("refundBps", refundBps, 0n, BPS);
  let best = 0n;
  for (let price = TICK_BPS; price < BPS; price += TICK_BPS) {
    if (refundBps * costPerContractBps(price) > costBps * BPS) break;
    best = price;
  }
  return best;
}

/** Which of the two ceilings stops the next sale. */
export type CapacityLimit = "budget" | "depth";

export interface Capacity {
  /** How many more single-unit sales can be quoted right now, rounded down. */
  sales: number;
  /**
   * `depth` when the asks at or below the pause threshold run out first (or at the same sale as
   * the budget), `budget` when the reserved guaranteed costs exhaust the budget first.
   */
  limitedBy: CapacityLimit;
}

export interface LimitsInput extends MarketInput {
  /** Price of one unit, micro-USDC. */
  unitPrice: MicroUsdc;
  /** The campaign's fixed refund rate. */
  refundBps: Bps;
  /** The merchant's usual margin on the offer. */
  usualMarginBps: Bps;
  /** The margin the merchant wants to keep on every sale. */
  minMarginBps: Bps;
  /** Hedge budget still free: budget − spent − reserved, micro-USDC. */
  availableBudget: MicroUsdc;
}

/** Everything screen M6 shows (SPEC PR-2). */
export interface Limits {
  /** `c_max`: usual margin − minimum margin. */
  maxCostBps: Bps;
  /** `p_max`: "Your promo pauses if the chances go above X %". */
  pauseThresholdBps: Bps;
  /** Mid price. Null without a fresh, two-sided book. */
  currentProbabilityBps: Bps | null;
  /**
   * Taker cost, fees included and rounded up, of the next single-unit sale: the slice of the asks
   * right behind `pending`. Null when no fresh book can fill one sale (which includes no asks).
   * It is given even when that sale would be refused for its price or for the budget.
   */
  costPerSale: MicroUsdc | null;
  /**
   * Usual margin on one unit (rounded down) minus `costPerSale`, floored at zero. Null when
   * `costPerSale` is.
   */
  marginKeptPerSale: MicroUsdc | null;
  /** `marginKeptPerSale` as a share of the price, rounded down. */
  marginKeptBps: Bps | null;
  capacity: Capacity;
  /** Whether a single-unit sale could be quoted right now with these terms, and if not, why. */
  saleState: QuoteSaleState;
}

/** A count of sales never needs more than this; it is what an unbounded capacity reports. */
export const MAX_CAPACITY_SALES = Number.MAX_SAFE_INTEGER;

interface AskSlice {
  costBps: Bps;
  left: MicroContracts;
}

function capacityOf(sales: bigint, limitedBy: CapacityLimit): Capacity {
  const capped = sales > BigInt(MAX_CAPACITY_SALES) ? MAX_CAPACITY_SALES : Number(sales);
  return { sales: capped, limitedBy };
}

/** How many sales of `reserve` each fit in `budgetLeft`, at most `fit`. */
function affordableSales(budgetLeft: MicroUsdc, reserve: MicroUsdc, fit: bigint): bigint {
  if (budgetLeft < reserve) return 0n;
  if (reserve === 0n) return fit;
  const byBudget = budgetLeft / reserve;
  return byBudget < fit ? byBudget : fit;
}

/**
 * Counts the single-unit sales that `computeQuote` would accept one after the other on this book,
 * each one consuming `exposure` micro-contracts behind the previous one and reserving its
 * guaranteed cost on the budget. The count is exact: it walks the levels, in bulk where sales fit
 * inside one level and one by one where a sale straddles levels.
 */
function saleCapacity(
  book: Book,
  pending: MicroContracts,
  exposure: MicroContracts,
  thresholdBps: Bps,
  availableBudget: MicroUsdc,
  toleranceTicks: bigint,
): Capacity {
  if (exposure === 0n) {
    // Nothing to hedge: neither the depth nor the price can stop a sale, only a negative budget.
    return capacityOf(availableBudget < 0n ? 0n : BigInt(MAX_CAPACITY_SALES), "budget");
  }

  // Asks a sale may consume: at or below the threshold, minus what is promised to earlier sales.
  assertValidAsks(book.asks);
  const slices: AskSlice[] = [];
  let toSkip = pending;
  for (const level of book.asks) {
    if (level.priceBps > thresholdBps) break;
    const skipped = toSkip < level.qty ? toSkip : level.qty;
    toSkip -= skipped;
    slices.push({ costBps: costPerContractBps(level.priceBps), left: level.qty - skipped });
  }

  const tolerance = toleranceCost(exposure, toleranceTicks);
  let sales = 0n;
  let budgetLeft = availableBudget;
  let index = 0;
  for (;;) {
    const slice = slices[index];
    if (slice === undefined) return capacityOf(sales, "depth");

    if (slice.left >= exposure) {
      // Sales that fit entirely in this level all cost the same.
      const fit = slice.left / exposure;
      const reserve = mulDivUp(exposure, slice.costBps, BPS) + tolerance;
      const sold = affordableSales(budgetLeft, reserve, fit);
      sales += sold;
      budgetLeft -= sold * reserve;
      slice.left -= sold * exposure;
      if (sold < fit) return capacityOf(sales, "budget");
      continue;
    }

    // The next sale takes the rest of this level and continues in the following ones.
    let need = exposure;
    let rawCost = 0n; // micro-contracts × basis points
    let end = index;
    let last = slice;
    for (;;) {
      const take = need < last.left ? need : last.left;
      rawCost += take * last.costBps;
      need -= take;
      if (need === 0n) {
        const reserve = (rawCost + BPS - 1n) / BPS + tolerance;
        if (reserve > budgetLeft) return capacityOf(sales, "budget");
        sales += 1n;
        budgetLeft -= reserve;
        last.left -= take;
        index = end;
        break;
      }
      end += 1;
      const next = slices[end];
      if (next === undefined) return capacityOf(sales, "depth");
      last = next;
    }
  }
}

/**
 * The figures of screen M6, recomputed at every move of a slider (SPEC PR-2): `c_max`, `p_max`,
 * the cost of one sale at the current price, the margin kept, and the remaining capacity.
 *
 * The capacity is the number of single-unit sales that could be quoted now, one after the other:
 * the smaller of what the budget allows (each sale reserves its guaranteed cost) and what the
 * asks hold at or below the pause threshold behind `pending`. A missing or stale book is not
 * priced: the market figures are null and the capacity is zero.
 */
export function limits(input: LimitsInput): Limits {
  if (input.unitPrice <= 0n) {
    throw new PricingInputError(`unitPrice must be positive, got ${input.unitPrice.toString()}`);
  }
  const maxCost = maxCostBps(input.usualMarginBps, input.minMarginBps);
  const threshold = pauseThresholdBps(maxCost, input.refundBps);
  const ticks = resolveToleranceTicks(input.toleranceTicks);
  const saleState = saleStateForQuote(
    computeQuote({ ...input, qty: 1n, pauseThresholdBps: threshold }),
  );

  const book = input.book;
  if (book === null || isBookStale(book, input.nowMs, input.staleAfterMs)) {
    return {
      maxCostBps: maxCost,
      pauseThresholdBps: threshold,
      currentProbabilityBps: null,
      costPerSale: null,
      marginKeptPerSale: null,
      marginKeptBps: null,
      capacity: { sales: 0, limitedBy: "depth" },
      saleState,
    };
  }

  const exposure = refundableAmount(1n, input.unitPrice, input.refundBps);
  const costPerSale = marginalTakerCost(book, input.pending, exposure);
  const usualMargin = mulDivDown(input.unitPrice, input.usualMarginBps, BPS);
  const marginKept =
    costPerSale === null ? null : costPerSale > usualMargin ? 0n : usualMargin - costPerSale;

  return {
    maxCostBps: maxCost,
    pauseThresholdBps: threshold,
    currentProbabilityBps: midBps(book),
    costPerSale,
    marginKeptPerSale: marginKept,
    marginKeptBps: marginKept === null ? null : mulDivDown(marginKept, BPS, input.unitPrice),
    capacity: saleCapacity(book, input.pending, exposure, threshold, input.availableBudget, ticks),
    saleState,
  };
}
