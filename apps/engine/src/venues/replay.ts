import { makerFeeBps, takerFeeBps } from "@winz/pricing";
import { BPS, CONTRACT_STEP_MICRO, mulDivUp } from "@winz/shared";
import type { Bps, MicroContracts, MicroUsdc, OrderKind } from "@winz/shared";

import { FillReplayError } from "./errors";
import type { OrderSide, VenueFill } from "./types";

/**
 * Pure arithmetic of paper execution, shared by the paper venue and `replayFill`, so that the
 * replay of a fill uses exactly the rules that produced it.
 */

/** Rounds a quantity down to the 0.01 contract step: the venue never fills a fraction of a step. */
export function floorToContractStep(qty: MicroContracts): MicroContracts {
  if (qty <= 0n) return 0n;
  return (qty / CONTRACT_STEP_MICRO) * CONTRACT_STEP_MICRO;
}

/** Whether `priceBps` is at or better than the order's limit: at or below for a buy, at or above for a sell. */
export function isWithinLimit(side: OrderSide, priceBps: Bps, limitPriceBps: Bps): boolean {
  return side === "buy" ? priceBps <= limitPriceBps : priceBps >= limitPriceBps;
}

/**
 * Fee of a fill, micro-USDC, rounded up because a fee is a cost: qty × feeBps / 10 000, where
 * feeBps is the per-contract fee of `packages/pricing` (taker, or maker with the waiver flag).
 * One contract is one dollar is 1 000 000 micro-USDC, so micro-contracts × bps / 10 000 is
 * micro-USDC.
 */
export function fillFee(
  kind: OrderKind,
  priceBps: Bps,
  qty: MicroContracts,
  makerFeeWaived: boolean,
): MicroUsdc {
  const perContractBps =
    kind === "taker" ? takerFeeBps(priceBps) : makerFeeBps(priceBps, { waived: makerFeeWaived });
  return mulDivUp(qty, perContractBps, BPS);
}

export interface ReplayedFill {
  priceBps: Bps;
  qty: MicroContracts;
  fee: MicroUsdc;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Recomputes a paper fill's price, quantity and fee from its `bookRef` alone (SPEC 9.7, last
 * bullet). The caller compares the result with the fill: any difference means the fill was not
 * what the referenced book or print allowed.
 *
 * - Taker fill: one level; price = that level's price; qty = min(order remaining, what the level
 *   still displayed after earlier fills, rounded down to the step); taker fee.
 * - Maker fill on a book: every level touched at or better than the limit; price = the order's
 *   limit, never better; qty = min(order remaining, sum of what those levels still displayed);
 *   maker fee with the recorded waiver.
 * - Maker fill on a trade print: the print at or better than the limit; price = the order's
 *   limit; qty = min(order remaining, what the print had left after orders with priority).
 *
 * Throws `FillReplayError` when the reference itself contradicts the fill (wrong instrument, a
 * level beyond the limit, a taker fill on a print), and for a fill a real venue reported
 * (`source: "venue"`), which no book reproduces.
 *
 * Known limit: the fee is recomputed with the same `fillFee` the venue used, so the replay checks
 * that the fee matches the referenced price and quantity under that rule, not that the rule
 * itself is right. A wrong fee formula (rounding down, a wrong rate) replays identically; the fee
 * rule is covered by the unit tests with fees computed by hand.
 */
export function replayFill(fill: VenueFill): ReplayedFill {
  const ref = fill.bookRef;
  if (ref.instrumentSymbol !== fill.instrumentSymbol) {
    throw new FillReplayError(fill.fillId, "book reference names another instrument");
  }
  if (ref.orderRemainingQty <= 0n) {
    throw new FillReplayError(fill.fillId, "order had nothing left to fill");
  }

  if (ref.source === "venue") {
    throw new FillReplayError(
      fill.fillId,
      "a fill reported by a real venue is not replayable from a book: it is what the venue said",
    );
  }

  if (ref.source === "trade") {
    if (fill.kind !== "maker") {
      throw new FillReplayError(fill.fillId, "only maker orders are filled by trade prints");
    }
    if (!isWithinLimit(fill.side, ref.printPriceBps, ref.limitPriceBps)) {
      throw new FillReplayError(fill.fillId, "print is beyond the order limit");
    }
    const available = floorToContractStep(ref.printedQty - ref.allocatedBeforeQty);
    const qty = min(ref.orderRemainingQty, available);
    const priceBps = ref.limitPriceBps;
    return { priceBps, qty, fee: fillFee("maker", priceBps, qty, ref.makerFeeWaived) };
  }

  const expectedSide = fill.side === "buy" ? "asks" : "bids";
  if (ref.bookSide !== expectedSide) {
    throw new FillReplayError(fill.fillId, `a ${fill.side} fills against the ${expectedSide}`);
  }
  if (ref.levels.length === 0) {
    throw new FillReplayError(fill.fillId, "book reference holds no level");
  }
  for (const level of ref.levels) {
    if (!isWithinLimit(fill.side, level.priceBps, ref.limitPriceBps)) {
      throw new FillReplayError(fill.fillId, "a referenced level is beyond the order limit");
    }
    if (level.consumedBeforeQty < 0n || level.consumedBeforeQty > level.displayedQty) {
      throw new FillReplayError(fill.fillId, "a level was consumed beyond what it displayed");
    }
  }

  if (fill.kind === "taker") {
    const [level] = ref.levels;
    if (level === undefined || ref.levels.length !== 1) {
      throw new FillReplayError(fill.fillId, "a taker fill touches exactly one level");
    }
    const available = floorToContractStep(level.displayedQty - level.consumedBeforeQty);
    const qty = min(ref.orderRemainingQty, available);
    return {
      priceBps: level.priceBps,
      qty,
      fee: fillFee("taker", level.priceBps, qty, ref.makerFeeWaived),
    };
  }

  let available = 0n;
  for (const level of ref.levels) {
    available += floorToContractStep(level.displayedQty - level.consumedBeforeQty);
  }
  const qty = min(ref.orderRemainingQty, available);
  const priceBps = ref.limitPriceBps;
  return { priceBps, qty, fee: fillFee("maker", priceBps, qty, ref.makerFeeWaived) };
}
