import { describe, expect, it } from "vitest";

import type { CampaignStatus, SaleState } from "@winz/shared";

import {
  RESUME_DELAY_MS,
  evaluateSaleState,
  failedEvaluation,
  freshMemory,
  type SaleStateDecision,
  type SaleStateInput,
  type SaleStateMemory,
} from "./evaluate";
import { JOE_SALE_EXPOSURE, bookAt, emptyBook, liveInput } from "./test-support";

const T0 = 1_800_000_000_000;

/** Runs `steps` evaluations, carrying the memory from one to the next. */
function run(
  start: SaleStateMemory | null,
  steps: readonly ((previous: SaleStateMemory | null) => SaleStateInput)[],
): SaleStateDecision[] {
  const decisions: SaleStateDecision[] = [];
  let previous = start;
  for (const step of steps) {
    const decision = evaluateSaleState(step(previous));
    decisions.push(decision);
    previous = decision.memory;
  }
  return decisions;
}

function pausedMemory(state: SaleState, priceRefused = false): SaleStateMemory {
  return { state, acceptedSinceMs: null, clearSinceMs: null, priceRefused };
}

describe("evaluateSaleState: closed", () => {
  it.each<CampaignStatus>(["settled_yes", "settled_no", "void", "closed"])(
    "is closed when the campaign is %s",
    (status) => {
      const decision = evaluateSaleState(liveInput(T0, { status }));
      expect(decision.state).toBe("closed");
      expect(decision.reason).toBe("settled");
    },
  );

  it("is closed once an outcome is known, even if the status lags", () => {
    expect(evaluateSaleState(liveInput(T0, { outcome: "yes" })).state).toBe("closed");
  });

  it("is closed when the status is sales_closed", () => {
    const decision = evaluateSaleState(liveInput(T0, { status: "sales_closed" }));
    expect(decision).toMatchObject({ state: "closed", reason: "sales_closed" });
  });

  it("closes at the exact instant of the sales close, not a millisecond before", () => {
    expect(evaluateSaleState(liveInput(T0, { salesCloseMs: T0 + 1 })).state).toBe("open");
    expect(evaluateSaleState(liveInput(T0, { salesCloseMs: T0 })).state).toBe("closed");
    expect(evaluateSaleState(liveInput(T0, { salesCloseMs: T0 })).reason).toBe(
      "sales_close_reached",
    );
  });

  it("is closed without an on-chain id, and while draft or funding", () => {
    expect(evaluateSaleState(liveInput(T0, { hasOnchainId: false })).reason).toBe("not_on_chain");
    expect(evaluateSaleState(liveInput(T0, { status: "draft" })).reason).toBe("not_live");
    expect(evaluateSaleState(liveInput(T0, { status: "funding" })).reason).toBe("not_live");
  });

  it("is closed while an early close requested by the merchant is on its way", () => {
    const decision = evaluateSaleState(liveInput(T0, { closeRequested: true }));
    expect(decision).toMatchObject({ state: "closed", reason: "close_requested" });
  });

  it("is closed before anything else: manual pause, breaker and book are ignored", () => {
    const decision = evaluateSaleState(
      liveInput(T0, {
        status: "sales_closed",
        manualPause: true,
        breaker: { active: true, reason: "venue_down" },
        book: null,
      }),
    );
    expect(decision.state).toBe("closed");
  });
});

