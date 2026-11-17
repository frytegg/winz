import { makerFeeBps, takerFeeBps } from "@winz/pricing";
import { BOOK_STALE_AFTER_MS } from "@winz/shared";
import { afterEach, describe, expect, it } from "vitest";

import { VenueInputError } from "./errors";
import { DEFAULT_PAPER_VENUE_CONFIG, PAPER_VENUE_LABEL, PaperVenue } from "./paper-venue";
import { c, expectReplayable, harness, level, makeBook, silentLogger } from "./test-support";
import type { Harness } from "./test-support";
import type { PlaceOrderRequest, VenueFill } from "./types";

const SYM = "GEMI-NBA-LAL-YES";

function order(
  overrides: Partial<PlaceOrderRequest> & { clientOrderId: string },
): PlaceOrderRequest {
  return {
    instrumentSymbol: SYM,
    side: "buy",
    kind: "taker",
    limitPriceBps: 5000n,
    qty: c(1),
    ...overrides,
  };
}

/** A fresh two-sided book at the clock's time: bids 4700/4600, asks 5000/5100/5300. */
function standardBook(h: Harness): void {
  h.venue.onBook(
    makeBook(
      SYM,
      h.clock.ms,
      [level(4700, 4), level(4600, 6)],
      [level(5000, 1), level(5100, 2), level(5300, 5)],
    ),
  );
}

/** Every fill produced by every harness in a test is replayed after the test. */
const harnesses: Harness[] = [];
function setup(...args: Parameters<typeof harness>): Harness {
  const h = harness(...args);
  harnesses.push(h);
  return h;
}

afterEach(() => {
  for (const h of harnesses) expectReplayable(h.fills);
  harnesses.length = 0;
});

describe("PaperVenue · describe and configuration", () => {
  it("states its label and the queue-position limit", () => {
    const h = setup();
    const description = h.venue.describe();
    expect(description.name).toBe("paper");
    expect(description.label).toBe(PAPER_VENUE_LABEL);
    expect(description.label).toBe("PAPER · live Gemini book");
    expect(description.note).toMatch(/queue position is not simulated/i);
    expect(description.note).toMatch(/optimistic/i);
  });

  it("waives the maker fee by default and keeps the configuration explicit", () => {
    const h = setup();
    expect(h.venue.getConfig()).toEqual({
      makerFeeWaived: true,
      staleAfterMs: BOOK_STALE_AFTER_MS,
    });
    expect(DEFAULT_PAPER_VENUE_CONFIG.makerFeeWaived).toBe(true);
  });

  it("refuses an invalid configuration", () => {
    const clock = { now: (): Date => new Date(0) };
    expect(
      () => new PaperVenue({ clock, logger: silentLogger(), config: { staleAfterMs: -1 } }),
    ).toThrow(VenueInputError);
  });
});

