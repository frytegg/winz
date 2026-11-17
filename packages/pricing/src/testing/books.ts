import fc from "fast-check";
import { parseContracts } from "@winz/shared";
import type { Book, BookLevel } from "@winz/shared";

/** Test-only builders and generators. Not exported from the package. */

/** A level from a price in basis points and a quantity written like Gemini does ("441.19"). */
export type LevelSpec = readonly [priceBps: bigint, contracts: string];

export const NOW_MS = 1_800_000_000_000;

function toLevels(specs: readonly LevelSpec[]): BookLevel[] {
  return specs.map(([priceBps, contracts]) => ({ priceBps, qty: parseContracts(contracts) }));
}

/** A book observed at `NOW_MS` unless told otherwise. Asks lowest first, bids highest first. */
export function makeBook(
  asks: readonly LevelSpec[],
  bids: readonly LevelSpec[] = [],
  observedAtMs: number = NOW_MS,
): Book {
  return { instrumentSymbol: "TEST", asks: toLevels(asks), bids: toLevels(bids), observedAtMs };
}

/** Up to 60 contracts, with empty levels now and then. */
const arbLevelQty: fc.Arbitrary<bigint> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(0n) },
  { weight: 9, arbitrary: fc.bigInt({ min: 1n, max: 60_000_000n }) },
);

const arbRawLevels: fc.Arbitrary<BookLevel[]> = fc.array(
  fc.record({
    priceBps: fc.integer({ min: 1, max: 99 }).map((tick) => BigInt(tick) * 100n),
    qty: arbLevelQty,
  }),
  { maxLength: 6 },
);

/** Ask side: up to 6 levels on the tick grid, sorted lowest first, equal prices allowed. */
export const arbAsks: fc.Arbitrary<BookLevel[]> = arbRawLevels.map((levels) =>
  [...levels].sort((a, b) => Number(a.priceBps - b.priceBps)),
);

/** Bid side: up to 6 levels on the tick grid, sorted highest first. */
export const arbBids: fc.Arbitrary<BookLevel[]> = arbRawLevels.map((levels) =>
  [...levels].sort((a, b) => Number(b.priceBps - a.priceBps)),
);

/** A fresh book (observed at `NOW_MS`) with arbitrary sides. */
export const arbBook: fc.Arbitrary<Book> = fc.record({
  instrumentSymbol: fc.constant("TEST"),
  asks: arbAsks,
  bids: arbBids,
  observedAtMs: fc.constant(NOW_MS),
});

/** Total quantity on the ask side. */
export function askDepth(book: Book): bigint {
  return book.asks.reduce((sum, level) => sum + level.qty, 0n);
}
