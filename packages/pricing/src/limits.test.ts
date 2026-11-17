import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TICK_BPS } from "@winz/shared";

import { PricingInputError } from "./errors";
import { costPerContractBps } from "./fees";
import { MAX_CAPACITY_SALES, limits, maxCostBps, pauseThresholdBps } from "./limits";
import type { LimitsInput } from "./limits";
import { computeQuote } from "./quote";
import type { QuoteRefusalReason } from "./quote";
import { NOW_MS, arbBook, makeBook } from "./testing/books";

describe("maxCostBps", () => {
  it("is the usual margin minus the minimum margin", () => {
    // SPEC 4.3: 65 % − 45 % = 20 %.
    expect(maxCostBps(6500n, 4500n)).toBe(2000n);
    expect(maxCostBps(10_000n, 0n)).toBe(10_000n);
  });

  it("is zero when the minimum margin is not below the usual one", () => {
    expect(maxCostBps(4500n, 4500n)).toBe(0n);
    expect(maxCostBps(4500n, 6500n)).toBe(0n);
    expect(maxCostBps(4500n, 4501n)).toBe(0n);
  });

  it("refuses a margin outside 0..10 000 bps", () => {
    expect(() => maxCostBps(10_001n, 0n)).toThrow(PricingInputError);
    expect(() => maxCostBps(6500n, -1n)).toThrow(PricingInputError);
    expect(() => maxCostBps(6500n, 4500n)).not.toThrow();
  });
});

describe("pauseThresholdBps", () => {
  it("is 18 % in the worked example of SPEC 4.3, because 19 % costs 20.08 %", () => {
    expect(pauseThresholdBps(2000n, 10_000n)).toBe(1800n);
    expect(costPerContractBps(1800n)).toBeLessThanOrEqual(2000n);
    expect(costPerContractBps(1900n)).toBeGreaterThan(2000n);
  });

  it("is twice as far with a half refund, fees aside", () => {
    // 50 % × c(0.37) = 19.32 % ≤ 20 % ; 50 % × c(0.38) = 19.83 % ≤ 20 % ; 50 % × c(0.39) = 20.33 %.
    expect(pauseThresholdBps(2000n, 5_000n)).toBe(3800n);
  });

  it("is 0 when even one tick costs too much", () => {
    expect(pauseThresholdBps(0n, 10_000n)).toBe(0n);
    // One tick costs 1.07 % of the price at a full refund.
    expect(pauseThresholdBps(106n, 10_000n)).toBe(0n);
    expect(pauseThresholdBps(107n, 10_000n)).toBe(100n);
  });

  it("is the highest tradable tick, 99 %, when nothing is refunded (R = 0)", () => {
    expect(pauseThresholdBps(0n, 0n)).toBe(9900n);
    expect(pauseThresholdBps(2000n, 0n)).toBe(9900n);
  });

  it("never exceeds 99 %, even when the whole price may be spent", () => {
    expect(pauseThresholdBps(10_000n, 10_000n)).toBe(9900n);
  });

  it("refuses a negative cost and a refund rate outside 0..10 000 bps", () => {
    expect(() => pauseThresholdBps(-1n, 10_000n)).toThrow(PricingInputError);
    expect(() => pauseThresholdBps(2000n, 10_001n)).toThrow(PricingInputError);
    expect(() => pauseThresholdBps(2000n, -1n)).toThrow(PricingInputError);
  });

  const arbCost = fc.bigInt({ min: 0n, max: 10_000n });
  const arbRefund = fc.bigInt({ min: 0n, max: 10_000n });

  it("is the largest tick whose cost fits: it fits, and the next tick does not", () => {
    let interior = 0;
    fc.assert(
      fc.property(arbCost, arbRefund, (costBps, refundBps) => {
        const threshold = pauseThresholdBps(costBps, refundBps);
        expect(threshold % TICK_BPS).toBe(0n);
        if (threshold > 0n) {
          expect(refundBps * costPerContractBps(threshold)).toBeLessThanOrEqual(costBps * 10_000n);
        }
        if (threshold < 9900n) {
          expect(refundBps * costPerContractBps(threshold + TICK_BPS)).toBeGreaterThan(
            costBps * 10_000n,
          );
        }
        if (threshold > 0n && threshold < 9900n) interior += 1;
      }),
      { numRuns: 1000 },
    );
    expect(interior).toBeGreaterThan(0);
  });

  it("never decreases when the accepted cost grows", () => {
    fc.assert(
      fc.property(arbCost, arbCost, arbRefund, (a, b, refundBps) => {
        const low = a < b ? a : b;
        const high = a < b ? b : a;
        expect(pauseThresholdBps(low, refundBps)).toBeLessThanOrEqual(
          pauseThresholdBps(high, refundBps),
        );
      }),
      { numRuns: 500 },
    );
    // Positive control: the threshold does move with the cost.
    expect(pauseThresholdBps(1000n, 10_000n)).toBeLessThan(pauseThresholdBps(2000n, 10_000n));
  });

  it("never increases when the refund rate grows", () => {
    fc.assert(
      fc.property(arbCost, arbRefund, arbRefund, (costBps, a, b) => {
        const low = a < b ? a : b;
        const high = a < b ? b : a;
        expect(pauseThresholdBps(costBps, high)).toBeLessThanOrEqual(
          pauseThresholdBps(costBps, low),
        );
      }),
      { numRuns: 500 },
    );
    expect(pauseThresholdBps(2000n, 10_000n)).toBeLessThan(pauseThresholdBps(2000n, 5_000n));
  });
});

