/**
 * Contracts that hedged a settled campaign are no longer held (SPEC HE-1 to HE-6, MDB-4): the
 * venue paid them out. A new campaign on the same instrument is hedged, charged and reconciled as
 * the first one was, with or without a restart of the hedging between the two, and whatever the
 * first one's outcome; a campaign that settles while another one on the instrument is still
 * selling leaves the other's allocations, charges and resting order alone, and nothing is sold.
 *
 * Campaigns, purchases, early sales closes and settlements are made on the real escrow; lots,
 * exposure and campaign statuses come from the real chain projection.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encodeFunctionData } from "viem";

import {
  CONTRACT_STEP_MICRO,
  hedgeInstrumentSchema,
  winzEscrowAbi,
  type HedgeInstrument,
} from "@winz/shared";

import { startAnvil, type AnvilInstance } from "../../testing/anvil";
import {
  CONTRACT,
  createHedgeHarness,
  hedgeTables,
  onchainCampaign,
  waitFor,
  type Campaign,
  type HedgeHarness,
  type Market,
  type RunningService,
} from "./test-support";

let anvil: AnvilInstance;
let h: HedgeHarness;

beforeAll(async () => {
  anvil = await startAnvil();
});
afterAll(async () => {
  await anvil?.stop();
});
beforeEach(async () => {
  h = await createHedgeHarness(anvil);
});
afterEach(async () => {
  await h?.close();
});

/** 5 contracts at $0.41: what one sale of these tests costs to hedge. */
const COST = 2_050_000n;
const GUARANTEE = 2_500_000n;
const QUIET = { bid: 4000n, ask: 4600n } as const;
const FILLING = { bid: 4000n, ask: 4100n } as const;

type Outcome = 0 | 1;

/** The desk row of the instrument, or null when it has none (no runner). */
async function deskRow(symbol: string): Promise<HedgeInstrument | null> {
  const [row] = await h.db<{ payload: unknown }[]>`
    select payload from live_hedge_desk where instrument = ${symbol}
  `;
  return row === undefined ? null : hedgeInstrumentSchema.parse(row.payload);
}

async function position(symbol: string): Promise<{ exposure: bigint; held: bigint } | null> {
  const { position: row } = await hedgeTables(h.db, symbol);
  return row === null ? null : { exposure: row.exposure, held: row.held };
}

/** Waits until `positions` and the desk row both show this exposure and held. */
async function expectPositionAndDesk(
  symbol: string,
  exposure: bigint,
  held: bigint,
  what: string,
): Promise<void> {
  await waitFor(async () => {
    const row = await position(symbol);
    const desk = await deskRow(symbol);
    return (
      row?.exposure === exposure &&
      row.held === held &&
      desk?.exposure === exposure.toString() &&
      desk.held === held.toString()
    );
  }, `${what}: exposure ${exposure.toString()}, held ${held.toString()} in positions and on the desk`);
}

/** Waits until the instrument has no runner (no desk row) and `positions.held` is `held`. */
async function expectRetired(symbol: string, held: bigint, what: string): Promise<void> {
  await waitFor(async () => {
    const row = await position(symbol);
    return row?.exposure === 0n && row.held === held && (await deskRow(symbol)) === null;
  }, `${what}: no runner, exposure 0 and held ${held.toString()}`);
}

/** Lots of one campaign, in FIFO order. */
async function campaignLots(
  campaign: Campaign,
): Promise<{ ticket: bigint; qty: bigint; filled: bigint; cost: bigint; charged: boolean }[]> {
  const rows = await h.db<
    { ticket: bigint; qty: bigint; filled_qty: bigint; cost: bigint; charged: boolean }[]
  >`
    select t.onchain_id as ticket, l.qty, l.filled_qty, l.cost, l.charged
    from lots l join tickets t on t.id = l.ticket_id
    where l.campaign_id = ${campaign.id} order by l.seq
  `;
  return rows.map((row) => ({
    ticket: row.ticket,
    qty: row.qty,
    filled: row.filled_qty,
    cost: row.cost,
    charged: row.charged,
  }));
}

async function chargedOf(campaign: Campaign): Promise<{ ticketId: bigint; amount: bigint }[]> {
  return (await h.hedgeChargedLogs())
    .filter((log) => log.campaignId === campaign.onchainId)
    .map((log) => ({ ticketId: log.ticketId, amount: log.amount }));
}

async function waitCharged(campaign: Campaign, count: number): Promise<void> {
  await waitFor(async () => {
    const lots = await campaignLots(campaign);
    return lots.length === count && lots.every((lot) => lot.charged);
  }, `the ${count.toString()} lot(s) of campaign ${campaign.onchainId.toString()} charged`);
}

