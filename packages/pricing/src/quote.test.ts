import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SALE_STATES } from "@winz/shared";

import { PricingInputError } from "./errors";
import { QUOTE_REFUSAL_SALE_STATE, computeQuote, saleStateForQuote } from "./quote";
import type { QuoteInput, QuoteRefusalReason } from "./quote";
import { NOW_MS, arbBook, makeBook } from "./testing/books";

/** Joe's Pizza (SPEC 4.3): a $20 pizza, 100 % back, pause threshold 18 %, $1,000 of budget. */
const joe: QuoteInput = {
  book: makeBook(
    [
      [1200n, "441.19"],
      [1300n, "120"],
      [1900n, "500"],
    ],
    [[1100n, "300"]],
  ),
  pending: 0n,
  qty: 1n,
  unitPrice: 20_000_000n,
  refundBps: 10_000n,
  pauseThresholdBps: 1800n,
  availableBudget: 1_000_000_000n,
  nowMs: NOW_MS,
};

describe("computeQuote", () => {
  it("quotes the $20 sale of SPEC 4.3 at 12 %", () => {
    expect(computeQuote(joe)).toEqual({
      ok: true,
      exposure: 20_000_000n,
      hedgeCost: 2_548_000n,
      // + one tick ($0.01) on 20 contracts = $0.20
      maxHedgeCost: 2_748_000n,
      effectivePriceBps: 1200n,
    });
  });

  it("scales the exposure with the quantity and the refund rate", () => {
    expect(computeQuote({ ...joe, qty: 3n })).toMatchObject({
      ok: true,
      exposure: 60_000_000n,
      hedgeCost: 7_644_000n,
      maxHedgeCost: 8_244_000n,
    });
    expect(computeQuote({ ...joe, refundBps: 5_000n })).toMatchObject({
      ok: true,
      exposure: 10_000_000n,
      hedgeCost: 1_274_000n,
      maxHedgeCost: 1_374_000n,
    });
  });

  it("prices the slice behind the exposure that is already sold and not hedged", () => {
    // 440 contracts promised: 1.19 left at 12 %, the other 18.81 at 13 %.
    const quote = computeQuote({ ...joe, pending: 440_000_000n });
    expect(quote).toEqual({
      ok: true,
      exposure: 20_000_000n,
      // 1.19 × 0.1274 + 18.81 × 0.1380 = 0.151606 + 2.59578
      hedgeCost: 2_747_386n,
      maxHedgeCost: 2_947_386n,
      effectivePriceBps: 1300n,
    });
  });

  it("adds the tolerance in ticks, rounded up, and none when it is zero", () => {
    expect(computeQuote({ ...joe, toleranceTicks: 0 })).toMatchObject({
      hedgeCost: 2_548_000n,
      maxHedgeCost: 2_548_000n,
    });
    expect(computeQuote({ ...joe, toleranceTicks: 2 })).toMatchObject({
      maxHedgeCost: 2_948_000n,
    });
    // 33 micro-contracts: cost 4.2042 → 5, tolerance 0.33 → 1.
    expect(computeQuote({ ...joe, unitPrice: 33n })).toMatchObject({
      ok: true,
      exposure: 33n,
      hedgeCost: 5n,
      maxHedgeCost: 6n,
    });
  });

  it("guarantees the cost plus the tolerance, which at the threshold is above c_max", () => {
    // At exactly p_max = 18 % the sale costs 20 × 0.1904 = $3.808, under c_max × price = $4.00.
    // The guaranteed cost adds one tick: $4.008. See the open question in the P-01 report.
    const atThreshold = computeQuote({ ...joe, book: makeBook([[1800n, "100"]]) });
    expect(atThreshold).toMatchObject({
      ok: true,
      hedgeCost: 3_808_000n,
      maxHedgeCost: 4_008_000n,
      effectivePriceBps: 1800n,
    });
  });

  describe("refusals", () => {
    it("stale_book: the book is older than 10 s", () => {
      expect(computeQuote({ ...joe, nowMs: NOW_MS + 10_001 })).toEqual({
        ok: false,
        reason: "stale_book",
      });
      // Positive control: at exactly 10 s the same sale is quoted.
      expect(computeQuote({ ...joe, nowMs: NOW_MS + 10_000 }).ok).toBe(true);
      // The limit is a parameter.
      expect(computeQuote({ ...joe, nowMs: NOW_MS + 3_000, staleAfterMs: 2_000 })).toEqual({
        ok: false,
        reason: "stale_book",
      });
    });

    it("no_depth: no book, an empty book, or not enough asks behind the pending exposure", () => {
      const refused = { ok: false, reason: "no_depth" };
      expect(computeQuote({ ...joe, book: null })).toEqual(refused);
      expect(computeQuote({ ...joe, book: makeBook([]) })).toEqual(refused);
      expect(computeQuote({ ...joe, pauseThresholdBps: 9_900n, qty: 54n })).toEqual(refused);
      expect(computeQuote({ ...joe, pending: 1_061_190_000n })).toEqual(refused);
      // Positive control: 53 pizzas are exactly the 1,060 contracts the book can still fill.
      expect(
        computeQuote({ ...joe, pauseThresholdBps: 9_900n, pending: 1_190_000n, qty: 53n }).ok,
      ).toBe(true);
    });

    it("above_threshold: the highest level consumed is above the pause threshold", () => {
      const refused = { ok: false, reason: "above_threshold" };
      // 561.19 contracts at or below 18 %: 28 pizzas fit, the 29th reaches the 19 % level.
      expect(computeQuote({ ...joe, qty: 29n })).toEqual(refused);
      expect(computeQuote({ ...joe, qty: 28n })).toMatchObject({
        ok: true,
        effectivePriceBps: 1300n,
      });
      // The threshold itself is allowed, one basis point under the level is not.
      expect(computeQuote({ ...joe, pauseThresholdBps: 1200n }).ok).toBe(true);
      expect(computeQuote({ ...joe, pauseThresholdBps: 1199n })).toEqual(refused);
      // The pending exposure pushes a small sale into the expensive level.
      expect(computeQuote({ ...joe, pending: 561_190_000n })).toEqual(refused);
    });

    it("over_budget: the guaranteed cost, tolerance included, exceeds the available budget", () => {
      const refused = { ok: false, reason: "over_budget" };
      expect(computeQuote({ ...joe, availableBudget: 2_747_999n })).toEqual(refused);
      expect(computeQuote({ ...joe, availableBudget: 2_748_000n }).ok).toBe(true);
      // The cost alone would fit: the tolerance is what is reserved too.
      expect(computeQuote({ ...joe, availableBudget: 2_548_000n })).toEqual(refused);
      expect(computeQuote({ ...joe, availableBudget: 0n })).toEqual(refused);
    });

    it("are reported in the order stale, depth, price, budget", () => {
      const everythingWrong: QuoteInput = {
        ...joe,
        nowMs: NOW_MS + 60_000,
        qty: 100n,
        pauseThresholdBps: 100n,
        availableBudget: 0n,
      };
      expect(computeQuote(everythingWrong)).toMatchObject({ reason: "stale_book" });
      expect(computeQuote({ ...everythingWrong, nowMs: NOW_MS })).toMatchObject({
        reason: "no_depth",
      });
      expect(computeQuote({ ...everythingWrong, nowMs: NOW_MS, qty: 1n })).toMatchObject({
        reason: "above_threshold",
      });
      expect(
        computeQuote({ ...everythingWrong, nowMs: NOW_MS, qty: 1n, pauseThresholdBps: 1800n }),
      ).toMatchObject({ reason: "over_budget" });
    });
  });

  it("accepts a sale with no exposure (R = 0) at zero cost, on any fresh book", () => {
    const free = {
      ok: true,
      exposure: 0n,
      hedgeCost: 0n,
      maxHedgeCost: 0n,
      effectivePriceBps: null,
    };
    expect(computeQuote({ ...joe, refundBps: 0n })).toEqual(free);
    expect(
      computeQuote({ ...joe, refundBps: 0n, book: makeBook([]), availableBudget: 0n }),
    ).toEqual(free);
    // …but still not on a stale one, nor without any book.
    expect(computeQuote({ ...joe, refundBps: 0n, nowMs: NOW_MS + 60_000 })).toMatchObject({
      reason: "stale_book",
    });
    expect(computeQuote({ ...joe, refundBps: 0n, book: null })).toMatchObject({
      reason: "no_depth",
    });
  });

  it("refuses arguments that can never be valid", () => {
    expect(() => computeQuote({ ...joe, qty: 0n })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, qty: -1n })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, unitPrice: 0n })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, refundBps: 10_001n })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, refundBps: -1n })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, pauseThresholdBps: 10_001n })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, pending: -1n })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, toleranceTicks: -1 })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, toleranceTicks: 0.5 })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, toleranceTicks: Number.NaN })).toThrow(PricingInputError);
    expect(() => computeQuote(joe)).not.toThrow();
  });
});

