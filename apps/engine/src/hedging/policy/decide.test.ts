import { CONTRACT_STEP_MICRO } from "@winz/shared";
import { describe, expect, it } from "vitest";

import {
  decide,
  makerBuyPrice,
  maxUnhedgedQty,
  placingBlockedReason,
  takerBuyLimit,
  takerSellLimit,
  unhedgedExcessCurable,
} from "./decide";
import type { PolicyAction, PolicyOrder, PolicyState } from "./decide";
import { PolicyInputError } from "./errors";
import { DEFAULT_POLICY_PARAMS, resolvePolicyParams } from "./params";
import { HOUR_MS, SYM, T0, c, level, makeBook, makerOrder, policyState } from "./test-support";

/** Applies a decision as a venue that fills nothing would: placements become open orders. */
function apply(state: PolicyState, actions: readonly PolicyAction[]): PolicyState {
  const cancelled = new Set(
    actions.flatMap((action) => (action.type === "cancel" ? [action.clientOrderId] : [])),
  );
  const open: PolicyOrder[] = state.openOrders.filter(
    (order) => !cancelled.has(order.clientOrderId),
  );
  actions.forEach((action, i) => {
    if (action.type === "cancel") return;
    open.push({
      clientOrderId: `applied-${i.toString()}`,
      side: action.type === "place_taker_sell" ? "sell" : "buy",
      kind: action.type === "place_maker_buy" ? "maker" : "taker",
      limitPriceBps: action.limitPriceBps,
      remainingQty: action.qty,
      placedAtMs: state.nowMs,
      askAtPlacementBps: action.type === "place_maker_buy" ? action.askAtPlacementBps : null,
    });
  });
  return { ...state, openOrders: open };
}

function expectIdempotent(state: PolicyState): void {
  const first = decide(state);
  expect(decide(state)).toEqual(first);
  const after = decide(apply(state, first));
  expect(after.filter((action) => action.type !== "cancel")).toEqual([]);
}

describe("decide · U <= 0", () => {
  it("places nothing when nothing is owed", () => {
    expect(decide(policyState())).toEqual([]);
  });

  it("places nothing when the position covers the exposure", () => {
    expect(decide(policyState({ exposure: c(10), held: c(10) }))).toEqual([]);
    expect(decide(policyState({ exposure: c(10), held: c(10.01) }))).toEqual([]);
  });

  it("cancels resting makers that are no longer needed", () => {
    const state = policyState({
      exposure: c(10),
      held: c(10),
      openOrders: [makerOrder({ clientOrderId: "m1", remainingQty: c(3) })],
    });
    expect(decide(state)).toEqual([{ type: "cancel", clientOrderId: "m1", reason: "not_needed" }]);
  });

  it("counts an in-flight taker buy as covering", () => {
    const state = policyState({
      exposure: c(10),
      openOrders: [
        {
          clientOrderId: "t1",
          side: "buy",
          kind: "taker",
          limitPriceBps: 5200n,
          remainingQty: c(10),
          placedAtMs: T0,
          askAtPlacementBps: null,
        },
      ],
    });
    expect(decide(state)).toEqual([]);
  });
});

