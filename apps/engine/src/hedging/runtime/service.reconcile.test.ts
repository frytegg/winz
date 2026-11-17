/**
 * Inventory held ahead of exposure, and the reconciliation at sales close (H-08, HE-6): the
 * position ends within one 0.01 contract step of the exposure, a surplus is sold with its result
 * recorded, every remaining lot is charged (zero-quantity and zero-guarantee lots charged zero),
 * and `hedgeReserved` is zero on-chain for every campaign of the instrument.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionData } from "viem";

import { CONTRACT_STEP_MICRO, winzEscrowAbi } from "@winz/shared";

import type { TxRequest } from "../../chain";
import { startAnvil, type AnvilInstance } from "../../testing/anvil";
import { recordFill, takerCost } from "../allocation";
import type { ChargeTxSender } from "./charger";
import { HedgeFinalizeError, HedgeNotReconciledError } from "./errors";
import { HedgingService } from "./service";
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
  type Market,
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

/** Moves the sales close of every campaign of the instrument into the past (the clock passed it). */
async function closeSales(market: Market): Promise<void> {
  await h.db`
    update campaigns set sales_close = ${new Date(h.clock.nowMs() - 1_000)}
    where instrument = ${market.symbol}
  `;
}

function within(held: bigint, exposure: bigint): boolean {
  const gap = held > exposure ? held - exposure : exposure - held;
  return gap <= CONTRACT_STEP_MICRO;
}

async function chargeTxCount(): Promise<number> {
  const [row] = await h.db<{ n: bigint }[]>`
    select count(*)::bigint as n from chain_txs where kind = 'chargeHedge'
  `;
  return Number(row?.n ?? 0n);
}

describe("inventory held ahead of exposure", () => {
  it("covers a lot created later without a new order", async () => {
    const market = await h.createMarket();
    // 5 USDC × 33.33 % = 1 666 500 micro-contracts: bought rounded up to 1.67 contracts.
    const a = await h.openCampaign(market, { refundBps: 3_333 });
    const small = await h.openCampaign(market, { unitPrice: 3_500n });
    h.books.push(market.symbol, 4000n, 4600n);
    h.startService();

    await h.sell(a, 900_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).orders.length === 1,
      "maker",
    );
    const [maker] = (await hedgeTables(h.db, market.symbol)).orders;
    expect(maker?.qty).toBe(1_670_000n);
    h.books.push(market.symbol, 4000n, 4100n);
    await waitAllCharged(h.db, market.symbol);

    // 3 500 micro-contracts are held unallocated; a sale of exactly that size comes in.
    const ticket = await h.sell(small, 10_000n);
    await waitAllCharged(h.db, market.symbol);

    const tables = await hedgeTables(h.db, market.symbol);
    expect(tables.orders).toHaveLength(1);
    expect(tables.fills).toHaveLength(1);
    const lot = tables.lots.find((row) => row.ticket_onchain_id === ticket);
    // 3 500 of the 1 670 000 bought at $0.41: what they cost, a share of the fill.
    expect(lot).toMatchObject({ qty: 3_500n, filled_qty: 3_500n, charged: true });
    expect(lot?.cost).toBe(1_435n);
    expect(lot?.charged_amount).toBe(1_435n);
    expect(tables.position).toMatchObject({ exposure: 1_670_000n, held: 1_670_000n });
    expect(await h.hedgeChargedLogs()).toHaveLength(2);
  });
});

