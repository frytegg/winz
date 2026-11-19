import type { HedgeDeskResponse, HedgeInstrument } from "@winz/shared";

import { shareOfBps } from "./format";

/**
 * What the Hedge desk screens read, worked out from `GET /api/hedge-desk`. The server already did the
 * arithmetic that matters (exposure, position, unhedged notional); here is only what a bar needs:
 * shares of a whole, and the order of the rows.
 */

/** The unhedged bar turns red from this share of the limit (SCREENS: "vire au rouge près de la limite"). */
export const NEAR_LIMIT_BPS = 8_000;

export type RiskLevel = "ok" | "near" | "over";

export interface UnhedgedMeter {
  /** What fills the bar, 0 to 10,000 (never more: the bar stops at the limit). */
  fillBps: number;
  level: RiskLevel;
}

/** (E − H) × price against `uMax`. The bar is capped at the limit; `level` says whether it is crossed. */
export function unhedgedMeter(unhedgedNotional: string, uMax: string): UnhedgedMeter {
  const unhedged = BigInt(unhedgedNotional);
  const limit = BigInt(uMax);
  if (limit <= 0n) {
    return unhedged > 0n ? { fillBps: 10_000, level: "over" } : { fillBps: 0, level: "ok" };
  }
  if (unhedged > limit) return { fillBps: 10_000, level: "over" };
  const fillBps = shareOfBps(unhedged, limit);
  return { fillBps, level: fillBps >= NEAR_LIMIT_BPS ? "near" : "ok" };
}

export interface ExposureBar {
  /** The scale of the bar, in micro-contracts: the exposure, or more if H + W overshoots it. */
  scale: bigint;
  /** H and W as shares of `scale`, in basis points; `openBps` is what is left of E, uncovered. */
  heldBps: number;
  workingBps: number;
  openBps: number;
  /** H as a share of E (what "hedged" means): 0 when there is no exposure. */
  hedgedOfExposureBps: number;
  /** True when H + W is above E: more cover than the exposure. */
  overCovered: boolean;
}

/** E, H and W on one bar: H first, W after it, whatever is left of E is open. */
export function exposureBar(exposure: string, held: string, working: string): ExposureBar {
  const e = BigInt(exposure);
  const h = BigInt(held);
  const w = BigInt(working);
  const covered = h + w;
  const scale = covered > e ? covered : e;
  const heldBps = shareOfBps(h, scale);
  const workingBps = Math.min(shareOfBps(w, scale), 10_000 - heldBps);
  const openBps = scale === 0n ? 0 : Math.max(0, 10_000 - heldBps - workingBps);
  return {
    scale,
    heldBps,
    workingBps,
    openBps,
    hedgedOfExposureBps: shareOfBps(h, e),
    overCovered: covered > e,
  };
}

/** Newest first. The API sends them that way, but the screen does not depend on it. */
export function newestFirst<T extends { at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Ordered by start, then symbol: the API's order, enforced so a poll never reshuffles the cards. */
export function sortInstruments(instruments: readonly HedgeInstrument[]): HedgeInstrument[] {
  return [...instruments].sort((a, b) => {
    if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
    return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
  });
}

type VenueCheck = NonNullable<HedgeDeskResponse["venueCheck"]>;
export type ProofOrder = VenueCheck["orders"][number];
export type ProofAction = ProofOrder["action"];

/** The three things the sandbox check has to show (SPEC HE-10), in the order they happen. */
export const PROOF_STEPS: readonly ProofAction[] = ["placed_maker", "cancelled", "filled"];

export interface ProofStep {
  action: ProofAction;
  /** The sandbox order and the time it happened, or `null` when the check has not done it. */
  done: ProofOrder | null;
}

/** Which of the three steps the check has shown. A step seen twice shows its latest. */
export function proofSteps(venueCheck: HedgeDeskResponse["venueCheck"]): ProofStep[] {
  const orders = venueCheck === null ? [] : newestFirst(venueCheck.orders);
  return PROOF_STEPS.map((action) => ({
    action,
    done: orders.find((order) => order.action === action) ?? null,
  }));
}
