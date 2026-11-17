import { afterEach, beforeEach, describe, expect, it } from "vitest";

import pino from "pino";
import { decodeFunctionData } from "viem";

import { winzEscrowAbi } from "@winz/shared";

import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import type { BookLevelsRef } from "../../venues/types";
import { fillCost } from "./core";
import { FillConflictError, FillOrderMismatchError } from "./errors";
import {
  allocateHeldInventory,
  allocateHeldInventoryForOpenLots,
  CHARGE_HEDGE_TX_KIND,
  chargeHedgeTxRequest,
  heldInventoryOf,
  pendingCharges,
  recordFill,
  type RecordFillInput,
} from "./store";
import {
  createCampaign,
  createLot,
  createMarket,
  createOrder,
  lotStates,
  markChargedAsProjectionWould,
  SeededRandom,
  type LotFixture,
  type MarketFixture,
} from "./test-support";

const CONTRACT = 1_000_000n;
const ESCROW = "0x00000000000000000000000000000000000000e5";

let database: TestDatabase;
let market: MarketFixture;
let fillCounter = 0;

beforeEach(async () => {
  database = await createTestDatabase();
  market = await createMarket(database.db);
});
afterEach(async () => {
  await database.drop();
});

function fill(
  orderId: string,
  priceBps: bigint,
  qty: bigint,
  fee = 0n,
  extra: Partial<RecordFillInput> = {},
): RecordFillInput {
  fillCounter += 1;
  return {
    orderId,
    venueFillId: `vf-${fillCounter.toString()}`,
    priceBps,
    qty,
    fee,
    at: new Date("2026-11-17T12:00:00Z"),
    bookRef: null,
    ...extra,
  };
}

async function counts(): Promise<{ fills: bigint; lotFills: bigint; pnl: bigint; filled: bigint }> {
  const [row] = await database.db<
    { fills: bigint; lot_fills: bigint; pnl: bigint; filled: bigint }[]
  >`
    select (select count(*) from fills)::bigint as fills,
           (select count(*) from lot_fills)::bigint as lot_fills,
           (select count(*) from engine_pnl)::bigint as pnl,
           (select coalesce(sum(filled_qty), 0) from lots)::bigint as filled
  `;
  if (row === undefined) throw new Error("no counts");
  return { fills: row.fills, lotFills: row.lot_fills, pnl: row.pnl, filled: row.filled };
}

async function enginePnl(): Promise<
  { maker_savings: bigint; guarantee_losses: bigint } | undefined
> {
  const [row] = await database.db<{ maker_savings: bigint; guarantee_losses: bigint }[]>`
    select maker_savings, guarantee_losses from engine_pnl where event_ticker = ${market.eventTicker}
  `;
  return row;
}

