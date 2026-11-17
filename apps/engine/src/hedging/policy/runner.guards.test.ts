/**
 * Scenarios the first review found uncovered: recovery from an unhedged_limit trip with the same
 * exposure, restore races, inputs before `start`, and the executor's own safety guards.
 */
import { CONTRACT_STEP_MICRO } from "@winz/shared";
import { describe, expect, it } from "vitest";

import { HOUR_MS, SYM, Scenario, T0, c, level } from "./test-support";

const U_MAX = 300_000_000n;

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** A thin book (one contract of ask a book) and 1 000 contracts of exposure: trips at T0 + 6 s. */
async function tripOnUnhedgedLimit(s: Scenario): Promise<void> {
  await s.runner.start();
  await s.book([level(4800, 2000)], [level(5000, 1)]);
  await s.exposure(c(1000));
  await s.advance(6_000);
  expect(s.runner.getBreaker()).toMatchObject({ active: true, reason: "unhedged_limit" });
}

describe("PolicyRunner · unhedged_limit recovery with the same exposure", () => {
  it("resets once liquidity has been back for the quiet period, then buys the excess at once", async () => {
    const s = new Scenario();
    await tripOnUnhedgedLimit(s);
    const placedAtTrip = s.venue.placed.length;

    // Still thin: the breaker holds, nothing is placed (HE-5).
    await s.advance(5_000);
    expect(s.runner.isBreakerActive()).toBe(true);
    expect(s.venue.placed).toHaveLength(placedAtTrip);

    // Liquidity comes back, exposure unchanged.
    await s.book([level(4800, 2000)], [level(5000, 5000)]);
    const backAt = s.nowMs;
    await s.advance(9_000);
    expect(s.runner.isBreakerActive()).toBe(true);
    expect(s.venue.placed).toHaveLength(placedAtTrip);

    await s.advance(1_000);
    expect(s.runner.isBreakerActive()).toBe(false);
    expect(s.sink.ofType("breaker_reset")).toEqual([
      expect.objectContaining({ atMs: backAt + 10_000 }),
    ]);
    // The reset cycle bought the excess taker and rested the rest maker: back at uMax.
    const after = s.venue.placed.slice(placedAtTrip);
    expect(after.map((r) => r.kind)).toEqual(["taker", "maker"]);
    expect(s.runner.snapshot().unhedgedNotional).toBeLessThanOrEqual(U_MAX);
    expect(s.runner.snapshot().held).toBe(s.venueHeld());

    // No new trip afterwards; the maker's TTL then completes the hedge.
    await s.advance(95_000);
    expect(s.sink.ofType("breaker_tripped")).toHaveLength(1);
    expect(s.venueHeld()).toBe(c(1000));
  });

  it("stays active while the book stays too thin to cure the excess", async () => {
    const s = new Scenario();
    await tripOnUnhedgedLimit(s);
    const placedAtTrip = s.venue.placed.length;
    // 300 contracts: not enough to bring ~994 contracts at $0.50 under $300.
    await s.book([level(4800, 2000)], [level(5000, 300)]);
    await s.advance(60_000);
    expect(s.runner.getBreaker()).toMatchObject({ active: true, reason: "unhedged_limit" });
    expect(s.venue.placed).toHaveLength(placedAtTrip);
    expect(s.sink.ofType("breaker_reset")).toEqual([]);
  });

  it("keeps a reconciliation pending while tripped and completes it after the reset", async () => {
    const s = new Scenario();
    await tripOnUnhedgedLimit(s);
    const outcome = await s.runner.reconcile();
    expect(outcome.attempted).toBe(false);
    expect(s.runner.snapshot().reconcilePending).toBe(true);

    await s.book([level(4800, 2000)], [level(5000, 5000)]);
    await s.advance(10_000);
    expect(s.runner.isBreakerActive()).toBe(false);
    expect(s.runner.snapshot().reconcilePending).toBe(false);
    expect(abs(s.venueHeld() - c(1000))).toBeLessThanOrEqual(CONTRACT_STEP_MICRO);
    expect(s.sink.ofType("order_placed").at(-1)?.reason).toBe("reconcile");
  });
});