describe("reconciliation at sales close", () => {
  it("cancels the makers, buys the shortfall taker and charges every remaining lot; finalize twice is harmless", async () => {
    const market = await h.createMarket();
    const a = await h.openCampaign(market, { refundBps: 3_333 });
    // 1 micro-USDC × 0.01 %: a sale owing nothing, a lot of zero contracts.
    const z = await h.openCampaign(market, { unitPrice: 1n, refundBps: 1 });
    h.books.push(market.symbol, 4000n, 4600n);
    const service = h.startService();

    await h.sell(a, 900_000n);
    await h.sell(a, 0n); // guaranteed at zero: the merchant pays nothing for its hedge
    await h.sell(z, 0n);
    await waitFor(async () => {
      const { orders, position } = await hedgeTables(h.db, market.symbol);
      return position?.exposure === 3_333_000n && orders.some((o) => o.status === "working");
    }, "makers for the exposure");

    await closeSales(market);
    await waitAllCharged(h.db, market.symbol);
    // `positions.working` follows the runner on the service's tick, not in the fill's transaction.
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).position?.working === 0n,
      "the working quantity back to zero",
    );

    const tables = await hedgeTables(h.db, market.symbol);
    expect(
      tables.orders.filter((o) => o.kind === "maker").every((o) => o.status === "cancelled"),
    ).toBe(true);
    const takers = tables.orders.filter((o) => o.kind === "taker");
    expect(takers).toHaveLength(1);
    expect(takers[0]).toMatchObject({ side: "buy", status: "filled" });
    expect(takers[0]?.qty).toBe(3_340_000n);
    const position = tables.position;
    if (position === null) throw new Error("no position");
    expect(within(position.held, position.exposure)).toBe(true);
    expect(position).toMatchObject({ held: 3_340_000n, working: 0n });

    const [lot1, lot2, lot3] = tables.lots;
    expect(lot1).toMatchObject({ qty: 1_666_500n, filled_qty: 1_666_500n, charged: true });
    expect(lot1?.charged_amount).toBe(
      lot1 !== undefined ? (lot1.cost < 900_000n ? lot1.cost : 900_000n) : -1n,
    );
    expect(lot2).toMatchObject({
      qty: 1_666_500n,
      filled_qty: 1_666_500n,
      charged: true,
      charged_amount: 0n,
    });
    expect(lot3).toMatchObject({ qty: 0n, charged: true, charged_amount: 0n });
    const pnl = await enginePnl(h.db, market.eventTicker);
    expect(pnl.guaranteeLosses).toBe(
      (lot2?.cost ?? 0n) + (lot1 !== undefined && lot1.cost > 900_000n ? lot1.cost - 900_000n : 0n),
    );

    for (const campaign of [a, z]) {
      expect((await onchainCampaign(h.env, campaign.onchainId)).hedgeReserved).toBe(0n);
    }
    expect(
      h.logs.filter(
        (entry) => entry.msg === "sales closed: position reconciled and remaining lots charged",
      ),
    ).toHaveLength(1);

    const txsBefore = await chargeTxCount();
    const logsBefore = (await h.hedgeChargedLogs()).length;
    for (const campaign of [a, a, z]) await service.hedging.finalizer.finalize(campaign);
    expect(await chargeTxCount()).toBe(txsBefore);
    expect(await h.hedgeChargedLogs()).toHaveLength(logsBefore);
    expect(logsBefore).toBe(3);
  });

  it("a thin book leaves a lot covered in part: within one step, charged what covers it", async () => {
    // The event starts in 30 minutes: every purchase is hedged taker at once (force taker).
    const market = await h.createMarket({ startsInMs: 30 * 60_000 });
    const a = await h.openCampaign(market, { refundBps: 3_333 });
    // Only 1 660 000 micro-contracts on offer: 6 500 short of the exposure, less than a step.
    h.books.push(market.symbol, 4000n, 4600n, 1_660_000n);
    const service = h.startService();
    const ticket = await h.sell(a, 900_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).fills.length === 1,
      "taker fill",
    );

    await closeSales(market);
    await service.hedging.finalizer.finalize(a);
    await waitAllCharged(h.db, market.symbol);

    const tables = await hedgeTables(h.db, market.symbol);
    const position = tables.position;
    if (position === null) throw new Error("no position");
    expect(position.held).toBe(1_660_000n);
    expect(within(position.held, position.exposure)).toBe(true);
    const lot = tables.lots[0];
    expect(lot).toMatchObject({ qty: 1_666_500n, filled_qty: 1_660_000n, charged: true });
    expect(lot?.cost).toBe(takerCost(4600n, 1_660_000n));
    expect(lot?.charged_amount).toBe(lot?.cost);
    expect(await h.hedgeChargedLogs()).toEqual([
      { ticketId: ticket, campaignId: a.onchainId, amount: lot?.cost ?? -1n },
    ]);
    expect((await onchainCampaign(h.env, a.onchainId)).hedgeReserved).toBe(0n);
  });

  it("sells a surplus and records the resale result", async () => {
    const market = await h.createMarket();
    const a = await h.openCampaign(market);
    await h.sell(a, 2_500_000n); // 5 contracts owed
    // 8 contracts were bought at $0.40 by an earlier process: 3 too many.
    const [order] = await h.db<{ id: string }[]>`
      insert into orders (instrument, side, kind, price_bps, qty, filled_qty, status, venue, venue_order_id)
      values (${market.symbol}, 'buy', 'taker', 4000, ${(8n * CONTRACT).toString()}::bigint,
              ${(8n * CONTRACT).toString()}::bigint, 'filled', 'paper', 'earlier-process-1')
      returning id
    `;
    if (order === undefined) throw new Error("order not inserted");
    await recordFill(h.db, {
      orderId: order.id,
      venueFillId: "earlier-fill-1",
      priceBps: 4000n,
      qty: 8n * CONTRACT,
      fee: 0n,
      at: new Date(),
      bookRef: null,
    });
    h.books.push(market.symbol, 4500n, 4600n);
    h.startService();
    await waitAllCharged(h.db, market.symbol);
    expect((await hedgeTables(h.db, market.symbol)).lots[0]?.charged_amount).toBe(2n * USDC);

    await closeSales(market);
    await waitFor(async () => {
      const { orders } = await hedgeTables(h.db, market.symbol);
      return orders.some((o) => o.side === "sell" && o.status === "filled");
    }, "the surplus sold");
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).position?.held === 5n * CONTRACT,
      "held",
    );

    const tables = await hedgeTables(h.db, market.symbol);
    const sale = tables.fills.find((fill) => fill.side === "sell");
    if (sale === undefined) throw new Error("no sale");
    expect(sale.qty).toBe(3n * CONTRACT);
    expect(sale.price_bps).toBe(4500);
    const proceeds = (sale.qty * 4500n) / 10_000n - sale.fee;
    const costBasis = 1_200_000n; // 3 contracts at $0.40
    expect((await enginePnl(h.db, market.eventTicker)).resaleResult).toBe(proceeds - costBasis);
    expect(proceeds - costBasis).toBeGreaterThan(0n);
    expect((await onchainCampaign(h.env, a.onchainId)).hedgeReserved).toBe(0n);
  });
});