describe("decide · maker rule", () => {
  it("rests a maker at best bid + 1 tick for U, rounded up to the step", () => {
    const state = policyState({ exposure: c(10) + 5_000n });
    expect(decide(state)).toEqual([
      {
        type: "place_maker_buy",
        limitPriceBps: 4900n,
        qty: c(10.01),
        askAtPlacementBps: 5000n,
        reason: "maker",
      },
    ]);
    expectIdempotent(state);
  });

  it("places only U − W next to a resting maker", () => {
    const state = policyState({
      exposure: c(10),
      held: c(1),
      openOrders: [makerOrder({ clientOrderId: "m1", remainingQty: c(4), placedAtMs: T0 - 1000 })],
    });
    expect(decide(state)).toEqual([
      {
        type: "place_maker_buy",
        limitPriceBps: 4900n,
        qty: c(5),
        askAtPlacementBps: 5000n,
        reason: "maker",
      },
    ]);
    expectIdempotent(state);
  });

  it("does not chase a maker whose price is no longer bid + 1 tick", () => {
    const state = policyState({
      exposure: c(10),
      book: makeBook(SYM, T0, [level(5100, 50)], [level(5300, 50)]),
      openOrders: [
        makerOrder({
          clientOrderId: "m1",
          limitPriceBps: 4900n,
          remainingQty: c(10),
          placedAtMs: T0 - 30_000,
          askAtPlacementBps: 5200n,
        }),
      ],
    });
    expect(decide(state)).toEqual([]);
  });

  it("rests at the bid when bid + 1 tick would touch the ask", () => {
    const state = policyState({
      exposure: c(2),
      book: makeBook(SYM, T0, [level(4900, 10)], [level(5000, 10)]),
    });
    expect(decide(state)).toEqual([
      {
        type: "place_maker_buy",
        limitPriceBps: 4900n,
        qty: c(2),
        askAtPlacementBps: 5000n,
        reason: "maker",
      },
    ]);
  });

  it("prices one tick below the ask without a bid, and places nothing on an empty book", () => {
    const book = makeBook(SYM, T0, [], [level(5000, 10)]);
    expect(makerBuyPrice(book, 9900n)).toBe(4900n);
    expect(makerBuyPrice(makeBook(SYM, T0, [], []), 9900n)).toBeNull();
    expect(decide(policyState({ exposure: c(1), book: makeBook(SYM, T0, [], []) }))).toEqual([]);
  });

  it("caps the maker price and never prices below one tick", () => {
    expect(makerBuyPrice(makeBook(SYM, T0, [level(9900, 1)], []), 9900n)).toBe(9900n);
    expect(makerBuyPrice(makeBook(SYM, T0, [], [level(100, 1)]), 9900n)).toBeNull();
    expect(makerBuyPrice(makeBook(SYM, T0, [level(150, 1)], [level(400, 1)]), 9900n)).toBe(200n);
  });

  it("ignores empty levels when reading the best prices", () => {
    const book = makeBook(
      SYM,
      T0,
      [level(4900, 0), level(4800, 5)],
      [level(4950, 0), level(5000, 5)],
    );
    expect(makerBuyPrice(book, 9900n)).toBe(4900n);
  });

  it("cancels the newest makers when W exceeds what is uncovered", () => {
    const state = policyState({
      exposure: c(6),
      openOrders: [
        makerOrder({ clientOrderId: "hedge-2", remainingQty: c(5), placedAtMs: T0 - 1000 }),
        makerOrder({ clientOrderId: "hedge-1", remainingQty: c(5), placedAtMs: T0 - 2000 }),
      ],
    });
    expect(decide(state)).toEqual([
      { type: "cancel", clientOrderId: "hedge-2", reason: "not_needed" },
      {
        type: "place_maker_buy",
        limitPriceBps: 4900n,
        qty: c(1),
        askAtPlacementBps: 5000n,
        reason: "maker",
      },
    ]);
    expectIdempotent(state);
  });

  it("cancels an unexpected sell maker", () => {
    const state = policyState({
      exposure: c(1),
      openOrders: [makerOrder({ clientOrderId: "s1", side: "sell", remainingQty: c(1) })],
    });
    expect(decide(state)[0]).toEqual({
      type: "cancel",
      clientOrderId: "s1",
      reason: "unexpected_sell_maker",
    });
  });
});

