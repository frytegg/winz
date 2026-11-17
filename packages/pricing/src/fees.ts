import { BPS } from "@winz/shared";
import type { Bps } from "@winz/shared";

import { assertInRange } from "./errors";

/** Gemini taker fee rate: 0.07 × p × (1 − p) dollars per contract (SPEC 4.1). */
export const TAKER_FEE_RATE_BPS = 700n;

/** Gemini maker fee rate of the published schedule: 0.0175 × p × (1 − p) dollars per contract. */
export const MAKER_FEE_RATE_BPS = 175n;

export interface MakerFeeOptions {
  /**
   * True while Gemini's maker-fee promotion applies (announced until 31 December 2026): the fee
   * is then zero. The caller decides, from its own clock and configuration; this library never
   * reads the time.
   */
  waived: boolean;
  /** Maker rate in basis points of p × (1 − p). Defaults to `MAKER_FEE_RATE_BPS`. */
  rateBps?: Bps;
}

/** `rate × p × (1 − p)` in basis points of a dollar, rounded up because a fee is a cost. */
function proportionalFeeBps(rateBps: Bps, priceBps: Bps): Bps {
  assertInRange("priceBps", priceBps, 0n, BPS);
  assertInRange("rateBps", rateBps, 0n, BPS);
  const numerator = rateBps * priceBps * (BPS - priceBps);
  const denominator = BPS * BPS;
  return (numerator + denominator - 1n) / denominator;
}

/** Taker fee per contract, in basis points of a dollar, rounded up: 0.07 × p × (1 − p). */
export function takerFeeBps(priceBps: Bps): Bps {
  return proportionalFeeBps(TAKER_FEE_RATE_BPS, priceBps);
}

/**
 * Maker fee per contract, in basis points of a dollar, rounded up: rate × p × (1 − p), or zero
 * while the fee is waived.
 */
export function makerFeeBps(priceBps: Bps, options: MakerFeeOptions): Bps {
  const fee = proportionalFeeBps(options.rateBps ?? MAKER_FEE_RATE_BPS, priceBps);
  return options.waived ? 0n : fee;
}

/**
 * What one YES contract costs a taker at price p, fee included, in basis points of a dollar:
 * c(p) = p + 0.07 × p × (1 − p). Never decreases when p increases.
 */
export function costPerContractBps(priceBps: Bps): Bps {
  return priceBps + takerFeeBps(priceBps);
}
