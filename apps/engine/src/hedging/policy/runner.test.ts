import { CONTRACT_STEP_MICRO } from "@winz/shared";
import type { Book, MicroContracts } from "@winz/shared";
import { describe, expect, it } from "vitest";

import { parseGeminiWsMessage } from "../../market-data/ws-messages";
import { wsFixtureRows } from "../../market-data/book-test-support";
import { PolicyInputError } from "./errors";
import { FakeClock, HOUR_MS, SYM, Scenario, T0, c, level, makeBook } from "./test-support";

const MINUTE_MS = 60_000;

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function ceilStep(qty: MicroContracts): MicroContracts {
  if (qty <= 0n) return 0n;
  return ((qty + CONTRACT_STEP_MICRO - 1n) / CONTRACT_STEP_MICRO) * CONTRACT_STEP_MICRO;
}

/** W never above what is uncovered, and the runner's H matches the venue's fills. */
async function expectConsistent(s: Scenario, exposure: MicroContracts): Promise<void> {
  const held = s.venueHeld();
  expect(s.runner.snapshot().held).toBe(held);
  expect(await s.venueWorking()).toBeLessThanOrEqual(ceilStep(exposure - held));
  expect(held).toBeLessThanOrEqual(ceilStep(exposure));
}

function uniqueIds(s: Scenario): void {
  const ids = s.venue.placed.map((request) => request.clientOrderId);
  expect(new Set(ids).size).toBe(ids.length);
}

describe("PolicyRunner · maker first", () => {
  it("hedges exposure arriving in several sales maker first, the resting quantity following U", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);

    await s.exposure(c(10));
    let open = await s.openOrders();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      clientOrderId: "hedge-1",
      side: "buy",
      kind: "maker",
      limitPriceBps: 4900n,
      qty: c(10),
    });

    await s.exposure(c(15.5));
    open = await s.openOrders();
    expect(open.map((order) => [order.clientOrderId, order.qty])).toEqual([
      ["hedge-1", c(10)],
      ["hedge-2", c(5.5)],
    ]);
    expect(await s.venueWorking()).toBe(c(15.5));

    // A print at the maker price fills 4 contracts of the oldest maker.
    await s.trade(4900, 4);
    expect(s.venueHeld()).toBe(c(4));
    expect(s.runner.snapshot()).toMatchObject({ held: c(4), working: c(11.5) });
    expect(await s.venueWorking()).toBe(c(11.5));
    expect(s.venue.placed).toHaveLength(2);

    // Two sales arriving together become one order (HE-3).
    await Promise.all([s.exposure(c(16)), s.exposure(c(17))]);
    expect(s.venue.placed).toHaveLength(3);
    expect(s.venue.placed[2]).toMatchObject({ kind: "maker", qty: c(1.5), limitPriceBps: 4900n });
    expect(await s.venueWorking()).toBe(c(13));

    // The ask drops onto the makers: 3 contracts fill. bid + 1 tick would now touch the ask, so
    // nothing is chased and W still equals U.
    await s.book([level(4800, 500)], [level(4900, 3)]);
    expect(s.venueHeld()).toBe(c(7));
    expect(await s.venueWorking()).toBe(c(10));
    expect(s.venue.placed).toHaveLength(3);
    await expectConsistent(s, c(17));

    expect(s.sink.ofType("order_placed").map((event) => event.reason)).toEqual([
      "maker",
      "maker",
      "maker",
    ]);
    expect(s.sink.ofType("fill").map((event) => event.fill.qty)).toEqual([c(4), c(3)]);
  });

  it("rounds a non-step exposure up and never buys a full step more than the exposure", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(2) + 3_000n);
    expect(s.venue.placed[0]).toMatchObject({ kind: "maker", qty: c(2.01) });
    await s.trade(4900, 50);
    expect(s.venueHeld()).toBe(c(2.01));
    await s.advance(5_000);
    expect(s.venue.placed).toHaveLength(1);
  });

  it("sends an expired maker's remainder taker after the 90 s TTL, not before", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));
    await s.trade(4900, 4);

    await s.advance(89_000);
    expect(await s.venueWorking()).toBe(c(6));
    expect(s.venue.placed).toHaveLength(1);

    await s.advance(1_000);
    expect(await s.openOrders()).toEqual([]);
    expect(s.venue.placed[1]).toMatchObject({
      clientOrderId: "hedge-2",
      side: "buy",
      kind: "taker",
      limitPriceBps: 5200n,
      qty: c(6),
    });
    expect(s.venueHeld()).toBe(c(10));
    expect(s.fills.at(-1)).toMatchObject({ priceBps: 5000n, qty: c(6), kind: "taker" });
    expect(s.sink.ofType("order_cancelled")).toEqual([
      expect.objectContaining({ reason: "ttl_expired" }),
    ]);
    expect(s.sink.ofType("order_placed").map((event) => event.reason)).toEqual([
      "maker",
      "ttl_expired",
    ]);

    await s.advance(5_000);
    expect(s.venue.placed).toHaveLength(2);
  });

  it("falls back to taker when the ask rises two ticks, not one", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));

    await s.book([level(4800, 500)], [level(5100, 500)]);
    expect(await s.venueWorking()).toBe(c(10));
    expect(s.venue.placed).toHaveLength(1);

    await s.book([level(4800, 500)], [level(5200, 500)]);
    expect(await s.openOrders()).toEqual([]);
    expect(s.venue.placed[1]).toMatchObject({ kind: "taker", limitPriceBps: 5400n, qty: c(10) });
    expect(s.fills.at(-1)).toMatchObject({ priceBps: 5200n, qty: c(10) });
    expect(s.sink.ofType("order_cancelled")[0]?.reason).toBe("ask_moved");
  });
});