describe("decide · TTL and ask-move fallback", () => {
  it("keeps a maker until its TTL", () => {
    const state = policyState({
      exposure: c(10),
      openOrders: [makerOrder({ clientOrderId: "m1", placedAtMs: T0 - 89_999 })],
    });
    expect(decide(state)).toEqual([]);
  });

  it("cancels a maker after 90 s and sends its remainder taker at ask + 2 ticks", () => {
    const state = policyState({
      exposure: c(10),
      held: c(3),
      openOrders: [
        makerOrder({ clientOrderId: "m1", remainingQty: c(7), placedAtMs: T0 - 90_000 }),
      ],
    });
    expect(decide(state)).toEqual([
      { type: "cancel", clientOrderId: "m1", reason: "ttl_expired" },
      {
        type: "place_taker_buy",
        limitPriceBps: 5200n,
        qty: c(7),
        reason: "ttl_expired",
        replacesClientOrderId: "m1",
      },
    ]);
    expectIdempotent(state);
  });

  it("falls back when the ask has risen two ticks, not one", () => {
    const placed = makerOrder({
      clientOrderId: "m1",
      placedAtMs: T0 - 1000,
      askAtPlacementBps: 5000n,
    });
    const oneTick = policyState({
      exposure: c(10),
      openOrders: [placed],
      book: makeBook(SYM, T0, [level(4800, 50)], [level(5100, 50)]),
    });
    expect(decide(oneTick)).toEqual([]);
    const twoTicks = policyState({
      exposure: c(10),
      openOrders: [placed],
      book: makeBook(SYM, T0, [level(4800, 50)], [level(5200, 50)]),
    });
    expect(decide(twoTicks)).toEqual([
      { type: "cancel", clientOrderId: "m1", reason: "ask_moved" },
      {
        type: "place_taker_buy",
        limitPriceBps: 5400n,
        qty: c(10),
        reason: "ask_moved",
        replacesClientOrderId: "m1",
      },
    ]);
  });

  it("does not apply the ask-move rule to an adopted maker without a placement ask", () => {
    const state = policyState({
      exposure: c(10),
      openOrders: [
        makerOrder({ clientOrderId: "m1", placedAtMs: T0 - 1000, askAtPlacementBps: null }),
      ],
      book: makeBook(SYM, T0, [level(4800, 50)], [level(6000, 50)]),
    });
    expect(decide(state)).toEqual([]);
  });

  it("caps the fallback taker by what is still uncovered", () => {
    const state = policyState({
      exposure: c(4),
      openOrders: [
        makerOrder({ clientOrderId: "m1", remainingQty: c(3), placedAtMs: T0 - 100_000 }),
        makerOrder({ clientOrderId: "m2", remainingQty: c(3), placedAtMs: T0 - 95_000 }),
      ],
    });
    expect(decide(state)).toEqual([
      { type: "cancel", clientOrderId: "m1", reason: "ttl_expired" },
      { type: "cancel", clientOrderId: "m2", reason: "ttl_expired" },
      {
        type: "place_taker_buy",
        limitPriceBps: 5200n,
        qty: c(3),
        reason: "ttl_expired",
        replacesClientOrderId: "m1",
      },
      {
        type: "place_taker_buy",
        limitPriceBps: 5200n,
        qty: c(1),
        reason: "ttl_expired",
        replacesClientOrderId: "m2",
      },
    ]);
  });

  it("replaces an expired maker with a new maker when no taker can be priced", () => {
    const state = policyState({
      exposure: c(2),
      book: makeBook(SYM, T0, [level(4800, 5)], []),
      openOrders: [
        makerOrder({ clientOrderId: "m1", remainingQty: c(2), placedAtMs: T0 - 90_000 }),
      ],
    });
    expect(decide(state)).toEqual([
      { type: "cancel", clientOrderId: "m1", reason: "ttl_expired" },
      {
        type: "place_maker_buy",
        limitPriceBps: 4900n,
        qty: c(2),
        askAtPlacementBps: null,
        reason: "maker",
      },
    ]);
  });
});