describe("evaluateSaleState: order of the rules", () => {
  it("puts the manual pause before the breaker and the market", () => {
    const decision = evaluateSaleState(
      liveInput(T0, {
        manualPause: true,
        breaker: { active: true, reason: "venue_down" },
        book: bookAt(5_000n, T0),
      }),
    );
    expect(decision).toMatchObject({ state: "paused_manual", reason: "manual" });
  });

  it("is paused_manual when the on-chain status is paused (manual pause in force)", () => {
    const decision = evaluateSaleState(liveInput(T0, { status: "paused", manualPause: true }));
    expect(decision.state).toBe("paused_manual");
  });

  it("puts the breaker before the book", () => {
    const decision = evaluateSaleState(
      liveInput(T0, { breaker: { active: true, reason: "unhedged_limit" }, book: null }),
    );
    expect(decision).toMatchObject({
      state: "paused_breaker",
      reason: "breaker",
      detail: "unhedged_limit",
    });
  });

  it("is paused_stale when the book is older than 10 s, or when the feed flags it", () => {
    const old = evaluateSaleState(liveInput(T0, { book: bookAt(1_200n, T0 - 10_001) }));
    expect(old.state).toBe("paused_stale");
    const atLimit = evaluateSaleState(liveInput(T0, { book: bookAt(1_200n, T0 - 10_000) }));
    expect(atLimit.state).toBe("open");
    const flagged = evaluateSaleState(liveInput(T0, { bookFlaggedStale: true }));
    expect(flagged.state).toBe("paused_stale");
  });

  it("is paused_depth without a book, with an empty book, or when the asks are too thin", () => {
    expect(evaluateSaleState(liveInput(T0, { book: null })).state).toBe("paused_depth");
    expect(evaluateSaleState(liveInput(T0, { book: null, bookFlaggedStale: true })).state).toBe(
      "paused_depth",
    );
    expect(evaluateSaleState(liveInput(T0, { book: emptyBook(T0) })).state).toBe("paused_depth");
    const thin = bookAt(1_200n, T0, JOE_SALE_EXPOSURE - 10_000n);
    expect(evaluateSaleState(liveInput(T0, { book: thin })).state).toBe("paused_depth");
  });

  it("prices the sale behind the pending exposure", () => {
    const book = bookAt(1_200n, T0, 30_000_000n);
    expect(evaluateSaleState(liveInput(T0, { book, pending: 10_000_000n })).state).toBe("open");
    expect(evaluateSaleState(liveInput(T0, { book, pending: 10_000_001n })).state).toBe(
      "paused_depth",
    );
  });

  it("is paused_price above the threshold, before the budget", () => {
    const decision = evaluateSaleState(
      liveInput(T0, { book: bookAt(1_900n, T0), availableBudget: 0n }),
    );
    expect(decision).toMatchObject({ state: "paused_price", reason: "above_threshold" });
  });

  it("is paused_budget when the guaranteed cost exceeds the available budget", () => {
    // At 12 %: taker cost $2.548 + $0.20 tolerance = $2.748 guaranteed.
    expect(evaluateSaleState(liveInput(T0, { availableBudget: 2_748_000n })).state).toBe("open");
    const decision = evaluateSaleState(liveInput(T0, { availableBudget: 2_747_999n }));
    expect(decision).toMatchObject({ state: "paused_budget", reason: "over_budget" });
    expect(evaluateSaleState(liveInput(T0, { availableBudget: -5n })).state).toBe("paused_budget");
  });
});

describe("evaluateSaleState: SPEC 4.3 worked example (p_max = 18 %)", () => {
  it("is open at 12 % and paused_price at 19 %", () => {
    const at12 = evaluateSaleState(liveInput(T0, { book: bookAt(1_200n, T0) }));
    expect(at12).toMatchObject({ state: "open", couldOpen: true, effectivePriceBps: 1_200n });
    const at19 = evaluateSaleState(
      liveInput(T0 + 1_000, { book: bookAt(1_900n, T0 + 1_000), previous: at12.memory }),
    );
    expect(at19.state).toBe("paused_price");
  });

  it("is still open at exactly 18 % (the threshold itself sells)", () => {
    expect(evaluateSaleState(liveInput(T0, { book: bookAt(1_800n, T0) })).state).toBe("open");
  });
});

