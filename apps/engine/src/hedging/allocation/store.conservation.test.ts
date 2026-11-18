/**
 * Conservation of hedge costs across resales (SPEC 9.5, HE-4), on Postgres: whatever the sequence
 * of buy fills, lots, resales and over-sales, what was paid for the buy fills is exactly what the
 * lots were allocated (charged to merchants, or absorbed as guarantee losses), plus the cost basis
 * booked on the resales (`engine_pnl.resale_result` is proceeds minus it), plus the cost of the
 * buys that replaced an over-sale (booked on the resales too), plus what the inventory held ahead
 * of exposure still carries. To the micro-USDC, after every step.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { fillCost } from "./core";
import { allocateHeldInventory, heldInventoryOf, recordFill, type RecordFillResult } from "./store";
import {
  SeededRandom,
  createCampaign,
  createLot,
  createMarket,
  createOrder,
  type CampaignFixture,
  type MarketFixture,
} from "./test-support";

const STEP = 10_000n;
const SEEDS = 30;

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database?.drop();
});

let fillSeq = 0;

/** One instrument with a buy order, a sell order, one campaign, and the books of the test. */
class Ledger {
  /** What every buy fill cost. */
  paid = 0n;
  /** Cost basis of every resale, as `recordFill` returned it. */
  soldCostBasis = 0n;
  /** Cost of the buys that replaced an over-sale, as `recordFill` returned it. */
  replacedCost = 0n;
  resales = 0;
  overSales = 0;
  replacements = 0;

  private constructor(
    readonly market: MarketFixture,
    readonly campaign: CampaignFixture,
    private readonly buyOrder: string,
    private readonly sellOrder: string,
  ) {}

  static async create(): Promise<Ledger> {
    const market = await createMarket(database.db);
    const campaign = await createCampaign(database.db, market);
    return new Ledger(
      market,
      campaign,
      await createOrder(database.db, market, "buy"),
      await createOrder(database.db, market, "sell"),
    );
  }

  private async record(
    order: string,
    priceBps: bigint,
    qty: bigint,
    fee: bigint,
  ): Promise<Extract<RecordFillResult, { status: "recorded" }>> {
    fillSeq += 1;
    const result = await recordFill(database.db, {
      orderId: order,
      venueFillId: `c-${fillSeq.toString()}`,
      priceBps,
      qty,
      fee,
      at: new Date(),
      bookRef: null,
    });
    if (result.status !== "recorded") throw new Error("fill not recorded");
    return result;
  }

  async buy(priceBps: bigint, qty: bigint, fee: bigint): Promise<void> {
    const result = await this.record(this.buyOrder, priceBps, qty, fee);
    this.paid += fillCost(priceBps, qty, fee);
    if (result.replacedShort !== null) {
      this.replacedCost += result.replacedShort.cost;
      this.replacements += 1;
    }
  }

  async sell(priceBps: bigint, qty: bigint, fee: bigint): Promise<void> {
    const result = await this.record(this.sellOrder, priceBps, qty, fee);
    if (result.sale === null) throw new Error("a sell fill without its sale");
    this.soldCostBasis += result.sale.costBasis;
    this.resales += 1;
    if (result.sale.shortQty > 0n) this.overSales += 1;
  }

  /** A sale of the campaign: its lot, then the inventory held ahead of exposure covers it. */
  async lot(qty: bigint, maxHedgeCost: bigint): Promise<void> {
    await createLot(database.db, this.market, this.campaign, qty, maxHedgeCost);
    await allocateHeldInventory(database.db, this.market.instrument);
  }

  /** What the lots of the instrument were allocated, read from the tables. */
  async lotCost(): Promise<bigint> {
    const [row] = await database.db<{ cost: bigint; allocated: bigint }[]>`
      select coalesce(sum(l.cost), 0)::bigint as cost,
             (select coalesce(sum(lf.cost), 0) from lot_fills lf
               join lots x on x.id = lf.lot_id where x.instrument = ${this.market.instrument})::bigint
               as allocated
      from lots l where l.instrument = ${this.market.instrument}
    `;
    expect(row?.cost).toBe(row?.allocated);
    return row?.cost ?? 0n;
  }

  /** paid − (lots + resales' cost bases + replacements + inventory): 0 when costs are conserved. */
  async gap(): Promise<bigint> {
    const inventory = await heldInventoryOf(database.db, this.market.instrument);
    if (inventory.shortQty > 0n) expect(inventory).toMatchObject({ qty: 0n, cost: 0n });
    return (
      this.paid - ((await this.lotCost()) + this.soldCostBasis + this.replacedCost + inventory.cost)
    );
  }
}