/** Every `chargeHedge` row, oldest first. */
async function chargeTxs(): Promise<
  { id: string; status: string; tickets: string[]; last_error: string | null }[]
> {
  return h.db<{ id: string; status: string; tickets: string[]; last_error: string | null }[]>`
    select id, status, payload -> 'ticketIds' as tickets, last_error
    from chain_txs where kind = 'chargeHedge' order by created_at
  `;
}

describe("final charges of lots covered in part", () => {
  it("are capped at the guarantee, the rest booked once as the platform's loss", async () => {
    const market = await h.createMarket({ startsInMs: 30 * 60_000 });
    const a = await h.openCampaign(market, { refundBps: 3_333 });
    // 1 660 000 of 1 666 500 contracts on offer at $0.46: they cost more than the 700 000 guarantee.
    h.books.push(market.symbol, 4000n, 4600n, 1_660_000n);
    const service = h.startService();
    const ticket = await h.sell(a, 700_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).fills.length === 1,
      "taker fill",
    );

    await closeSales(market);
    await service.hedging.finalizer.finalize(a);
    await waitAllCharged(h.db, market.symbol);

    const lot = (await hedgeTables(h.db, market.symbol)).lots[0];
    const cost = takerCost(4600n, 1_660_000n);
    expect(cost).toBeGreaterThan(700_000n);
    expect(lot).toMatchObject({ filled_qty: 1_660_000n, cost, charged: true });
    expect(lot?.charged_amount).toBe(700_000n);
    expect(await h.hedgeChargedLogs()).toEqual([
      { ticketId: ticket, campaignId: a.onchainId, amount: 700_000n },
    ]);
    expect((await enginePnl(h.db, market.eventTicker)).guaranteeLosses).toBe(cost - 700_000n);
    expect((await onchainCampaign(h.env, a.onchainId)).hedgeReserved).toBe(0n);

    // Finalized again: nothing more is charged or booked.
    await service.hedging.finalizer.finalize(a);
    expect((await enginePnl(h.db, market.eventTicker)).guaranteeLosses).toBe(cost - 700_000n);
    expect(await chargeTxs()).toHaveLength(1);
  });

  it("a final charge that fails and is sent again books its loss once", async () => {
    await h.stopSender();
    const market = await h.createMarket({ startsInMs: 30 * 60_000 });
    const a = await h.openCampaign(market, { refundBps: 3_333 });
    h.books.push(market.symbol, 4000n, 4600n, 1_660_000n);
    const service = h.startService();
    const ticket = await h.sell(a, 700_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).fills.length === 1,
      "taker fill",
    );
    await closeSales(market);
    await waitFor(async () => (await chargeTxs()).length === 1, "the final charge queued");
    // Queued, not mined: nothing is booked yet.
    expect((await enginePnl(h.db, market.eventTicker)).guaranteeLosses).toBe(0n);

    // The node refused it: a failure that may pass. The charge is queued again under a new key.
    const [first] = await chargeTxs();
    await h.db`
      update chain_txs set status = 'failed', last_error = 'broadcast refused 5 times: node down'
      where id = ${first?.id ?? ""}
    `;
    await h.restartSender();
    await service.hedging.finalizer.finalize(a);
    await waitAllCharged(h.db, market.symbol);

    const txs = await chargeTxs();
    expect(txs).toHaveLength(2);
    expect(txs[0]?.status).toBe("failed");
    expect(txs[1]).toMatchObject({ status: "mined", tickets: [ticket.toString()] });
    const cost = takerCost(4600n, 1_660_000n);
    expect((await enginePnl(h.db, market.eventTicker)).guaranteeLosses).toBe(cost - 700_000n);
    expect(await h.hedgeChargedLogs()).toEqual([
      { ticketId: ticket, campaignId: a.onchainId, amount: 700_000n },
    ]);
    expect((await onchainCampaign(h.env, a.onchainId)).hedgeReserved).toBe(0n);
  });
});

