import { BOOK_STALE_AFTER_MS } from "@winz/shared";
import type { MicroUsdc } from "@winz/shared";

import { PolicyInputError } from "./errors";

/** Why the breaker is active: the names of `hedgeInstrumentSchema.breaker.reason`. */
export const BREAKER_REASONS = ["venue_down", "stale_book", "unhedged_limit"] as const;
export type BreakerReason = (typeof BREAKER_REASONS)[number];

export interface BreakerParams {
  /** Consecutive venue failures (calls that threw) that trip the breaker. */
  maxConsecutiveVenueFailures: number;
  /** A book older than this trips the breaker. */
  staleAfterMs: number;
  /** The unhedged notional may stay above uMax this long before the breaker trips. */
  unhedgedGraceMs: number;
  /** Every cause must have been absent this long before the breaker resets. */
  quietPeriodMs: number;
}

export const DEFAULT_BREAKER_PARAMS: Readonly<BreakerParams> = Object.freeze({
  maxConsecutiveVenueFailures: 3,
  staleAfterMs: BOOK_STALE_AFTER_MS,
  unhedgedGraceMs: 5_000,
  quietPeriodMs: 10_000,
});

export function resolveBreakerParams(overrides?: Partial<BreakerParams>): Readonly<BreakerParams> {
  const params: BreakerParams = { ...DEFAULT_BREAKER_PARAMS, ...overrides };
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new PolicyInputError(
        `breaker params: ${name} must be an integer >= 0, got ${String(value)}`,
      );
    }
  }
  if (params.maxConsecutiveVenueFailures < 1) {
    throw new PolicyInputError("breaker params: maxConsecutiveVenueFailures must be at least 1");
  }
  return Object.freeze(params);
}

/** The breaker of one instrument. Immutable: every step returns a new state. */
export interface BreakerState {
  active: boolean;
  /**
   * While active: the cause present now (venue_down first, then stale_book, then unhedged_limit),
   * or, during the quiet period, the last cause seen. Null when inactive.
   */
  reason: BreakerReason | null;
  /** Every cause present at the last step. */
  causes: readonly BreakerReason[];
  trippedAtMs: number | null;
  /** Since when no cause has been present, while active; null otherwise. */
  quietSinceMs: number | null;
  consecutiveVenueFailures: number;
  /** Since when the unhedged notional has been above uMax, or null. */
  unhedgedAboveSinceMs: number | null;
}

export const INITIAL_BREAKER_STATE: Readonly<BreakerState> = Object.freeze({
  active: false,
  reason: null,
  causes: Object.freeze([]) as readonly BreakerReason[],
  trippedAtMs: null,
  quietSinceMs: null,
  consecutiveVenueFailures: 0,
  unhedgedAboveSinceMs: null,
});

/** What the breaker observes at one step. */
export interface BreakerObservation {
  nowMs: number;
  /**
   * Outcomes of the venue calls since the last step, oldest first: `success` for a call that got
   * an answer (a rejection is an answer), `failure` for a call that threw or timed out.
   */
  venueOutcomes: readonly ("success" | "failure")[];
  /**
   * Age of the book, ms. With no book at all, the time since the instrument started being
   * followed: a feed that never delivers trips the breaker like one that went silent.
   */
  bookAgeMs: number;
  /** (E − H) × price, micro-USDC; null when it cannot be measured. */
  unhedgedNotional: MicroUsdc | null;
  uMaxMicroUsdc: MicroUsdc;
  /**
   * True when the book offers, at or below the taker limit price, enough contracts to bring the
   * unhedged notional back under uMax (`unhedgedExcessCurable`). Defaults to false.
   *
   * Once the breaker is active, an excess the book can cure no longer counts as a cause. Nothing
   * may be placed while the breaker is active (HE-5, SPEC 16 "Jamais"), so an excess that had to
   * disappear on its own would only go away when the exposure falls: hedging would stop for good
   * on a thin book whose liquidity comes back. With this rule, liquidity that stays back for the
   * quiet period resets the breaker, and the first cycle after the reset buys the excess.
   */
  unhedgedCurable?: boolean;
}