describe("PolicyRunner · restore races", () => {
  async function firstRunnerWithMaker(): Promise<Scenario> {
    const first = new Scenario();
    await first.runner.start();
    await first.book([level(4800, 500)], [level(5000, 500)]);
    await first.exposure(c(10));
    await first.runner.stop();
    return first;
  }

  function secondRunner(first: Scenario): Scenario {
    return new Scenario({
      paper: first.paper,
      clock: first.clock,
      restore: {
        exposure: c(10),
        held: 0n,
        nextOrderSeq: 2,
        unsettledOrders: [{ clientOrderId: "hedge-1", recordedFilledQty: 0n }],
      },
    });
  }

  it("counts once a fill that arrives while the restore looks the order up", async () => {
    const first = await firstRunnerWithMaker();
    const second = secondRunner(first);
    let printed = false;
    second.venue.beforeGetOrder = (): void => {
      if (printed) return;
      printed = true;
      first.paper.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(4), atMs: T0 });
    };
    await second.book([level(4800, 500)], [level(5000, 500)]);
    await second.runner.start();

    expect(second.venueHeld()).toBe(c(4));
    expect(second.runner.snapshot().held).toBe(c(4));
    expect(second.sink.ofType("fill").map((e) => [e.fill.qty, e.countedQty])).toEqual([
      [c(4), c(4)],
    ]);
    expect(second.sink.ofType("position_recovered")).toEqual([]);
    expect(second.runner.snapshot().working).toBe(c(6));
  });

  it("recovers the fills missed while down and counts the one during the restore once", async () => {
    const first = await firstRunnerWithMaker();
    first.paper.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(2), atMs: T0 });
    const second = secondRunner(first);
    let printed = false;
    second.venue.beforeGetOrder = (): void => {
      if (printed) return;
      printed = true;
      first.paper.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(3), atMs: T0 });
    };
    await second.book([level(4800, 500)], [level(5000, 500)]);
    await second.runner.start();

    expect(second.runner.snapshot().held).toBe(c(5));
    expect(second.sink.ofType("fill").map((e) => e.countedQty)).toEqual([c(3)]);
    expect(second.sink.ofType("position_recovered").map((e) => e.qty)).toEqual([c(2)]);
  });

  it("does not count again a fill whose event arrives after the snapshot that recovered it", async () => {
    const first = await firstRunnerWithMaker();
    const second = secondRunner(first);
    second.venue.holdEvents = true;
    second.venue.beforeGetOrder = (): void => {
      first.paper.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(4), atMs: T0 });
      second.venue.beforeGetOrder = null;
    };
    await second.book([level(4800, 500)], [level(5000, 500)]);
    await second.runner.start();
    expect(second.sink.ofType("position_recovered").map((e) => e.qty)).toEqual([c(4)]);
    expect(second.runner.snapshot().held).toBe(c(4));

    second.venue.releaseEvents();
    await second.runner.onTick();
    expect(second.runner.snapshot().held).toBe(c(4));
    expect(second.sink.ofType("fill").map((e) => [e.fill.qty, e.countedQty])).toEqual([[c(4), 0n]]);
    expect(second.venueHeld()).toBe(c(4));
  });
});

describe("PolicyRunner · before start", () => {
  it("records books, exposure, trades and ticks but places nothing until started", async () => {
    const s = new Scenario({ restore: { exposure: c(10), held: 0n, nextOrderSeq: 1 } });
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));
    await s.trade(4900, 4);
    await s.runner.onTick();
    expect(await s.runner.reconcile()).toMatchObject({ attempted: false });
    expect(s.venue.calls).toEqual({ place: 0, cancel: 0, get: 0, list: 0 });
    expect(s.sink.events).toEqual([]);

    await s.runner.start();
    // The reconciliation requested before start runs on the first cycle: taker for E.
    expect(s.venue.placed).toEqual([
      expect.objectContaining({ clientOrderId: "hedge-1", kind: "taker", qty: c(10) }),
    ]);
    expect(s.runner.snapshot().held).toBe(c(10));
  });

  it("never buys beyond E when a print would have filled a maker placed before start", async () => {
    const s = new Scenario({ restore: { exposure: c(10), held: 0n, nextOrderSeq: 1 } });
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.trade(4900, 4);
    await s.runner.start();
    expect(s.venue.placed).toEqual([
      expect.objectContaining({ clientOrderId: "hedge-1", kind: "maker", qty: c(10) }),
    ]);
    await s.advance(95_000);
    const outcome = await s.runner.reconcile();
    expect(outcome).toMatchObject({ attempted: true, withinOneStep: true });
    expect(s.venueHeld()).toBe(c(10));
    expect(s.runner.snapshot().held).toBe(s.venueHeld());
  });
});