/** Joe's Pizza (SPEC 4.3): $20, usual margin 65 %, minimum 45 %, 100 % back, $1,000 of budget. */
const joe: LimitsInput = {
  book: makeBook(
    [
      [1200n, "441.19"],
      [1300n, "120"],
      [1900n, "500"],
    ],
    [[1100n, "300"]],
  ),
  pending: 0n,
  unitPrice: 20_000_000n,
  refundBps: 10_000n,
  usualMarginBps: 6500n,
  minMarginBps: 4500n,
  availableBudget: 1_000_000_000n,
  nowMs: NOW_MS,
};

describe("limits", () => {
  it("gives the figures of the worked example of SPEC 4.3", () => {
    expect(limits(joe)).toEqual({
      maxCostBps: 2000n,
      pauseThresholdBps: 1800n,
      currentProbabilityBps: 1150n,
      // $20 × (0.12 + 0.07 × 0.12 × 0.88) = $2.548
      costPerSale: 2_548_000n,
      // $13.00 of usual margin − $2.548 = $10.452
      marginKeptPerSale: 10_452_000n,
      marginKeptBps: 5226n,
      // 561.19 contracts at or below 18 %, 20 per pizza.
      capacity: { sales: 28, limitedBy: "depth" },
      saleState: "open",
    });
  });

  it("counts the capacity on the budget when it runs out before the asks", () => {
    // Each of the first 22 sales reserves $2.548 + $0.20 of tolerance.
    expect(limits({ ...joe, availableBudget: 50_000_000n }).capacity).toEqual({
      sales: 18,
      limitedBy: "budget",
    });
    expect(limits({ ...joe, availableBudget: 22n * 2_748_000n }).capacity).toEqual({
      sales: 22,
      limitedBy: "budget",
    });
    // The 23rd sale straddles the 12 % and 13 % levels: it reserves $2.947386.
    expect(limits({ ...joe, availableBudget: 22n * 2_748_000n + 2_947_385n }).capacity).toEqual({
      sales: 22,
      limitedBy: "budget",
    });
    expect(limits({ ...joe, availableBudget: 22n * 2_748_000n + 2_947_386n }).capacity).toEqual({
      sales: 23,
      limitedBy: "budget",
    });
  });

  it("says depth when the budget and the asks run out at the same sale", () => {
    // 22 sales at 12 %, one across both levels, 5 at 13 %: exactly what 28 sales reserve.
    const exact = 22n * 2_748_000n + 2_947_386n + 5n * 2_960_000n;
    expect(limits({ ...joe, availableBudget: exact }).capacity).toEqual({
      sales: 28,
      limitedBy: "depth",
    });
    expect(limits({ ...joe, availableBudget: exact - 1n }).capacity).toEqual({
      sales: 27,
      limitedBy: "budget",
    });
  });

  it("starts the capacity and the cost behind the pending exposure", () => {
    const result = limits({ ...joe, pending: 440_000_000n });
    // 1.19 contracts left at 12 %, then the 13 % level.
    expect(result.costPerSale).toBe(2_747_386n);
    expect(result.marginKeptPerSale).toBe(13_000_000n - 2_747_386n);
    // 121.19 contracts left at or below 18 %.
    expect(result.capacity).toEqual({ sales: 6, limitedBy: "depth" });
    expect(result.saleState).toBe("open");
  });

  it("does not count the asks above the pause threshold", () => {
    // Minimum margin 51 %: c_max = 14 %, so p_max = 13 % and the 19 % level is out of reach.
    const tight = limits({ ...joe, minMarginBps: 5100n });
    expect(tight.pauseThresholdBps).toBe(1300n);
    expect(tight.capacity).toEqual({ sales: 28, limitedBy: "depth" });
    // Minimum margin 52 %: p_max = 12 %, only the first level counts.
    const tighter = limits({ ...joe, minMarginBps: 5200n });
    expect(tighter.pauseThresholdBps).toBe(1200n);
    expect(tighter.capacity).toEqual({ sales: 22, limitedBy: "depth" });
    // Usual margin 85 %: c_max = 40 %, p_max = 38 %, the 19 % level counts too (1,061.19 contracts).
    const loose = limits({ ...joe, usualMarginBps: 8500n });
    expect(loose.pauseThresholdBps).toBe(3800n);
    expect(loose.capacity).toEqual({ sales: 53, limitedBy: "depth" });
  });

  it("still shows the cost of a sale when the price is above the threshold", () => {
    const book = makeBook([[2300n, "500"]], [[2200n, "100"]]);
    expect(limits({ ...joe, book })).toEqual({
      maxCostBps: 2000n,
      pauseThresholdBps: 1800n,
      currentProbabilityBps: 2250n,
      costPerSale: 4_848_000n,
      marginKeptPerSale: 8_152_000n,
      marginKeptBps: 4076n,
      capacity: { sales: 0, limitedBy: "depth" },
      saleState: "paused_price",
    });
  });

  it("pauses on the budget when it cannot reserve one sale", () => {
    const result = limits({ ...joe, availableBudget: 2_747_999n });
    expect(result.capacity).toEqual({ sales: 0, limitedBy: "budget" });
    expect(result.saleState).toBe("paused_budget");
    expect(result.costPerSale).toBe(2_548_000n);
    expect(limits({ ...joe, availableBudget: -1n }).capacity).toEqual({
      sales: 0,
      limitedBy: "budget",
    });
  });

  it("has no market figure and no capacity without a book", () => {
    expect(limits({ ...joe, book: null })).toEqual({
      maxCostBps: 2000n,
      pauseThresholdBps: 1800n,
      currentProbabilityBps: null,
      costPerSale: null,
      marginKeptPerSale: null,
      marginKeptBps: null,
      capacity: { sales: 0, limitedBy: "depth" },
      saleState: "paused_depth",
    });
  });

  it("does not price a stale book", () => {
    expect(limits({ ...joe, nowMs: NOW_MS + 10_001 })).toEqual({
      maxCostBps: 2000n,
      pauseThresholdBps: 1800n,
      currentProbabilityBps: null,
      costPerSale: null,
      marginKeptPerSale: null,
      marginKeptBps: null,
      capacity: { sales: 0, limitedBy: "depth" },
      saleState: "paused_stale",
    });
    // Positive control: one millisecond earlier the book is priced.
    expect(limits({ ...joe, nowMs: NOW_MS + 10_000 }).costPerSale).toBe(2_548_000n);
  });

  it("has a cost but no probability when nobody bids, and neither when nobody offers", () => {
    const asksOnly = limits({ ...joe, book: makeBook([[1200n, "441.19"]]) });
    expect(asksOnly.currentProbabilityBps).toBeNull();
    expect(asksOnly.costPerSale).toBe(2_548_000n);
    expect(asksOnly.capacity).toEqual({ sales: 22, limitedBy: "depth" });

    const bidsOnly = limits({ ...joe, book: makeBook([], [[1100n, "300"]]) });
    expect(bidsOnly.currentProbabilityBps).toBeNull();
    expect(bidsOnly.costPerSale).toBeNull();
    expect(bidsOnly.marginKeptPerSale).toBeNull();
    expect(bidsOnly.marginKeptBps).toBeNull();
    expect(bidsOnly.capacity).toEqual({ sales: 0, limitedBy: "depth" });
    expect(bidsOnly.saleState).toBe("paused_depth");
  });

  it("has no cost when the asks cannot fill one sale", () => {
    const thin = limits({ ...joe, book: makeBook([[1200n, "19.99"]], [[1100n, "300"]]) });
    expect(thin.costPerSale).toBeNull();
    expect(thin.capacity).toEqual({ sales: 0, limitedBy: "depth" });
    expect(thin.saleState).toBe("paused_depth");
    expect(thin.currentProbabilityBps).toBe(1150n);
    // Exact depth for one sale.
    const exact = limits({ ...joe, book: makeBook([[1200n, "20"]], [[1100n, "300"]]) });
    expect(exact.costPerSale).toBe(2_548_000n);
    expect(exact.capacity).toEqual({ sales: 1, limitedBy: "depth" });
  });

  it("floors the margin kept at zero when a sale would cost more than the usual margin", () => {
    // Usual margin 10 % of $20 = $2.00, less than the $2.548 a sale costs.
    const result = limits({ ...joe, usualMarginBps: 1000n, minMarginBps: 500n });
    expect(result.costPerSale).toBe(2_548_000n);
    expect(result.marginKeptPerSale).toBe(0n);
    expect(result.marginKeptBps).toBe(0n);
    expect(result.saleState).toBe("paused_price");
  });

  it("rounds the usual margin and the margin kept down", () => {
    // $0.000007 at 65 %: 4.55 micro-USDC of margin → 4. Exposure 7 micro-contracts → cost 1.
    const result = limits({ ...joe, unitPrice: 7n });
    expect(result.costPerSale).toBe(1n);
    expect(result.marginKeptPerSale).toBe(3n);
    // 3 / 7 = 42.857 %
    expect(result.marginKeptBps).toBe(4285n);
  });

  it("has no ceiling when nothing is refunded (R = 0)", () => {
    const result = limits({ ...joe, refundBps: 0n });
    expect(result.pauseThresholdBps).toBe(9900n);
    expect(result.costPerSale).toBe(0n);
    expect(result.marginKeptPerSale).toBe(13_000_000n);
    expect(result.marginKeptBps).toBe(6500n);
    expect(result.capacity).toEqual({ sales: MAX_CAPACITY_SALES, limitedBy: "budget" });
    expect(result.saleState).toBe("open");
    expect(limits({ ...joe, refundBps: 0n, availableBudget: -1n }).capacity).toEqual({
      sales: 0,
      limitedBy: "budget",
    });
  });

  it("counts a capacity of a billion sales without walking them one by one", () => {
    // $0.001 per unit: 1,000 micro-contracts per sale, reserving 128 + 10 micro-USDC each.
    const tiny: LimitsInput = {
      ...joe,
      book: makeBook([[1200n, "1000000"]], [[1100n, "1"]]),
      unitPrice: 1_000n,
      availableBudget: 138_000_000_000n,
    };
    expect(limits(tiny).capacity).toEqual({ sales: 1_000_000_000, limitedBy: "depth" });
    expect(limits({ ...tiny, availableBudget: 137_999_999_999n }).capacity).toEqual({
      sales: 999_999_999,
      limitedBy: "budget",
    });
  });

  it("caps the count at the largest safe integer", () => {
    const huge: LimitsInput = {
      ...joe,
      book: makeBook([[1200n, "10000000000"]], [[1100n, "1"]]),
      unitPrice: 1n,
      availableBudget: 10n ** 20n,
    };
    expect(limits(huge).capacity).toEqual({ sales: MAX_CAPACITY_SALES, limitedBy: "depth" });
  });

  it("handles asks at a price of zero, which cost nothing to reserve without tolerance", () => {
    const free: LimitsInput = {
      ...joe,
      book: makeBook([[0n, "100"]], []),
      toleranceTicks: 0,
      availableBudget: 0n,
    };
    expect(limits(free).capacity).toEqual({ sales: 5, limitedBy: "depth" });
    expect(limits({ ...free, availableBudget: -1n }).capacity).toEqual({
      sales: 0,
      limitedBy: "budget",
    });
  });

  it("rounds up the reserve of a sale that straddles two levels", () => {
    // 3 micro-contracts per sale: 1 at 12.74 % and 2 at 13.80 % cost 0.4034 micro-USDC → 1.
    const dust: LimitsInput = {
      ...joe,
      book: makeBook(
        [
          [1200n, "0.000001"],
          [1300n, "100"],
        ],
        [[1100n, "300"]],
      ),
      unitPrice: 3n,
      toleranceTicks: 0,
    };
    expect(limits({ ...dust, availableBudget: 0n }).capacity).toEqual({
      sales: 0,
      limitedBy: "budget",
    });
    expect(limits({ ...dust, availableBudget: 1n }).capacity).toEqual({
      sales: 1,
      limitedBy: "budget",
    });
  });

  it("skips empty levels between two quoted ones", () => {
    const book = makeBook(
      [
        [1200n, "30"],
        [1250n, "0"],
        [1300n, "30"],
      ],
      [[1100n, "300"]],
    );
    // One sale at 12 %, one across both levels (10 + 10), one at 13 %.
    expect(limits({ ...joe, book }).capacity).toEqual({ sales: 3, limitedBy: "depth" });
  });

  it("refuses terms that can never be valid", () => {
    expect(() => limits({ ...joe, unitPrice: 0n })).toThrow(PricingInputError);
    expect(() => limits({ ...joe, usualMarginBps: 10_001n })).toThrow(PricingInputError);
    expect(() => limits({ ...joe, refundBps: 10_001n })).toThrow(PricingInputError);
    expect(() => limits({ ...joe, pending: -1n })).toThrow(PricingInputError);
    expect(() => limits({ ...joe, toleranceTicks: -1 })).toThrow(PricingInputError);
    expect(() => limits(joe)).not.toThrow();
  });
});

