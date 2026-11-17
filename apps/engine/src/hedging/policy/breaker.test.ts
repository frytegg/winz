import { describe, expect, it } from "vitest";

import {
  DEFAULT_BREAKER_PARAMS,
  INITIAL_BREAKER_STATE,
  resolveBreakerParams,
  stepBreaker,
} from "./breaker";
import type { BreakerObservation, BreakerState, BreakerTransition } from "./breaker";
import { PolicyInputError } from "./errors";

const T0 = 1_800_000_000_000;
const U_MAX = 300_000_000n;
const params = DEFAULT_BREAKER_PARAMS;

function observe(overrides: Partial<BreakerObservation> = {}): BreakerObservation {
  return {
    nowMs: T0,
    venueOutcomes: [],
    bookAgeMs: 500,
    unhedgedNotional: 0n,
    uMaxMicroUsdc: U_MAX,
    ...overrides,
  };
}

/** Runs observations in order, returning every state and transition. */
function run(
  observations: readonly BreakerObservation[],
  start: BreakerState = INITIAL_BREAKER_STATE,
): { state: BreakerState; transitions: BreakerTransition[] } {
  let state = start;
  const transitions: BreakerTransition[] = [];
  for (const observation of observations) {
    const step = stepBreaker(state, observation, params);
    state = step.state;
    transitions.push(step.transition);
  }
  return { state, transitions };
}

describe("breaker · venue failures", () => {
  it("trips on the third consecutive failure, not before", () => {
    const two = run([observe({ venueOutcomes: ["failure", "failure"] })]);
    expect(two.state.active).toBe(false);
    expect(two.state.consecutiveVenueFailures).toBe(2);
    const three = stepBreaker(two.state, observe({ venueOutcomes: ["failure"] }), params);
    expect(three.transition).toBe("tripped");
    expect(three.state).toMatchObject({
      active: true,
      reason: "venue_down",
      causes: ["venue_down"],
      trippedAtMs: T0,
    });
  });

  it("counts only consecutive failures", () => {
    const { state } = run([
      observe({ venueOutcomes: ["failure", "failure", "success", "failure", "failure"] }),
    ]);
    expect(state.active).toBe(false);
    expect(state.consecutiveVenueFailures).toBe(2);
  });

  it("resets only after a success and a 10 s quiet period", () => {
    const tripped = run([observe({ venueOutcomes: ["failure", "failure", "failure"] })]).state;
    // Still failing 20 s later: still active.
    const still = stepBreaker(tripped, observe({ nowMs: T0 + 20_000 }), params);
    expect(still.state.active).toBe(true);
    expect(still.state.quietSinceMs).toBeNull();
    const answered = stepBreaker(
      still.state,
      observe({ nowMs: T0 + 21_000, venueOutcomes: ["success"] }),
      params,
    );
    expect(answered.transition).toBeNull();
    expect(answered.state).toMatchObject({
      active: true,
      reason: "venue_down",
      quietSinceMs: T0 + 21_000,
    });
    const early = stepBreaker(answered.state, observe({ nowMs: T0 + 30_999 }), params);
    expect(early.state.active).toBe(true);
    const reset = stepBreaker(early.state, observe({ nowMs: T0 + 31_000 }), params);
    expect(reset.transition).toBe("reset");
    expect(reset.state).toMatchObject({ active: false, reason: null, trippedAtMs: null });
  });

  it("restarts the quiet period when a cause comes back", () => {
    const tripped = run([observe({ venueOutcomes: ["failure", "failure", "failure"] })]).state;
    const quiet = stepBreaker(
      tripped,
      observe({ nowMs: T0 + 1000, venueOutcomes: ["success"] }),
      params,
    );
    const again = stepBreaker(
      quiet.state,
      observe({ nowMs: T0 + 9000, venueOutcomes: ["failure", "failure", "failure"] }),
      params,
    );
    expect(again.state.quietSinceMs).toBeNull();
    const quietAgain = stepBreaker(
      again.state,
      observe({ nowMs: T0 + 12_000, venueOutcomes: ["success"] }),
      params,
    );
    expect(
      stepBreaker(quietAgain.state, observe({ nowMs: T0 + 21_999 }), params).state.active,
    ).toBe(true);
    expect(stepBreaker(quietAgain.state, observe({ nowMs: T0 + 22_000 }), params).transition).toBe(
      "reset",
    );
  });
});