describe("decide · uMax", () => {
  it("sends the excess taker so that at most uMax stays unhedged, the rest maker", () => {
    // 700 contracts at an ask of 0.50 = $350 > $300: 600 may stay unhedged.
    const state = policyState({ exposure: c(700) + 5_000n });
    expect(maxUnhedgedQty(DEFAULT_POLICY_PARAMS.uMaxMicroUsdc, 5000n)).toBe(c(600));
    expect(decide(state)).toEqual([
      {
        type: "place_taker_buy",
        limitPriceBps: 5200n,
        qty: c(100.01),
        reason: "u_max_excess",
        replacesClientOrderId: null,
      },
      {
        type: "place_maker_buy",
        limitPriceBps: 4900n,
        qty: c(600),
        askAtPlacementBps: 5000n,
        reason: "maker",
      },
    ]);
    expectIdempotent(state);
  });

  it("does nothing taker at exactly uMax", () => {
    const state = policyState({ exposure: c(600) });
    expect(decide(state).map((action) => action.type)).toEqual(["place_maker_buy"]);
  });

  it("computes the excess on a non-round ask, rounded up to the step", () => {
    // ask 0.57: 300e6 × 10 000 / 5 700 = 526 315 789 micro-contracts may stay unhedged.
    const state = policyState({
      exposure: c(1000),
      book: makeBook(SYM, T0, [level(5600, 1000)], [level(5700, 5000)]),
    });
    const actions = decide(state);
    expect(actions[0]).toEqual({
      type: "place_taker_buy",
      limitPriceBps: 5900n,
      qty: 473_690_000n,
      reason: "u_max_excess",
      replacesClientOrderId: null,
    });
    // What stays unhedged is worth at most $300.
    expect(((c(1000) - 473_690_000n) * 5700n) / 10_000n).toBeLessThanOrEqual(300_000_000n);
    // Bid 5600 + 1 tick touches the ask: the maker rests at the bid.
    expect(actions[1]).toEqual({
      type: "place_maker_buy",
      limitPriceBps: 5600n,
      qty: c(1000) - 473_690_000n,
      askAtPlacementBps: 5700n,
      reason: "maker",
    });
  });

  it("cancels resting makers that the excess taker makes unnecessary", () => {
    const state = policyState({
      exposure: c(700),
      openOrders: [
        makerOrder({ clientOrderId: "m1", remainingQty: c(700), placedAtMs: T0 - 1000 }),
      ],
    });
    expect(decide(state)).toEqual([
      { type: "cancel", clientOrderId: "m1", reason: "not_needed" },
      {
        type: "place_taker_buy",
        limitPriceBps: 5200n,
        qty: c(100),
        reason: "u_max_excess",
        replacesClientOrderId: null,
      },
      {
        type: "place_maker_buy",
        limitPriceBps: 4900n,
        qty: c(600),
        askAtPlacementBps: 5000n,
        reason: "maker",
      },
    ]);
  });
});

describe("decide · forced taker", () => {
  it("sends everything taker less than 60 minutes before the start, makers cancelled first", () => {
    const state = policyState({
      exposure: c(10) + 1n,
      held: c(2),
      eventStartMs: T0 + HOUR_MS - 1,
      openOrders: [makerOrder({ clientOrderId: "m1", remainingQty: c(5), placedAtMs: T0 - 1000 })],
    });
    expect(decide(state)).toEqual([
      { type: "cancel", clientOrderId: "m1", reason: "force_taker" },
      {
        type: "place_taker_buy",
        limitPriceBps: 5200n,
        qty: c(8.01),
        reason: "force_taker",
        replacesClientOrderId: null,
      },
    ]);
    expectIdempotent(state);
  });

  it("is still the maker regime at exactly 60 minutes, and taker after the start", () => {
    expect(
      decide(policyState({ exposure: c(1), eventStartMs: T0 + HOUR_MS })).map((a) => a.type),
    ).toEqual(["place_maker_buy"]);
    expect(
      decide(policyState({ exposure: c(1), eventStartMs: T0 - 1 })).map((a) => a.reason),
    ).toEqual(["force_taker"]);
  });
});

describe("decide · taker limit price", () => {
  it("is the ask plus the slippage, capped at 9 900 bps", () => {
    const params = DEFAULT_POLICY_PARAMS;
    expect(takerBuyLimit(makeBook(SYM, T0, [], [level(5000, 1)]), params)).toBe(5200n);
    expect(takerBuyLimit(makeBook(SYM, T0, [], [level(9800, 1)]), params)).toBe(9900n);
    expect(takerBuyLimit(makeBook(SYM, T0, [], [level(9900, 1)]), params)).toBe(9900n);
    expect(takerBuyLimit(makeBook(SYM, T0, [level(100, 1)], []), params)).toBeNull();
    const tight = resolvePolicyParams({ takerSlippageTicks: 5, maxPriceBps: 9500n });
    expect(takerBuyLimit(makeBook(SYM, T0, [], [level(9000, 1)]), tight)).toBe(9500n);
    expect(takerBuyLimit(makeBook(SYM, T0, [], [level(9600, 1)]), tight)).toBeNull();
  });

  it("places no taker when the cap is below the ask", () => {
    const state = policyState({
      exposure: c(10),
      eventStartMs: T0,
      params: resolvePolicyParams({ maxPriceBps: 9500n }),
      book: makeBook(SYM, T0, [level(9500, 5)], [level(9600, 5)]),
    });
    expect(decide(state)).toEqual([]);
  });

  it("sells at the bid minus the slippage, floored at one tick", () => {
    const params = DEFAULT_POLICY_PARAMS;
    expect(takerSellLimit(makeBook(SYM, T0, [level(4800, 1)], []), params)).toBe(4600n);
    expect(takerSellLimit(makeBook(SYM, T0, [level(200, 1)], []), params)).toBe(100n);
    expect(takerSellLimit(makeBook(SYM, T0, [], [level(200, 1)]), params)).toBeNull();
  });
});