describe("recordFill", () => {
  it("allocates a buy fill to the open lots in FIFO order and returns the lots it covered", async () => {
    const a = await createCampaign(database.db, market);
    const lot1 = await createLot(database.db, market, a, 400_000n, 250_000n);
    const lot2 = await createLot(database.db, market, a, 400_000n, 250_000n);
    const order = await createOrder(database.db, market, "buy");

    const result = await recordFill(database.db, fill(order, 5000n, 600_000n, 600n)); // 300 600
    if (result.status !== "recorded") throw new Error("expected recorded");
    expect(result.cost).toBe(300_600n);
    expect(result.allocations.map((x) => [x.lotId, x.qty, x.cost])).toEqual([
      [lot1.lotId, 400_000n, 200_400n],
      [lot2.lotId, 200_000n, 100_200n],
    ]);
    expect(result.coveredLots).toEqual([
      expect.objectContaining({
        lotId: lot1.lotId,
        ticketId: lot1.ticketId,
        amount: 200_400n,
        guaranteeLoss: 0n,
      }),
    ]);
    expect(result.inventory).toEqual({ qty: 0n, cost: 0n, shortQty: 0n });
    const lots = await lotStates(database.db, market.instrument);
    expect(lots.map((l) => [l.filled_qty, l.cost])).toEqual([
      [400_000n, 200_400n],
      [200_000n, 100_200n],
    ]);
  });

  it("is idempotent: the same venue fill id twice changes nothing", async () => {
    const a = await createCampaign(database.db, market);
    await createLot(database.db, market, a, CONTRACT, 600_000n);
    const order = await createOrder(database.db, market, "buy");
    const input = fill(order, 5000n, 500_000n, 100n);

    const first = await recordFill(database.db, input);
    const before = await counts();
    const lotsBefore = await lotStates(database.db, market.instrument);
    const second = await recordFill(database.db, input);

    expect(first.status).toBe("recorded");
    expect(second).toEqual({ status: "duplicate", fillId: first.fillId });
    expect(await counts()).toEqual(before);
    expect(await lotStates(database.db, market.instrument)).toEqual(lotsBefore);
    await expect(recordFill(database.db, { ...input, qty: 400_000n })).rejects.toThrow(
      FillConflictError,
    );
  });

  it("writes nothing when it fails mid-way: the fill and its allocation are one transaction", async () => {
    const a = await createCampaign(database.db, market);
    await createLot(database.db, market, a, CONTRACT, 600_000n);
    const order = await createOrder(database.db, market, "buy");
    const lotsBefore = await lotStates(database.db, market.instrument);

    let sawFill = false;
    await expect(
      recordFill(database.db, fill(order, 5000n, CONTRACT), {
        afterFillInsert: async (tx) => {
          const [row] = await tx<{ n: bigint }[]>`select count(*)::bigint as n from fills`;
          sawFill = row?.n === 1n;
          throw new Error("crash between the fill insert and the allocation");
        },
      }),
    ).rejects.toThrow("crash between");

    expect(sawFill).toBe(true);
    expect(await counts()).toEqual({ fills: 0n, lotFills: 0n, pnl: 0n, filled: 0n });
    expect(await lotStates(database.db, market.instrument)).toEqual(lotsBefore);
  });

  it("refuses a fill of an unknown order or beyond its order's quantity, and writes nothing", async () => {
    const order = await createOrder(database.db, market, "buy", { qty: 100_000n });
    await expect(
      recordFill(database.db, fill("00000000-0000-0000-0000-000000000000", 5000n, 10_000n)),
    ).rejects.toThrow(FillOrderMismatchError);
    await recordFill(database.db, fill(order, 5000n, 60_000n));
    await expect(recordFill(database.db, fill(order, 5000n, 50_000n))).rejects.toThrow(
      FillOrderMismatchError,
    );
    expect((await counts()).fills).toBe(1n);
  });

  it("keeps a fill larger than the open lots as inventory, which covers a lot created later", async () => {
    const a = await createCampaign(database.db, market);
    const b = await createCampaign(database.db, market);
    await createLot(database.db, market, a, 300_000n, 200_000n);
    const order = await createOrder(database.db, market, "buy");

    const recorded = await recordFill(database.db, fill(order, 5000n, CONTRACT, 2_000n)); // 502 000
    if (recorded.status !== "recorded") throw new Error("expected recorded");
    expect(recorded.inventory).toEqual({ qty: 700_000n, cost: 351_400n, shortQty: 0n });
    expect(await heldInventoryOf(database.db, market.instrument)).toEqual({
      qty: 700_000n,
      cost: 351_400n,
      shortQty: 0n,
    });

    const later = await createLot(database.db, market, b, 500_000n, 300_000n);
    const outcome = await allocateHeldInventory(database.db, market.instrument);
    expect(outcome.allocations.map((x) => [x.lotId, x.qty, x.cost])).toEqual([
      [later.lotId, 500_000n, 251_000n],
    ]);
    expect(outcome.coveredLots.map((x) => x.lotId)).toEqual([later.lotId]);
    expect(outcome.inventory).toEqual({ qty: 200_000n, cost: 100_400n, shortQty: 0n });

    // A lot arriving after that is covered by the next fill: inventory first, then the fill.
    const third = await createLot(database.db, market, a, 400_000n, 300_000n);
    const next = await recordFill(database.db, fill(order, 6000n, 200_000n));
    if (next.status !== "recorded") throw new Error("expected recorded");
    expect(next.allocations.map((x) => [x.lotId, x.qty, x.cost])).toEqual([
      [third.lotId, 200_000n, 100_400n],
      [third.lotId, 200_000n, 120_000n],
    ]);
    const lots = await lotStates(database.db, market.instrument);
    const total = lots.reduce((t, l) => t + l.cost, 0n);
    expect(total).toBe(502_000n + 120_000n);
  });

  it("a sell fill reduces the inventory and never touches a lot", async () => {
    const a = await createCampaign(database.db, market);
    await createLot(database.db, market, a, 300_000n, 200_000n);
    const buyOrder = await createOrder(database.db, market, "buy");
    const sellOrder = await createOrder(database.db, market, "sell");
    await recordFill(database.db, fill(buyOrder, 5000n, CONTRACT)); // 500 000, 700 000 held
    const lotsBefore = await lotStates(database.db, market.instrument);

    const sale = await recordFill(database.db, fill(sellOrder, 5500n, 400_000n, 100n));
    if (sale.status !== "recorded") throw new Error("expected recorded");
    expect(sale.allocations).toEqual([]);
    expect(sale.sale).toEqual({
      proceeds: 219_900n,
      costBasis: 200_000n,
      result: 19_900n,
      shortQty: 0n,
    });
    expect(sale.inventory).toEqual({ qty: 300_000n, cost: 150_000n, shortQty: 0n });
    expect(await heldInventoryOf(database.db, market.instrument)).toEqual({
      qty: 300_000n,
      cost: 150_000n,
      shortQty: 0n,
    });
    expect(await lotStates(database.db, market.instrument)).toEqual(lotsBefore);
    const [lotFills] = await database.db<
      { n: bigint }[]
    >`select count(*)::bigint as n from lot_fills`;
    expect(lotFills?.n).toBe(1n);
  });

  it("a sale decided before a late lot arrived is recorded first: the sold contracts never cover that lot", async () => {
    // The verifier's sequence: 1.0 bought, lot A of 0.3 covered, 0.7 held; the reconciliation
    // sells the 0.7 surplus, and a late TicketPurchased creates lot B of 0.5 before the venue's
    // sell fill is recorded.
    const a = await createCampaign(database.db, market);
    const b = await createCampaign(database.db, market);
    const lotA = await createLot(database.db, market, a, 300_000n, 200_000n);
    const buyOrder = await createOrder(database.db, market, "buy");
    const sellOrder = await createOrder(database.db, market, "sell");
    await recordFill(database.db, fill(buyOrder, 5000n, CONTRACT));
    const lotB = await createLot(database.db, market, b, 500_000n, 300_000n);

    const sale = await recordFill(database.db, fill(sellOrder, 5000n, 700_000n));
    if (sale.status !== "recorded") throw new Error("expected recorded");
    expect(sale.sale).toEqual({
      proceeds: 350_000n,
      costBasis: 350_000n,
      result: 0n,
      shortQty: 0n,
    });
    expect(sale.allocations).toEqual([]);
    expect(sale.inventory).toEqual({ qty: 0n, cost: 0n, shortQty: 0n });

    // Nothing is left to cover B: it waits for a real buy, and is not charged meanwhile.
    expect((await allocateHeldInventory(database.db, market.instrument)).allocations).toEqual([]);
    const states = await lotStates(database.db, market.instrument);
    expect(states.map((l) => [l.id, l.filled_qty, l.cost])).toEqual([
      [lotA.lotId, 300_000n, 150_000n],
      [lotB.lotId, 0n, 0n],
    ]);
    const batches = await pendingCharges(database.db, { limit: 10 });
    expect(batches.flatMap((x) => x.ticketIds)).toEqual([lotA.ticketOnchainId]);
    expect(batches.flatMap((x) => x.amounts)).toEqual([150_000n]);

    // The buy the policy then places covers B at its own price.
    const next = await recordFill(database.db, fill(buyOrder, 6000n, 500_000n));
    if (next.status !== "recorded") throw new Error("expected recorded");
    expect(next.coveredLots.map((l) => [l.lotId, l.amount])).toEqual([[lotB.lotId, 300_000n]]);
    expect(next.inventory).toEqual({ qty: 0n, cost: 0n, shortQty: 0n });
  });

  it("records a sale beyond the unallocated inventory as a short, logs it, and has the next buy replace it", async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: "info" },
      { write: (line: string): void => void lines.push(line) },
    );
    const a = await createCampaign(database.db, market);
    const b = await createCampaign(database.db, market);
    const lotA = await createLot(database.db, market, a, 300_000n, 200_000n);
    const buyOrder = await createOrder(database.db, market, "buy");
    const sellOrder = await createOrder(database.db, market, "sell");
    await recordFill(database.db, fill(buyOrder, 5000n, CONTRACT)); // A covered, 0.7 held

    // The venue sold 1.0: 0.3 more than was held unallocated. It happened: it is recorded.
    const sale = await recordFill(database.db, fill(sellOrder, 5000n, CONTRACT), { logger });
    if (sale.status !== "recorded") throw new Error("expected recorded");
    expect(sale.sale).toEqual({
      proceeds: 500_000n,
      costBasis: 350_000n,
      result: 150_000n,
      shortQty: 300_000n,
    });
    expect(sale.inventory).toEqual({ qty: 0n, cost: 0n, shortQty: 300_000n });
    expect((await counts()).fills).toBe(2n);
    expect(await heldInventoryOf(database.db, market.instrument)).toEqual({
      qty: 0n,
      cost: 0n,
      shortQty: 300_000n,
    });
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged).toEqual([
      expect.objectContaining({
        level: 50,
        instrument: market.instrument,
        shortQty: "300000",
        soldQty: "1000000",
      }),
    ]);
    // A stays covered at the real cost its merchant was charged; nothing was taken back from it.
    expect((await lotStates(database.db, market.instrument))[0]).toMatchObject({
      id: lotA.lotId,
      filled_qty: 300_000n,
      cost: 150_000n,
    });

    // A lot B of 0.2 arrives, then a buy of 0.5 at 0.60: its first 0.3 replace the short (the
    // platform's cost), the next 0.2 cover B. B never pays for the replacement.
    const lotB = await createLot(database.db, market, b, 200_000n, 150_000n);
    expect((await allocateHeldInventory(database.db, market.instrument)).allocations).toEqual([]);
    const next = await recordFill(database.db, fill(buyOrder, 6000n, 500_000n));
    if (next.status !== "recorded") throw new Error("expected recorded");
    expect(next.allocations.map((x) => [x.lotId, x.qty, x.cost])).toEqual([
      [lotB.lotId, 200_000n, 120_000n],
    ]);
    expect(next.inventory).toEqual({ qty: 0n, cost: 0n, shortQty: 0n });
    expect(await heldInventoryOf(database.db, market.instrument)).toEqual({
      qty: 0n,
      cost: 0n,
      shortQty: 0n,
    });
  });

  it("orders the inventory by recording order, even when the transaction that records last began first", async () => {
    const a = await createCampaign(database.db, market);
    const order = await createOrder(database.db, market, "buy");

    let begun: () => void = () => undefined;
    const hasBegun = new Promise<void>((resolve) => {
      begun = resolve;
    });
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    // This transaction starts first (its now() is fixed here) but records its fill last.
    const late = database.db.begin(async (tx) => {
      await tx`select 1`;
      begun();
      await released;
      return recordFill(tx, fill(order, 3000n, 200_000n));
    });
    await hasBegun;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const first = await recordFill(database.db, fill(order, 7000n, 200_000n));
    release();
    const second = await late;
    if (first.status !== "recorded" || second.status !== "recorded") {
      throw new Error("expected recorded");
    }

    // The next lot takes the fill recorded first, at 0.70, not the one whose transaction began
    // first: FIFO follows the order fills were recorded in.
    const lot = await createLot(database.db, market, a, 200_000n, 200_000n);
    const outcome = await allocateHeldInventory(database.db, market.instrument);
    expect(outcome.allocations).toEqual([
      { lotId: lot.lotId, fillId: first.fillId, qty: 200_000n, cost: 140_000n },
    ]);
    expect(outcome.inventory).toEqual({ qty: 200_000n, cost: 60_000n, shortQty: 0n });
  });

  it("accumulates maker savings and guarantee losses in engine_pnl, per event", async () => {
    const a = await createCampaign(database.db, market);
    await createLot(database.db, market, a, CONTRACT, 450_000n);
    const order = await createOrder(database.db, market, "buy", { kind: "maker" });
    const bookRef: BookLevelsRef = {
      source: "book",
      instrumentSymbol: market.instrument,
      observedAtMs: 0,
      bookSide: "asks",
      levels: [{ priceBps: 5000n, displayedQty: CONTRACT, consumedBeforeQty: 0n }],
      limitPriceBps: 4800n,
      orderRemainingQty: CONTRACT,
      makerFeeWaived: true,
    };
    const result = await recordFill(database.db, fill(order, 4800n, CONTRACT, 0n, { bookRef }));
    if (result.status !== "recorded") throw new Error("expected recorded");
    expect(result.makerSaving).toBe(500_000n + 17_500n - 480_000n);
    expect(result.coveredLots[0]).toMatchObject({ amount: 450_000n, guaranteeLoss: 30_000n });
    expect(await enginePnl()).toEqual({ maker_savings: 37_500n, guarantee_losses: 30_000n });
    const [stored] = await database.db<
      { book_ref: { levels: { priceBps: string }[] } }[]
    >`select book_ref from fills`;
    expect(stored?.book_ref.levels[0]?.priceBps).toBe("5000");
  });

  it("does not allocate to a charged lot or to a lot of a settled campaign", async () => {
    const settled = await createCampaign(database.db, market, {
      status: "settled_no",
      outcome: "no",
    });
    const live = await createCampaign(database.db, market);
    await createLot(database.db, market, settled, 100_000n, 100_000n);
    const charged = await createLot(database.db, market, live, 100_000n, 100_000n);
    await markChargedAsProjectionWould(database.db, charged.ticketOnchainId, 0n);
    const open = await createLot(database.db, market, live, 100_000n, 100_000n);
    const order = await createOrder(database.db, market, "buy");
    const result = await recordFill(database.db, fill(order, 5000n, 100_000n));
    if (result.status !== "recorded") throw new Error("expected recorded");
    expect(result.allocations.map((x) => x.lotId)).toEqual([open.lotId]);
  });

  it("two concurrent recordFill on one instrument never allocate the same lot quantity twice", async () => {
    const a = await createCampaign(database.db, market);
    const b = await createCampaign(database.db, market);
    for (let i = 0; i < 6; i += 1)
      await createLot(database.db, market, i % 2 === 0 ? a : b, 300_000n, 200_000n);
    const order = await createOrder(database.db, market, "buy");

    // The first transaction waits, holding the instrument, until the second one is blocked on it:
    // both are provably in flight at the same time.
    let blockedSeen = false;
    const first = recordFill(database.db, fill(order, 5000n, 1_000_000n), {
      afterFillInsert: async (tx) => {
        for (let i = 0; i < 200 && !blockedSeen; i += 1) {
          const [row] = await tx<{ n: bigint }[]>`
            select count(*)::bigint as n from pg_locks
            where locktype = 'advisory' and not granted
              and database = (select oid from pg_database where datname = current_database())
          `;
          blockedSeen = (row?.n ?? 0n) > 0n;
          if (!blockedSeen) await new Promise((resolve) => setTimeout(resolve, 10));
        }
      },
    });
    const second = recordFill(database.db, fill(order, 6000n, 1_000_000n));
    const results = await Promise.all([first, second]);
    expect(blockedSeen).toBe(true);
    expect(results.map((r) => r.status)).toEqual(["recorded", "recorded"]);

    const lots = await lotStates(database.db, market.instrument);
    expect(lots.every((l) => l.filled_qty === l.qty)).toBe(true);
    const [sums] = await database.db<{ qty: bigint; cost: bigint }[]>`
      select sum(qty)::bigint as qty, sum(cost)::bigint as cost from lot_fills
    `;
    expect(sums?.qty).toBe(1_800_000n);
    const held = await heldInventoryOf(database.db, market.instrument);
    expect(held.qty).toBe(200_000n);
    expect((sums?.cost ?? 0n) + held.cost).toBe(500_000n + 600_000n);
  });

  it("many concurrent fills on one instrument conserve quantity and cost", async () => {
    const random = new SeededRandom(42);
    const campaigns = [
      await createCampaign(database.db, market),
      await createCampaign(database.db, market),
    ];
    let lotQty = 0n;
    for (let i = 0; i < 12; i += 1) {
      const qty = random.between(1n, 40n) * 10_000n;
      lotQty += qty;
      await createLot(database.db, market, campaigns[i % 2] ?? campaigns[0]!, qty, qty / 2n);
    }
    const order = await createOrder(database.db, market, "buy");
    const inputs = Array.from({ length: 10 }, () =>
      fill(
        order,
        random.between(1n, 99n) * 100n,
        random.between(1n, 30n) * 10_000n,
        random.between(0n, 500n),
      ),
    );
    const results = await Promise.all(inputs.map((input) => recordFill(database.db, input)));
    expect(results.every((r) => r.status === "recorded")).toBe(true);

    const bought = inputs.reduce((t, i) => t + i.qty, 0n);
    const boughtCost = inputs.reduce((t, i) => t + fillCost(i.priceBps, i.qty, i.fee), 0n);
    const lots = await lotStates(database.db, market.instrument);
    const filled = lots.reduce((t, l) => t + l.filled_qty, 0n);
    const allocatedCost = lots.reduce((t, l) => t + l.cost, 0n);
    const held = await heldInventoryOf(database.db, market.instrument);
    expect(filled).toBe(bought < lotQty ? bought : lotQty);
    expect(filled + held.qty).toBe(bought);
    expect(allocatedCost + held.cost).toBe(boughtCost);
    // FIFO in the database too: covered lots, at most one partial lot, then untouched lots.
    const firstOpen = lots.findIndex((l) => l.filled_qty < l.qty);
    if (firstOpen >= 0)
      expect(lots.slice(firstOpen + 1).every((l) => l.filled_qty === 0n)).toBe(true);
  });
});

