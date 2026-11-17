import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Book } from "@winz/shared";

import { PricingInputError } from "./errors";
import { takerFeeBps } from "./fees";
import { marginalTakerCost, marginalTakerFill } from "./marginal-cost";
import { arbBook, askDepth, makeBook } from "./testing/books";

/** The sample of SPEC section 14, copied as written. Used as an oracle for non-empty slices. */
function specMarginalTakerCost(book: Book, skip: bigint, qty: bigint): bigint | null {
  const BPS = 10_000n;
  let toSkip = skip;
  let remaining = qty;
  let cost = 0n;
  for (const level of book.asks) {
    const skipped = toSkip < level.qty ? toSkip : level.qty;
    toSkip -= skipped;
    const available = level.qty - skipped;
    if (available === 0n) continue;
    const take = remaining < available ? remaining : available;
    cost += take * (level.priceBps + takerFeeBps(level.priceBps));
    remaining -= take;
    if (remaining === 0n) return (cost + BPS - 1n) / BPS;
  }
  return null;
}

/** null means "cannot be bought": more expensive than anything. */
function orInfinity(cost: bigint | null): bigint {
  return cost ?? 10n ** 30n;
}

const threeLevels = makeBook([
  [1200n, "100"],
  [1300n, "50"],
  [1500n, "200"],
]);

describe("marginalTakerCost", () => {
  it("reproduces Gemini's fee example: 100 contracts at $0.40 pay $1.68 of taker fee", () => {
    const book = makeBook([[4000n, "100"]]);
    const cost = marginalTakerCost(book, 0n, 100_000_000n);
    expect(cost).toBe(41_680_000n);
    expect(orInfinity(cost) - 40_000_000n).toBe(1_680_000n);
  });

  it("prices the $20 sale of SPEC 4.3 at 12 %: $2.548", () => {
    const book = makeBook([[1200n, "441.19"]]);
    expect(marginalTakerCost(book, 0n, 20_000_000n)).toBe(2_548_000n);
  });

  it("is null on an empty book", () => {
    expect(marginalTakerCost(makeBook([]), 0n, 1n)).toBeNull();
    expect(marginalTakerFill(makeBook([]), 0n, 1n)).toBeNull();
  });

  it("fills exactly the depth, and not one micro-contract more", () => {
    // 100 × 0.1274 + 50 × 0.1380 + 200 × 0.1590
    const all = 12_740_000n + 6_900_000n + 31_800_000n;
    expect(marginalTakerCost(threeLevels, 0n, 350_000_000n)).toBe(all);
    expect(marginalTakerCost(threeLevels, 0n, 350_000_001n)).toBeNull();
    expect(marginalTakerCost(threeLevels, 1n, 350_000_000n)).toBeNull();
    expect(marginalTakerCost(threeLevels, 1n, 349_999_999n)).not.toBeNull();
  });

  it("is null when the skip is larger than the depth, or equal to it", () => {
    expect(marginalTakerCost(threeLevels, 400_000_000n, 1n)).toBeNull();
    expect(marginalTakerCost(threeLevels, 350_000_000n, 1n)).toBeNull();
    expect(marginalTakerCost(threeLevels, 349_999_999n, 1n)).toBe(1n);
  });

  it("starts inside a level when the skip lands inside it", () => {
    // Skip 60 of the 100 at 12 %: 40 left there, then 10 at 13 %.
    const fill = marginalTakerFill(threeLevels, 60_000_000n, 50_000_000n);
    expect(fill).toEqual({ cost: 5_096_000n + 1_380_000n, topPriceBps: 1300n });
    // Skip 120: the first level is gone, 30 left at 13 %.
    expect(marginalTakerFill(threeLevels, 120_000_000n, 30_000_000n)).toEqual({
      cost: 4_140_000n,
      topPriceBps: 1300n,
    });
  });

  it("consumes several levels and reports the highest one it touches", () => {
    expect(marginalTakerFill(threeLevels, 0n, 100_000_000n)).toEqual({
      cost: 12_740_000n,
      topPriceBps: 1200n,
    });
    expect(marginalTakerFill(threeLevels, 0n, 100_000_001n)).toEqual({
      cost: 12_740_001n, // one micro-contract at 13.80 %, rounded up
      topPriceBps: 1300n,
    });
    expect(marginalTakerFill(threeLevels, 0n, 200_000_000n)).toEqual({
      cost: 12_740_000n + 6_900_000n + 7_950_000n,
      topPriceBps: 1500n,
    });
  });

  it("prices the slice behind the skip, not the average from the top", () => {
    const fromTop = marginalTakerCost(threeLevels, 0n, 20_000_000n);
    const behind = marginalTakerCost(threeLevels, 150_000_000n, 20_000_000n);
    expect(fromTop).toBe(2_548_000n);
    expect(behind).toBe(3_180_000n);
  });

  it("rounds the cost up to the next micro-USDC", () => {
    const book = makeBook([[1200n, "1"]]);
    // 1 micro-contract × 0.1274 = 0.1274 micro-USDC.
    expect(marginalTakerCost(book, 0n, 1n)).toBe(1n);
    // 7 × 0.1274 = 0.8918; 8 × 0.1274 = 1.0192.
    expect(marginalTakerCost(book, 0n, 7n)).toBe(1n);
    expect(marginalTakerCost(book, 0n, 8n)).toBe(2n);
  });

  it("costs nothing for a zero quantity, whatever the book holds", () => {
    expect(marginalTakerFill(threeLevels, 0n, 0n)).toEqual({ cost: 0n, topPriceBps: null });
    expect(marginalTakerFill(makeBook([]), 0n, 0n)).toEqual({ cost: 0n, topPriceBps: null });
    expect(marginalTakerCost(threeLevels, 999_000_000n, 0n)).toBe(0n);
  });

  it("ignores levels that hold no quantity", () => {
    const book = makeBook([
      [1100n, "0"],
      [1200n, "100"],
    ]);
    expect(marginalTakerFill(book, 0n, 20_000_000n)).toEqual({
      cost: 2_548_000n,
      topPriceBps: 1200n,
    });
  });

  it("refuses a negative skip or quantity", () => {
    expect(() => marginalTakerCost(threeLevels, -1n, 1n)).toThrow(PricingInputError);
    expect(() => marginalTakerCost(threeLevels, 0n, -1n)).toThrow(PricingInputError);
    expect(() => marginalTakerCost(threeLevels, 0n, 1n)).not.toThrow();
  });

  it("refuses asks that are not sorted, instead of pricing them wrong", () => {
    const unsorted = makeBook([
      [1300n, "50"],
      [1200n, "100"],
    ]);
    expect(() => marginalTakerCost(unsorted, 0n, 1n)).toThrow(PricingInputError);
    expect(() => marginalTakerCost(unsorted, 0n, 0n)).toThrow(PricingInputError);
  });
});

