/**
 * H against the allocation, as seeded randomised sequences on one instrument with several
 * campaigns (fast-check is not a dependency of the engine): sales, buy fills, resales (now and then
 * beyond the inventory: an over-sale), and settlements. Lots, exposure and campaign statuses are
 * written by the chain projection itself (`projectChainEvent`), fills by the allocation store.
 *
 * After every step, H as the hedging derives it (the restore, the instrument listing and the
 * derived write of `positions.held`) equals what the lots of unsettled campaigns were allocated
 * plus the inventory held ahead of exposure, less an over-sale not replaced yet; and the costs are
 * conserved to the micro-USDC: what the buy fills cost is what the lots were allocated, plus the
 * inventory's cost, plus the cost basis of what was resold, plus the cost of the buys that
 * replaced an over-sale (all as the allocation store records or returns them).
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hex } from "viem";

import { projectChainEvent, type StoredChainEvent } from "../../chain";
import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { allocateHeldInventory, fillCost, heldInventoryOf, recordFill } from "../allocation";
import {
  SeededRandom,
  createCampaign,
  createMarket,
  createOrder,
  type CampaignFixture,
  type MarketFixture,
} from "../allocation/test-support";
import { orderIdPrefix } from "./ids";
import {
  listHedgeInstruments,
  loadRestoreState,
  SETTLED_CAMPAIGN_STATUSES,
  writeDerivedHeld,
} from "./store";

const SEEDS = 24;
const STEP = 10_000n;

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database?.drop();
});

let block = 1_000n;
let ticketId = 1_000_000n;
let fillId = 0;

function txHash(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

/** Projects one escrow event exactly as the ingest would, in its own transaction. */
async function project(name: string, args: Record<string, string | number>): Promise<void> {
  block += 1n;
  const event: StoredChainEvent = {
    txHash: txHash(),
    logIndex: 0,
    blockNumber: block,
    blockTime: new Date(),
    name,
    args,
    createdAt: new Date(),
  };
  await database.db.begin(async (tx) => {
    const outcome = await projectChainEvent(tx, event);
    if (outcome.status !== "applied") {
      throw new Error(`${name} not applied: ${JSON.stringify(outcome)}`);
    }
  });
}

interface Truth {
  allocatedUnsettled: bigint;
  exposure: bigint;
  /** Allocated cost of every lot, settled or not. */
  lotCost: bigint;
  /** filled_qty and cost of each settled lot, by id. */
  settledLots: Map<string, string>;
}

/** What the lots hold, read straight from the tables (independent of the code under test). */
async function truth(market: MarketFixture): Promise<Truth> {
  const rows = await database.db<
    {
      id: string;
      qty: bigint;
      filled_qty: bigint;
      cost: bigint;
      allocated: bigint;
      settled: boolean;
    }[]
  >`
    select l.id, l.qty, l.filled_qty, l.cost,
           (select coalesce(sum(lf.qty), 0) from lot_fills lf where lf.lot_id = l.id)::bigint
             as allocated,
           c.status = any(${[...SETTLED_CAMPAIGN_STATUSES]}::text[]) as settled
    from lots l join campaigns c on c.id = l.campaign_id
    where l.instrument = ${market.instrument}
  `;
  const result: Truth = {
    allocatedUnsettled: 0n,
    exposure: 0n,
    lotCost: 0n,
    settledLots: new Map(),
  };
  for (const row of rows) {
    expect(row.allocated).toBe(row.filled_qty);
    result.lotCost += row.cost;
    if (row.settled) {
      result.settledLots.set(row.id, `${row.filled_qty.toString()}/${row.cost.toString()}`);
    } else {
      result.allocatedUnsettled += row.allocated;
      result.exposure += row.qty;
    }
  }
  return result;
}

interface Run {
  steps: number;
  sales: number;
  buys: number;
  resales: number;
  overSales: number;
  settlements: number;
}