export type BreakerTransition = "tripped" | "reset" | null;

export interface BreakerStep {
  state: BreakerState;
  transition: BreakerTransition;
}

function primaryCause(causes: readonly BreakerReason[]): BreakerReason | null {
  for (const reason of BREAKER_REASONS) {
    if (causes.includes(reason)) return reason;
  }
  return null;
}

/**
 * One step of the circuit breaker (HE-5). Pure. It trips as soon as one cause is present:
 * `maxConsecutiveVenueFailures` venue calls failed in a row, the book is older than
 * `staleAfterMs`, or the unhedged notional has been above uMax for longer than `unhedgedGraceMs`.
 * It resets only once no cause has been present for `quietPeriodMs`, so it does not flap.
 *
 * While active, an unhedged excess the book can cure (`unhedgedCurable`) is not a cause: the
 * breaker resets once that has held for the quiet period, and the grace period then starts again
 * from the reset, so the policy gets its full `unhedgedGraceMs` to buy the excess.
 */
export function stepBreaker(
  previous: Readonly<BreakerState>,
  observation: BreakerObservation,
  params: Readonly<BreakerParams>,
): BreakerStep {
  const nowMs = observation.nowMs;
  let failures = previous.consecutiveVenueFailures;
  for (const outcome of observation.venueOutcomes) {
    failures = outcome === "failure" ? failures + 1 : 0;
  }

  let unhedgedAboveSinceMs = previous.unhedgedAboveSinceMs;
  const notional = observation.unhedgedNotional;
  if (notional !== null && notional > observation.uMaxMicroUsdc) {
    unhedgedAboveSinceMs ??= nowMs;
  } else {
    unhedgedAboveSinceMs = null;
  }

  const causes: BreakerReason[] = [];
  if (failures >= params.maxConsecutiveVenueFailures) causes.push("venue_down");
  if (observation.bookAgeMs > params.staleAfterMs) causes.push("stale_book");
  const unhedgedOverGrace =
    unhedgedAboveSinceMs !== null && nowMs - unhedgedAboveSinceMs > params.unhedgedGraceMs;
  const curable = observation.unhedgedCurable ?? false;
  if (unhedgedOverGrace && !(previous.active && curable)) {
    causes.push("unhedged_limit");
  }
  const frozenCauses = Object.freeze(causes);
  const current = primaryCause(causes);
  const base = { consecutiveVenueFailures: failures, unhedgedAboveSinceMs, causes: frozenCauses };

  if (!previous.active) {
    if (current === null) {
      return {
        state: Object.freeze({
          ...base,
          active: false,
          reason: null,
          trippedAtMs: null,
          quietSinceMs: null,
        }),
        transition: null,
      };
    }
    return {
      state: Object.freeze({
        ...base,
        active: true,
        reason: current,
        trippedAtMs: nowMs,
        quietSinceMs: null,
      }),
      transition: "tripped",
    };
  }

  if (current !== null) {
    return {
      state: Object.freeze({
        ...base,
        active: true,
        reason: current,
        trippedAtMs: previous.trippedAtMs,
        quietSinceMs: null,
      }),
      transition: null,
    };
  }
  const quietSinceMs = previous.quietSinceMs ?? nowMs;
  if (nowMs - quietSinceMs >= params.quietPeriodMs) {
    return {
      state: Object.freeze({
        ...base,
        // A curable excess still above uMax gets a fresh grace period from the reset.
        unhedgedAboveSinceMs: unhedgedAboveSinceMs === null ? null : nowMs,
        active: false,
        reason: null,
        trippedAtMs: null,
        quietSinceMs: null,
      }),
      transition: "reset",
    };
  }
  return {
    state: Object.freeze({
      ...base,
      active: true,
      reason: previous.reason,
      trippedAtMs: previous.trippedAtMs,
      quietSinceMs,
    }),
    transition: null,
  };
}