async function sellOrders(symbol: string): Promise<number> {
  return (await hedgeTables(h.db, symbol)).orders.filter((order) => order.side === "sell").length;
}

/**
 * Closes the campaign's sales on-chain (the projection moves `sales_close`), and moves the
 * service's clock past that close when the chain's clock is ahead of it. The books are pushed
 * again at the new time, as a live feed would.
 */
async function closeSalesOnChain(market: Market, campaign: Campaign): Promise<void> {
  const { blockTime } = await h.driver.closeSales(campaign.onchainId);
  await waitFor(async () => {
    const [row] = await h.db<{ sales_close: Date }[]>`
      select sales_close from campaigns where id = ${campaign.id}
    `;
    return row?.sales_close.getTime() === blockTime.getTime();
  }, "the early sales close projected");
  const ahead = blockTime.getTime() - h.clock.nowMs();
  if (ahead >= 0) h.clock.advance(ahead + 1_000);
  h.books.refresh(market.symbol);
}

/**
 * Settles the campaign on-chain and waits for the projection to mark it settled. Sent through the
 * running transaction sender: it signs the hedge charges with the same oracle key, so a settle sent
 * beside it would take a nonce it is about to use.
 */
async function settleOnChain(campaign: Campaign, outcome: Outcome): Promise<void> {
  await h.send(
    {
      signer: "oracle",
      kind: "settle",
      to: h.env.escrow,
      data: encodeFunctionData({
        abi: winzEscrowAbi,
        functionName: "settle",
        args: [campaign.onchainId, outcome],
      }),
    },
    `test-settle-${campaign.onchainId.toString()}`,
  );
  const status = outcome === 0 ? "settled_yes" : "settled_no";
  await waitFor(async () => {
    const [row] = await h.db<{ status: string }[]>`
      select status from campaigns where id = ${campaign.id}
    `;
    return row?.status === status;
  }, `campaign ${campaign.onchainId.toString()} projected ${status}`);
}

/**
 * One campaign from its first sale to its settlement, alone selling on the instrument: a sale of
 * 5 contracts, the maker the runner rests for its exposure (not a leftover's), the fill allocated
 * to its lot, the charge on-chain, the sales close reconciled within one step, the finalizer ok,
 * the settlement; then the instrument has no runner and nothing held.
 */
async function playCampaign(
  market: Market,
  service: RunningService,
  outcome: Outcome,
  index: number,
): Promise<Campaign> {
  const campaign = await h.openCampaign(market);
  const before = await hedgeTables(h.db, market.symbol);
  const ordersBefore = before.orders.length;
  const fillsBefore = before.fills.length;

  const ticket = await h.sell(campaign, GUARANTEE);
  // The runner rests a maker for this campaign's whole exposure: nothing old is counted as held.
  await waitFor(async () => {
    const { orders } = await hedgeTables(h.db, market.symbol);
    return orders.length === ordersBefore + 1 && orders[ordersBefore]?.status === "working";
  }, `campaign ${index.toString()}: a maker for its exposure`);
  const maker = (await hedgeTables(h.db, market.symbol)).orders[ordersBefore];
  expect(maker).toMatchObject({ side: "buy", kind: "maker", price_bps: 4100 });
  expect(maker?.qty).toBe(5n * CONTRACT);
  await expectPositionAndDesk(
    market.symbol,
    5n * CONTRACT,
    0n,
    `campaign ${index.toString()} sold`,
  );

  h.books.push(market.symbol, FILLING.bid, FILLING.ask);
  await waitCharged(campaign, 1);
  h.books.push(market.symbol, QUIET.bid, QUIET.ask);
  const tables = await hedgeTables(h.db, market.symbol);
  expect(tables.fills).toHaveLength(fillsBefore + 1);
  expect(tables.fills[fillsBefore]?.qty).toBe(5n * CONTRACT);
  // Its fill went to its own lot, charged once at its cost.
  expect(await campaignLots(campaign)).toEqual([
    { ticket, qty: 5n * CONTRACT, filled: 5n * CONTRACT, cost: COST, charged: true },
  ]);
  expect(await chargedOf(campaign)).toEqual([{ ticketId: ticket, amount: COST }]);
  await expectPositionAndDesk(
    market.symbol,
    5n * CONTRACT,
    5n * CONTRACT,
    `campaign ${index.toString()} hedged`,
  );

  // Sales close: the sales-close pass reconciles within one step; the finalizer answers ok.
  const reconciledBefore = h.logs.filter(
    (entry) => entry.msg === "sales closed: position reconciled and remaining lots charged",
  ).length;
  await closeSalesOnChain(market, campaign);
  await waitFor(
    async () =>
      h.logs.filter(
        (entry) => entry.msg === "sales closed: position reconciled and remaining lots charged",
      ).length > reconciledBefore,
    `campaign ${index.toString()}: the sales-close reconciliation`,
  );
  await service.hedging.finalizer.finalize(campaign);
  const closed = await position(market.symbol);
  if (closed === null) throw new Error("no position");
  const gap = closed.held - closed.exposure;
  expect(gap < 0n ? -gap : gap).toBeLessThanOrEqual(CONTRACT_STEP_MICRO);
  expect(await onchainCampaign(h.env, campaign.onchainId)).toMatchObject({
    hedgeReserved: 0n,
    hedgeSpent: COST,
  });

  await settleOnChain(campaign, outcome);
  // Its contracts were paid out: no runner, nothing held, nothing sold for them.
  await expectRetired(market.symbol, 0n, `campaign ${index.toString()} settled`);
  expect(await sellOrders(market.symbol)).toBe(0);
  expect(await chargedOf(campaign)).toEqual([{ ticketId: ticket, amount: COST }]);
  return campaign;
}

