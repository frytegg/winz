import { describe, expect, it } from "vitest";

import {
  assertValidAsks,
  bestAsk,
  bestBid,
  isBookStale,
  isTwoSided,
  micropriceBps,
  midBps,
  spreadBps,
} from "./book";
import { PricingInputError } from "./errors";
import { NOW_MS, makeBook } from "./testing/books";

describe("best bid and ask", () => {
  it("are the first levels of each side", () => {
    const book = makeBook(
      [
        [1300n, "100"],
        [1400n, "50"],
      ],
      [
        [1100n, "300"],
        [1000n, "20"],
      ],
    );
    expect(bestAsk(book)).toEqual({ priceBps: 1300n, qty: 100_000_000n });
    expect(bestBid(book)).toEqual({ priceBps: 1100n, qty: 300_000_000n });
    expect(isTwoSided(book)).toBe(true);
  });

  it("skip levels that hold no quantity", () => {
    const book = makeBook(
      [
        [1300n, "0"],
        [1400n, "50"],
      ],
      [
        [1100n, "0"],
        [1000n, "20"],
      ],
    );
    expect(bestAsk(book)?.priceBps).toBe(1400n);
    expect(bestBid(book)?.priceBps).toBe(1000n);
  });

  it("are null on an empty side", () => {
    const book = makeBook([], [[1100n, "300"]]);
    expect(bestAsk(book)).toBeNull();
    expect(bestBid(book)).not.toBeNull();
    expect(isTwoSided(book)).toBe(false);
    expect(isTwoSided(makeBook([[1300n, "1"]]))).toBe(false);
    expect(isTwoSided(makeBook([[1300n, "0"]], [[1100n, "1"]]))).toBe(false);
  });
});

describe("midBps", () => {
  it("is the average of the best bid and the best ask", () => {
    expect(midBps(makeBook([[1300n, "100"]], [[1100n, "300"]]))).toBe(1200n);
    expect(midBps(makeBook([[1200n, "1"]], [[1100n, "1"]]))).toBe(1150n);
  });

  it("rounds down when the sum is odd", () => {
    expect(midBps(makeBook([[1202n, "1"]], [[1101n, "1"]]))).toBe(1151n);
  });

  it("is null without a two-sided book", () => {
    expect(midBps(makeBook([[1300n, "100"]]))).toBeNull();
    expect(midBps(makeBook([], [[1100n, "300"]]))).toBeNull();
    expect(midBps(makeBook([]))).toBeNull();
  });
});

describe("micropriceBps", () => {
  it("is (ask × bidQty + bid × askQty) / (bidQty + askQty)", () => {
    // (1300 × 300 + 1100 × 100) / 400 = 1250: more bids than asks pushes the price up.
    expect(micropriceBps(makeBook([[1300n, "100"]], [[1100n, "300"]]))).toBe(1250n);
    // (1300 × 100 + 1100 × 300) / 400 = 1150: more asks than bids pushes it down.
    expect(micropriceBps(makeBook([[1300n, "300"]], [[1100n, "100"]]))).toBe(1150n);
  });

  it("equals the mid when both sides hold the same quantity", () => {
    const book = makeBook([[1300n, "42"]], [[1100n, "42"]]);
    expect(micropriceBps(book)).toBe(midBps(book));
  });

  it("rounds down", () => {
    // (1300 × 1 + 1100 × 2) / 3 = 1166.67
    expect(micropriceBps(makeBook([[1300n, "2"]], [[1100n, "1"]]))).toBe(1166n);
  });

  it("is null without a two-sided book", () => {
    expect(micropriceBps(makeBook([[1300n, "100"]]))).toBeNull();
    expect(micropriceBps(makeBook([], [[1100n, "300"]]))).toBeNull();
  });
});

describe("spreadBps", () => {
  it("is the best ask minus the best bid", () => {
    expect(spreadBps(makeBook([[1300n, "100"]], [[1100n, "300"]]))).toBe(200n);
  });

  it("is null without a two-sided book", () => {
    expect(spreadBps(makeBook([[1300n, "100"]]))).toBeNull();
    expect(spreadBps(makeBook([], [[1100n, "300"]]))).toBeNull();
  });
});

describe("isBookStale", () => {
  const book = makeBook([[1300n, "100"]], [[1100n, "300"]], NOW_MS);

  it("is false up to 10 s and true after", () => {
    expect(isBookStale(book, NOW_MS)).toBe(false);
    expect(isBookStale(book, NOW_MS + 10_000)).toBe(false);
    expect(isBookStale(book, NOW_MS + 10_001)).toBe(true);
  });

  it("takes another limit", () => {
    expect(isBookStale(book, NOW_MS + 2_000, 2_000)).toBe(false);
    expect(isBookStale(book, NOW_MS + 2_001, 2_000)).toBe(true);
  });

  it("treats a book observed slightly in the future as fresh", () => {
    expect(isBookStale(book, NOW_MS - 50)).toBe(false);
  });

  it("treats a time that is not a number as stale", () => {
    expect(isBookStale(book, Number.NaN)).toBe(true);
    expect(isBookStale({ ...book, observedAtMs: Number.NaN }, NOW_MS)).toBe(true);
  });
});

describe("assertValidAsks", () => {
  it("accepts sorted asks, equal prices and empty levels", () => {
    expect(() =>
      assertValidAsks([
        { priceBps: 0n, qty: 0n },
        { priceBps: 1200n, qty: 5n },
        { priceBps: 1200n, qty: 7n },
        { priceBps: 10_000n, qty: 1n },
      ]),
    ).not.toThrow();
    expect(() => assertValidAsks([])).not.toThrow();
  });

  it("refuses asks that are not sorted lowest first", () => {
    expect(() =>
      assertValidAsks([
        { priceBps: 1300n, qty: 5n },
        { priceBps: 1200n, qty: 5n },
      ]),
    ).toThrow(PricingInputError);
  });

  it("refuses a price outside 0..10 000 bps and a negative quantity", () => {
    expect(() => assertValidAsks([{ priceBps: -1n, qty: 5n }])).toThrow(PricingInputError);
    expect(() => assertValidAsks([{ priceBps: 10_001n, qty: 5n }])).toThrow(PricingInputError);
    expect(() => assertValidAsks([{ priceBps: 1200n, qty: -1n }])).toThrow(PricingInputError);
  });
});