describe("PolicyRunner · uMax", () => {
  it("sends the excess taker at once, so at most uMax stays unhedged", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 2000)], [level(5000, 2000)]);
    // 1 000 contracts at $0.50 = $500 unhedged: 400 go taker, 600 ($300) rest maker.
    await s.exposure(c(1000));
    expect(s.venue.placed.map((r) => [r.kind, r.qty, r.limitPriceBps])).toEqual([
      ["taker", c(400), 5200n],
      ["maker", c(600), 4900n],
    ]);
    expect(s.venueHeld()).toBe(c(400));
    expect(s.runner.snapshot().unhedgedNotional).toBe(300_000_000n);
    await s.advance(10_000);
    expect(s.runner.isBreakerActive()).toBe(false);
    expect(s.venue.placed).toHaveLength(2);
  });

  it("brings the unhedged notional back under uMax within 5 s on a thin book", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 2000)], [level(5000, 150)]);
    const start = s.nowMs;
    await s.exposure(c(1000));
    let underAtMs: number | null = null;
    for (let i = 0; i < 5 && underAtMs === null; i += 1) {
      const notional = s.runner.snapshot().unhedgedNotional;
      if (notional !== null && notional <= 300_000_000n) underAtMs = s.nowMs;
      else await s.advance(1_000);
    }
    const notional = s.runner.snapshot().unhedgedNotional;
    if (underAtMs === null && notional !== null && notional <= 300_000_000n) underAtMs = s.nowMs;
    expect(underAtMs).not.toBeNull();
    expect((underAtMs ?? Infinity) - start).toBeLessThanOrEqual(5_000);
    // 150 contracts a second: 150 at 0 s, 150 at 1 s, the last 100 at 2 s.
    expect(underAtMs).toBe(start + 2_000);
    expect(s.venueHeld()).toBe(c(400));
    await s.advance(8_000);
    expect(s.sink.ofType("breaker_tripped")).toEqual([]);
    await expectConsistent(s, c(1000));
  });
});

describe("PolicyRunner · forced taker", () => {
  it("sends everything taker inside the last 60 minutes", async () => {
    const s = new Scenario({ eventStartMs: T0 + 30 * MINUTE_MS });
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));
    await s.exposure(c(12.5));
    expect(s.venue.placed.map((r) => [r.kind, r.qty])).toEqual([
      ["taker", c(10)],
      ["taker", c(2.5)],
    ]);
    expect(s.sink.ofType("order_placed").every((e) => e.reason === "force_taker")).toBe(true);
    expect(s.venueHeld()).toBe(c(12.5));
    expect(await s.openOrders()).toEqual([]);
  });

  it("cancels a resting maker when the 60-minute line is crossed and buys its remainder taker", async () => {
    const s = new Scenario({ eventStartMs: T0 + HOUR_MS + 30_000 });
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));
    await s.advance(30_000);
    expect(await s.venueWorking()).toBe(c(10));
    await s.advance(1_000);
    expect(await s.openOrders()).toEqual([]);
    expect(s.sink.ofType("order_cancelled")[0]?.reason).toBe("force_taker");
    expect(s.venue.placed[1]).toMatchObject({ kind: "taker", qty: c(10), limitPriceBps: 5200n });
    expect(s.venueHeld()).toBe(c(10));
  });
});