describe("PaperVenue · taker buy", () => {
  it("walks several ask levels up to its limit, with the exact price and taker fee per level", async () => {
    const h = setup();
    standardBook(h);
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "t1", limitPriceBps: 5200n, qty: c(4) }),
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;

    expect(result.fills.map((f) => [f.priceBps, f.qty, f.fee])).toEqual([
      // 0.07 × 0.50 × 0.50 = 175 bps per contract → 1 contract pays 17 500 micro-USDC.
      [5000n, c(1), 17_500n],
      // 0.07 × 0.51 × 0.49 = 174.93 bps, rounded up to 175 → 2 contracts pay 35 000.
      [5100n, c(2), 35_000n],
    ]);
    expect(takerFeeBps(5100n)).toBe(175n);
    const notional = result.fills.reduce((sum, f) => sum + (f.qty * f.priceBps) / 10_000n, 0n);
    expect(notional).toBe(1_520_000n);
    expect(result.order.feePaid).toBe(52_500n);
    // 5300 is above the limit: never touched, and the remaining contract is cancelled.
    expect(result.order.filledQty).toBe(c(3));
    expect(result.order.status).toBe("cancelled");
    expect(await h.venue.listOpenOrders()).toEqual([]);
  });

  it("rounds the per-contract taker fee up", async () => {
    const h = setup();
    h.venue.onBook(makeBook(SYM, h.clock.ms, [], [level(3300, 10)]));
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "t1", limitPriceBps: 3300n, qty: c(0.03) }),
    );
    if (!result.accepted) throw new Error("expected acceptance");
    // 0.07 × 0.33 × 0.67 = 154.77 bps → 155 bps; 0.03 contract × 155 bps = 465 micro-USDC.
    expect(result.fills[0]?.fee).toBe(465n);
  });

  it("ends filled when the book holds enough at or below the limit", async () => {
    const h = setup();
    standardBook(h);
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "t1", limitPriceBps: 5100n, qty: c(2.5) }),
    );
    if (!result.accepted) throw new Error("expected acceptance");
    expect(result.order.status).toBe("filled");
    expect(result.fills.map((f) => f.qty)).toEqual([c(1), c(1.5)]);
  });

  it("is cancelled with nothing filled when the best ask is above its limit", async () => {
    const h = setup();
    standardBook(h);
    const result = await h.venue.placeOrder(order({ clientOrderId: "t1", limitPriceBps: 4900n }));
    if (!result.accepted) throw new Error("expected acceptance");
    expect(result.fills).toEqual([]);
    expect(result.order.status).toBe("cancelled");
    expect(result.order.filledQty).toBe(0n);
  });

  it("remembers consumed depth across two takers, and a new book resets it", async () => {
    const h = setup();
    standardBook(h);
    const first = await h.venue.placeOrder(
      order({ clientOrderId: "t1", limitPriceBps: 5100n, qty: c(2) }),
    );
    const second = await h.venue.placeOrder(
      order({ clientOrderId: "t2", limitPriceBps: 5100n, qty: c(2) }),
    );
    if (!first.accepted || !second.accepted) throw new Error("expected acceptance");
    expect(first.fills.map((f) => [f.priceBps, f.qty])).toEqual([
      [5000n, c(1)],
      [5100n, c(1)],
    ]);
    // The level at 5000 is exhausted and 5100 has only one contract left.
    expect(second.fills.map((f) => [f.priceBps, f.qty])).toEqual([[5100n, c(1)]]);
    expect(second.order.status).toBe("cancelled");
    expect(second.fills[0]?.bookRef).toMatchObject({
      levels: [{ priceBps: 5100n, displayedQty: c(2), consumedBeforeQty: c(1) }],
    });

    const third = await h.venue.placeOrder(
      order({ clientOrderId: "t3", limitPriceBps: 5100n, qty: c(1) }),
    );
    if (!third.accepted) throw new Error("expected acceptance");
    expect(third.fills).toEqual([]);

    h.clock.advance(500);
    standardBook(h);
    const fourth = await h.venue.placeOrder(
      order({ clientOrderId: "t4", limitPriceBps: 5000n, qty: c(1) }),
    );
    if (!fourth.accepted) throw new Error("expected acceptance");
    expect(fourth.fills.map((f) => [f.priceBps, f.qty])).toEqual([[5000n, c(1)]]);
  });

  it("never fills a fraction of the 0.01 contract step from a level with an odd size", async () => {
    const h = setup();
    h.venue.onBook(
      makeBook(SYM, h.clock.ms, [], [{ priceBps: 5000n, qty: 1_234_567n }, level(5100, 1)]),
    );
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "t1", limitPriceBps: 5100n, qty: c(2) }),
    );
    if (!result.accepted) throw new Error("expected acceptance");
    expect(result.fills.map((f) => [f.priceBps, f.qty])).toEqual([
      [5000n, 1_230_000n],
      [5100n, 770_000n],
    ]);
  });
});