describe("allocateHeldInventoryForOpenLots", () => {
  it("covers, on every instrument, the lots created while inventory was already held", async () => {
    const other = await createMarket(database.db);
    const a = await createCampaign(database.db, market);
    const b = await createCampaign(database.db, other);
    const order = await createOrder(database.db, market, "buy");
    await recordFill(database.db, fill(order, 5000n, CONTRACT)); // held ahead of exposure
    const late = await createLot(database.db, market, a, 400_000n, 300_000n);
    const uncovered = await createLot(database.db, other, b, 100_000n, 100_000n); // nothing held

    expect(await pendingCharges(database.db, { limit: 10 })).toEqual([]);
    const swept = await allocateHeldInventoryForOpenLots(database.db);
    expect(swept.map((x) => x.instrument)).toEqual([market.instrument]);
    expect(swept[0]?.outcome.coveredLots.map((l) => [l.lotId, l.amount])).toEqual([
      [late.lotId, 200_000n],
    ]);
    const batches = await pendingCharges(database.db, { limit: 10 });
    expect(batches.flatMap((x) => x.ticketIds)).toEqual([late.ticketOnchainId]);
    expect(batches.flatMap((x) => x.ticketIds)).not.toContain(uncovered.ticketOnchainId);
    // Nothing left to do: a second sweep allocates nothing.
    expect(await allocateHeldInventoryForOpenLots(database.db)).toEqual([]);
  });
});

