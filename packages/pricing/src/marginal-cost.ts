import { BPS } from "@winz/shared";
import type { Book, Bps, MicroContracts, MicroUsdc } from "@winz/shared";

import { assertValidAsks } from "./book";
import { assertNonNegative } from "./errors";
import { costPerContractBps } from "./fees";

/** What buying a slice of the ask side as a taker costs, and how deep it reaches. */
export interface TakerFill {
  /** Micro-USDC, taker fees included, rounded up. */
  cost: MicroUsdc;
  /**
   * Price of the highest ask level the slice touches. This is the marginal price `p_eff` that is
   * compared to the pause threshold: if it is at or below the threshold, so is every contract of
   * the slice. Null when the slice is empty (`qty` = 0), because nothing is bought.
   */
  topPriceBps: Bps | null;
}

/**
 * Prices the next `qty` micro-contracts of the asks, after skipping the `skip` micro-contracts
 * already promised to earlier sales that are not hedged yet (SPEC PR-1, 9.2). This is the price of
 * the slice this sale will really consume, not the average from the top of the book.
 *
 * Returns null when the asks do not hold `skip + qty` micro-contracts. An empty slice
 * (`qty` = 0) costs nothing whatever the book holds.
 */
export function marginalTakerFill(
  book: Book,
  skip: MicroContracts,
  qty: MicroContracts,
): TakerFill | null {
  assertNonNegative("skip", skip);
  assertNonNegative("qty", qty);
  assertValidAsks(book.asks);
  if (qty === 0n) return { cost: 0n, topPriceBps: null };

  let toSkip = skip;
  let remaining = qty;
  let rawCost = 0n; // micro-contracts × basis points
  for (const level of book.asks) {
    const skipped = toSkip < level.qty ? toSkip : level.qty;
    toSkip -= skipped;
    const available = level.qty - skipped;
    if (available === 0n) continue;
    const take = remaining < available ? remaining : available;
    rawCost += take * costPerContractBps(level.priceBps);
    remaining -= take;
    if (remaining === 0n) {
      return { cost: (rawCost + BPS - 1n) / BPS, topPriceBps: level.priceBps };
    }
  }
  return null;
}

/**
 * Cost in micro-USDC, taker fees included and rounded up, of the next `qty` micro-contracts of the
 * asks after skipping `skip` micro-contracts already promised; null when the book is too thin
 * (SPEC PR-1). See `marginalTakerFill` for the price level reached.
 */
export function marginalTakerCost(
  book: Book,
  skip: MicroContracts,
  qty: MicroContracts,
): MicroUsdc | null {
  const fill = marginalTakerFill(book, skip, qty);
  return fill === null ? null : fill.cost;
}
