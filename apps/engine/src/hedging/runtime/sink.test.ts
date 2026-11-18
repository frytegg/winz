/**
 * The persistence of the policy events on a real Postgres: orders, fills with their allocation
 * and the position in one transaction, idempotent on the venue's fill id, and events that cannot
 * be written yet kept in order and retried.
 */
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MicroContracts } from "@winz/shared";

import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import type { VenueFill, VenueOrder } from "../../venues";
import { heldInventoryOf } from "../allocation";
import {
  createCampaign,
  createLot,
  createMarket,
  type MarketFixture,
} from "../allocation/test-support";
import type { PolicyEvent } from "../policy";
import { PositionEventsPendingError } from "./errors";
import { PgPolicySink, type FillRecorded } from "./sink";

const C = 1_000_000n;
const logger = pino({ level: "silent" });

let database: TestDatabase;
let market: MarketFixture;

beforeEach(async () => {
  database = await createTestDatabase();
  market = await createMarket(database.db);
});
afterEach(async () => {
  await database.drop();
});

function intent(
  clientOrderId: string,
  qty: MicroContracts,
  side: "buy" | "sell" = "buy",
  instrument: string = market.instrument,
): PolicyEvent {
  return {
    type: "order_intent",
    atMs: Date.now(),
    instrumentSymbol: instrument,
    request: {
      clientOrderId,
      instrumentSymbol: instrument,
      side,
      kind: "maker",
      limitPriceBps: 4100n,
      qty,
    },
    reason: "maker",
  };
}