describe("pendingCharges", () => {
  it("returns covered, uncharged lots in batches of at most 50, in FIFO order", async () => {
    const a = await createCampaign(database.db, market);
    const lots: LotFixture[] = [];
    for (let i = 0; i < 120; i += 1)
      lots.push(await createLot(database.db, market, a, 10_000n, 6_000n));
    await createLot(database.db, market, a, 10_000n, 6_000n); // left open
    const order = await createOrder(database.db, market, "buy");
    await recordFill(database.db, fill(order, 5000n, 1_200_000n));

    const batches = await pendingCharges(database.db, { limit: 500 });
    expect(batches.map((b) => b.ticketIds.length)).toEqual([50, 50, 20]);
    expect(batches.flatMap((b) => b.ticketIds)).toEqual(lots.map((l) => l.ticketOnchainId));
    expect(batches.flatMap((b) => b.amounts).every((amount) => amount === 5_000n)).toBe(true);
    expect(new Set(batches.map((b) => b.idempotencyKey)).size).toBe(3);

    const limited = await pendingCharges(database.db, { limit: 70, batchSize: 30 });
    expect(limited.map((b) => b.ticketIds.length)).toEqual([30, 30, 10]);
    await expect(pendingCharges(database.db, { limit: 10, batchSize: 51 })).rejects.toThrow();
  });

  it("excludes already charged lots and lots of a settled campaign, and includes a zero-quantity lot at 0", async () => {
    const live = await createCampaign(database.db, market);
    const settled = await createCampaign(database.db, market);
    const zero = await createLot(database.db, market, live, 0n, 0n);
    const charged = await createLot(database.db, market, live, 10_000n, 6_000n);
    const ofSettled = await createLot(database.db, market, settled, 10_000n, 6_000n);
    const pending = await createLot(database.db, market, live, 10_000n, 6_000n);
    const order = await createOrder(database.db, market, "buy");
    await recordFill(database.db, fill(order, 7000n, 30_000n)); // 7 000 each: above the guarantee
    await markChargedAsProjectionWould(database.db, charged.ticketOnchainId, 6_000n);
    await database.db`update campaigns set status = 'settled_yes', outcome = 'yes' where id = ${settled.campaignId}`;

    const batches = await pendingCharges(database.db, { limit: 100 });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.ticketIds).toEqual([zero.ticketOnchainId, pending.ticketOnchainId]);
    expect(batches[0]?.amounts).toEqual([0n, 6_000n]);
    expect(batches[0]?.ticketIds).not.toContain(ofSettled.ticketOnchainId);
  });

  it("leaves out lots whose ticket or campaign has no on-chain id yet", async () => {
    const live = await createCampaign(database.db, market);
    const offchainCampaign = await createCampaign(database.db, market, { onchain: false });
    const ready = await createLot(database.db, market, live, 10_000n, 6_000n);
    const noTicketId = await createLot(database.db, market, live, 10_000n, 6_000n, {
      onchain: false,
    });
    const ofOffchain = await createLot(database.db, market, offchainCampaign, 10_000n, 6_000n);
    const order = await createOrder(database.db, market, "buy");
    await recordFill(database.db, fill(order, 5000n, 30_000n));
    expect(
      (await lotStates(database.db, market.instrument)).every((l) => l.filled_qty === l.qty),
    ).toBe(true);

    const batches = await pendingCharges(database.db, { limit: 10 });
    expect(batches.map((x) => x.lots.map((l) => l.lotId))).toEqual([[ready.lotId]]);
    expect(batches.flatMap((x) => x.lots.map((l) => l.lotId))).not.toContain(noTicketId.lotId);
    expect(batches.flatMap((x) => x.lots.map((l) => l.lotId))).not.toContain(ofOffchain.lotId);
  });

  it("leaves out a campaign whose budget was released, and isolates campaigns in the emergency window", async () => {
    const a = await createCampaign(database.db, market);
    const late = await createCampaign(database.db, market);
    const released = await createCampaign(database.db, market);
    const a1 = await createLot(database.db, market, a, 10_000n, 6_000n);
    const e1 = await createLot(database.db, market, late, 10_000n, 6_000n);
    const r1 = await createLot(database.db, market, released, 10_000n, 6_000n);
    const a2 = await createLot(database.db, market, a, 10_000n, 6_000n);
    const e2 = await createLot(database.db, market, late, 10_000n, 6_000n);
    const a3 = await createLot(database.db, market, a, 10_000n, 6_000n);
    const order = await createOrder(database.db, market, "buy");
    await recordFill(database.db, fill(order, 5000n, 60_000n));

    // `released` had its budget released on-chain (emergencyReleaseBudget emits CampaignReleased):
    // chargeHedge would revert with AlreadyReleased, and the whole batch with it.
    await database.db`
      insert into chain_events (tx_hash, log_index, block_number, name, args, source)
      values (${`0x${"ab".repeat(32)}`}, 0, 10, 'CampaignReleased',
              ${database.db.json({ id: released.campaignOnchainId.toString(), amount: "0" })}, 'logs')
    `;
    // `late` closed its sales more than EMERGENCY_DELAY ago without a settlement: anyone can
    // release it at any moment.
    await database.db`
      update campaigns set sales_close = now() - interval '8 days', status = 'sales_closed'
      where id = ${late.campaignId}
    `;

    const batches = await pendingCharges(database.db, { limit: 100, batchSize: 2 });
    expect(batches.map((x) => [x.isolated, x.ticketIds])).toEqual([
      [false, [a1.ticketOnchainId, a2.ticketOnchainId]],
      [true, [e1.ticketOnchainId, e2.ticketOnchainId]],
      [false, [a3.ticketOnchainId]],
    ]);
    expect(batches.flatMap((x) => x.ticketIds)).not.toContain(r1.ticketOnchainId);

    // Seen from a time before the emergency window opened, nothing is isolated.
    const before = await pendingCharges(database.db, {
      limit: 100,
      at: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    });
    expect(before.map((x) => [x.isolated, x.ticketIds])).toEqual([
      [
        false,
        [
          a1.ticketOnchainId,
          e1.ticketOnchainId,
          a2.ticketOnchainId,
          e2.ticketOnchainId,
          a3.ticketOnchainId,
        ],
      ],
    ]);
  });

  it("leaves out tickets a chargeHedge of the outbox still holds, and offers them again after a revert", async () => {
    const a = await createCampaign(database.db, market);
    const lot1 = await createLot(database.db, market, a, 10_000n, 6_000n);
    const lot2 = await createLot(database.db, market, a, 10_000n, 6_000n);
    const order = await createOrder(database.db, market, "buy");
    await recordFill(database.db, fill(order, 5000n, 20_000n));

    const [batch] = await pendingCharges(database.db, { limit: 10 });
    if (batch === undefined) throw new Error("expected a batch");
    const again = await pendingCharges(database.db, { limit: 10 });
    expect(again[0]?.idempotencyKey).toBe(batch.idempotencyKey);

    const request = chargeHedgeTxRequest(batch, ESCROW);
    expect(request.kind).toBe(CHARGE_HEDGE_TX_KIND);
    expect(request.signer).toBe("oracle");
    const decoded = decodeFunctionData({ abi: winzEscrowAbi, data: request.data });
    expect(decoded.functionName).toBe("chargeHedge");
    expect(decoded.args).toEqual([
      [lot1.ticketOnchainId, lot2.ticketOnchainId],
      [5_000n, 5_000n],
    ]);

    // What the outbox would store for it.
    const [tx] = await database.db<{ id: string }[]>`
      insert into chain_txs (idempotency_key, signer, kind, to_address, data, payload)
      values (${request.idempotencyKey}, ${request.signer}, ${request.kind}, ${request.to}, ${request.data},
              ${database.db.json(request.payload as Record<string, string[]>)})
      returning id
    `;
    expect(await pendingCharges(database.db, { limit: 10 })).toEqual([]);
    for (const status of ["sent", "mined"]) {
      await database.db`update chain_txs set status = ${status} where id = ${tx?.id ?? ""}`;
      expect(await pendingCharges(database.db, { limit: 10 })).toEqual([]);
    }

    await database.db`update chain_txs set status = 'reverted' where id = ${tx?.id ?? ""}`;
    const retry = await pendingCharges(database.db, { limit: 10 });
    expect(retry[0]?.ticketIds).toEqual(batch.ticketIds);
    expect(retry[0]?.idempotencyKey).not.toBe(batch.idempotencyKey);
  });
});