describe("evaluateSaleState: hysteresis", () => {
  it("uses the delay of SPEC CA-5: 10 s", () => {
    expect(RESUME_DELAY_MS).toBe(10_000);
  });

  it("opens at once for a campaign never evaluated, newly live, or resumed by hand", () => {
    expect(evaluateSaleState(liveInput(T0)).state).toBe("open");
    expect(evaluateSaleState(liveInput(T0, { previous: freshMemory("closed") })).state).toBe(
      "open",
    );
    expect(evaluateSaleState(liveInput(T0, { previous: freshMemory("paused_manual") })).state).toBe(
      "open",
    );
    expect(evaluateSaleState(liveInput(T0, { previous: freshMemory("open") })).state).toBe("open");
  });

  it("pauses at once and reopens only after 10 s of uninterrupted ability to sell", () => {
    const steps = [0, 1_000, 5_000, 9_999, 10_000].map(
      (offset) => (previous: SaleStateMemory | null) =>
        liveInput(T0 + offset, { book: bookAt(1_200n, T0 + offset), previous }),
    );
    const decisions = run(pausedMemory("paused_budget"), steps);
    expect(decisions.map((d) => d.state)).toEqual([
      "paused_budget",
      "paused_budget",
      "paused_budget",
      "paused_budget",
      "open",
    ]);
    expect(decisions[0]?.reason).toBe("resume_delay");
    expect(decisions[0]?.couldOpen).toBe(true);
  });

  it("restarts the delay after any refusal during the wait", () => {
    const decisions = run(pausedMemory("paused_depth"), [
      (p) => liveInput(T0, { previous: p }),
      (p) => liveInput(T0 + 8_000, { previous: p }),
      (p) => liveInput(T0 + 9_000, { previous: p, book: null }),
      (p) => liveInput(T0 + 12_000, { previous: p, book: bookAt(1_200n, T0 + 12_000) }),
      (p) => liveInput(T0 + 21_999, { previous: p, book: bookAt(1_200n, T0 + 21_999) }),
      (p) => liveInput(T0 + 22_000, { previous: p, book: bookAt(1_200n, T0 + 22_000) }),
    ]);
    expect(decisions.map((d) => d.state)).toEqual([
      "paused_depth",
      "paused_depth",
      "paused_depth",
      "paused_depth",
      "paused_depth",
      "open",
    ]);
  });

  it("switches at once from one automatic pause to another", () => {
    const decision = evaluateSaleState(
      liveInput(T0, { previous: pausedMemory("paused_depth"), availableBudget: 0n }),
    );
    expect(decision.state).toBe("paused_budget");
  });

  it("needs one tick of margin below p_max for 10 s to lift a price pause", () => {
    const at = (offset: number, priceBps: bigint) => (previous: SaleStateMemory | null) =>
      liveInput(T0 + offset, { book: bookAt(priceBps, T0 + offset), previous });
    const decisions = run(null, [
      at(0, 1_200n),
      at(1_000, 1_900n), // above p_max: paused at once
      at(2_000, 1_800n), // sells, but not one tick below
      at(13_000, 1_800n), // 11 s at the threshold: still paused
      at(14_000, 1_700n), // one tick below: the delay starts
      at(23_999, 1_700n),
      at(24_000, 1_700n), // 10 s at 17 %: open
    ]);
    expect(decisions.map((d) => d.state)).toEqual([
      "open",
      "paused_price",
      "paused_price",
      "paused_price",
      "paused_price",
      "paused_price",
      "open",
    ]);
    expect(decisions[3]?.reason).toBe("resume_margin");
  });

  it("keeps the margin requirement when another pause comes during a price pause", () => {
    const at =
      (offset: number, priceBps: bigint, observedOffset = offset) =>
      (previous: SaleStateMemory | null) =>
        liveInput(T0 + offset, { book: bookAt(priceBps, T0 + observedOffset), previous });
    const decisions = run(null, [
      at(0, 1_900n),
      at(20_000, 1_200n, 0), // book stale
      at(21_000, 1_800n), // back, at the threshold
      at(40_000, 1_800n),
    ]);
    expect(decisions.map((d) => d.state)).toEqual([
      "paused_price",
      "paused_stale",
      "paused_stale",
      "paused_stale",
    ]);
  });

  it("follows a breaker trip at once and waits 10 s after it ends", () => {
    const tripped = { active: true, reason: "venue_down" };
    const clear = { active: false, reason: null };
    const at =
      (offset: number, breaker: { active: boolean; reason: string | null }) =>
      (previous: SaleStateMemory | null) =>
        liveInput(T0 + offset, { book: bookAt(1_200n, T0 + offset), breaker, previous });
    const decisions = run(null, [
      at(0, clear),
      at(1_000, tripped),
      at(5_000, clear),
      at(14_999, clear),
      at(15_000, clear),
    ]);
    expect(decisions.map((d) => d.state)).toEqual([
      "open",
      "paused_breaker",
      "paused_breaker",
      "paused_breaker",
      "open",
    ]);
  });

  it("pauses within the evaluation after the book turns stale and reopens 10 s after it returns", () => {
    const decisions = run(null, [
      (p) => liveInput(T0, { book: bookAt(1_200n, T0), previous: p }),
      (p) => liveInput(T0 + 10_000, { book: bookAt(1_200n, T0), previous: p }),
      (p) => liveInput(T0 + 11_000, { book: bookAt(1_200n, T0), previous: p }),
      (p) => liveInput(T0 + 12_000, { book: bookAt(1_200n, T0 + 12_000), previous: p }),
      (p) => liveInput(T0 + 21_000, { book: bookAt(1_200n, T0 + 21_000), previous: p }),
      (p) => liveInput(T0 + 22_000, { book: bookAt(1_200n, T0 + 22_000), previous: p }),
    ]);
    expect(decisions.map((d) => d.state)).toEqual([
      "open",
      "open",
      "paused_stale",
      "paused_stale",
      "paused_stale",
      "open",
    ]);
  });

  it("reopens a budget pause after a top-up plus the delay", () => {
    const at = (offset: number, availableBudget: bigint) => (previous: SaleStateMemory | null) =>
      liveInput(T0 + offset, { book: bookAt(1_200n, T0 + offset), availableBudget, previous });
    const decisions = run(null, [
      at(0, 1_000_000n),
      at(5_000, 100_000_000n), // topped up
      at(14_999, 100_000_000n),
      at(15_000, 100_000_000n),
    ]);
    expect(decisions.map((d) => d.state)).toEqual([
      "paused_budget",
      "paused_budget",
      "paused_budget",
      "open",
    ]);
  });

  it("never lets an automatic state override a manual pause, and a manual resume opens at once", () => {
    const decisions = run(null, [
      (p) => liveInput(T0, { manualPause: true, book: bookAt(1_900n, T0), previous: p }),
      (p) => liveInput(T0 + 1_000, { manualPause: true, availableBudget: 0n, previous: p }),
      (p) => liveInput(T0 + 2_000, { manualPause: true, book: null, previous: p }),
      (p) => liveInput(T0 + 3_000, { manualPause: false, previous: p }),
    ]);
    expect(decisions.map((d) => d.state)).toEqual([
      "paused_manual",
      "paused_manual",
      "paused_manual",
      "open",
    ]);
  });

  it("does not flap when the price oscillates around p_max every second", () => {
    const steps: ((previous: SaleStateMemory | null) => SaleStateInput)[] = [];
    // 60 s alternating 19 % / 18 % (or 17 % every fourth second), then 17 % for good.
    for (let second = 0; second < 60; second += 1) {
      const price = second % 2 === 0 ? 1_900n : second % 4 === 1 ? 1_700n : 1_800n;
      const now = T0 + second * 1_000;
      steps.push((p) => liveInput(now, { book: bookAt(price, now), previous: p }));
    }
    for (let second = 60; second < 80; second += 1) {
      const now = T0 + second * 1_000;
      steps.push((p) => liveInput(now, { book: bookAt(1_700n, now), previous: p }));
    }
    const states = run(freshMemory("open"), steps).map((d) => d.state);
    const transitions = states.filter((state, i) => i > 0 && state !== states[i - 1]).length;
    expect(states[0]).toBe("paused_price");
    expect(states.slice(0, 70)).toEqual(Array<SaleState>(70).fill("paused_price"));
    // Last refusal at second 58, 18 % at 59, 17 % for good from second 60: open at 70.
    expect(states[70]).toBe("open");
    expect(transitions).toBe(1);
  });
});