describe("breaker · stale book", () => {
  it("trips on a book older than 10 s, not at exactly 10 s", () => {
    expect(
      stepBreaker(INITIAL_BREAKER_STATE, observe({ bookAgeMs: 10_000 }), params).state.active,
    ).toBe(false);
    const tripped = stepBreaker(INITIAL_BREAKER_STATE, observe({ bookAgeMs: 10_001 }), params);
    expect(tripped.transition).toBe("tripped");
    expect(tripped.state.reason).toBe("stale_book");
  });

  it("resets 10 s after the book is fresh again", () => {
    const { state, transitions } = run([
      observe({ nowMs: T0, bookAgeMs: 12_000 }),
      observe({ nowMs: T0 + 1000, bookAgeMs: 100 }),
      observe({ nowMs: T0 + 5000, bookAgeMs: 100 }),
      observe({ nowMs: T0 + 10_999, bookAgeMs: 100 }),
      observe({ nowMs: T0 + 11_000, bookAgeMs: 100 }),
    ]);
    expect(transitions).toEqual(["tripped", null, null, null, "reset"]);
    expect(state.active).toBe(false);
  });
});

describe("breaker · unhedged limit", () => {
  it("trips when the notional stays above uMax for more than 5 s", () => {
    const above = U_MAX + 1n;
    const { state, transitions } = run([
      observe({ nowMs: T0, unhedgedNotional: above }),
      observe({ nowMs: T0 + 5000, unhedgedNotional: above }),
      observe({ nowMs: T0 + 5001, unhedgedNotional: above }),
    ]);
    expect(transitions).toEqual([null, null, "tripped"]);
    expect(state.reason).toBe("unhedged_limit");
    expect(state.unhedgedAboveSinceMs).toBe(T0);
  });

  it("does not trip at exactly uMax, and forgets an excess that went away", () => {
    const { state, transitions } = run([
      observe({ nowMs: T0, unhedgedNotional: U_MAX }),
      observe({ nowMs: T0 + 1000, unhedgedNotional: U_MAX + 1n }),
      observe({ nowMs: T0 + 4000, unhedgedNotional: U_MAX }),
      observe({ nowMs: T0 + 5000, unhedgedNotional: U_MAX + 1n }),
      observe({ nowMs: T0 + 9000, unhedgedNotional: U_MAX + 1n }),
      observe({ nowMs: T0 + 9500, unhedgedNotional: null }),
    ]);
    expect(transitions).toEqual([null, null, null, null, null, null]);
    expect(state.unhedgedAboveSinceMs).toBeNull();
  });

  it("resets 10 s after the notional is back under uMax", () => {
    const { transitions } = run([
      observe({ nowMs: T0, unhedgedNotional: U_MAX * 2n }),
      observe({ nowMs: T0 + 6000, unhedgedNotional: U_MAX * 2n }),
      observe({ nowMs: T0 + 7000, unhedgedNotional: U_MAX }),
      observe({ nowMs: T0 + 16_999, unhedgedNotional: 0n }),
      observe({ nowMs: T0 + 17_000, unhedgedNotional: 0n }),
    ]);
    expect(transitions).toEqual([null, "tripped", null, null, "reset"]);
  });
});

