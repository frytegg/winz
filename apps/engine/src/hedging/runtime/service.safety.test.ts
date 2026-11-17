/**
 * The safety rails of the hedging service: the circuit breaker (HE-5) as the desk and the
 * sale-state evaluator see it, a `chargeHedge` batch poisoned by a ticket of a settled campaign,
 * and a stop on abort that leaves no timer and no half-written row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, getAddress } from "viem";

import { hedgeInstrumentSchema, winzEscrowAbi } from "@winz/shared";

import { ChainProjector, LogPoller, type TxRequest } from "../../chain";
import { startAnvil, type AnvilInstance } from "../../testing/anvil";
import type { ChargeTxSender } from "./charger";
import {
  CONTRACT,
  USDC,
  createHedgeHarness,
  hedgeTables,
  waitFor,
  type HedgeHarness,
} from "./test-support";

let anvil: AnvilInstance;
let h: HedgeHarness | null = null;

beforeAll(async () => {
  anvil = await startAnvil();
});
afterAll(async () => {
  await anvil?.stop();
});
afterEach(async () => {
  await h?.close();
  h = null;
});

/** Reads the escrow's logs and projects them, once per call (instead of the ingest loops). */
function manualProjection(harness: HedgeHarness): () => Promise<void> {
  const poller = new LogPoller(
    harness.db,
    harness.env.publicClient,
    { escrowAddress: harness.env.escrow, fromBlock: harness.env.deployedAtBlock },
    harness.logger,
  );
  const projector = new ChainProjector(harness.db, harness.logger);
  return async (): Promise<void> => {
    await poller.pollOnce();
    await projector.runPass();
  };
}

async function deskPayload(harness: HedgeHarness, symbol: string): Promise<unknown> {
  const [row] = await harness.db<{ payload: unknown }[]>`
    select payload from live_hedge_desk where instrument = ${symbol}
  `;
  return row?.payload ?? null;
}

describe("circuit breaker", () => {
  it("a stale book stops placing, cancels resting orders, shows on the desk and in breakerStatus, and clears when books return", async () => {
    h = await createHedgeHarness(anvil);
    const harness = h;
    const market = await harness.createMarket();
    const campaign = await harness.openCampaign(market);
    harness.books.push(market.symbol, 4000n, 4600n);
    const service = harness.startService();
    await harness.sell(campaign, 2_500_000n);
    await waitFor(
      async () =>
        (await hedgeTables(harness.db, market.symbol)).orders.some((o) => o.status === "working"),
      "a resting maker",
    );

    // The feed goes silent: 11 s later the book is stale.
    harness.clock.advance(11_000);
    await waitFor(
      async () => service.hedging.breakerStatus(market.symbol).active,
      "breaker tripped",
    );
    expect(service.hedging.breakerStatus(market.symbol)).toEqual({
      active: true,
      reason: "stale_book",
    });
    await waitFor(async () => {
      const { orders } = await hedgeTables(harness.db, market.symbol);
      return orders.every((o) => o.status === "cancelled");
    }, "the resting maker cancelled");
    await waitFor(async () => {
      const parsed = hedgeInstrumentSchema.safeParse(await deskPayload(harness, market.symbol));
      return parsed.success && parsed.data.breaker.active && parsed.data.stale;
    }, "the desk showing the breaker");
    const desk = hedgeInstrumentSchema.parse(await deskPayload(harness, market.symbol));
    expect(desk.breaker).toEqual({ active: true, reason: "stale_book" });

    // Nothing is placed while it is active.
    const ordersWhileActive = (await hedgeTables(harness.db, market.symbol)).orders.length;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await hedgeTables(harness.db, market.symbol)).orders).toHaveLength(ordersWhileActive);

    // Books flow again for the quiet period (10 s by the clock): the breaker resets, hedging resumes.
    harness.books.refresh(market.symbol);
    for (let i = 0; i < 6; i += 1) {
      harness.clock.advance(2_000);
      harness.books.refresh(market.symbol);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await waitFor(
      async () => !service.hedging.breakerStatus(market.symbol).active,
      "breaker reset",
    );
    expect(service.hedging.breakerStatus(market.symbol)).toEqual({ active: false, reason: null });
    await waitFor(async () => {
      const { orders } = await hedgeTables(harness.db, market.symbol);
      return orders.some((o) => o.status === "working");
    }, "a new maker once the breaker cleared");
    await waitFor(async () => {
      const parsed = hedgeInstrumentSchema.safeParse(await deskPayload(harness, market.symbol));
      return parsed.success && !parsed.data.breaker.active;
    }, "the desk showing the breaker off");
    // An instrument without a runner never blocks sales.
    expect(service.hedging.breakerStatus("UNKNOWN")).toEqual({ active: false, reason: null });
  });
});

