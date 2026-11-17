import { BPS, CONTRACT_STEP_MICRO, TICK_BPS, ceilToContractStep } from "@winz/shared";
import type { Book, BookLevel, Bps, MicroContracts, OrderKind } from "@winz/shared";

import type { OrderSide } from "../../venues";
import { PolicyInputError } from "./errors";
import { POLICY_MIN_PRICE_BPS } from "./params";
import type { PolicyParams } from "./params";

/** An order of the instrument the venue may still fill, as the policy sees it. */
export interface PolicyOrder {
  clientOrderId: string;
  side: OrderSide;
  kind: OrderKind;
  limitPriceBps: Bps;
  /** What the order may still fill, micro-contracts. */
  remainingQty: MicroContracts;
  placedAtMs: number;
  /**
   * For a maker: the best ask when it was placed (the ask-move rule compares against it). Null
   * for a taker, and for a maker adopted after a restart whose placement ask is unknown: such a
   * maker is only replaced through its TTL.
   */
  askAtPlacementBps: Bps | null;
}

/** Everything one decision depends on. No clock, no I/O: time is `nowMs`. */
export interface PolicyState {
  nowMs: number;
  /** When the event starts, epoch milliseconds. */
  eventStartMs: number;
  /** E: micro-contracts owed if YES, every campaign of the instrument together (HE-3). */
  exposure: MicroContracts;
  /** H: micro-contracts held. */
  held: MicroContracts;
  /** Working and partially filled orders, plus placements whose outcome is not known yet. */
  openOrders: readonly PolicyOrder[];
  /** The latest book, or null when none was ever received. Its age is `nowMs − observedAtMs`. */
  book: Book | null;
  params: Readonly<PolicyParams>;
  /** True while the circuit breaker (HE-5) is active: nothing may be placed. */
  breakerActive: boolean;
  /** Sales-close reconciliation (HE-6): bring H to E within one step, selling any surplus. */
  reconcile: boolean;
}

/** Why an action was decided. Kept with the order so the Hedge desk can explain it. */
export type PolicyActionReason =
  /** Normal regime: rest a maker at best bid + 1 tick for U − W. */
  | "maker"
  /** A maker was not filled within its TTL: cancelled, remainder taker. */
  | "ttl_expired"
  /** The best ask rose `askMoveTicks` since a maker was placed: cancelled, remainder taker. */
  | "ask_moved"
  /** U × p above uMax: taker for the excess. */
  | "u_max_excess"
  /** Less than `forceTakerMs` before the start: everything taker, makers cancelled. */
  | "force_taker"
  /** U ≤ 0, or resting makers exceed what is still uncovered. */
  | "not_needed"
  /** Reconciliation: makers cancelled, shortfall bought, surplus sold. */
  | "reconcile"
  /** The policy never rests a sell: an adopted sell maker is cancelled. */
  | "unexpected_sell_maker"
  /** Nothing may be placed: the breaker is active. Resting makers are cancelled. */
  | "breaker_active"
  /** Nothing may be placed: no book. Resting makers are cancelled. */
  | "no_book"
  /** Nothing may be placed: the book is stale. Resting makers are cancelled. */
  | "stale_book";

export type PolicyAction =
  | {
      type: "place_maker_buy";
      limitPriceBps: Bps;
      qty: MicroContracts;
      /** Best ask when decided, recorded with the order for the ask-move rule. */
      askAtPlacementBps: Bps | null;
      reason: "maker";
    }
  | {
      type: "place_taker_buy";
      limitPriceBps: Bps;
      qty: MicroContracts;
      reason: "ttl_expired" | "ask_moved" | "u_max_excess" | "force_taker" | "reconcile";
      /**
       * The maker this taker replaces (TTL or ask-move fallback). Its quantity is that maker's
       * remainder: the executor caps it by what the cancel actually left, and skips it when the
       * cancel finds the maker filled.
       */
      replacesClientOrderId: string | null;
    }
  | {
      type: "place_taker_sell";
      limitPriceBps: Bps;
      qty: MicroContracts;
      reason: "reconcile";
    }
  | { type: "cancel"; clientOrderId: string; reason: PolicyActionReason };