describe("evaluateSaleState: a campaign with no history (restart, dropped write)", () => {
  const steady = (
    priceBps: bigint,
    seconds: number,
    from = 0,
  ): ((previous: SaleStateMemory | null) => SaleStateInput)[] =>
    Array.from(
      { length: seconds + 1 },
      (_, i) => (previous: SaleStateMemory | null) =>
        liveInput(T0 + (from + i) * 1_000, {
          book: bookAt(priceBps, T0 + (from + i) * 1_000),
          previous,
        }),
    );

  it("keeps the one-tick margin for a stored paused_price: no reopening at exactly p_max", () => {
    const atThreshold = run(freshMemory("paused_price"), steady(1_800n, 12));
    expect(new Set(atThreshold.map((d) => d.state))).toEqual(new Set(["paused_price"]));
    expect(atThreshold.at(-1)?.reason).toBe("resume_margin");

    // One tick below for 10 s: it reopens.
    const below = run(atThreshold.at(-1)?.memory ?? null, steady(1_700n, 10, 13));
    expect(below.at(-2)?.state).toBe("paused_price");
    expect(below.at(-1)?.state).toBe("open");
  });

  it("carries a known price refusal through another stored automatic pause, never onto others", () => {
    expect(freshMemory("paused_price").priceRefused).toBe(true);
    expect(freshMemory("paused_stale").priceRefused).toBe(false);
    expect(freshMemory("paused_stale", true).priceRefused).toBe(true);
    expect(freshMemory("open", true).priceRefused).toBe(false);
    expect(freshMemory("paused_manual", true).priceRefused).toBe(false);
    expect(freshMemory("closed", true).priceRefused).toBe(false);
    const stale = run(freshMemory("paused_stale", true), steady(1_800n, 12));
    expect(new Set(stale.map((d) => d.state))).toEqual(new Set(["paused_stale"]));
  });

  it("still reopens a stored non-price pause after the plain delay", () => {
    const depth = run(freshMemory("paused_depth"), steady(1_800n, 10));
    expect(depth.at(-2)?.state).toBe("paused_depth");
    expect(depth.at(-1)?.state).toBe("open");
  });
});