describe("PaperVenue · book freshness", () => {
  it("rejects with no_book when no book was ever received", async () => {
    const h = setup();
    for (const kind of ["taker", "maker"] as const) {
      const result = await h.venue.placeOrder(order({ clientOrderId: `o-${kind}`, kind }));
      expect(result).toMatchObject({ accepted: false, reason: "no_book" });
      if (!result.accepted) expect(result.order?.status).toBe("rejected");
    }
    const other = setup();
    standardBook(other);
    const elsewhere = await other.venue.placeOrder(
      order({ clientOrderId: "x", instrumentSymbol: "OTHER" }),
    );
    expect(elsewhere).toMatchObject({ accepted: false, reason: "no_book" });
  });

  it("accepts a book exactly 10 s old and rejects one a millisecond older as stale_book", async () => {
    const h = setup();
    standardBook(h);
    h.clock.advance(BOOK_STALE_AFTER_MS);
    const fresh = await h.venue.placeOrder(order({ clientOrderId: "a", limitPriceBps: 5000n }));
    expect(fresh.accepted).toBe(true);

    h.clock.advance(1);
    for (const kind of ["taker", "maker"] as const) {
      const stale = await h.venue.placeOrder(
        order({ clientOrderId: `b-${kind}`, kind, limitPriceBps: 4800n }),
      );
      expect(stale).toMatchObject({ accepted: false, reason: "stale_book" });
    }
  });

  it("ignores a book older than the one it holds", async () => {
    const h = setup();
    standardBook(h);
    h.venue.onBook(makeBook(SYM, h.clock.ms - 1, [], [level(4000, 100)]));
    const result = await h.venue.placeOrder(order({ clientOrderId: "t", limitPriceBps: 5000n }));
    if (!result.accepted) throw new Error("expected acceptance");
    expect(result.fills.map((f) => f.priceBps)).toEqual([5000n]);
  });

  it("keeps the consumed-depth memory when the same book is delivered again", async () => {
    const h = setup();
    const book = makeBook(SYM, h.clock.ms, [level(4700, 1)], [level(5000, 1)]);
    h.venue.onBook(book);
    const first = await h.venue.placeOrder(order({ clientOrderId: "t1", limitPriceBps: 5000n }));
    // The same object, then an equal copy: neither is a new book.
    h.venue.onBook(book);
    h.venue.onBook(makeBook(SYM, book.observedAtMs, [level(4700, 1)], [level(5000, 1)]));
    const second = await h.venue.placeOrder(order({ clientOrderId: "t2", limitPriceBps: 5000n }));
    if (!first.accepted || !second.accepted) throw new Error("expected acceptance");
    expect(first.fills.map((f) => f.qty)).toEqual([c(1)]);
    expect(second.fills).toEqual([]);

    // A different snapshot carrying the same time is a new book and replaces the memory.
    h.venue.onBook(makeBook(SYM, book.observedAtMs, [level(4700, 1)], [level(5000, 2)]));
    const third = await h.venue.placeOrder(
      order({ clientOrderId: "t3", limitPriceBps: 5000n, qty: c(2) }),
    );
    if (!third.accepted) throw new Error("expected acceptance");
    expect(third.fills.map((f) => f.qty)).toEqual([c(2)]);
  });

  it("does not fill a resting maker twice from the same book delivered again", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n, qty: c(3) }),
    );
    h.clock.advance(100);
    const crossing = makeBook(SYM, h.clock.ms, [], [level(4900, 1)]);
    expect(h.venue.onBook(crossing).map((f) => f.qty)).toEqual([c(1)]);
    expect(h.venue.onBook({ ...crossing, asks: [level(4900, 1)] })).toEqual([]);
    expect((await h.venue.getOrder("m"))?.filledQty).toBe(c(1));
  });

  it("does not fill resting makers from a book that is already stale when it arrives", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n }));
    h.clock.advance(BOOK_STALE_AFTER_MS + 5_000);
    const fills = h.venue.onBook(
      makeBook(SYM, h.clock.ms - BOOK_STALE_AFTER_MS - 1, [], [level(4800, 10)]),
    );
    expect(fills).toEqual([]);
    expect((await h.venue.getOrder("m"))?.status).toBe("working");
  });

  it("throws on a malformed book, which is an owner bug and not a market condition", () => {
    const h = setup();
    expect(() => h.venue.onBook(makeBook(SYM, 0, [], [level(5100, 1), level(5000, 1)]))).toThrow(
      VenueInputError,
    );
    expect(() => h.venue.onBook(makeBook(SYM, 0, [level(4000, 1), level(4100, 1)], []))).toThrow(
      VenueInputError,
    );
    expect(() => h.venue.onBook(makeBook(SYM, 0, [], [level(5000, 1), level(5000, 1)]))).toThrow(
      VenueInputError,
    );
    expect(() => h.venue.onBook(makeBook(SYM, 0, [], [{ priceBps: 5000n, qty: -1n }]))).toThrow(
      VenueInputError,
    );
    expect(() =>
      h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 5000n, qty: 0n, atMs: 0 }),
    ).toThrow(VenueInputError);
  });
});

describe("PaperVenue · input validation", () => {
  it.each([
    ["zero quantity", { qty: 0n }, "invalid_quantity"],
    ["negative quantity", { qty: -c(1) }, "invalid_quantity"],
    ["quantity off the 0.01 step", { qty: 1_005_000n }, "invalid_quantity"],
    ["price below one tick", { limitPriceBps: 0n }, "invalid_price"],
    ["price above 9 900", { limitPriceBps: 10_000n }, "invalid_price"],
    ["price off the tick", { limitPriceBps: 5050n }, "invalid_price"],
    ["empty instrument", { instrumentSymbol: "" }, "invalid_order"],
  ] as const)("rejects %s", async (_label, overrides, reason) => {
    const h = setup();
    standardBook(h);
    const result = await h.venue.placeOrder(order({ clientOrderId: "bad", ...overrides }));
    expect(result).toMatchObject({ accepted: false, reason });
    expect(h.fills).toEqual([]);
  });

  it("accepts the bounds 100 and 9 900 bps", async () => {
    const h = setup();
    h.venue.onBook(makeBook(SYM, h.clock.ms, [level(50, 1)], [level(9950, 1)]));
    const low = await h.venue.placeOrder(
      order({ clientOrderId: "low", kind: "maker", limitPriceBps: 100n }),
    );
    const high = await h.venue.placeOrder(
      order({ clientOrderId: "high", kind: "maker", side: "sell", limitPriceBps: 9900n }),
    );
    expect(low.accepted).toBe(true);
    expect(high.accepted).toBe(true);
  });

  it("rejects an empty clientOrderId without recording anything", async () => {
    const h = setup();
    standardBook(h);
    const result = await h.venue.placeOrder(order({ clientOrderId: "" }));
    expect(result).toMatchObject({ accepted: false, reason: "invalid_order", order: null });
    expect(h.events).toEqual([]);
  });
});