/** Best level the market displays, or null: the first level with a quantity above zero. */
export function bestLevel(levels: readonly BookLevel[]): BookLevel | null {
  for (const level of levels) {
    if (level.qty > 0n) return level;
  }
  return null;
}

export function bestBidBps(book: Book | null): Bps | null {
  return book === null ? null : (bestLevel(book.bids)?.priceBps ?? null);
}

export function bestAskBps(book: Book | null): Bps | null {
  return book === null ? null : (bestLevel(book.asks)?.priceBps ?? null);
}

function floorToTick(price: Bps): Bps {
  return (price / TICK_BPS) * TICK_BPS;
}

function ceilToTick(price: Bps): Bps {
  return ((price + TICK_BPS - 1n) / TICK_BPS) * TICK_BPS;
}

function floorToStep(qty: MicroContracts): MicroContracts {
  return (qty / CONTRACT_STEP_MICRO) * CONTRACT_STEP_MICRO;
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Maker buy price: best bid + 1 tick, never crossing. When bid + 1 tick would touch the ask, the
 * order rests at the bid (one tick below the ask). Without a bid, one tick below the ask. Capped at
 * `maxPriceBps`; null when no valid price exists.
 */
export function makerBuyPrice(book: Book, maxPriceBps: Bps): Bps | null {
  const bid = bestBidBps(book);
  const ask = bestAskBps(book);
  let price: Bps;
  if (bid !== null) price = floorToTick(bid) + TICK_BPS;
  else if (ask !== null) price = ceilToTick(ask) - TICK_BPS;
  else return null;
  if (ask !== null && price >= ask) price = ceilToTick(ask) - TICK_BPS;
  if (price > maxPriceBps) price = maxPriceBps;
  return price < POLICY_MIN_PRICE_BPS ? null : price;
}

/**
 * Taker buy limit: best ask + slippage ticks, capped at `maxPriceBps`. Null without an ask, or when
 * the cap is below the ask (the order could not fill anything).
 */
export function takerBuyLimit(book: Book, params: Readonly<PolicyParams>): Bps | null {
  const ask = bestAskBps(book);
  if (ask === null) return null;
  let limit = ceilToTick(ask) + BigInt(params.takerSlippageTicks) * TICK_BPS;
  if (limit > params.maxPriceBps) limit = params.maxPriceBps;
  return limit < ask ? null : limit;
}

/** Taker sell limit: best bid − slippage ticks, floored at one tick. Null without a bid. */
export function takerSellLimit(book: Book, params: Readonly<PolicyParams>): Bps | null {
  const bid = bestBidBps(book);
  if (bid === null) return null;
  let limit = floorToTick(bid) - BigInt(params.takerSlippageTicks) * TICK_BPS;
  if (limit < POLICY_MIN_PRICE_BPS) limit = POLICY_MIN_PRICE_BPS;
  return limit > bid ? null : limit;
}

/**
 * Why nothing may be placed now, or null. A missing or stale book is reported before the breaker:
 * it is the more specific cause, and the one the breaker itself trips on.
 */
export function placingBlockedReason(
  state: Pick<PolicyState, "nowMs" | "book" | "params" | "breakerActive">,
): "breaker_active" | "no_book" | "stale_book" | null {
  if (state.book === null) return "no_book";
  if (state.nowMs - state.book.observedAtMs > state.params.staleAfterMs) return "stale_book";
  if (state.breakerActive) return "breaker_active";
  return null;
}

/**
 * Micro-contracts that may stay unhedged without the notional exceeding uMax at price `askBps`:
 * floor(uMax × 10 000 / ask).
 */
export function maxUnhedgedQty(uMaxMicroUsdc: bigint, askBps: Bps): MicroContracts {
  return (uMaxMicroUsdc * BPS) / askBps;
}

/**
 * Whether the book can bring `unhedged` micro-contracts back under uMax: the ask depth at or below
 * the taker limit (`takerBuyLimit`) covers U minus what may stay unhedged, the remainder priced
 * at that limit (the highest best ask possible once the depth below it is taken), so the check
 * holds whichever levels the taker walks. True when nothing is above uMax at the best ask; false
 * without a book, an ask or a taker limit. Feeds the breaker's `unhedgedCurable`.
 */
export function unhedgedExcessCurable(
  book: Book | null,
  unhedged: MicroContracts,
  params: Readonly<PolicyParams>,
): boolean {
  if (book === null) return false;
  const ask = bestAskBps(book);
  const limit = takerBuyLimit(book, params);
  if (ask === null || ask <= 0n || limit === null) return false;
  if (unhedged <= 0n || unhedged * ask <= params.uMaxMicroUsdc * BPS) return true;
  const toBuy = unhedged - maxUnhedgedQty(params.uMaxMicroUsdc, limit);
  let depth = 0n;
  for (const level of book.asks) {
    if (level.qty > 0n && level.priceBps <= limit) depth += level.qty;
  }
  return depth >= toBuy;
}

function validate(state: PolicyState): void {
  if (state.exposure < 0n) {
    throw new PolicyInputError(`exposure must not be negative, got ${state.exposure.toString()}`);
  }
  if (state.held < 0n) {
    throw new PolicyInputError(`held must not be negative, got ${state.held.toString()}`);
  }
  if (!Number.isFinite(state.nowMs) || !Number.isFinite(state.eventStartMs)) {
    throw new PolicyInputError("nowMs and eventStartMs must be finite numbers");
  }
  const ids = new Set<string>();
  for (const order of state.openOrders) {
    if (ids.has(order.clientOrderId)) {
      throw new PolicyInputError(`open order ${order.clientOrderId} is listed twice`);
    }
    ids.add(order.clientOrderId);
  }
}

/**
 * The execution policy of one instrument (SPEC 9.3, HE-2, HE-6). Pure: the same state always gives
 * the same actions, and the state already counts every open order, so applying the actions and
 * deciding again on the resulting state never places the same quantity twice.
 *
 * Cancels always come before placements. With U = E − H − (taker buys in flight) + (taker sells in
 * flight), and every buy rounded UP to the 0.01 contract step, the buy commitments of a decision
 * (in-flight takers excluded) never exceed ceil(U) to the step, so the position never exceeds
 * the exposure by a full step.
 */
export function decide(state: PolicyState): PolicyAction[] {
  validate(state);
  const { params } = state;
  const actions: PolicyAction[] = [];
  const live = state.openOrders.filter((order) => order.remainingQty > 0n);
  const makers = live.filter((order) => order.kind === "maker");
  const buyMakers = makers
    .filter((order) => order.side === "buy")
    .sort((a, b) => a.placedAtMs - b.placedAtMs || compareIds(a.clientOrderId, b.clientOrderId));
  const sellMakers = makers.filter((order) => order.side === "sell");
  const sumRemaining = (orders: readonly PolicyOrder[]): MicroContracts =>
    orders.reduce((total, order) => total + order.remainingQty, 0n);
  const takerBuys = sumRemaining(live.filter((o) => o.kind === "taker" && o.side === "buy"));
  const takerSells = sumRemaining(live.filter((o) => o.kind === "taker" && o.side === "sell"));
  const cancel = (order: PolicyOrder, reason: PolicyActionReason): void => {
    actions.push({ type: "cancel", clientOrderId: order.clientOrderId, reason });
  };

  // Blind or stopped: no placement, and no order left resting on a market we cannot see.
  const blocked = placingBlockedReason(state);
  if (blocked !== null) {
    for (const order of makers) cancel(order, blocked);
    return actions;
  }
  const book = state.book;
  if (book === null) return actions; // unreachable: placingBlockedReason covers it

  for (const order of sellMakers) cancel(order, "unexpected_sell_maker");

  /** What is still to buy, before any maker counts. */
  const need = state.exposure - state.held - takerBuys + takerSells;

  if (state.reconcile) {
    for (const order of buyMakers) cancel(order, "reconcile");
    if (need > 0n) {
      const limit = takerBuyLimit(book, params);
      if (limit !== null) {
        actions.push({
          type: "place_taker_buy",
          limitPriceBps: limit,
          qty: ceilToContractStep(need),
          reason: "reconcile",
          replacesClientOrderId: null,
        });
      }
    } else if (-need > CONTRACT_STEP_MICRO) {
      const limit = takerSellLimit(book, params);
      if (limit !== null) {
        actions.push({
          type: "place_taker_sell",
          limitPriceBps: limit,
          qty: floorToStep(-need),
          reason: "reconcile",
        });
      }
    }
    return actions;
  }

  if (need <= 0n) {
    for (const order of buyMakers) cancel(order, "not_needed");
    return actions;
  }
  const target = ceilToContractStep(need);

  if (state.eventStartMs - state.nowMs < params.forceTakerMs) {
    for (const order of buyMakers) cancel(order, "force_taker");
    const limit = takerBuyLimit(book, params);
    if (limit !== null) {
      actions.push({
        type: "place_taker_buy",
        limitPriceBps: limit,
        qty: target,
        reason: "force_taker",
        replacesClientOrderId: null,
      });
    }
    return actions;
  }

  const ask = bestAskBps(book);
  const takerLimit = takerBuyLimit(book, params);
  const places: PolicyAction[] = [];
  let committed = 0n;

  // TTL and ask-move fallback: cancel, remainder taker.
  const kept: PolicyOrder[] = [];
  for (const order of buyMakers) {
    const expired = state.nowMs - order.placedAtMs >= params.makerTtlMs;
    const askMoved =
      order.askAtPlacementBps !== null &&
      ask !== null &&
      ask - order.askAtPlacementBps >= BigInt(params.askMoveTicks) * TICK_BPS;
    if (!expired && !askMoved) {
      kept.push(order);
      continue;
    }
    const reason = expired ? "ttl_expired" : "ask_moved";
    cancel(order, reason);
    const qty = minBig(order.remainingQty, target - committed);
    if (qty > 0n && takerLimit !== null) {
      places.push({
        type: "place_taker_buy",
        limitPriceBps: takerLimit,
        qty,
        reason,
        replacesClientOrderId: order.clientOrderId,
      });
      committed += qty;
    }
  }

  // Unhedged notional above uMax: taker for the excess, so that at most uMax stays unhedged.
  const unhedged = need - committed;
  if (ask !== null && ask > 0n && takerLimit !== null && unhedged > 0n) {
    if (unhedged * ask > params.uMaxMicroUsdc * BPS) {
      const excess = unhedged - maxUnhedgedQty(params.uMaxMicroUsdc, ask);
      const qty = minBig(ceilToContractStep(excess), target - committed);
      if (qty > 0n) {
        places.push({
          type: "place_taker_buy",
          limitPriceBps: takerLimit,
          qty,
          reason: "u_max_excess",
          replacesClientOrderId: null,
        });
        committed += qty;
      }
    }
  }

  // Makers: W never above what is still uncovered. The newest are cancelled first, so the oldest
  // keep their place in the queue; a maker that is merely no longer at bid + 1 tick is not chased.
  const room = target - committed > 0n ? target - committed : 0n;
  let working = sumRemaining(kept);
  for (let i = kept.length - 1; i >= 0 && working > room; i -= 1) {
    const order = kept[i];
    if (order === undefined) continue;
    cancel(order, "not_needed");
    working -= order.remainingQty;
  }
  const gap = room - working;
  if (gap > 0n) {
    const price = makerBuyPrice(book, params.maxPriceBps);
    if (price !== null) {
      places.push({
        type: "place_maker_buy",
        limitPriceBps: price,
        qty: gap,
        askAtPlacementBps: ask,
        reason: "maker",
      });
    }
  }

  return [...actions, ...places];
}

/** Ids compare by their trailing sequence number when both have one, else as strings. */
function compareIds(a: string, b: string): number {
  const seqA = /(\d+)$/.exec(a)?.[1];
  const seqB = /(\d+)$/.exec(b)?.[1];
  if (seqA !== undefined && seqB !== undefined && seqA !== seqB) {
    return Number(seqA) - Number(seqB);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