describe("marginalTakerCost, properties", () => {
  const arbQty = fc.bigInt({ min: 0n, max: 400_000_000n });

  it("agrees with the sample of SPEC section 14 for every non-empty slice", () => {
    let filled = 0;
    let tooThin = 0;
    fc.assert(
      fc.property(arbBook, arbQty, arbQty, (book, skip, qty) => {
        fc.pre(qty > 0n);
        const expected = specMarginalTakerCost(book, skip, qty);
        if (expected === null) tooThin += 1;
        else filled += 1;
        expect(marginalTakerCost(book, skip, qty)).toBe(expected);
      }),
      { numRuns: 500 },
    );
    // Both outcomes were exercised: the property is not vacuous.
    expect(filled).toBeGreaterThan(0);
    expect(tooThin).toBeGreaterThan(0);
  });

  it("is null exactly when skip + qty exceeds the depth", () => {
    fc.assert(
      fc.property(arbBook, arbQty, arbQty, (book, skip, qty) => {
        fc.pre(qty > 0n);
        const fits = skip + qty <= askDepth(book);
        expect(marginalTakerCost(book, skip, qty) !== null).toBe(fits);
      }),
      { numRuns: 500 },
    );
  });

  it("never decreases when the quantity grows", () => {
    fc.assert(
      fc.property(arbBook, arbQty, arbQty, arbQty, (book, skip, a, b) => {
        const small = a < b ? a : b;
        const large = a < b ? b : a;
        expect(orInfinity(marginalTakerCost(book, skip, small))).toBeLessThanOrEqual(
          orInfinity(marginalTakerCost(book, skip, large)),
        );
      }),
      { numRuns: 500 },
    );
  });

  it("never decreases when the skip grows", () => {
    fc.assert(
      fc.property(arbBook, arbQty, arbQty, arbQty, (book, a, b, qty) => {
        const near = a < b ? a : b;
        const far = a < b ? b : a;
        expect(orInfinity(marginalTakerCost(book, near, qty))).toBeLessThanOrEqual(
          orInfinity(marginalTakerCost(book, far, qty)),
        );
      }),
      { numRuns: 500 },
    );
  });

  it("is additive up to one micro-USDC of rounding: cost(0, a + b) = cost(0, a) + cost(a, b)", () => {
    let compared = 0;
    let rounded = 0;
    fc.assert(
      fc.property(arbBook, arbQty, arbQty, (book, a, b) => {
        const whole = marginalTakerCost(book, 0n, a + b);
        const first = marginalTakerCost(book, 0n, a);
        const second = marginalTakerCost(book, a, b);
        if (whole === null) {
          // The whole cannot be bought, so one of the two parts cannot either.
          expect(first === null || second === null).toBe(true);
          return;
        }
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        const difference = orInfinity(first) + orInfinity(second) - whole;
        // Each part is rounded up once, the whole once: the parts cost 0 or 1 micro-USDC more.
        expect(difference === 0n || difference === 1n).toBe(true);
        compared += 1;
        if (difference === 1n) rounded += 1;
      }),
      { numRuns: 1000 },
    );
    expect(compared).toBeGreaterThan(0);
    expect(rounded).toBeGreaterThan(0);
  });

  it("reports a top price that is the highest level holding part of the slice", () => {
    fc.assert(
      fc.property(arbBook, arbQty, arbQty, (book, skip, qty) => {
        const fill = marginalTakerFill(book, skip, qty);
        fc.pre(fill !== null && fill.topPriceBps !== null);
        const top = fill?.topPriceBps ?? 0n;
        // Everything at or below the top price is enough to hold skip + qty…
        const upToTop = book.asks
          .filter((level) => level.priceBps <= top)
          .reduce((sum, level) => sum + level.qty, 0n);
        expect(upToTop).toBeGreaterThanOrEqual(skip + qty);
        // …and everything strictly below it is not.
        const belowTop = book.asks
          .filter((level) => level.priceBps < top)
          .reduce((sum, level) => sum + level.qty, 0n);
        expect(belowTop).toBeLessThan(skip + qty);
      }),
      { numRuns: 500 },
    );
  });
});
