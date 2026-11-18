/**
 * The finalizer against settlements of other campaigns of its instrument (SPEC HE-1 to HE-6):
 * whatever settles while `finalize` waits for a reconciliation, or right before it is called, the
 * runner is never handed an exposure older than one it already has, nothing is bought back or sold
 * for contracts the venue paid out, and H ends as what the unsettled lots hold plus the inventory
 * held ahead of exposure.
 *
 * Campaigns, purchases, sales closes and settlements are made on the real escrow; lots, exposure
 * and campaign statuses come from the real chain projection; the settlement watcher of the last
 * test is the real one.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encodeFunctionData } from "viem";

import { hedgeInstrumentSchema, winzEscrowAbi, type HedgeInstrument } from "@winz/shared";

import { startSettlement } from "../../settlement";
import type { SettlementCampaign } from "../../settlement";
import { startAnvil, type AnvilInstance } from "../../testing/anvil";
import { heldInventoryOf } from "../allocation";
import { SETTLED_CAMPAIGN_STATUSES } from "./store";
import {
  CONTRACT,
  createHedgeHarness,
  hedgeTables,
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
  await h?.close();
});

const GUARANTEE = 2_500_000n;
const QUIET = { bid: 4000n, ask: 4600n } as const;
const FILLING = { bid: 4000n, ask: 4100n } as const;
const SETTLED_LOG = "campaigns settled: the contracts allocated to their lots are no longer held";
const SALES_CLOSE_LOG = "sales closed: position reconciled and remaining lots charged";

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

/**
 * H as the allocation has it: what the lots of the instrument's unsettled campaigns were allocated
 * plus the inventory held ahead of exposure (less a short, none here).
 */
async function heldByAllocation(symbol: string): Promise<bigint> {
  const [row] = await h.db<{ allocated: bigint }[]>`
    select coalesce(sum(l.filled_qty), 0)::bigint as allocated
    from lots l join campaigns c on c.id = l.campaign_id
    where l.instrument = ${symbol}
      and c.status <> all(${[...SETTLED_CAMPAIGN_STATUSES]}::text[])
  `;
  const inventory = await heldInventoryOf(h.db, symbol);
  return (row?.allocated ?? 0n) + inventory.qty - inventory.shortQty;
}

async function chargedLots(campaign: Campaign): Promise<boolean> {
  const rows = await h.db<{ charged: boolean }[]>`
    select charged from lots where campaign_id = ${campaign.id}
  `;
  return rows.length > 0 && rows.every((row) => row.charged);
}

/**
 * A campaign of the market sells 5 contracts; the runner rests a maker for them, the book fills
 * it, and the fill is allocated to the campaign's lot and charged on-chain.
 */
async function hedgedCampaign(market: Market, index: number): Promise<Campaign> {
  const ordersBefore = (await hedgeTables(h.db, market.symbol)).orders.length;
  const campaign = await h.openCampaign(market);
  await h.sell(campaign, GUARANTEE);
  await waitFor(async () => {
    const { orders } = await hedgeTables(h.db, market.symbol);
    return orders.length === ordersBefore + 1 && orders[ordersBefore]?.status === "working";
  }, `campaign ${index.toString()}: a maker for its exposure`);
  h.books.push(market.symbol, FILLING.bid, FILLING.ask);
  await waitFor(() => chargedLots(campaign), `campaign ${index.toString()} charged`);
  h.books.push(market.symbol, QUIET.bid, QUIET.ask);
  return campaign;
}

/** Closes the campaign's sales on-chain and moves the service's clock past that close. */
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

/** Settles the campaign YES on-chain, through the running sender, and waits for the projection. */
async function settleOnChain(campaign: Campaign): Promise<void> {
  await h.send(
    {
      signer: "oracle",
      kind: "settle",
      to: h.env.escrow,
      data: encodeFunctionData({
        abi: winzEscrowAbi,
        functionName: "settle",
        args: [campaign.onchainId, 0],
      }),
    },
    `test-settle-${campaign.onchainId.toString()}`,
  );
  await waitFor(async () => {
    const [row] = await h.db<{ status: string }[]>`
      select status from campaigns where id = ${campaign.id}
    `;
    return row?.status === "settled_yes";
  }, `campaign ${campaign.onchainId.toString()} projected settled`);
}

function settledLogs(symbol: string): Record<string, unknown>[] {
  return h.logs.filter((entry) => entry.msg === SETTLED_LOG && entry.instrument === symbol);
}

