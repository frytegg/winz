import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SALE_STATES, refundableAmount } from "@winz/shared";

import { PricingInputError } from "./errors";
import {
  QUOTE_REFUSAL_SALE_STATE,
  cappedGuarantee,
  computeQuote,
  guaranteeCap,
  saleStateForQuote,
} from "./quote";
import type { QuoteInput, QuoteRefusalReason } from "./quote";
import { pauseThresholdBps } from "./limits";
import { marginalTakerCost } from "./marginal-cost";
import { NOW_MS, arbBook, makeBook } from "./testing/books";

/**
 * Joe's Pizza (SPEC 4.3): a $20 pizza, 100 % back, c_max 20 % (at most $4.00 of hedge per pizza),
 * pause threshold 18 %, $1,000 of budget.
 */
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
  maxCostBps: 2000n,
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
    // 33 micro-contracts: cost 4.2042 → 5, tolerance 0.33 → 1, cap 33 × 20 % = 6.6 → 6.
    expect(computeQuote({ ...joe, unitPrice: 33n })).toMatchObject({
      ok: true,
      exposure: 33n,
      hedgeCost: 5n,
      maxHedgeCost: 6n,
    });
  });

  describe("the guarantee is capped at c_max of the amount paid (SPEC 4.3, 4.4)", () => {
    it("at the threshold of the worked example, guarantees exactly $4.00, not $4.008", () => {
      // At exactly p_max = 18 % the sale costs 20 × 0.1904 = $3.808; one tick more would be
      // $4.008, above the $4.00 (20 % of $20) the merchant was promised.
      const atThreshold = computeQuote({ ...joe, book: makeBook([[1800n, "100"]]) });
      expect(atThreshold).toEqual({
        ok: true,
        exposure: 20_000_000n,
        hedgeCost: 3_808_000n,
        maxHedgeCost: 4_000_000n,
        effectivePriceBps: 1800n,
      });
      // The budget has to hold the capped guarantee, and no more.
      const book = makeBook([[1800n, "100"]]);
      expect(computeQuote({ ...joe, book, availableBudget: 4_000_000n }).ok).toBe(true);
      expect(computeQuote({ ...joe, book, availableBudget: 3_999_999n })).toEqual({
        ok: false,
        reason: "over_budget",
      });
      // Several units: the cap scales with the amount paid (3 × $4.00).
      expect(computeQuote({ ...joe, book, qty: 3n })).toMatchObject({
        ok: true,
        hedgeCost: 11_424_000n,
        maxHedgeCost: 12_000_000n,
      });
    });

    it("just below the cap, leaves only part of the tolerance", () => {
      // 0.1 contract at 17 % and 19.9 at 18 %: 0.01799 + 3.78896 = $3.80695, so only
      // $0.19305 of the $0.20 tolerance fits under $4.00.
      const book = makeBook([
        [1700n, "0.1"],
        [1800n, "100"],
      ]);
      expect(computeQuote({ ...joe, book })).toMatchObject({
        ok: true,
        hedgeCost: 3_806_950n,
        maxHedgeCost: 4_000_000n,
        effectivePriceBps: 1800n,
      });
      // Same threshold, c_max 19.5 %: $3.90 of cap leaves $0.092 of tolerance at 18 %.
      expect(
        computeQuote({ ...joe, maxCostBps: 1950n, book: makeBook([[1800n, "100"]]) }),
      ).toMatchObject({ ok: true, hedgeCost: 3_808_000n, maxHedgeCost: 3_900_000n });
    });

    it("one tick below the threshold, and far below it, keeps the full tick", () => {
      // 17 %: 20 × 0.1799 = $3.598, + $0.20 = $3.798 ≤ $4.00.
      expect(computeQuote({ ...joe, book: makeBook([[1700n, "100"]]) })).toMatchObject({
        ok: true,
        hedgeCost: 3_598_000n,
        maxHedgeCost: 3_798_000n,
      });
      // 12 %: $2.548 + $0.20 (the first test of this file).
      expect(computeQuote(joe)).toMatchObject({ hedgeCost: 2_548_000n, maxHedgeCost: 2_748_000n });
    });

    it("refuses with above_threshold a sale whose taker cost alone is above the cap", () => {
      const refused = { ok: false, reason: "above_threshold" };
      // A threshold the caller set above p_max: 19 % costs 20 × 0.2008 = $4.016 > $4.00.
      const book = makeBook([[1900n, "100"]]);
      expect(computeQuote({ ...joe, book, pauseThresholdBps: 1900n })).toEqual(refused);
      // Positive control: with c_max 20.08 % the same sale fits exactly, without tolerance.
      expect(
        computeQuote({ ...joe, book, pauseThresholdBps: 1900n, maxCostBps: 2008n }),
      ).toMatchObject({ ok: true, hedgeCost: 4_016_000n, maxHedgeCost: 4_016_000n });
      // Rounding alone can do it under the threshold: a $0.000007 sale at 18 % costs 1.3328 → 2
      // micro-USDC, and its cap is 7 × 20 % = 1.4 → 1.
      const dust = { ...joe, unitPrice: 7n, book: makeBook([[1800n, "100"]]) };
      expect(computeQuote(dust)).toEqual(refused);
      expect(computeQuote({ ...dust, maxCostBps: 2858n })).toMatchObject({
        ok: true,
        hedgeCost: 2n,
        maxHedgeCost: 2n,
      });
      // The cap is checked before the budget.
      expect(computeQuote({ ...joe, book, pauseThresholdBps: 1900n, availableBudget: 0n })).toEqual(
        refused,
      );
    });

    it("refuses every refundable sale when c_max is 0, and still quotes one with R = 0", () => {
      const refused = { ok: false, reason: "above_threshold" };
      // Even asks at a price of 0, which would cost nothing, and a dust sale with no exposure.
      const free = makeBook([[0n, "100"]]);
      expect(computeQuote({ ...joe, maxCostBps: 0n, book: free, pauseThresholdBps: 0n })).toEqual(
        refused,
      );
      expect(computeQuote({ ...joe, maxCostBps: 0n, unitPrice: 1n, refundBps: 1n })).toEqual(
        refused,
      );
      expect(computeQuote({ ...joe, maxCostBps: 0n })).toEqual(refused);
      // Nothing refunded: nothing to hedge, nothing charged.
      expect(computeQuote({ ...joe, maxCostBps: 0n, refundBps: 0n })).toEqual({
        ok: true,
        exposure: 0n,
        hedgeCost: 0n,
        maxHedgeCost: 0n,
        effectivePriceBps: null,
      });
      // The stale book and the missing depth are still reported first.
      expect(computeQuote({ ...joe, maxCostBps: 0n, nowMs: NOW_MS + 60_000 })).toMatchObject({
        reason: "stale_book",
      });
      expect(computeQuote({ ...joe, maxCostBps: 0n, book: makeBook([]) })).toMatchObject({
        reason: "no_depth",
      });
    });

    it("rounds the cap down and keeps the guarantee between the cost and the cap", () => {
      expect(guaranteeCap(1n, 20_000_000n, 2000n)).toBe(4_000_000n);
      expect(guaranteeCap(3n, 7n, 2000n)).toBe(4n); // 4.2 → 4
      expect(guaranteeCap(1n, 7n, 0n)).toBe(0n);
      expect(cappedGuarantee(3_808_000n, 200_000n, 4_000_000n)).toBe(4_000_000n);
      expect(cappedGuarantee(2_548_000n, 200_000n, 4_000_000n)).toBe(2_748_000n);
      expect(cappedGuarantee(4_000_000n, 200_000n, 4_000_000n)).toBe(4_000_000n);
      expect(cappedGuarantee(4_000_001n, 0n, 4_000_000n)).toBeNull();
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
    expect(() => computeQuote({ ...joe, maxCostBps: 10_001n })).toThrow(PricingInputError);
    expect(() => computeQuote({ ...joe, maxCostBps: -1n })).toThrow(PricingInputError);
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
    maxCostBps: fc.oneof(
      { weight: 1, arbitrary: fc.constant(0n) },
      { weight: 9, arbitrary: fc.bigInt({ min: 0n, max: 10_000n }) },
    ),
    availableBudget: fc.bigInt({ min: 0n, max: 100_000_000n }),
    toleranceTicks: fc.integer({ min: 0, max: 3 }),
    nowMs: fc.integer({ min: NOW_MS, max: NOW_MS + 20_000 }),
  });

  it("an accepted quote never reserves more than the budget nor the cap, nor buys above the threshold", () => {
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
        // The merchant never guarantees more than c_max of what the buyer paid, rounded down.
        expect(quote.maxHedgeCost).toBeLessThanOrEqual(
          (input.qty * input.unitPrice * input.maxCostBps) / 10_000n,
        );
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

  it("with p_max derived from c_max, a sale at the threshold never guarantees more than c_max", () => {
    // The campaign's real configuration: the threshold comes from c_max, and the whole sale is
    // filled at that threshold, where the cost is closest to the cap.
    const arbAtThreshold = fc
      .record({
        maxCostBps: fc.bigInt({ min: 107n, max: 10_000n }),
        refundBps: fc.bigInt({ min: 1n, max: 10_000n }),
        qty: fc.bigInt({ min: 1n, max: 20n }),
        unitPrice: fc.bigInt({ min: 1n, max: 30_000_000n }),
        toleranceTicks: fc.integer({ min: 0, max: 3 }),
      })
      .map((terms) => ({
        ...terms,
        threshold: pauseThresholdBps(terms.maxCostBps, terms.refundBps),
      }))
      .filter(({ threshold }) => threshold > 0n);
    let capped = 0;
    let full = 0;
    let refused = 0;
    fc.assert(
      fc.property(arbAtThreshold, ({ threshold, ...terms }) => {
        const book = makeBook([[threshold, "100000000"]]);
        const input: QuoteInput = {
          ...terms,
          book,
          pending: 0n,
          pauseThresholdBps: threshold,
          availableBudget: 10n ** 18n,
          nowMs: NOW_MS,
        };
        const quote = computeQuote(input);
        const cap = (terms.qty * terms.unitPrice * terms.maxCostBps) / 10_000n;
        if (!quote.ok) {
          // Only the rounding of the cost (up) and of the cap (down) can push a sale over it.
          expect(quote.reason).toBe("above_threshold");
          const exposure = refundableAmount(terms.qty, terms.unitPrice, terms.refundBps);
          const cost = marginalTakerCost(book, 0n, exposure) ?? -1n;
          expect(cost).toBeGreaterThan(cap);
          expect(cost - cap).toBeLessThanOrEqual(1n);
          refused += 1;
          return;
        }
        expect(quote.maxHedgeCost).toBeLessThanOrEqual(cap);
        expect(quote.maxHedgeCost).toBeGreaterThanOrEqual(quote.hedgeCost);
        if (quote.maxHedgeCost === cap && quote.hedgeCost < cap) capped += 1;
        if (quote.maxHedgeCost > quote.hedgeCost && quote.maxHedgeCost < cap) full += 1;
      }),
      { numRuns: 2000 },
    );
    // The tolerance was both cut by the cap and left whole: both branches were exercised.
    expect(capped).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
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

  it("a larger c_max never lowers the guarantee, and never refuses on the price a sale it accepted", () => {
    fc.assert(
      fc.property(arbInput, fc.bigInt({ min: 0n, max: 10_000n }), (input, extra) => {
        const before = computeQuote(input);
        fc.pre(before.ok);
        const more = input.maxCostBps + extra > 10_000n ? 10_000n : input.maxCostBps + extra;
        // With unlimited budget, the only effect of a larger cap is a guarantee at least as high.
        const after = computeQuote({ ...input, maxCostBps: more, availableBudget: 10n ** 18n });
        expect(after.ok).toBe(true);
        if (after.ok && before.ok) {
          expect(after.hedgeCost).toBe(before.hedgeCost);
          expect(after.maxHedgeCost).toBeGreaterThanOrEqual(before.maxHedgeCost);
        }
        // A larger cap may reserve more, so it can run out of budget, but only for that reason.
        const sameBudget = computeQuote({ ...input, maxCostBps: more });
        if (!sameBudget.ok) expect(sameBudget.reason).toBe("over_budget");
      }),
      { numRuns: 300 },
    );
  });
});