describe("PaperVenue · idempotent placement", () => {
  it("returns the first result for the same clientOrderId and creates nothing", async () => {
    const h = setup();
    standardBook(h);
    const first = await h.venue.placeOrder(
      order({ clientOrderId: "same", limitPriceBps: 5000n, qty: c(0.5) }),
    );
    const eventsAfterFirst = h.events.length;
    const second = await h.venue.placeOrder(
      order({ clientOrderId: "same", limitPriceBps: 5000n, qty: c(0.5) }),
    );
    const third = await h.venue.placeOrder(
      order({ clientOrderId: "same", limitPriceBps: 5300n, qty: c(5) }),
    );
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(h.events.length).toBe(eventsAfterFirst);
    expect(h.fills.length).toBe(1);

    // Only the first half contract was taken from the 5000 level.
    const next = await h.venue.placeOrder(
      order({ clientOrderId: "next", limitPriceBps: 5000n, qty: c(1) }),
    );
    if (!next.accepted) throw new Error("expected acceptance");
    expect(next.fills.map((f) => f.qty)).toEqual([c(0.5)]);
  });

  it("returns the first rejection again for a rejected id", async () => {
    const h = setup();
    const first = await h.venue.placeOrder(order({ clientOrderId: "r" }));
    standardBook(h);
    const second = await h.venue.placeOrder(order({ clientOrderId: "r" }));
    expect(second).toBe(first);
    expect(second).toMatchObject({ accepted: false, reason: "no_book" });
  });
});