function venueOrder(
  clientOrderId: string,
  qty: MicroContracts,
  filledQty: MicroContracts,
  status: VenueOrder["status"],
): VenueOrder {
  return {
    clientOrderId,
    venueOrderId: `paper-${clientOrderId}`,
    instrumentSymbol: market.instrument,
    side: "buy",
    kind: "maker",
    limitPriceBps: 4100n,
    qty,
    filledQty,
    feePaid: 0n,
    status,
    rejectReason: null,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
}

function fillEvent(
  clientOrderId: string,
  fillId: string,
  qty: MicroContracts,
  side: "buy" | "sell" = "buy",
  priceBps = 4100n,
  fee = 0n,
): PolicyEvent {
  const fill: VenueFill = {
    fillId,
    clientOrderId,
    instrumentSymbol: market.instrument,
    side,
    kind: "maker",
    priceBps,
    qty,
    fee,
    atMs: Date.now(),
    bookRef: {
      source: "trade",
      instrumentSymbol: market.instrument,
      printPriceBps: priceBps,
      printedQty: qty,
      allocatedBeforeQty: 0n,
      printedAtMs: Date.now(),
      limitPriceBps: priceBps,
      orderRemainingQty: qty,
      makerFeeWaived: true,
    },
  };
  return {
    type: "fill",
    atMs: Date.now(),
    instrumentSymbol: market.instrument,
    fill,
    countedQty: qty,
  };
}

describe("PgPolicySink", () => {
  it("records a fill with its allocation and position once, however often it is delivered", async () => {
    const db = database.db;
    const campaign = await createCampaign(db, market);
    await createLot(db, market, campaign, 5n * C, 2_500_000n);
    const recorded: FillRecorded[] = [];
    const sink = new PgPolicySink({
      db,
      venue: "paper",
      logger,
      onFillRecorded: (e) => recorded.push(e),
    });

    await sink.record(intent("wz.t-1", 5n * C));
    await sink.record(intent("wz.t-1", 5n * C)); // the intent again: still one row
    const fill = fillEvent("wz.t-1", "fill-1", 5n * C);
    await sink.record(fill);
    await sink.record(fill);

    const orders = await db<
      { status: string; filled_qty: bigint; venue_order_id: string; venue: string }[]
    >`
      select status, filled_qty, venue_order_id, venue from orders
    `;
    // The fill that completes the order closes it in the same transaction, before the venue's
    // own order update arrives.
    expect(orders).toEqual([
      { status: "filled", filled_qty: 5n * C, venue_order_id: "wz.t-1", venue: "paper" },
    ]);
    const fills = await db<{ qty: bigint }[]>`select qty from fills`;
    expect(fills).toEqual([{ qty: 5n * C }]);
    const [lot] = await db<
      { filled_qty: bigint; cost: bigint }[]
    >`select filled_qty, cost from lots`;
    expect(lot).toEqual({ filled_qty: 5n * C, cost: 2_050_000n });
    const [position] = await db<{ held: bigint }[]>`select held from positions`;
    expect(position?.held).toBe(5n * C);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.result.coveredLots).toHaveLength(1);

    // The order closes; a late, older update never reopens it.
    await sink.record({
      type: "order_updated",
      atMs: Date.now(),
      instrumentSymbol: market.instrument,
      order: venueOrder("wz.t-1", 5n * C, 5n * C, "filled"),
    });
    await sink.record({
      type: "order_updated",
      atMs: Date.now(),
      instrumentSymbol: market.instrument,
      order: venueOrder("wz.t-1", 5n * C, 0n, "working"),
    });
    const [closed] = await db<
      { status: string; filled_qty: bigint }[]
    >`select status, filled_qty from orders`;
    expect(closed).toEqual({ status: "filled", filled_qty: 5n * C });
  });

  it("moves an order's status with its fills, and never out of a final status", async () => {
    const db = database.db;
    const sink = new PgPolicySink({ db, venue: "paper", logger });
    const orderOf = async (
      clientOrderId: string,
    ): Promise<{ status: string; filled_qty: bigint } | undefined> => {
      const [row] = await db<{ status: string; filled_qty: bigint }[]>`
        select status, filled_qty from orders where venue_order_id = ${clientOrderId}
      `;
      return row;
    };

    // No order update from the venue in between: the fills alone carry the status, so a crash
    // right after a fill leaves the order as it really is.
    await sink.record(intent("wz.t-20", 5n * C));
    await sink.record(fillEvent("wz.t-20", "fill-20a", 2n * C));
    expect(await orderOf("wz.t-20")).toEqual({ status: "partially_filled", filled_qty: 2n * C });
    await sink.record(fillEvent("wz.t-20", "fill-20b", 3n * C));
    expect(await orderOf("wz.t-20")).toEqual({ status: "filled", filled_qty: 5n * C });

    // A fill that reaches an order already cancelled is counted; the order stays cancelled.
    await sink.record(intent("wz.t-21", 5n * C));
    await sink.record({
      type: "order_cancelled",
      atMs: Date.now(),
      instrumentSymbol: market.instrument,
      order: venueOrder("wz.t-21", 5n * C, 0n, "cancelled"),
      reason: "ttl_expired",
    });
    await sink.record(fillEvent("wz.t-21", "fill-21a", 1n * C));
    expect(await orderOf("wz.t-21")).toEqual({ status: "cancelled", filled_qty: 1n * C });
  });

  it("keeps an event it cannot write yet, with those after it, and writes them in order later", async () => {
    const db = database.db;
    const sink = new PgPolicySink({ db, venue: "paper", logger });
    // A fill of an order the database does not hold yet (written by hand below).
    await sink.record(fillEvent("wz.t-7", "fill-a", 2n * C));
    await sink.record(fillEvent("wz.t-7", "fill-b", 1n * C));
    expect(sink.pendingCount(market.instrument)).toBe(2);
    expect(sink.pendingCount()).toBe(2);
    expect(await db`select 1 from fills`).toHaveLength(0);
    // While a fill is unwritten, no new order of the instrument may be placed.
    await expect(sink.record(intent("wz.t-8", 1n * C))).rejects.toBeInstanceOf(
      PositionEventsPendingError,
    );

    await db`
      insert into orders (instrument, side, kind, price_bps, qty, filled_qty, status, venue,
                          venue_order_id)
      values (${market.instrument}, 'buy', 'maker', 4100, ${(5n * C).toString()}::bigint, 0,
              'working', 'paper', 'wz.t-7')
    `;
    await sink.retryPending({ force: true });
    expect(sink.pendingCount()).toBe(0);
    const fills = await db<
      { venue_fill_id: string }[]
    >`select venue_fill_id from fills order by created_at`;
    expect(fills.map((f) => f.venue_fill_id)).toEqual(["fill-a", "fill-b"]);
    const [position] = await db<{ held: bigint }[]>`select held from positions`;
    // No lot exists: the 3 contracts are held as inventory.
    expect(position?.held).toBe(3n * C);
    // Written: orders are accepted again.
    await sink.record(intent("wz.t-8", 1n * C));
  });

  it("never drops a fill during a long database outage, and blocks new orders until it is written", async () => {
    const db = database.db;
    const campaign = await createCampaign(db, market);
    await createLot(db, market, campaign, 5n * C, 2_500_000n);
    let nowMs = 1_000_000;
    const sink = new PgPolicySink({
      db,
      venue: "paper",
      logger,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      nowMs: () => nowMs,
    });
    await sink.record(intent("wz.t-1", 5n * C));

    await db`alter table fills rename to fills_outage`;
    try {
      await sink.record(fillEvent("wz.t-1", "fill-1", 5n * C));
      expect(sink.pendingCount()).toBe(1);
      // Far more failures than any fixed attempt limit, over 10 minutes of backoff.
      for (let i = 0; i < 120; i += 1) {
        nowMs += 5_000;
        await sink.retryPending();
        await sink.retryPending({ force: true });
      }
      expect(sink.pendingCount()).toBe(1);
      expect(sink.stuckPositionEvents(market.instrument)).toBe(1);
      await expect(sink.record(intent("wz.t-2", 1n * C))).rejects.toBeInstanceOf(
        PositionEventsPendingError,
      );
      // A backoff is honoured: a retry before it is over does not touch the database.
      await sink.retryPending();
    } finally {
      await db`alter table fills_outage rename to fills`;
    }

    nowMs += 1_000;
    await sink.retryPending();
    expect({ pending: sink.pendingCount(), fills: (await db`select 1 from fills`).length }).toEqual(
      { pending: 0, fills: 1 },
    );
    const [lot] = await db<{ filled_qty: bigint; cost: bigint }[]>`
      select filled_qty, cost from lots
    `;
    expect(lot).toEqual({ filled_qty: 5n * C, cost: 2_050_000n });
    const [position] = await db<{ held: bigint }[]>`select held from positions`;
    expect(position?.held).toBe(5n * C);
    expect(sink.stuckPositionEvents(market.instrument)).toBe(0);
    await sink.record(intent("wz.t-2", 1n * C));
    const orders = await db<{ venue_order_id: string }[]>`
      select venue_order_id from orders order by venue_order_id
    `;
    expect(orders.map((o) => o.venue_order_id)).toEqual(["wz.t-1", "wz.t-2"]);
  });

  it("adds the result of a resale to engine_pnl.resale_result", async () => {
    const db = database.db;
    const sink = new PgPolicySink({ db, venue: "paper", logger });
    await sink.record(intent("wz.t-1", 4n * C));
    await sink.record(fillEvent("wz.t-1", "buy-1", 4n * C, "buy", 4000n));
    await sink.record(intent("wz.t-2", 3n * C, "sell"));
    await sink.record(fillEvent("wz.t-2", "sell-1", 3n * C, "sell", 4500n));
    await sink.record(fillEvent("wz.t-2", "sell-1", 3n * C, "sell", 4500n));
    const [pnl] = await db<{ resale_result: bigint }[]>`
      select resale_result from engine_pnl where event_ticker = ${market.eventTicker}
    `;
    expect(pnl?.resale_result).toBe(1_350_000n - 1_200_000n);
    const [position] = await db<{ held: bigint }[]>`select held from positions`;
    expect(position?.held).toBe(1n * C);
  });

  it("books a buy that replaces an over-sale on the resales: proceeds − cost basis − replacement cost", async () => {
    const db = database.db;
    const campaign = await createCampaign(db, market);
    await createLot(db, market, campaign, 1n * C, 1_000_000n);
    const recorded: FillRecorded[] = [];
    const sink = new PgPolicySink({
      db,
      venue: "paper",
      logger,
      onFillRecorded: (e) => recorded.push(e),
    });

    // 3 contracts at $0.41, fee 7: 1 230 007. The lot takes one: ceil(1 230 007 / 3) = 410 003.
    await sink.record(intent("wz.t-1", 3n * C));
    await sink.record(fillEvent("wz.t-1", "buy-1", 3n * C, "buy", 4100n, 7n));
    // 5 sold at $0.45, fee 3, while 2 were held: proceeds 2 249 997, cost basis 820 004 (what
    // the 2 held still carried), 3 over-sold.
    await sink.record(intent("wz.t-2", 5n * C, "sell"));
    await sink.record(fillEvent("wz.t-2", "sell-1", 5n * C, "sell", 4500n, 3n));
    const resaleResult = async (): Promise<bigint | undefined> => {
      const [row] = await db<{ resale_result: bigint }[]>`
        select resale_result from engine_pnl where event_ticker = ${market.eventTicker}
      `;
      return row?.resale_result;
    };
    expect(await resaleResult()).toBe(2_249_997n - 820_004n);

    // 4 bought at $0.37, fee 5: 1 480 005. 3 replace the over-sale: ceil(1 480 005 × 3 / 4) =
    // 1 110 004; 1 stays in inventory at 370 001.
    await sink.record(intent("wz.t-3", 4n * C));
    const replacement = fillEvent("wz.t-3", "buy-2", 4n * C, "buy", 3700n, 5n);
    await sink.record(replacement);
    await sink.record(replacement); // delivered twice: booked once
    expect(recorded).toHaveLength(3);
    expect(recorded[1]?.result.sale).toMatchObject({
      proceeds: 2_249_997n,
      costBasis: 820_004n,
      shortQty: 3n * C,
    });
    expect(recorded[2]?.result.replacedShort).toEqual({ qty: 3n * C, cost: 1_110_004n });

    expect(await resaleResult()).toBe(2_249_997n - 820_004n - 1_110_004n);
    expect(await resaleResult()).toBe(319_989n);

    // Every micro-USDC the buy fills cost is somewhere: the lot, the resale's cost basis, the
    // replacement, the inventory.
    const paid = 1_230_007n + 1_480_005n;
    const [lot] = await db<
      { cost: bigint; filled_qty: bigint }[]
    >`select cost, filled_qty from lots`;
    expect(lot).toEqual({ cost: 410_003n, filled_qty: 1n * C });
    const inventory = await heldInventoryOf(db, market.instrument);
    expect(inventory).toEqual({ qty: 1n * C, cost: 370_001n, shortQty: 0n });
    expect(410_003n + 820_004n + 1_110_004n + inventory.cost).toBe(paid);
  });

  it("refuses to place an order whose intent cannot be written", async () => {
    const sink = new PgPolicySink({ db: database.db, venue: "paper", logger });
    await expect(
      sink.record(intent("wz.t-1", 5n * C, "buy", "NO-SUCH-INSTRUMENT")),
    ).rejects.toThrow();
  });
});