describe("charges", () => {
  it("a batch with a ticket of an already settled campaign: the other tickets are still charged", async () => {
    // The projection is driven by hand: the settlement of campaign A stays unknown to the database.
    h = await createHedgeHarness(anvil, { ingest: false, startSender: false });
    const harness = h;
    const project = manualProjection(harness);

    const market = await harness.createMarket();
    const settled = await harness.openCampaign(market, { salesCloseInSeconds: 120n });
    const other = await harness.openCampaign(market, {
      merchant: getAddress("0x000000000000000000000000000000000000ba13"),
    });
    // Guaranteed at zero: A's reservation is zero, so A can settle with its ticket uncharged.
    const ticketA = await harness.sell(settled, 0n);
    const ticketB = await harness.sell(other, 2_500_000n);
    await project();
    await harness.env.advanceTime(121);
    await harness.driver.settle(settled.onchainId, 1); // NO, sent directly by the oracle
    await harness.restartSender();

    harness.books.push(market.symbol, 4000n, 4600n);
    harness.startService();
    await waitFor(
      async () => (await hedgeTables(harness.db, market.symbol)).orders.length === 1,
      "one maker for both lots",
    );
    harness.books.push(market.symbol, 4000n, 4100n);
    await waitFor(async () => {
      const logs = await harness.hedgeChargedLogs();
      return logs.some((log) => log.ticketId === ticketB);
    }, "B's ticket charged");
    // The event can be on the chain before the sender has read the receipt: wait until every
    // chargeHedge row is final before reading them.
    await waitFor(async () => {
      const [open] = await harness.db<{ n: bigint }[]>`
        select count(*)::bigint as n from chain_txs
        where kind = 'chargeHedge' and status not in ('mined', 'failed', 'reverted')
      `;
      return (open?.n ?? 1n) === 0n;
    }, "every chargeHedge final");

    const txs = await harness.db<
      { status: string; tickets: string[]; last_error: string | null }[]
    >`
      select status, payload -> 'ticketIds' as tickets, last_error
      from chain_txs where kind = 'chargeHedge' order by created_at
    `;
    // The batch of both failed in simulation; each ticket was then charged alone.
    expect(txs[0]).toMatchObject({
      status: "failed",
      tickets: [ticketA.toString(), ticketB.toString()],
      last_error: "AlreadySettled",
    });
    const alone = txs.slice(1);
    expect(alone).toEqual(
      expect.arrayContaining([
        { status: "failed", tickets: [ticketA.toString()], last_error: "AlreadySettled" },
        expect.objectContaining({ status: "mined", tickets: [ticketB.toString()] }),
      ]),
    );
    expect(await harness.hedgeChargedLogs()).toEqual([
      { ticketId: ticketB, campaignId: other.onchainId, amount: 2_050_000n },
    ]);

    // A is blocked for good, not waiting on a backoff: the charger says so once...
    const refusals = (): unknown[] =>
      harness.logs.filter(
        (entry) =>
          entry.msg === "chargeHedge refused for this ticket for good: it is no longer offered",
      );
    await waitFor(async () => refusals().length > 0, "the refusal of A reported");
    expect(refusals()).toEqual([
      expect.objectContaining({ ticketOnchainId: ticketA.toString(), reason: "AlreadySettled" }),
    ]);
    // ...and longer than the first retry backoff of a lone ticket (2 s), nothing is queued for it.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(refusals()).toHaveLength(1);
    const [count] = await harness.db<{ n: bigint }[]>`
      select count(*)::bigint as n from chain_txs where kind = 'chargeHedge'
    `;
    expect(Number(count?.n ?? 0n)).toBe(txs.length);
    await project();
    const tables = await hedgeTables(harness.db, market.symbol);
    expect(tables.lots.find((lot) => lot.ticket_onchain_id === ticketB)?.charged).toBe(true);
  });
});

describe("stop", () => {
  it("on abort leaves no timer and no half-written row", async () => {
    // No ingest loop and no sender: the only timers left are the service's own.
    h = await createHedgeHarness(anvil, { ingest: false });
    const harness = h;
    const project = manualProjection(harness);
    const market = await harness.createMarket();
    const campaign = await harness.openCampaign(market, {
      unitPrice: 50n * USDC,
      budget: 1_000n * USDC,
    });
    harness.books.push(market.symbol, 4000n, 4600n);
    await harness.sell(campaign, 25n * USDC); // 50 contracts
    await harness.sell(campaign, 25n * USDC);
    await project();
    // The service charges into an outbox that only records: no transaction runs in the background.
    const queued: TxRequest[] = [];
    const recording: ChargeTxSender = {
      enqueue: async (request) => {
        queued.push(request);
        return { id: `fake-${queued.length.toString()}`, created: true };
      },
    };
    await harness.stopSender();

    const timersBefore = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    const service = harness.startService({ txSender: recording });
    await waitFor(
      async () => (await hedgeTables(harness.db, market.symbol)).orders.length > 0,
      "orders placed",
    );
    // Fills land, and the stop comes in the middle of recording them.
    for (let i = 0; i < 5; i += 1) harness.books.trade(market.symbol, 4100n, 7n * CONTRACT);
    await service.stop();
    expect(harness.books.listenerCount()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const timersAfter = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    expect(timersAfter).toBeLessThanOrEqual(timersBefore);

    // Every fill is fully recorded: allocated, counted in the position, never beyond its order.
    const tables = await hedgeTables(harness.db, market.symbol);
    const filled = tables.fills.reduce((sum, fill) => sum + fill.qty, 0n);
    expect(filled).toBeGreaterThan(0n);
    expect(tables.position?.held).toBe(filled);
    expect(tables.lotFills[0]?.lot_qty_sum).toBe(filled);
    expect(tables.lots.reduce((sum, lot) => sum + lot.filled_qty, 0n)).toBe(filled);
    for (const order of tables.orders) {
      const ofOrder = tables.fills.filter((fill) => fill.venue_order_id === order.venue_order_id);
      expect(ofOrder.reduce((sum, fill) => sum + fill.qty, 0n)).toBeLessThanOrEqual(order.qty);
    }
    // Calling the finalizer after the stop is refused rather than left hanging.
    await expect(service.hedging.finalizer.finalize(campaign)).rejects.toThrow(/stopped/);
    // The encoded calls are real chargeHedge calls of the lots it covered.
    for (const request of queued) {
      expect(
        request.data.startsWith(
          encodeFunctionData({
            abi: winzEscrowAbi,
            functionName: "chargeHedge",
            args: [[], []],
          }).slice(0, 10),
        ),
      ).toBe(true);
    }
  });
});
