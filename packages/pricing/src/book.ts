import { BOOK_STALE_AFTER_MS, BPS } from "@winz/shared";
import type { Book, BookLevel, Bps } from "@winz/shared";

import { PricingInputError } from "./errors";

/** First level that actually holds quantity. Levels are expected best first (see `Book`). */
function firstQuotedLevel(levels: readonly BookLevel[]): BookLevel | null {
  for (const level of levels) {
    if (level.qty > 0n) return level;
  }
  return null;
}

/** Best (highest) bid with a positive quantity, or null when nobody bids. */
export function bestBid(book: Book): BookLevel | null {
  return firstQuotedLevel(book.bids);
}

/** Best (lowest) ask with a positive quantity, or null when nobody offers. */
export function bestAsk(book: Book): BookLevel | null {
  return firstQuotedLevel(book.asks);
}

/** A book is two-sided when it has at least one bid and one ask with a positive quantity. */
export function isTwoSided(book: Book): boolean {
  return bestBid(book) !== null && bestAsk(book) !== null;
}

/**
 * Mid price in basis points: (best bid + best ask) / 2, rounded down. This is the probability
 * shown to people (SPEC 9.1). Null without a two-sided book.
 */
export function midBps(book: Book): Bps | null {
  const bid = bestBid(book);
  const ask = bestAsk(book);
  if (bid === null || ask === null) return null;
  return (bid.priceBps + ask.priceBps) / 2n;
}

/**
 * Microprice in basis points: (ask × bidQty + bid × askQty) / (bidQty + askQty), rounded down
 * (SPEC 9.1). It leans towards the side with less quantity. Null without a two-sided book.
 */
export function micropriceBps(book: Book): Bps | null {
  const bid = bestBid(book);
  const ask = bestAsk(book);
  if (bid === null || ask === null) return null;
  return (ask.priceBps * bid.qty + bid.priceBps * ask.qty) / (bid.qty + ask.qty);
}

/** Best ask minus best bid, in basis points. Null without a two-sided book. */
export function spreadBps(book: Book): Bps | null {
  const bid = bestBid(book);
  const ask = bestAsk(book);
  if (bid === null || ask === null) return null;
  return ask.priceBps - bid.priceBps;
}

/**
 * Whether the book is too old to be priced or traded against: strictly more than `staleAfterMs`
 * (10 s by default, SPEC 9.1) between its observation and `nowMs`. A book observed "in the
 * future" (clock skew between two processes) counts as fresh; a time that is not a number counts
 * as stale.
 */
export function isBookStale(
  book: Book,
  nowMs: number,
  staleAfterMs: number = BOOK_STALE_AFTER_MS,
): boolean {
  const ageMs = nowMs - book.observedAtMs;
  return !(ageMs <= staleAfterMs);
}

/**
 * Checks the ask side before it is walked: prices within 0..10 000 bps, no negative quantity, and
 * levels sorted best (lowest) first. A marginal cost computed on unsorted asks would be silently
 * wrong, so this throws instead.
 */
export function assertValidAsks(asks: readonly BookLevel[]): void {
  let previous = 0n;
  for (const level of asks) {
    if (level.priceBps < 0n || level.priceBps > BPS) {
      throw new PricingInputError(
        `ask price must be between 0 and ${BPS.toString()} bps, got ${level.priceBps.toString()}`,
      );
    }
    if (level.qty < 0n) {
      throw new PricingInputError(`ask quantity must not be negative, got ${level.qty.toString()}`);
    }
    if (level.priceBps < previous) {
      throw new PricingInputError("asks must be sorted from the lowest price to the highest");
    }
    previous = level.priceBps;
  }
}
