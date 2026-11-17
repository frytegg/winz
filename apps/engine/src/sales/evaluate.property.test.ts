import { describe, expect, it } from "vitest";

import { computeQuote, maxCostBps } from "@winz/pricing";
import type { Book } from "@winz/shared";

import {
  RESUME_DELAY_MS,
  RESUME_MARGIN_BPS,
  evaluateSaleState,
  freshMemory,
  isAutomaticPause,
  type SaleStateInput,
  type SaleStateMemory,
} from "./evaluate";
import {
  JOE_SALE_EXPOSURE,
  JOE_TERMS,
  bookAt,
  emptyBook,
  liveInput,
  seededRandom,
} from "./test-support";

const T0 = 1_800_000_000_000;
const SEEDS = 300;
const STEPS = 400;

interface Step {
  input: SaleStateInput;
  /** Whether a single-unit quote would be refused at this instant (or the breaker is on). */
  refused: boolean;
  /** Whether the marginal price is not one tick below p_max (or the quote is refused). */
  notClear: boolean;
  priceRefused: boolean;
}

type MarketMode = "fresh" | "aging" | "none" | "empty" | "thin";

interface Market {
  mode: MarketMode;
  priceBps: bigint;
}

/** A market that keeps its regime for a while, so pauses and reopenings both happen. */
function nextMarket(random: () => number, market: Market): Market {
  if (random() < 0.08) {
    const roll = random();
    const mode: MarketMode =
      roll < 0.6
        ? "fresh"
        : roll < 0.75
          ? "aging"
          : roll < 0.83
            ? "none"
            : roll < 0.91
              ? "empty"
              : "thin";
    return { mode, priceBps: BigInt(14 + Math.floor(random() * 8)) * 100n }; // 14 % .. 21 %
  }
  if (random() < 0.3) {
    const step = random() < 0.5 ? -100n : 100n;
    const priceBps = market.priceBps + step;
    return { ...market, priceBps: priceBps < 100n ? 100n : priceBps > 9_900n ? 9_900n : priceBps };
  }
  return market;
}

function bookOf(random: () => number, market: Market, nowMs: number): Book | null {
  switch (market.mode) {
    case "none":
      return null;
    case "empty":
      return emptyBook(nowMs - Math.floor(random() * 3_000));
    case "thin":
      return bookAt(market.priceBps, nowMs, JOE_SALE_EXPOSURE / 2n);
    case "aging":
      // Around the 10 s staleness limit.
      return bookAt(market.priceBps, nowMs - 9_000 - Math.floor(random() * 3_000), 200_000_000n);
    case "fresh":
      return bookAt(market.priceBps, nowMs - Math.floor(random() * 2_000), 200_000_000n);
  }
}

/** An independent oracle: the quote `computeQuote` would give right now. */
function oracle(input: SaleStateInput): Omit<Step, "input"> {
  const quote = computeQuote({
    book: input.book,
    pending: input.pending,
    nowMs: input.nowMs,
    qty: 1n,
    unitPrice: JOE_TERMS.unitPrice,
    refundBps: JOE_TERMS.refundBps,
    pauseThresholdBps: JOE_TERMS.pauseThresholdBps,
    maxCostBps: maxCostBps(JOE_TERMS.usualMarginBps, JOE_TERMS.minMarginBps),
    availableBudget: input.availableBudget,
  });
  const stale = input.book !== null && input.bookFlaggedStale;
  const refused = input.breaker.active || stale || !quote.ok;
  const clear =
    !refused &&
    quote.ok &&
    (quote.effectivePriceBps === null ||
      quote.effectivePriceBps <= JOE_TERMS.pauseThresholdBps - RESUME_MARGIN_BPS);
  return {
    refused,
    notClear: !clear,
    priceRefused: !quote.ok && quote.reason === "above_threshold",
  };
}

describe("evaluateSaleState: properties over random sequences", () => {
  it("is never open when a quote would be refused, and never reopens less than 10 s after a refusal", () => {
    let reopenings = 0;
    let pauses = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const random = seededRandom(seed);
      let nowMs = T0;
      let breakerOn = false;
      let market: Market = { mode: "fresh", priceBps: 1_500n };
      let budget = 1_000_000_000n;
      let previous: SaleStateMemory | null = freshMemory("open");
      let lastRefusedMs = Number.NEGATIVE_INFINITY;
      let lastNotClearMs = Number.NEGATIVE_INFINITY;
      let priceRefusedInPause = false;

      for (let i = 0; i < STEPS; i += 1) {
        nowMs += Math.floor(random() * 2_000);
        if (random() < 0.02) breakerOn = !breakerOn;
        market = nextMarket(random, market);
        const budgetRoll = random();
        if (budgetRoll < 0.01) budget = BigInt(Math.floor(random() * 4_000_000));
        else if (budgetRoll < 0.03) budget = 1_000_000_000n;
        const input = liveInput(nowMs, {
          book: bookOf(random, market, nowMs),
          bookFlaggedStale: random() < 0.01,
          pending: random() < 0.05 ? BigInt(Math.floor(random() * 300)) * 1_000_000n : 0n,
          availableBudget: budget,
          breaker: { active: breakerOn, reason: breakerOn ? "venue_down" : null },
          previous,
        });
        const truth = oracle(input);
        const decision = evaluateSaleState(input);
        const context = `seed ${String(seed)}, step ${String(i)}`;

        expect(decision.couldOpen, context).toBe(!truth.refused);
        if (decision.state === "open") {
          expect(truth.refused, context).toBe(false);
        }
        if (truth.refused) lastRefusedMs = nowMs;
        if (truth.notClear) lastNotClearMs = nowMs;
        if (truth.priceRefused) priceRefusedInPause = true;

        const was = previous?.state ?? "open";
        if (decision.state === "open" && isAutomaticPause(was)) {
          reopenings += 1;
          expect(nowMs - lastRefusedMs, context).toBeGreaterThanOrEqual(RESUME_DELAY_MS);
          if (priceRefusedInPause) {
            expect(nowMs - lastNotClearMs, context).toBeGreaterThanOrEqual(RESUME_DELAY_MS);
          }
        }
        if (decision.state === "open") priceRefusedInPause = false;
        if (was === "open" && decision.state !== "open") pauses += 1;
        previous = decision.memory;
      }
    }
    // The sequences do exercise both directions.
    expect(pauses).toBeGreaterThan(100);
    expect(reopenings).toBeGreaterThan(100);
  });
});