describe("failedEvaluation (fail closed)", () => {
  it("throws from evaluateSaleState on inputs the pricing rejects (unsorted asks)", () => {
    const book = {
      ...bookAt(1_200n, T0),
      asks: [...bookAt(1_500n, T0).asks, ...bookAt(1_200n, T0).asks],
    };
    expect(() => evaluateSaleState(liveInput(T0, { book }))).toThrow(/sorted/);
  });

  it("pauses an open or newly seen campaign as paused_breaker", () => {
    for (const previous of [null, pausedMemory("open"), pausedMemory("closed")]) {
      const decision = failedEvaluation(liveInput(T0, { previous }), "boom");
      expect(decision).toMatchObject({
        state: "paused_breaker",
        reason: "evaluation_failed",
        detail: "boom",
        couldOpen: false,
      });
    }
  });

  it("keeps an automatic pause, its price margin, and restarts the delay", () => {
    const decision = failedEvaluation(
      liveInput(T0, {
        previous: {
          state: "paused_stale",
          acceptedSinceMs: T0 - 9_000,
          clearSinceMs: T0 - 9_000,
          priceRefused: true,
        },
      }),
      "boom",
    );
    expect(decision.state).toBe("paused_stale");
    expect(decision.memory).toEqual({
      state: "paused_stale",
      acceptedSinceMs: null,
      clearSinceMs: null,
      priceRefused: true,
    });
  });

  it("applies the closed and manual rules first", () => {
    expect(failedEvaluation(liveInput(T0, { salesCloseMs: T0 }), "boom").state).toBe("closed");
    expect(failedEvaluation(liveInput(T0, { status: "settled_no" }), "boom").state).toBe("closed");
    expect(failedEvaluation(liveInput(T0, { manualPause: true }), "boom").state).toBe(
      "paused_manual",
    );
  });
});