describe("PaperVenue · maker buy", () => {
  it("is rejected with would_cross at or above the best ask", async () => {
    const h = setup();
    standardBook(h);
    for (const limit of [5000n, 5200n]) {
      const result = await h.venue.placeOrder(
        order({ clientOrderId: `x${limit.toString()}`, kind: "maker", limitPriceBps: limit }),
      );
      expect(result).toMatchObject({ accepted: false, reason: "would_cross" });
    }
    const resting = await h.venue.placeOrder(
      order({ clientOrderId: "ok", kind: "maker", limitPriceBps: 4900n }),
    );
    expect(resting).toMatchObject({ accepted: true, fills: [] });
    if (resting.accepted) expect(resting.order.status).toBe("working");
  });

  it("judges crossing against the displayed book, whatever paper takers consumed from it", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(order({ clientOrderId: "t", limitPriceBps: 5000n, qty: c(1) }));
    // Paper takers never remove real liquidity: the market still shows 5000 as its best ask, and
    // the real venue would refuse a maker-or-cancel buy at or above it.
    for (const limit of [5000n, 5100n, 6000n]) {
      const result = await h.venue.placeOrder(
        order({ clientOrderId: `m${limit.toString()}`, kind: "maker", limitPriceBps: limit }),
      );
      expect(result).toMatchObject({ accepted: false, reason: "would_cross" });
    }
    // Nothing rests above the displayed ask, so the next book cannot fill anything there.
    h.clock.advance(500);
    expect(h.venue.onBook(makeBook(SYM, h.clock.ms, [level(4700, 4)], [level(5000, 1)]))).toEqual(
      [],
    );
    expect(await h.venue.listOpenOrders()).toEqual([]);
  });

  it("ignores a displayed level of zero size when judging crossing", async () => {
    const h = setup();
    h.venue.onBook(makeBook(SYM, h.clock.ms, [level(4700, 1)], [level(4900, 0), level(5000, 1)]));
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n }),
    );
    expect(result.accepted).toBe(true);
  });

  it("is filled by a later book whose asks cross down to it, at its own limit and within displayed depth", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n, qty: c(3) }),
    );
    h.clock.advance(1_000);
    const fills = h.venue.onBook(
      makeBook(SYM, h.clock.ms, [level(4700, 1)], [level(4800, 1), level(4900, 1), level(5000, 9)]),
    );
    expect(fills.map((f) => [f.priceBps, f.qty, f.fee, f.kind])).toEqual([
      // Two contracts are displayed at or below 4900; both fill at 4900, not at 4800.
      [4900n, c(2), 0n, "maker"],
    ]);
    expect(fills[0]?.bookRef).toMatchObject({
      source: "book",
      bookSide: "asks",
      levels: [
        { priceBps: 4800n, displayedQty: c(1), consumedBeforeQty: 0n },
        { priceBps: 4900n, displayedQty: c(1), consumedBeforeQty: 0n },
      ],
    });
    const partial = await h.venue.getOrder("m");
    expect(partial).toMatchObject({ status: "partially_filled", filledQty: c(2) });

    // The depth taken by the maker fill is not sold again to a taker on the same book.
    const taker = await h.venue.placeOrder(
      order({ clientOrderId: "t", limitPriceBps: 4900n, qty: c(1) }),
    );
    if (!taker.accepted) throw new Error("expected acceptance");
    expect(taker.fills).toEqual([]);

    h.clock.advance(1_000);
    const more = h.venue.onBook(makeBook(SYM, h.clock.ms, [], [level(4900, 5)]));
    expect(more.map((f) => [f.priceBps, f.qty])).toEqual([[4900n, c(1)]]);
    expect(await h.venue.getOrder("m")).toMatchObject({ status: "filled", filledQty: c(3) });
    expect(await h.venue.listOpenOrders()).toEqual([]);
  });

  it("is not filled by a book whose best ask stays above its limit", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n }));
    h.clock.advance(1_000);
    expect(h.venue.onBook(makeBook(SYM, h.clock.ms, [], [level(5000, 100)]))).toEqual([]);
  });

  it("is not filled by a book observed before it was placed", async () => {
    const h = setup();
    standardBook(h);
    h.clock.advance(1_000);
    await h.venue.placeOrder(order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n }));
    expect(h.venue.onBook(makeBook(SYM, h.clock.ms - 1, [], [level(4800, 100)]))).toEqual([]);
  });

  it("is filled by a print at its price, up to the printed size", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n, qty: c(3) }),
    );
    const fills = h.venue.onTrade({
      instrumentSymbol: SYM,
      priceBps: 4900n,
      qty: c(1.25),
      atMs: h.clock.ms,
    });
    expect(fills.map((f) => [f.priceBps, f.qty])).toEqual([[4900n, c(1.25)]]);
    expect(fills[0]?.bookRef).toMatchObject({
      source: "trade",
      printPriceBps: 4900n,
      printedQty: c(1.25),
      allocatedBeforeQty: 0n,
    });
    expect(await h.venue.getOrder("m")).toMatchObject({
      status: "partially_filled",
      filledQty: c(1.25),
    });
  });

  it("is filled at its own limit by a print below it, and a larger print fills only what it needs", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n, qty: c(2) }),
    );
    const fills = h.venue.onTrade({
      instrumentSymbol: SYM,
      priceBps: 4500n,
      qty: c(10),
      atMs: h.clock.ms,
    });
    expect(fills.map((f) => [f.priceBps, f.qty])).toEqual([[4900n, c(2)]]);
    expect(await h.venue.getOrder("m")).toMatchObject({ status: "filled", filledQty: c(2) });
  });

  it("is never filled by a print above its limit, nor by a print older than the order", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n }));
    expect(
      h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 5000n, qty: c(5), atMs: h.clock.ms }),
    ).toEqual([]);
    expect(
      h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 4800n, qty: c(5), atMs: h.clock.ms - 1 }),
    ).toEqual([]);
    expect(
      h.venue.onTrade({ instrumentSymbol: "OTHER", priceBps: 4800n, qty: c(5), atMs: h.clock.ms }),
    ).toEqual([]);
    expect((await h.venue.getOrder("m"))?.filledQty).toBe(0n);
  });

  it("shares one print among resting orders by price then time, never allocating it twice", async () => {
    const h = setup();
    h.venue.onBook(makeBook(SYM, h.clock.ms, [level(4500, 1)], [level(5200, 1)]));
    await h.venue.placeOrder(
      order({ clientOrderId: "a", kind: "maker", limitPriceBps: 4900n, qty: c(2) }),
    );
    h.clock.advance(10);
    await h.venue.placeOrder(
      order({ clientOrderId: "b", kind: "maker", limitPriceBps: 4900n, qty: c(2) }),
    );
    h.clock.advance(10);
    await h.venue.placeOrder(
      order({ clientOrderId: "c", kind: "maker", limitPriceBps: 5000n, qty: c(1) }),
    );
    const fills = h.venue.onTrade({
      instrumentSymbol: SYM,
      priceBps: 4800n,
      qty: c(3.5),
      atMs: h.clock.ms,
    });
    // c has the best price, then a is older than b.
    expect(fills.map((f) => [f.clientOrderId, f.priceBps, f.qty])).toEqual([
      ["c", 5000n, c(1)],
      ["a", 4900n, c(2)],
      ["b", 4900n, c(0.5)],
    ]);
    expect(fills.reduce((sum, f) => sum + f.qty, 0n)).toBe(c(3.5));
    expect(
      fills.map((f) => (f.bookRef.source === "trade" ? f.bookRef.allocatedBeforeQty : -1n)),
    ).toEqual([0n, c(1), c(3)]);
  });

  it("shares one book level among resting orders by price then time", async () => {
    const h = setup();
    h.venue.onBook(makeBook(SYM, h.clock.ms, [level(4500, 1)], [level(5200, 1)]));
    await h.venue.placeOrder(
      order({ clientOrderId: "a", kind: "maker", limitPriceBps: 4900n, qty: c(2) }),
    );
    h.clock.advance(10);
    await h.venue.placeOrder(
      order({ clientOrderId: "b", kind: "maker", limitPriceBps: 4900n, qty: c(2) }),
    );
    h.clock.advance(10);
    const fills = h.venue.onBook(makeBook(SYM, h.clock.ms, [], [level(4900, 3)]));
    expect(fills.map((f) => [f.clientOrderId, f.qty])).toEqual([
      ["a", c(2)],
      ["b", c(1)],
    ]);
    expect(fills[1]?.bookRef).toMatchObject({
      levels: [{ priceBps: 4900n, displayedQty: c(3), consumedBeforeQty: c(2) }],
    });
  });

  it("charges the scheduled maker fee when the waiver is off", async () => {
    const h = setup({ makerFeeWaived: false });
    standardBook(h);
    await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n, qty: c(2) }),
    );
    const [fill] = h.venue.onTrade({
      instrumentSymbol: SYM,
      priceBps: 4900n,
      qty: c(2),
      atMs: h.clock.ms,
    });
    const perContract = makerFeeBps(4900n, { waived: false });
    // 0.0175 × 0.49 × 0.51 = 43.73 bps → 44; 2 contracts × 44 bps = 8 800 micro-USDC.
    expect(perContract).toBe(44n);
    expect(fill?.fee).toBe(8_800n);
    expect(fill?.bookRef.makerFeeWaived).toBe(false);
  });
});