describe("decide · unhedged excess the book can cure", () => {
  const params = DEFAULT_POLICY_PARAMS;
  // 1 000 contracts at a 5 000 bps ask, taker limit 5 200 bps: what may stay unhedged, priced at
  // the limit, is floor(300 000 000 × 10 000 / 5 200) = 576 923 076 micro-contracts, so the book
  // must offer 423 076 924 micro-contracts at or below 5 200 bps.
  const book = (asks: Parameters<typeof makeBook>[3]): ReturnType<typeof makeBook> =>
    makeBook(SYM, T0, [level(4800, 10)], asks);

  it("needs the depth at or below the taker limit to cover the excess", () => {
    expect(unhedgedExcessCurable(book([level(5000, 423)]), c(1000), params)).toBe(false);
    expect(unhedgedExcessCurable(book([level(5000, 423.08)]), c(1000), params)).toBe(true);
    expect(
      unhedgedExcessCurable(book([level(5000, 200), level(5200, 223.08)]), c(1000), params),
    ).toBe(true);
    expect(
      unhedgedExcessCurable(book([level(5000, 200), level(5300, 5000)]), c(1000), params),
    ).toBe(false);
  });

  it("is true when nothing is above uMax, false without a book, an ask or a taker limit", () => {
    expect(unhedgedExcessCurable(book([level(5000, 0.01)]), c(600), params)).toBe(true);
    expect(unhedgedExcessCurable(book([level(5000, 0.01)]), 0n, params)).toBe(true);
    expect(unhedgedExcessCurable(null, c(1000), params)).toBe(false);
    expect(unhedgedExcessCurable(book([]), c(1000), params)).toBe(false);
    const capped = resolvePolicyParams({ maxPriceBps: 4900n });
    expect(unhedgedExcessCurable(book([level(5000, 5000)]), c(1000), capped)).toBe(false);
  });
});

describe("decide · reconcile", () => {
  it("cancels every maker and buys the shortfall taker", () => {
    const state = policyState({
      reconcile: true,
      exposure: c(10) + 5_000n,
      held: c(6),
      openOrders: [
        makerOrder({ clientOrderId: "m1", remainingQty: c(4), placedAtMs: T0 - 1000 }),
        makerOrder({ clientOrderId: "s1", side: "sell", remainingQty: c(1) }),
      ],
    });
    expect(decide(state)).toEqual([
      { type: "cancel", clientOrderId: "s1", reason: "unexpected_sell_maker" },
      { type: "cancel", clientOrderId: "m1", reason: "reconcile" },
      {
        type: "place_taker_buy",
        limitPriceBps: 5200n,
        qty: c(4.01),
        reason: "reconcile",
        replacesClientOrderId: null,
      },
    ]);
    expectIdempotent(state);
  });

  it("sells a surplus above one step, rounded down so H stays at or above E", () => {
    const state = policyState({ reconcile: true, exposure: c(9.497), held: c(10.01) });
    expect(decide(state)).toEqual([
      { type: "place_taker_sell", limitPriceBps: 4600n, qty: c(0.51), reason: "reconcile" },
    ]);
    expectIdempotent(state);
  });

  it("keeps a surplus of at most one step", () => {
    expect(decide(policyState({ reconcile: true, exposure: c(10), held: c(10.01) }))).toEqual([]);
    expect(decide(policyState({ reconcile: true, exposure: c(10), held: c(10.01) + 1n }))).toEqual([
      {
        type: "place_taker_sell",
        limitPriceBps: 4600n,
        qty: CONTRACT_STEP_MICRO,
        reason: "reconcile",
      },
    ]);
  });

  it("does nothing when H already equals E", () => {
    expect(decide(policyState({ reconcile: true, exposure: c(5), held: c(5) }))).toEqual([]);
  });
});