describe("PolicyRunner · reconciliation at sales close", () => {
  it("cancels the makers and buys the shortfall taker", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10) + 3_000n);
    await s.trade(4900, 4);
    const outcome = await s.runner.reconcile();
    expect(outcome).toEqual({
      attempted: true,
      exposure: c(10) + 3_000n,
      held: c(10.01),
      withinOneStep: true,
    });
    expect(await s.openOrders()).toEqual([]);
    expect(s.sink.ofType("order_cancelled")[0]?.reason).toBe("reconcile");
    expect(s.venue.placed[1]).toMatchObject({ kind: "taker", side: "buy", qty: c(6.01) });
    expect(s.runner.snapshot().reconcilePending).toBe(false);
  });

  it("sells a surplus above one step", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));
    await s.advance(90_000);
    expect(s.venueHeld()).toBe(c(10));
    // A campaign's exposure went away: E is now 7.005 contracts.
    const exposure = c(7) + 5_000n;
    await s.exposure(exposure);
    expect(s.venue.placed).toHaveLength(2);
    const outcome = await s.runner.reconcile();
    expect(s.venue.placed[2]).toMatchObject({
      kind: "taker",
      side: "sell",
      qty: c(2.99),
      limitPriceBps: 4600n,
    });
    expect(s.fills.at(-1)).toMatchObject({ side: "sell", priceBps: 4800n, qty: c(2.99) });
    expect(outcome).toMatchObject({ attempted: true, held: c(7.01), withinOneStep: true });
    expect(abs(s.venueHeld() - exposure)).toBeLessThanOrEqual(CONTRACT_STEP_MICRO);
  });

  it("stays pending while the book is stale, and while a thin book leaves a shortfall", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 3)]);
    await s.exposure(c(10));
    await s.advance(11_000, { refresh: false });
    expect(await s.openOrders()).toEqual([]);

    let outcome = await s.runner.reconcile();
    expect(outcome.attempted).toBe(false);
    expect(s.runner.snapshot().reconcilePending).toBe(true);

    // Fresh again from the next book (T0 + 12 s), but the breaker waits for its 10 s quiet
    // period before anything is placed.
    await s.advance(10_000);
    expect(s.runner.isBreakerActive()).toBe(true);
    expect(s.venue.placed).toHaveLength(1);
    await s.advance(1_000);
    expect(s.runner.isBreakerActive()).toBe(false);
    // 3 contracts a book: the first attempt leaves a shortfall, the next books complete it.
    expect(s.venueHeld()).toBe(c(3));
    expect(s.runner.snapshot().reconcilePending).toBe(true);
    await s.advance(3_000);
    expect(s.venueHeld()).toBe(c(10));
    expect(s.runner.snapshot().reconcilePending).toBe(false);
    outcome = await s.runner.reconcile();
    expect(outcome).toMatchObject({ attempted: true, withinOneStep: true });
    expect(s.venue.placed.filter((r) => r.kind === "maker")).toHaveLength(1);
  });
});