async function playInARow(outcomes: readonly Outcome[], restartBetween: boolean): Promise<void> {
  const market = await h.createMarket();
  h.books.push(market.symbol, QUIET.bid, QUIET.ask);
  let service = h.startService();
  const campaigns: Campaign[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    if (index > 0 && restartBetween) {
      await service.stop();
      service = h.startService();
    }
    campaigns.push(await playCampaign(market, service, outcome, index + 1));
  }

  // Each campaign paid for its own lot once, and only its own.
  const charged = await h.hedgeChargedLogs();
  expect(charged).toHaveLength(outcomes.length);
  expect(new Set(charged.map((log) => log.campaignId))).toEqual(
    new Set(campaigns.map((campaign) => campaign.onchainId)),
  );
  const tables = await hedgeTables(h.db, market.symbol);
  expect(tables.orders.every((order) => order.side === "buy")).toBe(true);
  expect(tables.fills).toHaveLength(outcomes.length);
  expect(tables.lotFills[0]).toEqual({
    lot_qty_sum: BigInt(outcomes.length) * 5n * CONTRACT,
    lot_cost_sum: BigInt(outcomes.length) * COST,
  });
  // A restarted engine starts from the same held: nothing is left over for a new runner.
  expect(
    h.logs.some(
      (entry) =>
        entry.msg === "hedging runner started" &&
        entry.instrument === market.symbol &&
        entry.held !== "0",
    ),
  ).toBe(false);
}

describe("a new campaign on the instrument of a settled one", () => {
  it("is hedged, charged and reconciled after a campaign settled YES (one engine)", async () => {
    await playInARow([0, 0], false);
  });

  it("is hedged, charged and reconciled after a campaign settled YES (hedging restarted between)", async () => {
    await playInARow([0, 0], true);
  });

  it("is hedged, charged and reconciled after a campaign settled NO (one engine)", async () => {
    await playInARow([1, 0], false);
  });

  it("is hedged, charged and reconciled after a campaign settled NO (hedging restarted between)", async () => {
    await playInARow([1, 1], true);
  });

  it("three campaigns in a row on one instrument (one engine)", async () => {
    await playInARow([0, 1, 0], false);
  });

  it("three campaigns in a row on one instrument (hedging restarted between each)", async () => {
    await playInARow([1, 0, 1], true);
  });
});

