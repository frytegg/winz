/**
 * H-10 end to end on a local chain: a sale projected from the real escrow makes the runner rest a
 * maker on the paper venue, the book fills it, the fill is allocated to the lot, `chargeHedge` is
 * mined through the real transaction sender, and the projection marks the lot charged. Also the
 * taker fallback with the guarantee loss, and two merchants on one instrument.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAddress } from "viem";

import { hedgeInstrumentSchema } from "@winz/shared";

import { startAnvil, type AnvilInstance } from "../../testing/anvil";
import { takerCost } from "../allocation";
import {
  CONTRACT,
  USDC,
  createHedgeHarness,
  enginePnl,
  hedgeTables,
  onchainCampaign,
  waitAllCharged,
  waitFor,
  type HedgeHarness,
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

describe("hedging service, one sale end to end", () => {
  it("rests a maker, fills it from the book, allocates, charges on-chain and publishes the desk", async () => {
    const market = await h.createMarket();
    const campaign = await h.openCampaign(market);
    h.books.push(market.symbol, 4000n, 4600n);
    const service = h.startService();

    const ticketId = await h.sell(campaign, 2_500_000n); // 5 contracts owed if YES
    await waitFor(async () => {
      const { orders } = await hedgeTables(h.db, market.symbol);
      return orders.some((order) => order.status === "working" && order.kind === "maker");
    }, "a resting maker");
    const { orders: resting } = await hedgeTables(h.db, market.symbol);
    expect(resting).toHaveLength(1);
    expect(resting[0]).toMatchObject({ side: "buy", kind: "maker", price_bps: 4100 });
    expect(resting[0]?.qty).toBe(5n * CONTRACT);

    // The ask comes down to the maker's price: the paper venue fills it at its limit.
    h.books.push(market.symbol, 4000n, 4100n);
    await waitAllCharged(h.db, market.symbol);
    // `positions.working` follows the runner on the service's tick, not in the fill's transaction.
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).position?.working === 0n,
      "the working quantity back to zero",
    );

    const tables = await hedgeTables(h.db, market.symbol);
    expect(tables.orders).toHaveLength(1);
    expect(tables.orders[0]).toMatchObject({ status: "filled" });
    expect(tables.orders[0]?.filled_qty).toBe(5n * CONTRACT);
    expect(tables.fills).toHaveLength(1);
    expect(tables.fills[0]).toMatchObject({ side: "buy", price_bps: 4100 });
    expect(tables.fills[0]?.qty).toBe(5n * CONTRACT);
    expect(tables.fills[0]?.fee).toBe(0n); // maker fee waived on the paper venue
    const cost = 2_050_000n; // 5 contracts × $0.41
    expect(tables.lotFills[0]).toEqual({ lot_qty_sum: 5n * CONTRACT, lot_cost_sum: cost });
    expect(tables.lots).toHaveLength(1);
    expect(tables.lots[0]).toMatchObject({
      ticket_onchain_id: ticketId,
      filled_qty: 5n * CONTRACT,
      cost,
      charged: true,
      charged_amount: cost,
    });
    expect(tables.position).toEqual({ exposure: 5n * CONTRACT, held: 5n * CONTRACT, working: 0n });

    // On-chain: charged once, for the real cost (below the guarantee), reservation released.
    expect(await h.hedgeChargedLogs()).toEqual([
      { ticketId, campaignId: campaign.onchainId, amount: cost },
    ]);
    expect(await onchainCampaign(h.env, campaign.onchainId)).toMatchObject({
      hedgeReserved: 0n,
      hedgeSpent: cost,
    });

    // The maker saved the taker fee against buying at the ask the fill's book showed.
    const takerFee = takerCost(4100n, 5n * CONTRACT) - cost;
    expect(takerFee).toBeGreaterThan(0n);
    const pnl = await enginePnl(h.db, market.eventTicker);
    expect(pnl).toEqual({ makerSavings: takerFee, guaranteeLosses: 0n, resaleResult: 0n });

    await waitFor(async () => {
      const [row] = await h.db<{ payload: unknown }[]>`
        select payload from live_hedge_desk where instrument = ${market.symbol}
      `;
      const parsed = hedgeInstrumentSchema.safeParse(row?.payload);
      return (
        parsed.success &&
        parsed.data.held === (5n * CONTRACT).toString() &&
        parsed.data.fills.length === 1
      );
    }, "the desk row with the fill");
    const [desk] = await h.db<{ payload: unknown }[]>`
      select payload from live_hedge_desk where instrument = ${market.symbol}
    `;
    const payload = hedgeInstrumentSchema.parse(desk?.payload);
    expect(payload).toMatchObject({
      symbol: market.symbol,
      label: "Texas wins",
      eventTitle: "Texas vs Arkansas",
      bidBps: 4000,
      askBps: 4100,
      stale: false,
      exposure: (5n * CONTRACT).toString(),
      held: (5n * CONTRACT).toString(),
      working: "0",
      unhedgedNotional: "0",
      breaker: { active: false, reason: null },
      makerSavings: takerFee.toString(),
    });
    expect(payload.orders).toHaveLength(1);
    expect(service.hedging.breakerStatus(market.symbol)).toEqual({ active: false, reason: null });
  });

  it("falls back to a taker after the maker TTL; the cost above the guarantee is the platform's", async () => {
    await h.db`insert into engine_params (key, value) values ('makerTtlSeconds', '1')`;
    const market = await h.createMarket();
    const campaign = await h.openCampaign(market);
    h.books.push(market.symbol, 4000n, 4600n);
    h.startService();
    const guarantee = 2_000_000n; // below what 5 contracts cost at the ask
    const ticketId = await h.sell(campaign, guarantee);
    await waitAllCharged(h.db, market.symbol);

    const tables = await hedgeTables(h.db, market.symbol);
    expect(tables.orders.map((order) => [order.kind, order.status])).toEqual([
      ["maker", "cancelled"],
      ["taker", "filled"],
    ]);
    expect(tables.fills).toHaveLength(1);
    const fill = tables.fills[0];
    if (fill === undefined) throw new Error("no fill");
    expect(fill.price_bps).toBe(4600);
    const cost = (fill.qty * 4600n + 9_999n) / 10_000n + fill.fee;
    expect(fill.fee).toBeGreaterThan(0n);
    expect(tables.lots[0]).toMatchObject({ cost, charged: true, charged_amount: guarantee });
    expect(await h.hedgeChargedLogs()).toEqual([
      { ticketId, campaignId: campaign.onchainId, amount: guarantee },
    ]);
    expect((await enginePnl(h.db, market.eventTicker)).guaranteeLosses).toBe(cost - guarantee);
  });

  it("two merchants on one instrument: each pays its own lots, never above its quotes", async () => {
    const market = await h.createMarket();
    const merchantB = getAddress("0x000000000000000000000000000000000000ba12");
    const a = await h.openCampaign(market);
    const b = await h.openCampaign(market, { merchant: merchantB, unitPrice: 2n * USDC });
    h.books.push(market.symbol, 4000n, 4600n);
    h.startService();

    // A sells 5 contracts, hedged at $0.41.
    const a1 = await h.sell(a, 2_500_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).orders.length === 1,
      "maker 1",
    );
    h.books.push(market.symbol, 4000n, 4100n);
    await waitAllCharged(h.db, market.symbol);

    // The market moves up; B sells 2 contracts, hedged at $0.51.
    h.books.push(market.symbol, 5000n, 5600n);
    const b1 = await h.sell(b, 1_200_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).orders.length === 2,
      "maker 2",
    );
    h.books.push(market.symbol, 5000n, 5100n);
    await waitAllCharged(h.db, market.symbol);

    // A sells 5 more with a tight guarantee ($2.40 < 5 × $0.51): the platform pays the difference.
    h.books.push(market.symbol, 5000n, 5600n);
    const a2 = await h.sell(a, 2_400_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).orders.length === 3,
      "maker 3",
    );
    h.books.push(market.symbol, 5000n, 5100n);
    await waitAllCharged(h.db, market.symbol);

    const tables = await hedgeTables(h.db, market.symbol);
    expect(tables.lots.map((lot) => [lot.ticket_onchain_id, lot.cost, lot.charged_amount])).toEqual(
      [
        [a1, 2_050_000n, 2_050_000n],
        [b1, 1_020_000n, 1_020_000n],
        [a2, 2_550_000n, 2_400_000n],
      ],
    );
    for (const lot of tables.lots) {
      expect(lot.charged_amount ?? 0n).toBeLessThanOrEqual(lot.max_hedge_cost);
      expect(lot.campaign_id).toBe(lot.ticket_onchain_id === b1 ? b.id : a.id);
    }
    const charged = await h.hedgeChargedLogs();
    const byCampaign = (id: bigint): bigint =>
      charged.filter((log) => log.campaignId === id).reduce((sum, log) => sum + log.amount, 0n);
    expect(byCampaign(a.onchainId)).toBe(2_050_000n + 2_400_000n);
    expect(byCampaign(b.onchainId)).toBe(1_020_000n);
    expect((await onchainCampaign(h.env, a.onchainId)).hedgeSpent).toBe(4_450_000n);
    expect((await onchainCampaign(h.env, b.onchainId)).hedgeSpent).toBe(1_020_000n);

    // Charged plus the platform's guarantee losses is exactly what the fills cost.
    const fillCost = tables.fills.reduce(
      (sum, fill) => sum + (fill.qty * BigInt(fill.price_bps) + 9_999n) / 10_000n + fill.fee,
      0n,
    );
    const pnl = await enginePnl(h.db, market.eventTicker);
    expect(pnl.guaranteeLosses).toBe(150_000n);
    expect(byCampaign(a.onchainId) + byCampaign(b.onchainId) + pnl.guaranteeLosses).toBe(fillCost);
  });
});