describe("PolicyRunner · stale book and breaker", () => {
  it("places nothing on a stale book and cancels the resting makers", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));
    await s.advance(10_000, { refresh: false });
    expect(await s.venueWorking()).toBe(c(10));
    await s.advance(1_000, { refresh: false });
    expect(await s.openOrders()).toEqual([]);
    expect(s.sink.ofType("order_cancelled")[0]?.reason).toBe("stale_book");
    expect(s.sink.ofType("breaker_tripped")).toEqual([
      expect.objectContaining({ reason: "stale_book", atMs: T0 + 11_000 }),
    ]);
    await s.exposure(c(50));
    await s.advance(5_000, { refresh: false });
    expect(s.venue.placed).toHaveLength(1);
  });

  it("places nothing before any book, and trips once no book came for 10 s", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.exposure(c(10));
    await s.advance(10_000, { refresh: false });
    expect(s.runner.isBreakerActive()).toBe(false);
    await s.advance(1_000, { refresh: false });
    expect(s.runner.getBreaker().reason).toBe("stale_book");
    expect(s.venue.calls.place).toBe(0);
  });

  it("trips on consecutive venue failures, blocks placing, and resets only after 10 quiet seconds", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    s.venue.mode = "before";
    await s.exposure(c(10));
    expect(s.sink.ofType("order_unconfirmed")).toHaveLength(1);
    expect(s.runner.getBreaker()).toMatchObject({ active: false, consecutiveVenueFailures: 1 });
    // One second = a book and a tick = two cycles, each looking the unconfirmed order up: the
    // second and third consecutive failures.
    await s.advance(1_000);
    expect(s.runner.getBreaker()).toMatchObject({ active: true, reason: "venue_down" });
    expect(s.sink.ofType("breaker_tripped")).toEqual([
      expect.objectContaining({ reason: "venue_down", atMs: T0 + 1_000 }),
    ]);

    await s.exposure(c(30));
    await s.advance(5_000);
    expect(s.venue.calls.place).toBe(1);

    s.venue.mode = "none";
    const recoveredAt = s.nowMs + 1_000;
    await s.advance(1_000);
    expect(s.sink.ofType("order_abandoned")).toEqual([
      expect.objectContaining({ clientOrderId: "hedge-1" }),
    ]);
    await s.advance(9_000);
    expect(s.runner.isBreakerActive()).toBe(true);
    expect(s.venue.calls.place).toBe(1);
    await s.advance(1_000);
    expect(s.runner.isBreakerActive()).toBe(false);
    expect(s.sink.ofType("breaker_reset")).toEqual([
      expect.objectContaining({ atMs: recoveredAt + 10_000 }),
    ]);
    const open = await s.openOrders();
    expect(open.map((order) => [order.kind, order.qty])).toEqual([["maker", c(30)]]);
    uniqueIds(s);
  });

  it("trips when the unhedged notional stays above uMax for more than 5 s, and resets after 10 s under it", async () => {
    const s = new Scenario();
    await s.runner.start();
    // One contract of depth a book: the excess cannot be bought quickly.
    await s.book([level(4800, 2000)], [level(5000, 1)]);
    await s.exposure(c(1000));
    await s.advance(5_000);
    expect(s.runner.isBreakerActive()).toBe(false);
    await s.advance(1_000);
    expect(s.runner.getBreaker()).toMatchObject({ active: true, reason: "unhedged_limit" });
    expect(s.sink.ofType("breaker_tripped")).toEqual([
      expect.objectContaining({ reason: "unhedged_limit", atMs: T0 + 6_000 }),
    ]);
    expect(await s.openOrders()).toEqual([]);
    expect(s.sink.ofType("order_cancelled").at(-1)?.reason).toBe("breaker_active");
    const placedAtTrip = s.venue.placed.length;
    const held = s.venueHeld();

    await s.advance(5_000);
    expect(s.venue.placed).toHaveLength(placedAtTrip);

    // Part of the exposure goes away: the unhedged notional is back under uMax.
    await s.exposure(c(500));
    await s.advance(9_000);
    expect(s.runner.isBreakerActive()).toBe(true);
    expect(s.venue.placed).toHaveLength(placedAtTrip);
    await s.advance(1_000);
    expect(s.runner.isBreakerActive()).toBe(false);
    expect(s.venueHeld()).toBe(held);
    expect(await s.venueWorking()).toBe(c(500) - held);
    await expectConsistent(s, c(500));
  });
});