describe("finalize", () => {
  it("throws while a ticket the escrow refused for good still holds its reservation", async () => {
    // An outbox that asks for 1 USDC more than each amount: the escrow refuses every charge
    // (HedgeAboveGuarantee) and the reservations stay held.
    const inflating: ChargeTxSender = {
      enqueue: (request: TxRequest) => {
        const { args } = decodeFunctionData({ abi: winzEscrowAbi, data: request.data });
        const [ticketIds, amounts] = args as readonly [readonly bigint[], readonly bigint[]];
        const data = encodeFunctionData({
          abi: winzEscrowAbi,
          functionName: "chargeHedge",
          args: [[...ticketIds], amounts.map((amount) => amount + USDC)],
        });
        return h.sender().enqueue({ ...request, data });
      },
    };
    const market = await h.createMarket({ startsInMs: 30 * 60_000 });
    const a = await h.openCampaign(market);
    h.books.push(market.symbol, 4000n, 4600n);
    const service = h.startService({ txSender: inflating });
    const ticket = await h.sell(a, 2_500_000n);
    await waitFor(async () => {
      const txs = await chargeTxs();
      return txs.some((tx) => tx.status === "failed" && tx.last_error === "HedgeAboveGuarantee");
    }, "the charge refused");

    await closeSales(market);
    const outcome = service.hedging.finalizer.finalize(a);
    await expect(outcome).rejects.toBeInstanceOf(HedgeFinalizeError);
    await expect(outcome).rejects.toThrow(
      new RegExp(`ticket ${ticket.toString()} \\(HedgeAboveGuarantee\\)`),
    );
    expect((await onchainCampaign(h.env, a.onchainId)).hedgeReserved).toBe(2_500_000n);
    expect(await h.hedgeChargedLogs()).toEqual([]);
  });

  it("never reconciles a runner while the sales-close pass reconciles it", async () => {
    let running = 0;
    let most = 0;
    const proto = HedgingService.prototype as unknown as {
      reconcile: (...args: unknown[]) => Promise<unknown>;
    };
    const original = proto.reconcile;
    const spy = vi.spyOn(proto, "reconcile").mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      running += 1;
      most = Math.max(most, running);
      try {
        return await original.apply(this, args);
      } finally {
        running -= 1;
      }
    });
    try {
      const market = await h.createMarket();
      const a = await h.openCampaign(market);
      // No ask: the reconciliation cannot buy, and each attempt runs until its timeout.
      h.books.push(market.symbol, 4000n, null);
      const service = h.startService({ reconcileTimeoutMs: 1_500 });
      await h.sell(a, 2_500_000n);
      await waitFor(
        async () => (await hedgeTables(h.db, market.symbol)).position?.exposure === 5n * CONTRACT,
        "exposure",
      );
      await closeSales(market);
      await expect(service.hedging.finalizer.finalize(a)).rejects.toBeInstanceOf(
        HedgeNotReconciledError,
      );
      // Sales-close passes keep retrying meanwhile: still never two at once.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(most).toBe(1);
      await service.stop();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("an instrument with nothing to hedge", () => {
  it("has its zero lots charged without a runner and without waiting for sales close or finalize", async () => {
    const market = await h.createMarket();
    // 1 micro-USDC × 0.01 %: a sale owing nothing, a lot of zero contracts. Covered as it is
    // created (filled 0 of 0), so the covered-lot charges release its reservation at once.
    const z = await h.openCampaign(market, { unitPrice: 1n, refundBps: 1 });
    h.books.push(market.symbol, 4000n, 4600n);
    h.startService();
    const ticket = await h.sell(z, 0n);
    await waitAllCharged(h.db, market.symbol);
    expect(await h.hedgeChargedLogs()).toEqual([
      { ticketId: ticket, campaignId: z.onchainId, amount: 0n },
    ]);
    expect((await onchainCampaign(h.env, z.onchainId)).hedgeReserved).toBe(0n);
    expect((await hedgeTables(h.db, market.symbol)).orders).toEqual([]);
  });
});
