import { BOOK_STALE_AFTER_MS, BPS, DEFAULT_RISK_PARAMS, TICK_BPS } from "@winz/shared";
import type { Bps, MicroUsdc } from "@winz/shared";

import { PolicyInputError } from "./errors";

/** Highest limit price any policy order carries: one tick below a certain payout. */
export const POLICY_MAX_PRICE_BPS: Bps = BPS - TICK_BPS;
/** Lowest limit price any policy order carries: one tick. */
export const POLICY_MIN_PRICE_BPS: Bps = TICK_BPS;

/** Ticks added to the best ask (or taken from the best bid) for a taker limit price. */
export const DEFAULT_TAKER_SLIPPAGE_TICKS = 2;

/**
 * Parameters of the execution policy of one instrument (SPEC 9.3). The persisted values
 * (`engine_params`) are read by the wiring and passed in; the policy never reads them itself.
 */
export interface PolicyParams {
  /** Largest unhedged notional, (E − H) × best ask, in micro-USDC. */
  uMaxMicroUsdc: MicroUsdc;
  /** A maker order not filled after this long is cancelled and its remainder sent taker. */
  makerTtlMs: number;
  /** A maker order is abandoned for taker when the best ask has risen this many ticks since. */
  askMoveTicks: number;
  /** Less than this before the event start, everything uncovered goes taker. */
  forceTakerMs: number;
  /** Taker buy limit = best ask + this many ticks; taker sell limit = best bid − this many. */
  takerSlippageTicks: number;
  /** Cap of every limit price, 9 900 bps by default. */
  maxPriceBps: Bps;
  /** A book older than this is stale: nothing is placed against it. */
  staleAfterMs: number;
}

export const DEFAULT_POLICY_PARAMS: Readonly<PolicyParams> = Object.freeze({
  uMaxMicroUsdc: DEFAULT_RISK_PARAMS.uMaxMicroUsdc,
  makerTtlMs: DEFAULT_RISK_PARAMS.makerTtlSeconds * 1000,
  askMoveTicks: DEFAULT_RISK_PARAMS.askMoveTicks,
  forceTakerMs: DEFAULT_RISK_PARAMS.forceTakerMinutes * 60 * 1000,
  takerSlippageTicks: DEFAULT_TAKER_SLIPPAGE_TICKS,
  maxPriceBps: POLICY_MAX_PRICE_BPS,
  staleAfterMs: BOOK_STALE_AFTER_MS,
});

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PolicyInputError(
      `policy params: ${name} must be an integer >= 0, got ${String(value)}`,
    );
  }
}

/** The defaults overridden by `overrides`, validated. Throws `PolicyInputError` on a bad value. */
export function resolvePolicyParams(overrides?: Partial<PolicyParams>): Readonly<PolicyParams> {
  const params: PolicyParams = { ...DEFAULT_POLICY_PARAMS, ...overrides };
  if (typeof params.uMaxMicroUsdc !== "bigint" || params.uMaxMicroUsdc < 0n) {
    throw new PolicyInputError("policy params: uMaxMicroUsdc must be a bigint >= 0");
  }
  requireNonNegativeInteger("makerTtlMs", params.makerTtlMs);
  requireNonNegativeInteger("askMoveTicks", params.askMoveTicks);
  requireNonNegativeInteger("forceTakerMs", params.forceTakerMs);
  requireNonNegativeInteger("takerSlippageTicks", params.takerSlippageTicks);
  requireNonNegativeInteger("staleAfterMs", params.staleAfterMs);
  if (params.askMoveTicks === 0) {
    throw new PolicyInputError("policy params: askMoveTicks must be at least 1");
  }
  if (
    typeof params.maxPriceBps !== "bigint" ||
    params.maxPriceBps < POLICY_MIN_PRICE_BPS ||
    params.maxPriceBps > POLICY_MAX_PRICE_BPS ||
    params.maxPriceBps % TICK_BPS !== 0n
  ) {
    throw new PolicyInputError(
      `policy params: maxPriceBps must be a multiple of ${TICK_BPS.toString()} between ${POLICY_MIN_PRICE_BPS.toString()} and ${POLICY_MAX_PRICE_BPS.toString()}`,
    );
  }
  return Object.freeze(params);
}