describe("PolicyRunner · venue rejections and failures", () => {
  it("survives a venue that rejects every placement, one attempt per input, no loop", async () => {
    const s = new Scenario();
    await s.runner.start();
    // The runner sees a book the venue never received: every placement is refused no_book.
    const book = (): Book => makeBook(SYM, s.nowMs, [level(4800, 500)], [level(5000, 500)]);
    await s.runner.onBook(book());
    await s.exposure(c(10));
    for (let i = 0; i < 5; i += 1) {
      s.clock.advance(1_000);
      await s.runner.onBook(book());
    }
    expect(s.venue.placed).toHaveLength(6);
    expect(s.sink.ofType("order_rejected").map((e) => e.rejectReason)).toEqual(
      Array.from({ length: 6 }, () => "no_book"),
    );
    expect(s.runner.isBreakerActive()).toBe(false);

    // The venue now sees a lower ask: a maker at 4900 would cross it.
    s.paper.onBook(makeBook(SYM, s.nowMs, [level(4700, 500)], [level(4900, 500)]));
    await s.runner.onTick();
    expect(s.sink.ofType("order_rejected").at(-1)?.rejectReason).toBe("would_cross");

    // Both see the same book again: exactly one maker rests.
    s.clock.advance(1_000);
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.advance(3_000);
    const open = await s.openOrders();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "maker", qty: c(10) });
    uniqueIds(s);
  });

  it("does not place twice when the venue took an order but its answer was lost", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    s.venue.mode = "after";
    await s.exposure(c(10));
    expect(s.sink.ofType("order_unconfirmed")).toHaveLength(1);
    s.venue.mode = "none";
    await s.advance(3_000);
    expect(s.venue.placed).toHaveLength(1);
    const open = await s.openOrders();
    expect(open.map((order) => [order.clientOrderId, order.qty])).toEqual([["hedge-1", c(10)]]);
    expect(s.runner.snapshot().working).toBe(c(10));
  });

  it("never throws nor duplicates through a long run of failures", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    let exposure = 0n;
    for (let i = 0; i < 40; i += 1) {
      s.venue.mode = i % 3 === 0 ? "after" : i % 3 === 1 ? "before" : "none";
      exposure += c(3);
      await s.exposure(exposure);
      await s.advance(2_000);
      if (i % 5 === 0) await s.trade(4900, 2);
      await expectConsistent(s, exposure);
    }
    s.venue.mode = "none";
    await s.advance(15_000);
    await expectConsistent(s, exposure);
    uniqueIds(s);
    expect(s.runner.isBreakerActive()).toBe(false);
    expect(s.venueHeld() + (await s.venueWorking())).toBe(exposure);
  });
});

describe("PolicyRunner · restart", () => {
  it("adopts the venue's open orders and places nothing twice", async () => {
    const first = new Scenario();
    await first.runner.start();
    await first.book([level(4800, 500)], [level(5000, 500)]);
    await first.exposure(c(10));
    await first.runner.stop();

    const second = new Scenario({
      paper: first.paper,
      clock: first.clock,
      restore: { exposure: c(10), held: 0n, nextOrderSeq: 2 },
    });
    // The wiring hands the latest book before starting: without one, the first decision would
    // cancel the adopted makers (no order rests on a market the runner cannot see).
    await second.book([level(4800, 500)], [level(5000, 500)]);
    await second.runner.start();
    await second.advance(5_000);
    expect(second.venue.placed).toEqual([]);
    expect(second.runner.snapshot()).toMatchObject({ working: c(10), nextOrderSeq: 2 });

    // The adopted maker still expires through its TTL (90 s after its placement).
    await second.advance(85_000);
    expect(second.venue.placed).toEqual([
      expect.objectContaining({ clientOrderId: "hedge-2", kind: "taker", qty: c(10) }),
    ]);
    expect(second.runner.snapshot().held).toBe(c(10));
  });

  it("recovers fills missed while down and never reuses an id", async () => {
    const first = new Scenario();
    await first.runner.start();
    await first.book([level(4800, 500)], [level(5000, 500)]);
    await first.exposure(c(10));
    await first.runner.stop();
    first.paper.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(4), atMs: T0 });

    const second = new Scenario({
      paper: first.paper,
      clock: first.clock,
      // The sequence was lost: the venue's open order moves it past hedge-1.
      restore: {
        exposure: c(15),
        held: 0n,
        nextOrderSeq: 1,
        unsettledOrders: [{ clientOrderId: "hedge-1", recordedFilledQty: 0n }],
      },
    });
    await second.book([level(4800, 500)], [level(5000, 500)]);
    await second.runner.start();
    expect(second.sink.ofType("position_recovered")).toEqual([
      expect.objectContaining({ qty: c(4) }),
    ]);
    expect(second.runner.snapshot().held).toBe(c(4));
    expect(second.venue.placed).toEqual([
      expect.objectContaining({ clientOrderId: "hedge-2", kind: "maker", qty: c(5) }),
    ]);
    expect(await second.venueWorking()).toBe(c(11));
  });

  it("decides nothing until the venue's open orders could be listed", async () => {
    const s = new Scenario();
    s.venue.mode = "before";
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));
    expect(s.venue.calls.place).toBe(0);
    // Three failed listings in a row tripped the breaker: once the venue answers, the order is
    // placed after the 10 s quiet period, not before.
    expect(s.runner.getBreaker().reason).toBe("venue_down");
    s.venue.mode = "none";
    await s.advance(10_000);
    expect(s.venue.calls.place).toBe(0);
    await s.advance(1_000);
    expect(s.venue.calls.place).toBe(1);
    expect(await s.venueWorking()).toBe(c(10));
  });
});