describe("PaperVenue · sell side mirrors the buy side", () => {
  it("taker sell walks the bids down to its limit, pays the taker fee and cancels the rest", async () => {
    const h = setup();
    standardBook(h);
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "s", side: "sell", limitPriceBps: 4600n, qty: c(12) }),
    );
    if (!result.accepted) throw new Error("expected acceptance");
    expect(result.fills.map((f) => [f.priceBps, f.qty, f.fee])).toEqual([
      // 0.07 × 0.47 × 0.53 = 174.37 → 175 bps; 4 contracts = 70 000.
      [4700n, c(4), 70_000n],
      // 0.07 × 0.46 × 0.54 = 173.88 → 174 bps; 6 contracts = 104 400.
      [4600n, c(6), 104_400n],
    ]);
    expect(result.fills[0]?.bookRef).toMatchObject({ bookSide: "bids" });
    expect(result.order).toMatchObject({ status: "cancelled", filledQty: c(10) });

    const again = await h.venue.placeOrder(
      order({ clientOrderId: "s2", side: "sell", limitPriceBps: 4600n, qty: c(1) }),
    );
    if (!again.accepted) throw new Error("expected acceptance");
    expect(again.fills).toEqual([]);
  });

  it("maker sell is rejected at or below the best bid", async () => {
    const h = setup();
    standardBook(h);
    for (const limit of [4700n, 4500n]) {
      const result = await h.venue.placeOrder(
        order({
          clientOrderId: `x${limit.toString()}`,
          side: "sell",
          kind: "maker",
          limitPriceBps: limit,
        }),
      );
      expect(result).toMatchObject({ accepted: false, reason: "would_cross" });
    }
  });

  it("maker sell judges crossing against the displayed bids, whatever paper takers consumed", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(
      order({ clientOrderId: "t", side: "sell", limitPriceBps: 4700n, qty: c(4) }),
    );
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "m", side: "sell", kind: "maker", limitPriceBps: 4700n }),
    );
    expect(result).toMatchObject({ accepted: false, reason: "would_cross" });
  });

  it("maker sell is filled at its limit by bids rising to it and by prints at or above it", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(
      order({ clientOrderId: "s", side: "sell", kind: "maker", limitPriceBps: 4800n, qty: c(3) }),
    );
    expect(
      h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 4700n, qty: c(5), atMs: h.clock.ms }),
    ).toEqual([]);
    const printFills = h.venue.onTrade({
      instrumentSymbol: SYM,
      priceBps: 4900n,
      qty: c(1),
      atMs: h.clock.ms,
    });
    expect(printFills.map((f) => [f.priceBps, f.qty])).toEqual([[4800n, c(1)]]);

    h.clock.advance(100);
    const bookFills = h.venue.onBook(
      makeBook(SYM, h.clock.ms, [level(4900, 1), level(4800, 5)], [level(5000, 1)]),
    );
    expect(bookFills.map((f) => [f.priceBps, f.qty])).toEqual([[4800n, c(2)]]);
    expect(bookFills[0]?.bookRef).toMatchObject({ bookSide: "bids" });
    expect(await h.venue.getOrder("s")).toMatchObject({ status: "filled", filledQty: c(3) });
  });
});

describe("PaperVenue · cancellation", () => {
  it("cancels a working maker order, idempotently, and it no longer fills", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n }));
    const first = await h.venue.cancelOrder("m");
    expect(first).toMatchObject({ cancelled: true, alreadyCancelled: false });
    if (first.cancelled) expect(first.order.status).toBe("cancelled");
    const second = await h.venue.cancelOrder("m");
    expect(second).toMatchObject({ cancelled: true, alreadyCancelled: true });
    expect(
      h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 4800n, qty: c(5), atMs: h.clock.ms }),
    ).toEqual([]);
    expect(await h.venue.listOpenOrders()).toEqual([]);
  });

  it("cancels a partially filled maker order and keeps what it filled", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n, qty: c(2) }),
    );
    h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(0.5), atMs: h.clock.ms });
    const result = await h.venue.cancelOrder("m");
    expect(result).toMatchObject({
      cancelled: true,
      order: { status: "cancelled", filledQty: c(0.5) },
    });
  });

  it("returns a typed result for filled, rejected and unknown orders", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(order({ clientOrderId: "t", limitPriceBps: 5000n, qty: c(1) }));
    await h.venue.placeOrder(order({ clientOrderId: "r", kind: "maker", limitPriceBps: 5100n }));
    expect(await h.venue.cancelOrder("t")).toMatchObject({
      cancelled: false,
      reason: "already_filled",
    });
    expect(await h.venue.cancelOrder("r")).toMatchObject({ cancelled: false, reason: "rejected" });
    expect(await h.venue.cancelOrder("nope")).toEqual({
      cancelled: false,
      reason: "unknown_order",
      order: null,
    });
  });
});