/** Sells one unit after the other, as the purchase job would, until a quote is refused. */
function sellUntilRefused(
  input: LimitsInput,
  thresholdBps: bigint,
): { accepted: number; refusal: QuoteRefusalReason } {
  let pending = input.pending;
  let budget = input.availableBudget;
  let accepted = 0;
  for (;;) {
    const quote = computeQuote({
      ...input,
      qty: 1n,
      pauseThresholdBps: thresholdBps,
      pending,
      availableBudget: budget,
    });
    if (!quote.ok) return { accepted, refusal: quote.reason };
    accepted += 1;
    // The generated books hold at most 360 contracts and a sale needs at least half of one.
    if (accepted > 1_000) throw new Error("repeated quoting never refused a sale");
    pending += quote.exposure;
    budget -= quote.maxHedgeCost;
  }
}

describe("limits, properties", () => {
  const arbInput: fc.Arbitrary<LimitsInput> = fc
    .record({
      book: arbBook,
      pending: fc.bigInt({ min: 0n, max: 100_000_000n }),
      unitPrice: fc.bigInt({ min: 2_000_000n, max: 30_000_000n }),
      refundBps: fc.constantFrom(2_500n, 5_000n, 7_777n, 10_000n),
      usualMarginBps: fc.bigInt({ min: 2_000n, max: 10_000n }),
      minMarginShare: fc.bigInt({ min: 0n, max: 10_000n }),
      availableBudget: fc.bigInt({ min: 0n, max: 400_000_000n }),
      toleranceTicks: fc.integer({ min: 0, max: 2 }),
    })
    .map(({ minMarginShare, ...terms }) => ({
      ...terms,
      minMarginBps: (terms.usualMarginBps * minMarginShare) / 10_000n,
      nowMs: NOW_MS,
    }));

  it("the capacity is exactly the number of sales that repeated quoting accepts", () => {
    const seen = { budget: 0, depth: 0, none: 0 };
    fc.assert(
      fc.property(arbInput, (input) => {
        const result = limits(input);

        const { accepted, refusal } = sellUntilRefused(input, result.pauseThresholdBps);

        expect(result.capacity.sales).toBe(accepted);
        expect(result.capacity.limitedBy).toBe(refusal === "over_budget" ? "budget" : "depth");
        expect(result.saleState === "open").toBe(accepted > 0);
        if (accepted === 0) seen.none += 1;
        else seen[result.capacity.limitedBy] += 1;
      }),
      { numRuns: 1500 },
    );
    // Sales limited by the budget, by the depth, and no sale at all were all exercised.
    expect(seen.budget).toBeGreaterThan(0);
    expect(seen.depth).toBeGreaterThan(0);
    expect(seen.none).toBeGreaterThan(0);
  });

  it("the capacity never grows when the budget shrinks or the pending exposure grows", () => {
    fc.assert(
      fc.property(
        arbInput,
        fc.bigInt({ min: 0n, max: 100_000_000n }),
        fc.bigInt({ min: 0n, max: 100_000_000n }),
        (input, lessBudget, morePending) => {
          const base = limits(input).capacity.sales;
          expect(
            limits({ ...input, availableBudget: input.availableBudget - lessBudget }).capacity
              .sales,
          ).toBeLessThanOrEqual(base);
          expect(
            limits({ ...input, pending: input.pending + morePending }).capacity.sales,
          ).toBeLessThanOrEqual(base);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("the margin kept never falls below the minimum margin while the sale is open", () => {
    let open = 0;
    fc.assert(
      fc.property(arbInput, (input) => {
        const result = limits(input);
        fc.pre(result.saleState === "open");
        open += 1;
        // Rounding: the usual margin is rounded down and the cost up, one micro-USDC each.
        const minimum = (input.unitPrice * input.minMarginBps) / 10_000n;
        expect(result.marginKeptPerSale ?? -1n).toBeGreaterThanOrEqual(minimum - 2n);
      }),
      { numRuns: 500 },
    );
    expect(open).toBeGreaterThan(0);
  });
});