describe("PolicyRunner · execution guards", () => {
  it("caps a taker by what fills that landed during the cycle's cancels left to buy", async () => {
    const s = new Scenario({ eventStartMs: T0 + HOUR_MS + 40_000 });
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));
    await s.advance(20_000);
    await s.exposure(c(15));
    await s.advance(20_000);
    expect(await s.venueWorking()).toBe(c(15));

    // The 60-minute line: both makers are cancelled, then a taker for 15 is decided. During the
    // first cancel a print fills 5 contracts of a maker.
    let printed = false;
    s.venue.beforeCancel = (): void => {
      if (printed) return;
      printed = true;
      s.paper.onTrade({ instrumentSymbol: SYM, priceBps: 4900n, qty: c(5), atMs: s.nowMs });
    };
    await s.advance(1_000);
    expect(printed).toBe(true);
    const taker = s.venue.placed.filter((r) => r.kind === "taker");
    expect(taker.map((r) => r.qty)).toEqual([c(10)]);
    expect(s.venueHeld()).toBe(c(15));
    expect(s.runner.snapshot().held).toBe(c(15));
  });

  it("sizes a TTL replacement by what the cancel left, even before the fill events arrive", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    await s.exposure(c(10));
    await s.advance(50_000);

    // The venue's events lag: a print fills 4 contracts, the runner does not know it yet.
    s.venue.holdEvents = true;
    await s.trade(4900, 4);
    await s.advance(40_000);
    expect(s.sink.ofType("order_cancelled")[0]?.reason).toBe("ttl_expired");
    const taker = s.venue.placed.filter((r) => r.kind === "taker");
    expect(taker.map((r) => r.qty)).toEqual([c(6)]);

    s.venue.releaseEvents();
    await s.runner.onTick();
    expect(s.venueHeld()).toBe(c(10));
    expect(s.runner.snapshot().held).toBe(c(10));
  });

  it("stops placing within a cycle once the venue has failed enough to trip the breaker", async () => {
    const s = new Scenario();
    await s.runner.start();
    await s.book([level(4800, 2000)], [level(5000, 2000)]);
    // First failure: the maker for 10 is left unconfirmed.
    s.venue.failNextPlaces = 1;
    await s.exposure(c(10));
    expect(s.runner.getBreaker()).toMatchObject({ active: false, consecutiveVenueFailures: 1 });

    // One cycle: the lookup of the unconfirmed maker fails (second failure, no trip yet), then
    // [taker 400 for the uMax excess, maker 590] is decided and the taker fails (third). The
    // venue would accept the maker, but a venue failing three times in a row is not hammered.
    s.venue.failNextGets = 1;
    s.venue.failNextPlaces = 1;
    await s.exposure(c(1000));
    expect(s.venue.calls.place).toBe(2);
    expect(s.venue.placed).toEqual([]);
    expect(s.sink.ofType("order_unconfirmed")).toHaveLength(2);
    expect(s.runner.getBreaker()).toMatchObject({ active: true, reason: "venue_down" });
  });

  it("buys no taker over makers whose cancel failed", async () => {
    const s = new Scenario({ eventStartMs: T0 + HOUR_MS + 40_000 });
    await s.runner.start();
    await s.book([level(4800, 500)], [level(5000, 500)]);
    for (const exposure of [5, 10, 15]) {
      await s.exposure(c(exposure));
      await s.advance(10_000);
    }
    expect(s.venue.placed.map((r) => [r.kind, r.qty])).toEqual([
      ["maker", c(5)],
      ["maker", c(5)],
      ["maker", c(5)],
    ]);
    await s.advance(10_000);

    // The 60-minute line: three cancels fail in the cycle, the venue would accept the taker.
    s.venue.failNextCancels = 3;
    await s.advance(1_000);
    expect(s.venue.placed.filter((r) => r.kind === "taker")).toEqual([]);
    expect(s.runner.getBreaker()).toMatchObject({ active: true, reason: "venue_down" });
    expect(s.venueHeld()).toBe(0n);
  });
});