describe("decide · blocked", () => {
  const resting = [
    makerOrder({ clientOrderId: "m1", remainingQty: c(5), placedAtMs: T0 - 1000 }),
    makerOrder({ clientOrderId: "s1", side: "sell", remainingQty: c(1) }),
  ];

  it("places nothing and cancels resting makers while the breaker is active", () => {
    const state = policyState({ exposure: c(100), breakerActive: true, openOrders: resting });
    expect(decide(state)).toEqual([
      { type: "cancel", clientOrderId: "m1", reason: "breaker_active" },
      { type: "cancel", clientOrderId: "s1", reason: "breaker_active" },
    ]);
    expect(decide({ ...state, reconcile: true })).toEqual(decide(state));
    expect(decide({ ...state, eventStartMs: T0 })).toEqual(decide(state));
  });

  it("places nothing without a book", () => {
    const state = policyState({ exposure: c(100), book: null, openOrders: resting });
    expect(decide(state).every((action) => action.type === "cancel")).toBe(true);
    expect(decide(state)[0]).toEqual({ type: "cancel", clientOrderId: "m1", reason: "no_book" });
  });

  it("places nothing on a book older than 10 s, and still trades on one exactly 10 s old", () => {
    const stale = policyState({
      exposure: c(100),
      book: makeBook(SYM, T0 - 10_001, [level(4800, 5)], [level(5000, 5)]),
      openOrders: resting,
    });
    expect(placingBlockedReason(stale)).toBe("stale_book");
    expect(decide(stale)[0]).toEqual({ type: "cancel", clientOrderId: "m1", reason: "stale_book" });
    expect(decide(stale).every((action) => action.type === "cancel")).toBe(true);
    // The stale book is named before the breaker it trips.
    expect(placingBlockedReason({ ...stale, breakerActive: true })).toBe("stale_book");
    expect(placingBlockedReason({ ...stale, book: null, breakerActive: true })).toBe("no_book");
    const fresh = {
      ...stale,
      book: makeBook(SYM, T0 - 10_000, [level(4800, 5)], [level(5000, 5)]),
    };
    expect(placingBlockedReason(fresh)).toBeNull();
  });
});

describe("decide · input validation", () => {
  it("rejects a negative exposure or position and duplicated orders", () => {
    expect(() => decide(policyState({ exposure: -1n }))).toThrow(PolicyInputError);
    expect(() => decide(policyState({ held: -1n }))).toThrow(PolicyInputError);
    expect(() => decide(policyState({ nowMs: Number.NaN }))).toThrow(PolicyInputError);
    const order = makerOrder({ clientOrderId: "m1" });
    expect(() => decide(policyState({ openOrders: [order, order] }))).toThrow(PolicyInputError);
  });

  it("rejects invalid parameters", () => {
    expect(() => resolvePolicyParams({ uMaxMicroUsdc: -1n })).toThrow(PolicyInputError);
    expect(() => resolvePolicyParams({ makerTtlMs: -1 })).toThrow(PolicyInputError);
    expect(() => resolvePolicyParams({ askMoveTicks: 0 })).toThrow(PolicyInputError);
    expect(() => resolvePolicyParams({ maxPriceBps: 9950n })).toThrow(PolicyInputError);
    expect(() => resolvePolicyParams({ maxPriceBps: 10_000n })).toThrow(PolicyInputError);
    expect(resolvePolicyParams()).toEqual(DEFAULT_POLICY_PARAMS);
  });

  it("uses the shared defaults", () => {
    expect(DEFAULT_POLICY_PARAMS).toEqual({
      uMaxMicroUsdc: 300_000_000n,
      makerTtlMs: 90_000,
      askMoveTicks: 2,
      forceTakerMs: 3_600_000,
      takerSlippageTicks: 2,
      maxPriceBps: 9900n,
      staleAfterMs: 10_000,
    });
  });
});