describe("sale state of a quote", () => {
  it("maps every refusal to its paused state", () => {
    expect(QUOTE_REFUSAL_SALE_STATE).toEqual({
      stale_book: "paused_stale",
      no_depth: "paused_depth",
      above_threshold: "paused_price",
      over_budget: "paused_budget",
    });
    for (const state of Object.values(QUOTE_REFUSAL_SALE_STATE)) {
      expect(SALE_STATES).toContain(state);
    }
  });

  it("is open for an accepted quote and paused for a refused one", () => {
    expect(saleStateForQuote(computeQuote(joe))).toBe("open");
    expect(saleStateForQuote(computeQuote({ ...joe, qty: 29n }))).toBe("paused_price");
    expect(saleStateForQuote(computeQuote({ ...joe, availableBudget: 0n }))).toBe("paused_budget");
    expect(saleStateForQuote(computeQuote({ ...joe, book: null }))).toBe("paused_depth");
    expect(saleStateForQuote(computeQuote({ ...joe, nowMs: NOW_MS + 60_000 }))).toBe(
      "paused_stale",
    );
  });
});

describe("computeQuote, properties", () => {
  const arbInput: fc.Arbitrary<QuoteInput> = fc.record({
    book: arbBook,
    pending: fc.bigInt({ min: 0n, max: 200_000_000n }),
    qty: fc.bigInt({ min: 1n, max: 20n }),
    unitPrice: fc.bigInt({ min: 1n, max: 30_000_000n }),
    refundBps: fc.bigInt({ min: 0n, max: 10_000n }),
    pauseThresholdBps: fc.integer({ min: 0, max: 99 }).map((tick) => BigInt(tick) * 100n),
    availableBudget: fc.bigInt({ min: 0n, max: 100_000_000n }),
    toleranceTicks: fc.integer({ min: 0, max: 3 }),
    nowMs: fc.integer({ min: NOW_MS, max: NOW_MS + 20_000 }),
  });

  it("an accepted quote never reserves more than the budget nor buys above the threshold", () => {
    const seen = new Map<QuoteRefusalReason | "ok", number>();
    fc.assert(
      fc.property(arbInput, (input) => {
        const quote = computeQuote(input);
        seen.set(
          quote.ok ? "ok" : quote.reason,
          (seen.get(quote.ok ? "ok" : quote.reason) ?? 0) + 1,
        );
        if (!quote.ok) return;
        expect(quote.maxHedgeCost).toBeLessThanOrEqual(input.availableBudget);
        expect(quote.hedgeCost).toBeLessThanOrEqual(quote.maxHedgeCost);
        if (quote.effectivePriceBps === null) {
          expect(quote.exposure).toBe(0n);
        } else {
          expect(quote.effectivePriceBps).toBeLessThanOrEqual(input.pauseThresholdBps);
        }
        // The cost is never below what the contracts cost at the lowest ask, before fees.
        expect(quote.hedgeCost * 10_000n).toBeGreaterThanOrEqual(
          quote.exposure * (input.book?.asks[0]?.priceBps ?? 0n),
        );
      }),
      { numRuns: 3000 },
    );
    // Accepted quotes and each kind of refusal all occurred: the property is not vacuous.
    for (const outcome of ["ok", "stale_book", "no_depth", "above_threshold", "over_budget"]) {
      expect(seen.get(outcome as QuoteRefusalReason | "ok") ?? 0, outcome).toBeGreaterThan(0);
    }
  });

  it("a larger budget, a higher threshold or a fresher book never turns an accepted quote down", () => {
    fc.assert(
      fc.property(arbInput, fc.bigInt({ min: 0n, max: 50_000_000n }), (input, extra) => {
        fc.pre(computeQuote(input).ok);
        expect(computeQuote({ ...input, availableBudget: input.availableBudget + extra }).ok).toBe(
          true,
        );
        expect(computeQuote({ ...input, pauseThresholdBps: 9_900n }).ok).toBe(true);
        expect(computeQuote({ ...input, nowMs: NOW_MS }).ok).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