describe("hedge costs across resales", () => {
  it("the smallest sequence: one fill, two resales of a third each, a lot for the last third", async () => {
    const ledger = await Ledger.create();
    // 0.03 contract at $0.01 plus a fee of 1: 301 micro-USDC, which three thirds cannot split evenly.
    await ledger.buy(100n, 3n * STEP, 1n);
    await ledger.sell(5000n, STEP, 0n);
    await ledger.sell(5000n, STEP, 0n);
    await ledger.lot(STEP, 1_000n);
    expect(ledger.paid).toBe(301n);
    // The resales were booked at 101 then 100, the lot charged 100: 301.
    expect(ledger.soldCostBasis).toBe(201n);
    expect(await ledger.lotCost()).toBe(100n);
    expect(await ledger.gap()).toBe(0n);
  });

  it("an over-sale and its recovery: the replacing buy's cost is booked, nothing is lost", async () => {
    const ledger = await Ledger.create();
    await ledger.buy(4100n, 3n * STEP, 7n); // 12 307
    await ledger.lot(STEP, 1_000_000n);
    // Sold 0.05 while 0.02 was held unallocated: 0.03 over-sold.
    await ledger.sell(4000n, 5n * STEP, 3n);
    expect(ledger.overSales).toBe(1);
    expect(await ledger.gap()).toBe(0n);
    expect(await heldInventoryOf(database.db, ledger.market.instrument)).toEqual({
      qty: 0n,
      cost: 0n,
      shortQty: 3n * STEP,
    });
    // A buy of 0.01 replaces a third of the short; the next one the rest, and holds 0.01 ahead.
    await ledger.buy(4300n, STEP, 0n);
    expect(await ledger.gap()).toBe(0n);
    await ledger.buy(3700n, 3n * STEP, 5n);
    expect(ledger.replacements).toBe(2);
    // 4 300, then two thirds of 11 105 rounded up: 7 404.
    expect(ledger.replacedCost).toBe(4_300n + 7_404n);
    expect(await heldInventoryOf(database.db, ledger.market.instrument)).toEqual({
      qty: STEP,
      cost: 11_105n - 7_404n,
      shortQty: 0n,
    });
    expect(await ledger.gap()).toBe(0n);
    // The next lot takes it: still exact.
    await ledger.lot(2n * STEP, 1_000_000n);
    expect(await ledger.gap()).toBe(0n);
  });

  it(
    "over random sequences of fills, lots, resales and over-sales, exactly, after every step",
    { timeout: 240_000 },
    async () => {
      let resales = 0;
      let overSales = 0;
      let replacements = 0;
      let multiResaleFills = 0;
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const random = new SeededRandom(seed);
        const ledger = await Ledger.create();
        const steps = random.int(6, 24);
        for (let step = 0; step < steps; step += 1) {
          const roll = random.int(1, 10);
          if (roll <= 3) {
            await ledger.lot(random.between(1n, 40n) * STEP, random.between(0n, 400_000n));
          } else if (roll <= 6) {
            // Quantities off the 0.01 step now and then, and odd fees: costs that never split evenly.
            const qty = random.chance(1, 4)
              ? random.between(1n, 900_000n)
              : random.between(1n, 60n) * STEP;
            await ledger.buy(random.between(1n, 9_999n), qty, random.between(0n, 997n));
          } else {
            const inventory = await heldInventoryOf(database.db, ledger.market.instrument);
            const over = random.chance(1, 6);
            if (inventory.qty === 0n && !over) continue;
            const qty = over
              ? inventory.qty + random.between(1n, 30n) * STEP
              : random.between(1n, inventory.qty);
            await ledger.sell(random.between(1n, 9_999n), qty, random.between(0n, 300n));
          }
          expect(await ledger.gap(), `seed ${seed.toString()} step ${step.toString()}`).toBe(0n);
        }
        resales += ledger.resales;
        overSales += ledger.overSales;
        replacements += ledger.replacements;
        if (ledger.resales > 1) multiResaleFills += 1;
      }
      // The sequences really exercised resales, several per run, over-sales and their recovery.
      expect(resales).toBeGreaterThan(40);
      expect(multiResaleFills).toBeGreaterThan(10);
      expect(overSales).toBeGreaterThan(3);
      expect(replacements).toBeGreaterThan(3);
    },
  );
});