function runnersStarted(symbol: string): number {
  return h.logs.filter(
    (entry) => entry.msg === "hedging runner started" && entry.instrument === symbol,
  ).length;
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** A gate the test closes and opens; `entered` resolves the first time something waits at it. */
class Gate {
  closed = false;
  private open: () => void = () => undefined;
  private readonly opened: Promise<void>;
  private markEntered: () => void = () => undefined;
  readonly entered: Promise<void>;

  constructor() {
    this.opened = new Promise((resolve) => {
      this.open = resolve;
    });
    this.entered = new Promise((resolve) => {
      this.markEntered = resolve;
    });
  }

  async pass(): Promise<void> {
    if (!this.closed) return;
    this.markEntered();
    await this.opened;
  }

  release(): void {
    this.closed = false;
    this.open();
  }
}

describe("finalize while another campaign of the instrument settles", () => {
  it("a settlement applied while finalize waits for a reconciliation is never undone: nothing bought back, nothing sold", async () => {
    const market = await h.createMarket();
    h.books.push(market.symbol, QUIET.bid, QUIET.ask);
    const gate = new Gate();
    const service = h.startService({
      testHooks: {
        beforeReconcile: async (instrument: string): Promise<void> => {
          if (instrument === market.symbol) await gate.pass();
        },
      },
    });

    const first = await hedgedCampaign(market, 1);
    const second = await hedgedCampaign(market, 2);
    await expectPositionAndDesk(market.symbol, 10n * CONTRACT, 10n * CONTRACT, "both hedged");
    const ordersBefore = (await hedgeTables(h.db, market.symbol)).orders;

    // Both campaigns' sales close: the next pass starts the sales-close reconciliation, held open
    // at the gate with the exposure of its read (10 contracts).
    gate.closed = true;
    await h.driver.closeSales(first.onchainId);
    await closeSalesOnChain(market, second);
    await gate.entered;

    // The finalizer of campaign 2 is called: it waits for that reconciliation.
    const finalizing = service.hedging.finalizer.finalize(second).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await pause(300);

    // Campaign 1 settles meanwhile; a pass hands its settlement to the runner (H and E: 5).
    await settleOnChain(first);
    await waitFor(
      async () => settledLogs(market.symbol).length === 1,
      "the pass applied the settlement of campaign 1",
    );
    await expectPositionAndDesk(market.symbol, 5n * CONTRACT, 5n * CONTRACT, "campaign 1 settled");

    // The reconciliation goes on, then the finalizer's own.
    gate.release();
    const outcome = await finalizing;
    expect(outcome).toEqual({ ok: true });
    await waitFor(
      async () => h.logs.some((entry) => entry.msg === SALES_CLOSE_LOG),
      "the held sales-close reconciliation completed",
    );
    // A few more passes: a stale exposure would show as an order by now.
    await pause(600);

    const tables = await hedgeTables(h.db, market.symbol);
    expect(tables.orders).toEqual(ordersBefore);
    expect(tables.orders.filter((order) => order.side === "sell")).toEqual([]);
    expect(await position(market.symbol)).toEqual({
      exposure: 5n * CONTRACT,
      held: 5n * CONTRACT,
    });
    expect(await heldByAllocation(market.symbol)).toBe(5n * CONTRACT);
    expect((await deskRow(market.symbol))?.held).toBe((5n * CONTRACT).toString());
    expect(settledLogs(market.symbol)).toEqual([
      expect.objectContaining({ released: (5n * CONTRACT).toString() }),
    ]);
  });

  it("finalize follows a settlement the exposure pass has not seen yet: no sale of the settled contracts", async () => {
    const market = await h.createMarket();
    h.books.push(market.symbol, QUIET.bid, QUIET.ask);
    const fast = h.startService();
    const first = await hedgedCampaign(market, 1);
    const second = await hedgedCampaign(market, 2);
    await expectPositionAndDesk(market.symbol, 10n * CONTRACT, 10n * CONTRACT, "both hedged");
    await fast.stop();

    // A service whose exposure pass runs once at its start, then not for ten minutes: only the
    // finalizer can notice what settles from now on.
    await h.driver.closeSales(first.onchainId);
    const startedBefore = runnersStarted(market.symbol);
    const slow = h.startService({ exposureIntervalMs: 600_000 });
    // Its one pass has restored the runner (the desk row and the position are the stopped
    // service's until then): from here on, no pass reads the exposure.
    await waitFor(
      async () => runnersStarted(market.symbol) === startedBefore + 1,
      "the runner of the slow service restored",
    );
    expect(
      h.logs.filter(
        (entry) => entry.msg === "hedging runner started" && entry.instrument === market.symbol,
      )[startedBefore],
    ).toMatchObject({
      exposure: (10n * CONTRACT).toString(),
      held: (10n * CONTRACT).toString(),
      settledAllocated: "0",
    });
    await expectPositionAndDesk(market.symbol, 10n * CONTRACT, 10n * CONTRACT, "runner restored");
    const ordersBefore = (await hedgeTables(h.db, market.symbol)).orders;
    const passesBefore = settledLogs(market.symbol).length;

    await settleOnChain(first);
    await slow.hedging.finalizer.finalize(second);

    // Within finalize: campaign 1's contracts left H with its lot's exposure.
    expect(await position(market.symbol)).toEqual({
      exposure: 5n * CONTRACT,
      held: 5n * CONTRACT,
    });
    expect(await heldByAllocation(market.symbol)).toBe(5n * CONTRACT);
    await expectPositionAndDesk(market.symbol, 5n * CONTRACT, 5n * CONTRACT, "after finalize");
    const tables = await hedgeTables(h.db, market.symbol);
    expect(tables.orders).toEqual(ordersBefore);
    expect(tables.orders.filter((order) => order.side === "sell")).toEqual([]);
    expect(settledLogs(market.symbol).length).toBe(passesBefore + 1);
  });

  it("two campaigns of one instrument settled at once by the settlement watcher: both finalized, nothing traded", async () => {
    const market = await h.createMarket();
    h.books.push(market.symbol, QUIET.bid, QUIET.ask);
    const service = h.startService();
    const first = await hedgedCampaign(market, 1);
    const second = await hedgedCampaign(market, 2);
    await expectPositionAndDesk(market.symbol, 10n * CONTRACT, 10n * CONTRACT, "both hedged");
    await h.driver.closeSales(first.onchainId);
    await closeSalesOnChain(market, second);
    await waitFor(
      async () => h.logs.some((entry) => entry.msg === SALES_CLOSE_LOG),
      "the sales-close reconciliation",
    );
    const ordersBefore = (await hedgeTables(h.db, market.symbol)).orders;

    // The game's result: the watcher finds both campaigns in one pass and runs them concurrently.
    await h.db`update instruments set outcome = 'no', settled_at = now() where symbol = ${market.symbol}`;
    let inFlight = 0;
    let mostInFlight = 0;
    const finalized: { campaignId: string; ok: boolean }[] = [];
    const controller = new AbortController();
    const settlement = startSettlement({
      db: h.db,
      txSender: h.sender(),
      publicClient: h.env.publicClient,
      escrowAddress: h.env.escrow,
      logger: h.logger,
      signal: controller.signal,
      intervalMs: 100,
      txWaitTimeoutMs: 15_000,
      retryBaseMs: 50,
      retryMaxMs: 400,
      campaignConcurrency: 4,
      hedgeFinalizer: {
        finalize: async (campaign: SettlementCampaign): Promise<void> => {
          inFlight += 1;
          mostInFlight = Math.max(mostInFlight, inFlight);
          try {
            await service.hedging.finalizer.finalize(campaign);
            finalized.push({ campaignId: campaign.id, ok: true });
          } catch (error: unknown) {
            finalized.push({ campaignId: campaign.id, ok: false });
            throw error;
          } finally {
            inFlight -= 1;
          }
        },
      },
    });
    try {
      await waitFor(async () => {
        const rows = await h.db<{ status: string }[]>`
          select status from campaigns where id = any(${[first.id, second.id]}::uuid[])
        `;
        return rows.length === 2 && rows.every((row) => row.status === "settled_no");
      }, "both campaigns settled by the watcher");
    } finally {
      controller.abort();
      await settlement.stopped;
    }

    expect(mostInFlight).toBe(2);
    expect(
      finalized
        .filter((call) => call.ok)
        .map((call) => call.campaignId)
        .sort(),
    ).toEqual([first.id, second.id].sort());
    expect(finalized.every((call) => call.ok)).toBe(true);
    // Every contract was paid out: no runner, nothing held, and nothing was traded for it.
    await waitFor(async () => {
      const row = await position(market.symbol);
      return row?.exposure === 0n && row.held === 0n && (await deskRow(market.symbol)) === null;
    }, "no runner, exposure 0 and held 0");
    const tables = await hedgeTables(h.db, market.symbol);
    expect(tables.orders).toEqual(ordersBefore);
    expect(tables.orders.filter((order) => order.side === "sell")).toEqual([]);
    expect(await heldByAllocation(market.symbol)).toBe(0n);
  });
});