describe("a campaign settling while another one on the instrument is still selling", () => {
  it("leaves the other's allocations, charges and resting order alone, sells nothing, and the runner hedges the rest", async () => {
    const market = await h.createMarket();
    h.books.push(market.symbol, QUIET.bid, QUIET.ask);
    h.startService();

    // Campaign 1: sold, hedged and charged.
    const first = await h.openCampaign(market);
    const firstTicket = await h.sell(first, GUARANTEE);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).orders.length === 1,
      "the maker of campaign 1",
    );
    h.books.push(market.symbol, FILLING.bid, FILLING.ask);
    await waitCharged(first, 1);
    h.books.push(market.symbol, QUIET.bid, QUIET.ask);
    await expectPositionAndDesk(market.symbol, 5n * CONTRACT, 5n * CONTRACT, "campaign 1 hedged");

    // Campaign 2 sells; its maker rests and is filled 2 contracts out of 5 (displayed depth).
    const second = await h.openCampaign(market);
    const secondTicket = await h.sell(second, GUARANTEE);
    await waitFor(async () => {
      const { orders } = await hedgeTables(h.db, market.symbol);
      return orders.length === 2 && orders[1]?.status === "working";
    }, "the maker of campaign 2");
    const makerId = (await hedgeTables(h.db, market.symbol)).orders[1]?.venue_order_id ?? "";
    expect((await hedgeTables(h.db, market.symbol)).orders[1]?.qty).toBe(5n * CONTRACT);
    h.books.push(market.symbol, FILLING.bid, FILLING.ask, 2n * CONTRACT);
    await waitFor(async () => {
      const { orders } = await hedgeTables(h.db, market.symbol);
      return orders[1]?.status === "partially_filled" && orders[1].filled_qty === 2n * CONTRACT;
    }, "the maker of campaign 2 partly filled");
    h.books.push(market.symbol, QUIET.bid, QUIET.ask);
    await expectPositionAndDesk(
      market.symbol,
      10n * CONTRACT,
      7n * CONTRACT,
      "campaign 2 partly hedged",
    );
    const partlyCovered = await campaignLots(second);
    expect(partlyCovered).toEqual([
      {
        ticket: secondTicket,
        qty: 5n * CONTRACT,
        filled: 2n * CONTRACT,
        cost: 820_000n,
        charged: false,
      },
    ]);

    // Campaign 1 closes and settles while that order rests, partly filled.
    await h.driver.closeSales(first.onchainId);
    await settleOnChain(first, 0);
    // Within a pass: its 5 contracts leave H with its lot's exposure, in positions and on the desk.
    await expectPositionAndDesk(market.symbol, 5n * CONTRACT, 2n * CONTRACT, "campaign 1 settled");
    const atSettlement = await hedgeTables(h.db, market.symbol);
    expect(atSettlement.orders[1]).toMatchObject({
      venue_order_id: makerId,
      status: "partially_filled",
    });
    expect(atSettlement.orders).toHaveLength(2);
    expect(await sellOrders(market.symbol)).toBe(0);
    // Campaign 2's allocation and (absent) charge are untouched; campaign 1's charge stays single.
    expect(await campaignLots(second)).toEqual(partlyCovered);
    expect(await chargedOf(second)).toEqual([]);
    expect(await chargedOf(first)).toEqual([{ ticketId: firstTicket, amount: COST }]);
    // The runner reports what campaign 2's lot holds plus the inventory ahead (none).
    const desk = await deskRow(market.symbol);
    expect(desk?.held).toBe((2n * CONTRACT).toString());
    expect(
      desk?.orders.some((order) => order.id === makerId && order.status === "partially_filled"),
    ).toBe(true);

    // The rest of the resting order fills: each of its fills counted once, campaign 2 covered.
    h.books.push(market.symbol, FILLING.bid, FILLING.ask);
    await waitCharged(second, 1);
    h.books.push(market.symbol, QUIET.bid, QUIET.ask);
    await expectPositionAndDesk(market.symbol, 5n * CONTRACT, 5n * CONTRACT, "campaign 2 hedged");
    const tables = await hedgeTables(h.db, market.symbol);
    expect(tables.orders).toHaveLength(2);
    expect(tables.orders[1]).toMatchObject({ venue_order_id: makerId, status: "filled" });
    expect(tables.orders[1]?.filled_qty).toBe(5n * CONTRACT);
    const makerFills = tables.fills.filter((fill) => fill.venue_order_id === makerId);
    expect(makerFills.map((fill) => fill.qty)).toEqual([2n * CONTRACT, 3n * CONTRACT]);
    expect(await campaignLots(second)).toEqual([
      {
        ticket: secondTicket,
        qty: 5n * CONTRACT,
        filled: 5n * CONTRACT,
        cost: COST,
        charged: true,
      },
    ]);
    expect(await chargedOf(second)).toEqual([{ ticketId: secondTicket, amount: COST }]);
    expect(await sellOrders(market.symbol)).toBe(0);
    // Campaign 1's lot kept its allocation: settled lots are never touched.
    expect(await campaignLots(first)).toEqual([
      { ticket: firstTicket, qty: 5n * CONTRACT, filled: 5n * CONTRACT, cost: COST, charged: true },
    ]);
    expect(
      h.logs.filter(
        (entry) =>
          entry.msg ===
          "campaigns settled: the contracts allocated to their lots are no longer held",
      ),
    ).toEqual([
      expect.objectContaining({
        instrument: market.symbol,
        released: (5n * CONTRACT).toString(),
        exposure: (5n * CONTRACT).toString(),
      }),
    ]);

    // Campaign 2 settles in turn: no runner, nothing held.
    await closeSalesOnChain(market, second);
    await waitFor(
      async () => (await onchainCampaign(h.env, second.onchainId)).hedgeReserved === 0n,
      "campaign 2's reservation released",
    );
    await settleOnChain(second, 1);
    await expectRetired(market.symbol, 0n, "campaign 2 settled");
    expect(await sellOrders(market.symbol)).toBe(0);
  });
});