describe("breaker · unhedged limit the book can cure", () => {
  const above = U_MAX + 1n;

  it("still trips on an excess the book could cure: the policy had its grace period", () => {
    const { transitions } = run([
      observe({ nowMs: T0, unhedgedNotional: above, unhedgedCurable: true }),
      observe({ nowMs: T0 + 5001, unhedgedNotional: above, unhedgedCurable: true }),
    ]);
    expect(transitions).toEqual([null, "tripped"]);
  });

  it("resets after the quiet period of curable liquidity, the excess unchanged, with a fresh grace", () => {
    const { state, transitions } = run([
      observe({ nowMs: T0, unhedgedNotional: above }),
      observe({ nowMs: T0 + 5001, unhedgedNotional: above }),
      observe({ nowMs: T0 + 6000, unhedgedNotional: above, unhedgedCurable: true }),
      observe({ nowMs: T0 + 15_999, unhedgedNotional: above, unhedgedCurable: true }),
      observe({ nowMs: T0 + 16_000, unhedgedNotional: above, unhedgedCurable: true }),
      observe({ nowMs: T0 + 21_000, unhedgedNotional: above }),
      observe({ nowMs: T0 + 21_001, unhedgedNotional: above }),
    ]);
    expect(transitions).toEqual([null, "tripped", null, null, "reset", null, "tripped"]);
    expect(state.unhedgedAboveSinceMs).toBe(T0 + 16_000);
  });

  it("restarts the quiet period when the liquidity goes away again", () => {
    const { state, transitions } = run([
      observe({ nowMs: T0, unhedgedNotional: above }),
      observe({ nowMs: T0 + 5001, unhedgedNotional: above }),
      observe({ nowMs: T0 + 6000, unhedgedNotional: above, unhedgedCurable: true }),
      observe({ nowMs: T0 + 10_000, unhedgedNotional: above, unhedgedCurable: false }),
      observe({ nowMs: T0 + 19_000, unhedgedNotional: above, unhedgedCurable: true }),
      observe({ nowMs: T0 + 28_999, unhedgedNotional: above, unhedgedCurable: true }),
    ]);
    expect(transitions).toEqual([null, "tripped", null, null, null, null]);
    expect(state).toMatchObject({ active: true, quietSinceMs: T0 + 19_000 });
    const reset = stepBreaker(
      state,
      observe({ nowMs: T0 + 29_000, unhedgedNotional: above, unhedgedCurable: true }),
      params,
    );
    expect(reset.transition).toBe("reset");
  });
});

describe("breaker · several causes", () => {
  it("reports the most important cause present, and every cause", () => {
    const step = stepBreaker(
      INITIAL_BREAKER_STATE,
      observe({
        venueOutcomes: ["failure", "failure", "failure"],
        bookAgeMs: 20_000,
      }),
      params,
    );
    expect(step.state.reason).toBe("venue_down");
    expect(step.state.causes).toEqual(["venue_down", "stale_book"]);
    const venueBack = stepBreaker(
      step.state,
      observe({ nowMs: T0 + 1000, venueOutcomes: ["success"], bookAgeMs: 20_000 }),
      params,
    );
    expect(venueBack.state.reason).toBe("stale_book");
    expect(venueBack.state.quietSinceMs).toBeNull();
  });

  it("keeps the last reason during the quiet period", () => {
    const tripped = stepBreaker(INITIAL_BREAKER_STATE, observe({ bookAgeMs: 20_000 }), params);
    const quiet = stepBreaker(tripped.state, observe({ nowMs: T0 + 1000 }), params);
    expect(quiet.state).toMatchObject({ active: true, reason: "stale_book", causes: [] });
  });
});

describe("breaker · parameters", () => {
  it("defaults to 3 failures, 10 s stale, 5 s grace, 10 s quiet", () => {
    expect(DEFAULT_BREAKER_PARAMS).toEqual({
      maxConsecutiveVenueFailures: 3,
      staleAfterMs: 10_000,
      unhedgedGraceMs: 5_000,
      quietPeriodMs: 10_000,
    });
  });

  it("takes other values and rejects invalid ones", () => {
    const custom = resolveBreakerParams({ maxConsecutiveVenueFailures: 1, quietPeriodMs: 0 });
    const step = stepBreaker(
      INITIAL_BREAKER_STATE,
      observe({ venueOutcomes: ["failure"] }),
      custom,
    );
    expect(step.state.active).toBe(true);
    const reset = stepBreaker(step.state, observe({ venueOutcomes: ["success"] }), custom);
    expect(reset.transition).toBe("reset");
    expect(() => resolveBreakerParams({ maxConsecutiveVenueFailures: 0 })).toThrow(
      PolicyInputError,
    );
    expect(() => resolveBreakerParams({ quietPeriodMs: -1 })).toThrow(PolicyInputError);
    expect(() => resolveBreakerParams({ staleAfterMs: 1.5 })).toThrow(PolicyInputError);
  });
});
