/**
 * Restarts at each interesting moment of a hedge: a new service on the same database and chain
 * ends in the same final state, with no order placed twice, no fill recorded twice and no ticket
 * charged twice (counted from the escrow's own `HedgeCharged` logs).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startAnvil, type AnvilInstance } from "../../testing/anvil";
import type { ChargeTxSender } from "./charger";
import {
  CONTRACT,
  createHedgeHarness,
  hedgeTables,
  onchainCampaign,
  waitAllCharged,
  waitFor,
  type Campaign,
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
  await anvil.rpc("evm_setAutomine", [true]);
  await h?.close();
});

const COST = 2_050_000n; // 5 contracts at $0.41

async function chargeTxRows(): Promise<{ status: string; tickets: unknown }[]> {
  return h.db<{ status: string; tickets: unknown }[]>`
    select status, payload -> 'ticketIds' as tickets from chain_txs where kind = 'chargeHedge'
  `;
}

/** The final state every scenario must reach: one fill, the lot charged once at its cost. */
async function expectFinalState(
  market: Market,
  campaign: Campaign,
  ticketId: bigint,
): Promise<void> {
  await waitAllCharged(h.db, market.symbol);
  const tables = await hedgeTables(h.db, market.symbol);
  expect(new Set(tables.orders.map((order) => order.venue_order_id)).size).toBe(
    tables.orders.length,
  );
  expect(tables.fills).toHaveLength(1);
  expect(tables.fills[0]?.qty).toBe(5n * CONTRACT);
  expect(tables.lots[0]).toMatchObject({ cost: COST, charged: true, charged_amount: COST });
  expect(tables.position).toMatchObject({ exposure: 5n * CONTRACT, held: 5n * CONTRACT });
  expect(await h.hedgeChargedLogs()).toEqual([
    { ticketId, campaignId: campaign.onchainId, amount: COST },
  ]);
  expect(await onchainCampaign(h.env, campaign.onchainId)).toMatchObject({
    hedgeReserved: 0n,
    hedgeSpent: COST,
  });
}

describe("hedging service restarts", () => {
  it("after an order is placed: the vanished paper order is cancelled and replaced, never placed twice", async () => {
    const market = await h.createMarket();
    const campaign = await h.openCampaign(market);
    h.books.push(market.symbol, 4000n, 4600n);
    const first = h.startService();
    const ticketId = await h.sell(campaign, 2_500_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).orders.length === 1,
      "maker",
    );
    await first.stop();

    h.startService();
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).orders.length === 2,
      "the replacing maker",
    );
    const { orders } = await hedgeTables(h.db, market.symbol);
    expect(orders.map((order) => order.status)).toEqual(["cancelled", "working"]);
    // The sequence continues from the database: a new id, never the old one again.
    const [oldId, newId] = orders.map((order) => order.venue_order_id);
    expect(oldId?.endsWith("-1")).toBe(true);
    expect(newId?.endsWith("-2")).toBe(true);
    expect(
      h.logs.some(
        (entry) =>
          typeof entry.msg === "string" &&
          entry.msg.startsWith("orders left open by the previous process marked cancelled"),
      ),
    ).toBe(true);

    h.books.push(market.symbol, 4000n, 4100n);
    await expectFinalState(market, campaign, ticketId);
    expect((await hedgeTables(h.db, market.symbol)).orders).toHaveLength(2);
  });

  it("after a fill is recorded but before its charge is sent", async () => {
    const market = await h.createMarket();
    const campaign = await h.openCampaign(market);
    h.books.push(market.symbol, 4000n, 4600n);
    // The outbox refuses everything: the process "dies" before any charge is queued.
    const refusing: ChargeTxSender = {
      enqueue: () => Promise.reject(new Error("outbox unreachable")),
    };
    const first = h.startService({ txSender: refusing });
    const ticketId = await h.sell(campaign, 2_500_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).orders.length === 1,
      "maker",
    );
    h.books.push(market.symbol, 4000n, 4100n);
    await waitFor(async () => (await hedgeTables(h.db, market.symbol)).fills.length === 1, "fill");
    await first.stop();
    expect(await chargeTxRows()).toEqual([]);

    h.startService();
    await expectFinalState(market, campaign, ticketId);
    // Held already equals the exposure: nothing more was bought.
    expect((await hedgeTables(h.db, market.symbol)).orders).toHaveLength(1);
    expect(await chargeTxRows()).toHaveLength(1);
  });

  it("after the charge is sent but before it is mined", async () => {
    const market = await h.createMarket();
    const campaign = await h.openCampaign(market);
    h.books.push(market.symbol, 4000n, 4600n);
    const first = h.startService();
    const ticketId = await h.sell(campaign, 2_500_000n);
    await waitFor(
      async () => (await hedgeTables(h.db, market.symbol)).orders.length === 1,
      "maker",
    );

    await anvil.rpc("evm_setAutomine", [false]);
    h.books.push(market.symbol, 4000n, 4100n);
    await waitFor(
      async () => (await chargeTxRows()).some((row) => row.status === "sent"),
      "the charge broadcast",
    );
    await first.stop();
    await h.stopSender();
    await anvil.rpc("evm_setAutomine", [true]);
    await anvil.rpc("evm_mine");

    await h.restartSender();
    h.startService();
    await expectFinalState(market, campaign, ticketId);
    const rows = await chargeTxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("mined");
  });
});