describe("PaperVenue · queries and events", () => {
  it("lists open orders by instrument, oldest first", async () => {
    const h = setup();
    standardBook(h);
    h.venue.onBook(makeBook("OTHER", h.clock.ms, [level(3000, 1)], [level(3500, 1)]));
    await h.venue.placeOrder(order({ clientOrderId: "a", kind: "maker", limitPriceBps: 4800n }));
    await h.venue.placeOrder(
      order({ clientOrderId: "o", kind: "maker", instrumentSymbol: "OTHER", limitPriceBps: 3100n }),
    );
    await h.venue.placeOrder(order({ clientOrderId: "b", kind: "maker", limitPriceBps: 4900n }));
    expect((await h.venue.listOpenOrders(SYM)).map((o) => o.clientOrderId)).toEqual(["a", "b"]);
    expect((await h.venue.listOpenOrders()).map((o) => o.clientOrderId)).toEqual(["a", "o", "b"]);
    expect(await h.venue.getOrder("missing")).toBeNull();
  });

  it("emits order updates and fills in order, and an unsubscribed listener hears nothing", async () => {
    const h = setup();
    standardBook(h);
    const seen: string[] = [];
    const unsubscribe = h.venue.onEvent((event) => {
      seen.push(
        event.type === "order"
          ? `order:${event.order.status}`
          : `fill:${event.fill.qty.toString()}`,
      );
    });
    await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n, qty: c(2) }),
    );
    h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(1), atMs: h.clock.ms });
    h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(1), atMs: h.clock.ms });
    await h.venue.placeOrder(order({ clientOrderId: "t", limitPriceBps: 5100n, qty: c(5) }));
    await h.venue.placeOrder(order({ clientOrderId: "r", qty: 1n }));
    expect(seen).toEqual([
      "order:working",
      "fill:1000000",
      "order:partially_filled",
      "fill:1000000",
      "order:filled",
      "fill:1000000",
      "fill:2000000",
      "order:cancelled",
      "order:rejected",
    ]);
    unsubscribe();
    await h.venue.cancelOrder("nothing");
    await h.venue.placeOrder(order({ clientOrderId: "z", qty: 1n }));
    expect(seen.length).toBe(9);
  });

  it("keeps going when a listener throws", async () => {
    const h = setup();
    standardBook(h);
    h.venue.onEvent(() => {
      throw new Error("listener bug");
    });
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "t", limitPriceBps: 5000n, qty: c(1) }),
    );
    expect(result).toMatchObject({ accepted: true, order: { status: "filled" } });
    expect(h.fills.length).toBe(1);
  });

  it("returns snapshots that later changes do not mutate", async () => {
    const h = setup();
    standardBook(h);
    const placed = await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n, qty: c(2) }),
    );
    h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(1), atMs: h.clock.ms });
    if (!placed.accepted) throw new Error("expected acceptance");
    expect(placed.order.filledQty).toBe(0n);
    expect(Object.isFrozen(placed.order)).toBe(true);
  });
});

/**
 * Listeners run synchronously and may call back into the venue (the execution policy cancels
 * surplus makers when it hears a fill). An acknowledged cancel must hold: after `cancelOrder`
 * answers `cancelled: true, alreadyCancelled: false`, the order never fills again.
 */