describe("the two-merchant scenario of H-05", () => {
  it("each merchant pays only its own lots, never above its quotes, and charges + platform result = real cost", async () => {
    const barA = await createCampaign(database.db, market);
    const pizzaB = await createCampaign(database.db, market);
    // Sales alternate between the two merchants; guarantees are each quote's maxHedgeCost.
    const sales = [
      { campaign: barA, qty: 400_000n, guarantee: 220_000n },
      { campaign: pizzaB, qty: 300_000n, guarantee: 160_000n },
      { campaign: barA, qty: 500_000n, guarantee: 260_000n },
      { campaign: pizzaB, qty: 600_000n, guarantee: 300_000n }, // the market moves: above guarantee
      { campaign: barA, qty: 0n, guarantee: 0n }, // a zero-refund sale
    ];
    const lots: LotFixture[] = [];
    for (const sale of sales)
      lots.push(await createLot(database.db, market, sale.campaign, sale.qty, sale.guarantee));
    const maker = await createOrder(database.db, market, "buy", { kind: "maker" });
    const taker = await createOrder(database.db, market, "buy", { kind: "taker" });

    const fills = [
      fill(maker, 4800n, 500_000n), // cheap maker fill: A1 and part of B1
      fill(taker, 5200n, 300_000n, 1_100n),
      fill(taker, 5600n, 1_000_000n, 3_900n), // B2 costs more than its guarantee
      fill(taker, 5800n, 100_000n, 400n), // ahead of exposure: inventory
    ];
    for (const input of fills) await recordFill(database.db, input);
    const realCost = fills.reduce((t, i) => t + fillCost(i.priceBps, i.qty, i.fee), 0n);

    const batches = await pendingCharges(database.db, { limit: 100 });
    const charged = new Map<bigint, bigint>();
    for (const batch of batches) {
      batch.ticketIds.forEach((ticketId, i) => charged.set(ticketId, batch.amounts[i] ?? -1n));
      for (const [i, ticketId] of batch.ticketIds.entries()) {
        await markChargedAsProjectionWould(database.db, ticketId, batch.amounts[i] ?? 0n);
      }
    }
    expect(charged.size).toBe(5);

    const states = await lotStates(database.db, market.instrument);
    const pnl = await enginePnl();
    const held = await heldInventoryOf(database.db, market.instrument);
    for (const [index, sale] of sales.entries()) {
      const lot = lots[index];
      const state = states.find((s) => s.id === lot?.lotId);
      if (lot === undefined || state === undefined) throw new Error("lot missing");
      const amount = charged.get(lot.ticketOnchainId);
      expect(state.campaign_id).toBe(sale.campaign.campaignId);
      expect(amount).toBe(state.cost < sale.guarantee ? state.cost : sale.guarantee);
      expect(amount).toBeLessThanOrEqual(sale.guarantee);
    }
    // Worked by hand. F1 240 000: A1 192 000, B1 48 000. F2 157 100: B1 104 734, A2 52 366.
    // F3 563 900: A2 225 560, B2 338 340. F4 58 400: held ahead of exposure.
    expect(states.map((s) => s.cost)).toEqual([192_000n, 152_734n, 277_926n, 338_340n, 0n]);
    expect(lots.map((l) => charged.get(l.ticketOnchainId))).toEqual([
      192_000n,
      152_734n,
      260_000n,
      300_000n,
      0n,
    ]);
    const chargedTo = (campaignId: string): bigint =>
      lots
        .filter((_, i) => sales[i]?.campaign.campaignId === campaignId)
        .reduce((t, l) => t + (charged.get(l.ticketOnchainId) ?? 0n), 0n);
    expect(chargedTo(barA.campaignId)).toBe(452_000n);
    expect(chargedTo(pizzaB.campaignId)).toBe(452_734n);
    expect(pnl?.guarantee_losses).toBe(17_926n + 38_340n);
    // The real cost of the hedge is paid by the merchants (charges), by the platform (guarantee
    // losses), or still held as inventory ahead of exposure: nothing else.
    const chargedTotal = [...charged.values()].reduce((t, v) => t + v, 0n);
    expect(held).toEqual({ qty: 100_000n, cost: 58_400n, shortQty: 0n });
    expect(chargedTotal + (pnl?.guarantee_losses ?? 0n) + held.cost).toBe(realCost);
    expect(realCost).toBe(1_019_400n);
    // Charged: nothing left to submit.
    expect(await pendingCharges(database.db, { limit: 100 })).toEqual([]);
  });
});