async function simulate(seed: number): Promise<Run> {
  const random = new SeededRandom(seed);
  const market = await createMarket(database.db);
  const prefix = orderIdPrefix(market.instrument);
  const buyOrder = await createOrder(database.db, market, "buy");
  const sellOrder = await createOrder(database.db, market, "sell");
  await database.db`insert into positions (instrument) values (${market.instrument})`;
  const open: CampaignFixture[] = [];
  const openCampaign = async (): Promise<void> => {
    open.push(await createCampaign(database.db, market));
  };
  await openCampaign();
  await openCampaign();

  const run: Run = { steps: 0, sales: 0, buys: 0, resales: 0, overSales: 0, settlements: 0 };
  let boughtCost = 0n;
  let soldCostBasis = 0n;
  let replacedCost = 0n;
  let settledBefore = new Map<string, string>();
  const steps = random.int(8, 30);

  for (let step = 0; step < steps; step += 1) {
    run.steps += 1;
    const roll = random.int(1, 20);
    if (roll <= 7 && open.length > 0) {
      // A sale: its lot and the exposure from the projection, then the inventory covers it.
      const campaign = open[random.int(0, open.length - 1)];
      if (campaign === undefined) throw new Error("no campaign");
      const refundable = random.chance(1, 10) ? 0n : random.between(1n, 400n) * 7_500n;
      ticketId += 1n;
      await project("TicketPurchased", {
        ticketId: ticketId.toString(),
        id: campaign.campaignOnchainId.toString(),
        buyer: `0x${randomBytes(20).toString("hex")}`,
        qty: 1,
        paid: (refundable + 1_000_000n).toString(),
        refundable: refundable.toString(),
        maxHedgeCost: (refundable / 2n).toString(),
      });
      await allocateHeldInventory(database.db, market.instrument);
      run.sales += 1;
    } else if (roll <= 13) {
      // A buy fill.
      fillId += 1;
      const priceBps = random.between(1n, 99n) * 100n;
      const qty = random.between(1n, 300n) * STEP;
      const fee = random.between(0n, 2_000n);
      const result = await recordFill(database.db, {
        orderId: buyOrder,
        venueFillId: `p-${fillId.toString()}`,
        priceBps,
        qty,
        fee,
        at: new Date(),
        bookRef: null,
      });
      if (result.status !== "recorded") throw new Error("buy not recorded");
      boughtCost += fillCost(priceBps, qty, fee);
      if (result.replacedShort !== null) replacedCost += result.replacedShort.cost;
      run.buys += 1;
    } else if (roll <= 16) {
      // A resale of surplus; one in eight goes beyond the inventory (an over-sale on the venue).
      const inventory = await heldInventoryOf(database.db, market.instrument);
      const over = random.chance(1, 8);
      if (inventory.qty === 0n && !over) continue;
      const qty = over
        ? inventory.qty + random.between(1n, 50n) * STEP
        : random.between(1n, inventory.qty);
      fillId += 1;
      const result = await recordFill(database.db, {
        orderId: sellOrder,
        venueFillId: `p-${fillId.toString()}`,
        priceBps: random.between(1n, 99n) * 100n,
        qty,
        fee: random.between(0n, 500n),
        at: new Date(),
        bookRef: null,
      });
      if (result.status !== "recorded" || result.sale === null)
        throw new Error("sale not recorded");
      soldCostBasis += result.sale.costBasis;
      if (result.sale.shortQty > 0n) run.overSales += 1;
      run.resales += 1;
    } else if (open.length > 0) {
      // A settlement, as the projection writes it; sometimes a new campaign opens on the instrument.
      const index = random.int(0, open.length - 1);
      const [campaign] = open.splice(index, 1);
      if (campaign === undefined) throw new Error("no campaign");
      await project("CampaignSettled", {
        id: campaign.campaignOnchainId.toString(),
        outcome: random.int(0, 2),
      });
      run.settlements += 1;
      if (open.length === 0 || random.chance(1, 2)) await openCampaign();
    }

    const lots = await truth(market);
    const inventory = await heldInventoryOf(database.db, market.instrument);
    const expected = lots.allocatedUnsettled + inventory.qty - inventory.shortQty;
    const expectedHeld = expected > 0n ? expected : 0n;
    const where = `seed ${seed.toString()} step ${step.toString()}`;

    // The identity, exact while nothing was sold beyond the inventory.
    if (inventory.shortQty === 0n) {
      expect(expectedHeld, where).toBe(lots.allocatedUnsettled + inventory.qty);
    }
    const restore = await loadRestoreState(database.db, market.instrument, "paper", prefix);
    expect(restore.held, `${where}: restore`).toBe(expectedHeld);
    expect(restore.exposure, `${where}: restore exposure`).toBe(lots.exposure);
    const row = (await listHedgeInstruments(database.db)).find(
      (item) => item.symbol === market.instrument,
    );
    expect(row?.derivedHeld, `${where}: listing`).toBe(expectedHeld);
    expect(row?.exposure, `${where}: listing exposure`).toBe(lots.exposure);
    expect(row?.settledAllocated, `${where}: settled allocation`).toBe(restore.settledAllocated);
    await writeDerivedHeld(database.db, market.instrument);
    const [position] = await database.db<{ held: bigint }[]>`
      select held from positions where instrument = ${market.instrument}
    `;
    expect(position?.held, `${where}: positions.held`).toBe(expectedHeld);

    // A settled lot never changes again: its contracts are gone, nothing more covers it.
    for (const [id, state] of settledBefore) {
      expect(lots.settledLots.get(id), `${where}: settled lot ${id}`).toBe(state);
    }
    settledBefore = lots.settledLots;

    // Costs conserved exactly (the allocation's own property), after any number of resales of a
    // fill and after an over-sale: a resale costs its share of what was sold from each fill in
    // all, so the inventory rebuilt from the tables carries exactly what the resales left, and the
    // buys that replace an over-sale return what that replacement cost. Settlements play no part.
    expect(lots.lotCost + inventory.cost + soldCostBasis + replacedCost, `${where}: costs`).toBe(
      boughtCost,
    );
  }
  return run;
}

describe("held after settlements, over random sequences", () => {
  it(
    "always equals what unsettled lots were allocated plus the inventory ahead, costs conserved",
    { timeout: 240_000 },
    async () => {
      const totals: Run = { steps: 0, sales: 0, buys: 0, resales: 0, overSales: 0, settlements: 0 };
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const run = await simulate(seed);
        for (const key of Object.keys(totals) as (keyof Run)[]) totals[key] += run[key];
      }
      // The sequences really exercised every kind of step.
      expect(totals.sales).toBeGreaterThan(50);
      expect(totals.buys).toBeGreaterThan(50);
      expect(totals.resales).toBeGreaterThan(10);
      expect(totals.overSales).toBeGreaterThan(0);
      expect(totals.settlements).toBeGreaterThan(20);
    },
  );
});