describe("PolicyRunner · inputs", () => {
  it("rejects a book or trade of another instrument and a negative exposure", async () => {
    const s = new Scenario();
    await s.runner.start();
    await expect(
      s.runner.onBook(makeBook("OTHER", T0, [level(4800, 1)], [level(5000, 1)])),
    ).rejects.toBeInstanceOf(PolicyInputError);
    await expect(
      s.runner.onTrade({ instrumentSymbol: "OTHER", priceBps: 5000n, qty: c(1), atMs: T0 }),
    ).rejects.toBeInstanceOf(PolicyInputError);
    await expect(s.runner.onExposure(-1n)).rejects.toBeInstanceOf(PolicyInputError);
  });

  it("ignores a book older than the one held", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.runner.onBook(makeBook(SYM, T0 - 1_000, [level(1000, 1)], [level(1100, 1)]));
    expect(s.runner.snapshot()).toMatchObject({ bidBps: 4800n, askBps: 5000n });
  });
});

describe("PolicyRunner · recorded Gemini book", () => {
  const NYK = "gemi-nba-2611180030-nyk-tor-m-nyk";

  function recordedBooks(): Book[] {
    const books: Book[] = [];
    for (const row of wsFixtureRows("sports-depth10")) {
      if (row.kind !== "msg" || typeof row.data !== "string") continue;
      const message = parseGeminiWsMessage(row.data);
      if (message.kind !== "depthSnapshot" || message.symbol !== NYK) continue;
      books.push(makeBook(SYM, row.t, message.bids, message.asks));
    }
    return books;
  }

  it("hedges sales maker first on the recorded NYK book, falls back after the TTL, and reconciles", async () => {
    const books = recordedBooks();
    expect(books.length).toBeGreaterThan(90);
    const first = books[0];
    if (first === undefined) throw new Error("no recorded book");
    const clock = new FakeClock(first.observedAtMs);
    const s = new Scenario({ clock, eventStartMs: first.observedAtMs + 3 * HOUR_MS });
    await s.runner.start();

    const sales = new Map<number, MicroContracts>([
      [0, c(120)],
      [20, c(80)],
      [40, c(50)],
    ]);
    let exposure = 0n;
    for (const [i, book] of books.entries()) {
      clock.ms = book.observedAtMs;
      await s.feed(book);
      await s.runner.onTick();
      const sale = sales.get(i);
      if (sale !== undefined) {
        exposure += sale;
        await s.exposure(exposure);
      }
      // No trade was recorded on the sports books: one print fills part of the first maker.
      if (i === 30) await s.trade(5600, 70);
      await expectConsistent(s, exposure);
    }

    // Bid 0.56, ask 0.57: bid + 1 tick touches the ask, so the makers rest at the bid.
    expect(s.venue.placed[0]).toMatchObject({ kind: "maker", limitPriceBps: 5600n, qty: c(120) });
    expect(s.venue.placed.filter((r) => r.kind === "maker").map((r) => r.qty)).toEqual([
      c(120),
      c(80),
      c(50),
    ]);
    // The first maker (120, 70 filled) expired 90 s after its placement: 50 bought taker.
    const fallback = s.venue.placed.find((r) => r.kind === "taker");
    expect(fallback).toMatchObject({ qty: c(50), limitPriceBps: 5900n });
    expect(s.sink.ofType("order_placed").find((e) => e.order.kind === "taker")?.reason).toBe(
      "ttl_expired",
    );

    const outcome = await s.runner.reconcile();
    expect(outcome.withinOneStep).toBe(true);
    expect(abs(s.venueHeld() - exposure)).toBeLessThanOrEqual(CONTRACT_STEP_MICRO);
    expect(await s.openOrders()).toEqual([]);
    uniqueIds(s);
  });
});