describe("PaperVenue · listeners that call back into the venue", () => {
  interface CancelWatch {
    result: Awaited<ReturnType<PaperVenue["cancelOrder"]>> | null;
    /** Number of fill events for the cancelled order heard after the cancel was acknowledged. */
    fillsAfterAck: number;
  }

  /** On the first fill of `trigger`, cancels `target`; counts fills of `target` after an ack. */
  function cancelOnFill(h: Harness, trigger: string, target: string): CancelWatch {
    const watch: CancelWatch = { result: null, fillsAfterAck: 0 };
    let acknowledged = false;
    h.venue.onEvent((event) => {
      if (event.type !== "fill") return;
      if (event.fill.clientOrderId === target && acknowledged) watch.fillsAfterAck += 1;
      if (event.fill.clientOrderId === trigger && watch.result === null) {
        void h.venue.cancelOrder(target).then((result) => {
          watch.result = result;
          return result;
        });
        // cancelOrder's body runs synchronously: from here on, a fill of the target is only
        // allowed if the cancel turns out not to have been acknowledged.
        acknowledged = true;
      }
    });
    return watch;
  }

  async function expectCancelHeld(h: Harness, target: string, watch: CancelWatch): Promise<void> {
    await Promise.resolve();
    expect(watch.result).not.toBeNull();
    const final = await h.venue.getOrder(target);
    if (watch.result?.cancelled === true && !watch.result.alreadyCancelled) {
      expect(watch.fillsAfterAck).toBe(0);
      expect(final).toMatchObject({
        status: "cancelled",
        filledQty: watch.result.order.filledQty,
      });
    } else {
      // The order filled before the cancel could act: the cancel must say so.
      expect(watch.result).toMatchObject({ cancelled: false, reason: "already_filled" });
      expect(final?.status).toBe("filled");
    }
    const targetFills = h.fills.filter((f) => f.clientOrderId === target);
    expect(targetFills.reduce((sum, f) => sum + f.qty, 0n)).toBe(final?.filledQty);
  }

  it("a cancel issued during a print's allocation holds", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(order({ clientOrderId: "a", kind: "maker", limitPriceBps: 4900n }));
    h.clock.advance(10);
    await h.venue.placeOrder(order({ clientOrderId: "b", kind: "maker", limitPriceBps: 4900n }));
    const watch = cancelOnFill(h, "a", "b");
    h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(5), atMs: h.clock.ms });
    await expectCancelHeld(h, "b", watch);
  });

  it("a cancel issued during a book's allocation holds", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(order({ clientOrderId: "a", kind: "maker", limitPriceBps: 4900n }));
    h.clock.advance(10);
    await h.venue.placeOrder(order({ clientOrderId: "b", kind: "maker", limitPriceBps: 4900n }));
    const watch = cancelOnFill(h, "a", "b");
    h.clock.advance(10);
    h.venue.onBook(makeBook(SYM, h.clock.ms, [], [level(4900, 5)]));
    await expectCancelHeld(h, "b", watch);
  });

  it("a taker cancelled by a listener on its own first fill is not left half-applied", async () => {
    const h = setup();
    standardBook(h);
    const watch = cancelOnFill(h, "t", "t");
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "t", limitPriceBps: 5100n, qty: c(3) }),
    );
    await expectCancelHeld(h, "t", watch);
    if (!result.accepted) throw new Error("expected acceptance");
    const final = await h.venue.getOrder("t");
    expect(result.order).toEqual(final);
  });

  it("an order placed by a listener during a book's allocation never buys the same depth twice", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(
      order({ clientOrderId: "m", kind: "maker", limitPriceBps: 4900n, qty: c(1) }),
    );
    let reaction: Promise<unknown> | null = null;
    h.venue.onEvent((event) => {
      if (event.type === "fill" && event.fill.clientOrderId === "m" && reaction === null) {
        reaction = h.venue.placeOrder(
          order({ clientOrderId: "t", limitPriceBps: 4900n, qty: c(5) }),
        );
      }
    });
    h.clock.advance(10);
    h.venue.onBook(makeBook(SYM, h.clock.ms, [], [level(4900, 3)]));
    await reaction;
    const total = h.fills.reduce((sum, f) => sum + f.qty, 0n);
    expect(total).toBe(c(3));
    expect(h.fills.map((f) => [f.clientOrderId, f.qty])).toEqual([
      ["m", c(1)],
      ["t", c(2)],
    ]);
  });

  it("delivers every event in the order the state changed, even when a listener re-enters", async () => {
    const h = setup();
    standardBook(h);
    await h.venue.placeOrder(order({ clientOrderId: "a", kind: "maker", limitPriceBps: 4900n }));
    await h.venue.placeOrder(order({ clientOrderId: "b", kind: "maker", limitPriceBps: 4800n }));
    h.venue.onEvent((event) => {
      if (event.type === "fill" && event.fill.clientOrderId === "a") void h.venue.cancelOrder("b");
    });
    const start = h.events.length;
    h.venue.onTrade({ instrumentSymbol: SYM, priceBps: 4700n, qty: c(5), atMs: h.clock.ms });
    const seen = h.events
      .slice(start)
      .map((e) =>
        e.type === "fill"
          ? `fill:${e.fill.clientOrderId}`
          : `order:${e.order.clientOrderId}:${e.order.status}`,
      );
    // Each order's fill is followed by its own update, and b's state never goes backwards.
    expect(seen).toEqual(["fill:a", "order:a:filled", "fill:b", "order:b:filled"]);
    expect((await h.venue.getOrder("b"))?.status).toBe("filled");
  });
});

describe("PaperVenue · fills carry their reference", () => {
  it("records the book observation time and the order context on every fill", async () => {
    const h = setup();
    standardBook(h);
    const observedAtMs = h.clock.ms;
    h.clock.advance(2_000);
    const result = await h.venue.placeOrder(
      order({ clientOrderId: "t", limitPriceBps: 5100n, qty: c(2) }),
    );
    if (!result.accepted) throw new Error("expected acceptance");
    const refs = result.fills.map((f: VenueFill) => f.bookRef);
    expect(refs).toEqual([
      {
        source: "book",
        instrumentSymbol: SYM,
        observedAtMs,
        bookSide: "asks",
        levels: [{ priceBps: 5000n, displayedQty: c(1), consumedBeforeQty: 0n }],
        limitPriceBps: 5100n,
        orderRemainingQty: c(2),
        makerFeeWaived: true,
      },
      {
        source: "book",
        instrumentSymbol: SYM,
        observedAtMs,
        bookSide: "asks",
        levels: [{ priceBps: 5100n, displayedQty: c(2), consumedBeforeQty: 0n }],
        limitPriceBps: 5100n,
        orderRemainingQty: c(1),
        makerFeeWaived: true,
      },
    ]);
    expect(result.fills.every((f) => f.atMs === h.clock.ms)).toBe(true);
  });
});
