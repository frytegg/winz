/**
 * X-02 and H-01 on the real contract: every escrow event of two campaigns' lives is read back
 * from a local chain, projected into a real Postgres, and the projection is compared with what
 * the contract itself returns (getCampaign, getTicket), never with numbers typed in the test.
 */
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress, parseEventLogs, type Address, type TransactionReceipt } from "viem";

import { instrumentId, parseUsd, winzEscrowAbi } from "@winz/shared";

import type { Db } from "../db";
import { startAnvil, type AnvilInstance } from "../testing/anvil";
import { deployTestEscrow, type TestEscrow } from "../testing/escrow";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { decodeEscrowLogs, insertChainEvents } from "./events";
import {
  EscrowDriver,
  exposureCheck,
  projectionSnapshot,
  seedCampaign,
  seedInstrument,
  seedMerchant,
} from "./ingest-test-support";
import { LogPoller } from "./log-poller";
import { ChainProjector, projectChainEvent, type StoredChainEvent } from "./projector";

const SYMBOL = "GEMI-CFBTEXARK-2611290030-TEXAS-MONEYLINE-YES";
const OTHER_SYMBOL = "GEMI-CFBTEXARK-2611290030-ARKANSAS-MONEYLINE-YES";
const USDC = 1_000_000n;
const HOUR = 3_600n;

/** Buyers never send transactions: any address will do. */
const BUYER_1: Address = getAddress("0x00000000000000000000000000000000000b0b01");
const BUYER_2: Address = getAddress("0x00000000000000000000000000000000000b0b02");
/** Blocked on the token before the refunds, and never unblocked. */
const BUYER_3: Address = getAddress("0x00000000000000000000000000000000000b0b03");
/** Blocked before the refunds, unblocked, then refunded by a second batch. */
const BUYER_4: Address = getAddress("0x00000000000000000000000000000000000b0b04");
/** The second merchant receives money only; it never signs anything. */
const MERCHANT_2: Address = getAddress("0x000000000000000000000000000000000000ba12");

/** Off-chain status of each `IWinzEscrow.Status`. */
const STATUS_BY_INDEX = ["live", "paused", "settled_yes", "settled_no", "void"] as const;
const OUTCOME_BY_STATUS = [null, null, "yes", "no", "void"] as const;

let anvil: AnvilInstance;
let env: TestEscrow;
let database: TestDatabase;
let db: Db;
let driver: EscrowDriver;
let poller: LogPoller;
let projector: ChainProjector;

/** Tickets whose last refund attempt failed, read from the RefundFailed / TicketRefunded logs. */
const failedRefunds = new Set<bigint>();
/** The campaigns' rows as the API wrote them, for the replay test. */
const seeded = new Map<string, { budget: bigint; salesClose: Date }>();

beforeAll(async () => {
  anvil = await startAnvil();
  env = await deployTestEscrow(anvil);
  database = await createTestDatabase();
  db = database.db;
  driver = new EscrowDriver(env);
  const logger = pino({ level: "silent" });
  poller = new LogPoller(
    db,
    env.publicClient,
    { escrowAddress: env.escrow, fromBlock: env.deployedAtBlock },
    logger,
  );
  projector = new ChainProjector(db, logger);
  await seedInstrument(db, SYMBOL);
  await seedInstrument(db, OTHER_SYMBOL);
});

afterAll(async () => {
  await database?.drop();
  await anvil?.stop();
});

/**
 * HE-1 against the contract: per instrument, the stored exposure equals the sum of the
 * `lockedRefunds` of the instrument's live or paused campaigns, read on-chain. Only campaigns
 * the database knows are counted (`known`).
 */
async function assertExposureMatchesChain(known: readonly bigint[]): Promise<void> {
  const expected = new Map<string, bigint>();
  for (const id of known) {
    const campaign = await driver.getCampaign(id);
    const [instrument] = await db<{ symbol: string }[]>`
      select symbol from instruments where onchain_id = ${campaign.instrument}
    `;
    if (instrument === undefined) throw new Error(`no instrument ${campaign.instrument}`);
    const add = campaign.status <= 1 ? campaign.lockedRefunds : 0n;
    expected.set(instrument.symbol, (expected.get(instrument.symbol) ?? 0n) + add);
  }
  const stored = await db<{ instrument: string; exposure: bigint }[]>`
    select instrument, exposure from positions
  `;
  for (const [symbol, exposure] of expected) {
    const row = stored.find((position) => position.instrument === symbol);
    expect(row?.exposure ?? 0n, `exposure of ${symbol}`).toBe(exposure);
  }
}

/** HE-1 inside the database: exposure = sum of refundable of tickets of unsettled campaigns. */
async function assertExposureMatchesTickets(): Promise<void> {
  for (const row of await exposureCheck(db)) {
    expect(row.exposure, `exposure of ${row.instrument}`).toBe(row.refundable);
  }
}

/** Reads the new logs, projects them, and checks the exposure invariant. */
async function sync(known: readonly bigint[]): Promise<void> {
  await poller.pollOnce();
  const result = await projector.runPass();
  expect(result.failed).toBe(0);
  await assertExposureMatchesTickets();
  await assertExposureMatchesChain(known);
}

function recordRefunds(receipt: TransactionReceipt): void {
  const logs = receipt.logs.filter((log) => log.address.toLowerCase() === env.escrow.toLowerCase());
  for (const event of parseEventLogs({ abi: winzEscrowAbi, logs })) {
    if (event.eventName === "RefundFailed") failedRefunds.add(event.args.ticketId);
    if (event.eventName === "TicketRefunded") failedRefunds.delete(event.args.ticketId);
  }
}

interface CampaignDbRow {
  id: string;
  status: string;
  outcome: string | null;
  budget: bigint;
  sales_close: Date;
  live_at: Date | null;
  slug: string | null;
  sale_state: string;
}

/** Every projected table against the contract's own view of every campaign and ticket. */
async function assertProjectionMatchesChain(): Promise<void> {
  const counts = await driver.counts();
  const ticketsByCampaign = new Map<bigint, { id: bigint; paid: bigint; refundable: bigint }[]>();

  for (let id = 1n; id <= counts.tickets; id += 1n) {
    const onchain = await driver.getTicket(id);
    const list = ticketsByCampaign.get(onchain.campaignId) ?? [];
    list.push({ id, paid: onchain.paid, refundable: onchain.refundable });
    ticketsByCampaign.set(onchain.campaignId, list);
    const campaign = await driver.getCampaign(onchain.campaignId);

    const [row] = await db<
      {
        campaign: bigint;
        buyer: string;
        qty: number;
        paid: bigint;
        refundable: bigint;
        max_hedge_cost: bigint;
        status: string;
        refunded_at: Date | null;
        tx_hash: string | null;
        lot_qty: bigint;
        lot_max: bigint;
        lot_charged: boolean;
        lot_count: bigint;
      }[]
    >`
      select c.onchain_id as campaign, t.buyer, t.qty, t.paid, t.refundable, t.max_hedge_cost,
             t.status, t.refunded_at, t.tx_hash, l.qty as lot_qty, l.max_hedge_cost as lot_max,
             l.charged as lot_charged,
             (select count(*) from lots where ticket_id = t.id) as lot_count
      from tickets t
      join campaigns c on c.id = t.campaign_id
      join lots l on l.ticket_id = t.id
      where t.onchain_id = ${id.toString()}::bigint
    `;
    expect(row, `ticket ${id.toString()}`).toBeDefined();
    if (row === undefined) continue;
    expect(row.campaign).toBe(onchain.campaignId);
    expect(row.buyer).toBe(onchain.buyer.toLowerCase());
    expect(row.paid).toBe(onchain.paid);
    expect(BigInt(row.qty) * campaign.unitPrice).toBe(onchain.paid);
    expect(row.refundable).toBe(onchain.refundable);
    expect(row.max_hedge_cost).toBe(onchain.maxHedgeCost);
    expect(row.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
    const expectedStatus = onchain.paidOut
      ? "refunded"
      : failedRefunds.has(id)
        ? "refund_failed"
        : "issued";
    expect(row.status, `status of ticket ${id.toString()}`).toBe(expectedStatus);
    expect(row.refunded_at !== null).toBe(onchain.paidOut);
    expect(row.lot_count).toBe(1n);
    expect(row.lot_qty).toBe(onchain.refundable);
    expect(row.lot_max).toBe(onchain.maxHedgeCost);
    expect(row.lot_charged).toBe(onchain.hedgeCharged);
  }

  for (let id = 1n; id <= counts.campaigns; id += 1n) {
    const onchain = await driver.getCampaign(id);
    const [row] = await db<CampaignDbRow[]>`
      select id, status, outcome, budget, sales_close, live_at, slug, sale_state
      from campaigns where onchain_id = ${id.toString()}::bigint
    `;
    expect(row, `campaign ${id.toString()}`).toBeDefined();
    if (row === undefined) continue;
    expect(row.status).toBe(STATUS_BY_INDEX[onchain.status]);
    expect(row.outcome).toBe(OUTCOME_BY_STATUS[onchain.status]);
    expect(row.budget).toBe(onchain.hedgeBudget);
    expect(BigInt(row.sales_close.getTime())).toBe(onchain.salesClose * 1000n);
    expect(row.live_at).not.toBeNull();

    const [lots] = await db<{ spent: bigint; reserved: bigint; open_refunds: bigint }[]>`
      select coalesce(sum(l.charged_amount), 0)::bigint as spent,
             coalesce(sum(l.max_hedge_cost) filter (where not l.charged), 0)::bigint as reserved,
             coalesce(sum(t.refundable) filter (where t.status <> 'refunded'), 0)::bigint as open_refunds
      from lots l join tickets t on t.id = l.ticket_id
      where l.campaign_id = ${row.id}
    `;
    expect(lots?.spent).toBe(onchain.hedgeSpent);
    expect(lots?.reserved).toBe(onchain.hedgeReserved);
    // Live, paused or YES: the escrow still holds the refundable part of every unpaid ticket.
    if (onchain.status <= 2) expect(lots?.open_refunds).toBe(onchain.lockedRefunds);

    const tickets = ticketsByCampaign.get(id) ?? [];
    const [live] = await db<
      {
        sale_state: string;
        sales: number;
        exposure: bigint;
        hedged_bps: number;
        outcome: string | null;
      }[]
    >`
      select sale_state, sales, exposure, hedged_bps, outcome
      from live_campaigns where slug = ${row.slug ?? ""}
    `;
    if (row.slug === null) {
      expect(live).toBeUndefined();
      continue;
    }
    expect(live, `live_campaigns row of ${row.slug}`).toBeDefined();
    expect(live?.sale_state).toBe(row.sale_state);
    expect(BigInt(live?.sales ?? -1)).toBe(
      tickets.reduce((sum, ticket) => sum + ticket.paid / onchain.unitPrice, 0n),
    );
    expect(live?.exposure).toBe(tickets.reduce((sum, ticket) => sum + ticket.refundable, 0n));
    expect(live?.hedged_bps).toBe(0);
    expect(live?.outcome).toBe(OUTCOME_BY_STATUS[onchain.status]);
  }

  await assertExposureMatchesTickets();
  await assertExposureMatchesChain(
    Array.from({ length: Number(counts.campaigns) }, (_, index) => BigInt(index + 1)),
  );
}

describe("chain ingestion on the real escrow", () => {
  let campaignA = 0n;
  let campaignB = 0n;
  const ticketsA: bigint[] = [];
  const ticketsB: bigint[] = [];
  let blockedForever = 0n;
  let blockedThenFreed = 0n;

  async function createAndSeed(input: {
    merchant: Address;
    merchantLabel: string;
    unitPrice: bigint;
    refundBps: number;
    budget: bigint;
    slug: string;
  }): Promise<bigint> {
    const created = await driver.createCampaign({
      merchant: input.merchant,
      symbol: SYMBOL,
      unitPrice: input.unitPrice,
      refundBps: input.refundBps,
      budget: input.budget,
      salesCloseInSeconds: HOUR,
    });
    const salesClose = new Date(Number(created.salesClose) * 1000);
    await seedCampaign(db, {
      merchantId: await seedMerchant(db, input.merchantLabel),
      symbol: SYMBOL,
      unitPrice: input.unitPrice,
      refundBps: input.refundBps,
      budget: input.budget,
      salesClose,
      onchainId: created.id,
      slug: input.slug,
    });
    seeded.set(input.slug, { budget: input.budget, salesClose });
    return created.id;
  }

  async function buy(
    campaign: bigint,
    buyer: Address,
    qty: number,
    into: bigint[],
  ): Promise<bigint> {
    const bought = await driver.buy(campaign, buyer, qty, 3n * USDC);
    into.push(bought.ticketId);
    await sync([campaignA, campaignB].filter((id) => id > 0n));
    return bought.ticketId;
  }

  it("projects a full lifecycle of two merchants' campaigns on one instrument", async () => {
    campaignA = await createAndSeed({
      merchant: env.accounts.merchant.address,
      merchantLabel: "bar-a",
      unitPrice: parseUsd("12.99"),
      refundBps: 5_000,
      budget: 500n * USDC,
      slug: "bar-a-texas",
    });
    await sync([campaignA]);
    const [liveA] = await db<{ status: string; live_at: Date | null }[]>`
      select status, live_at from campaigns where onchain_id = ${campaignA.toString()}::bigint
    `;
    expect(liveA?.status).toBe("live");
    expect(liveA?.live_at).not.toBeNull();

    campaignB = await createAndSeed({
      merchant: MERCHANT_2,
      merchantLabel: "pizza-b",
      unitPrice: parseUsd("20"),
      refundBps: 2_500,
      budget: 300n * USDC,
      slug: "pizza-b-texas",
    });
    await sync([campaignA, campaignB]);

    await buy(campaignA, BUYER_1, 3, ticketsA);
    await buy(campaignB, BUYER_3, 4, ticketsB);
    await buy(campaignA, BUYER_2, 2, ticketsA);
    await buy(campaignB, BUYER_1, 2, ticketsB);

    // Both campaigns share one position (HE-3).
    const [position] = await db<{ exposure: bigint; venue: string }[]>`
      select exposure, venue from positions where instrument = ${SYMBOL}
    `;
    expect(position?.venue).toBe("paper");
    const [a1, b1] = [ticketsA[0], ticketsB[0]];
    if (a1 === undefined || b1 === undefined) throw new Error("tickets missing");
    expect(position?.exposure).toBe(
      (await driver.getCampaign(campaignA)).lockedRefunds +
        (await driver.getCampaign(campaignB)).lockedRefunds,
    );

    // Some lots are charged while sales go on.
    await driver.chargeHedge([a1, b1], [1_500_000n, 0n]);
    await sync([campaignA, campaignB]);

    // A manual pause and resume.
    await driver.setPaused(campaignA, true);
    await sync([campaignA, campaignB]);
    const [paused] = await db<{ status: string }[]>`
      select status from campaigns where onchain_id = ${campaignA.toString()}::bigint
    `;
    expect(paused?.status).toBe("paused");
    await driver.setPaused(campaignA, false);
    await sync([campaignA, campaignB]);

    blockedForever = await buy(campaignA, BUYER_3, 5, ticketsA);
    blockedThenFreed = await buy(campaignA, BUYER_4, 2, ticketsA);

    await driver.topUp(campaignB, 50n * USDC);
    await sync([campaignA, campaignB]);

    // The same purchase through the receipt path first, then the log poller.
    const viaReceipt = await driver.buy(campaignA, BUYER_2, 1, 3n * USDC);
    ticketsA.push(viaReceipt.ticketId);
    const decoded = decodeEscrowLogs(viaReceipt.receipt.logs, env.escrow);
    expect(decoded.events.map((event) => event.name)).toEqual(["TicketPurchased"]);
    expect(await insertChainEvents(db, decoded.events, viaReceipt.blockTime)).toBe(1);
    expect((await projector.runPass()).applied).toBe(1);
    await sync([campaignA, campaignB]);
    const rows = await db<{ source: string; processed: boolean }[]>`
      select source, processed_at is not null as processed from chain_events
      where tx_hash = ${viaReceipt.receipt.transactionHash.toLowerCase()}
    `;
    expect(rows).toEqual([{ source: "receipt", processed: true }]);
    const [lotCount] = await db<{ n: bigint }[]>`
      select count(*) as n from lots l join tickets t on t.id = l.ticket_id
      where t.onchain_id = ${viaReceipt.ticketId.toString()}::bigint
    `;
    expect(lotCount?.n).toBe(1n);

    // Sales end: A closes early, B reaches its sales close.
    await driver.closeSales(campaignA);
    await sync([campaignA, campaignB]);
    await env.advanceTime(HOUR + 1n);

    // Every remaining lot is charged, as settle requires.
    const uncharged = [...ticketsA, ...ticketsB].filter((id) => id !== a1 && id !== b1);
    await driver.chargeHedge(
      uncharged,
      uncharged.map((_, index) => (index % 2 === 0 ? 2_000_000n + BigInt(index) : 0n)),
    );
    await sync([campaignA, campaignB]);

    await driver.settle(campaignA, 0);
    await sync([campaignA, campaignB]);
    await driver.settle(campaignB, 1);
    await sync([campaignA, campaignB]);
    const [settledPosition] = await db<{ exposure: bigint }[]>`
      select exposure from positions where instrument = ${SYMBOL}
    `;
    expect(settledPosition?.exposure).toBe(0n);

    // EC-7: a blocked buyer's refund fails without failing the batch.
    await driver.setBlocked(BUYER_3, true);
    await driver.setBlocked(BUYER_4, true);
    recordRefunds((await driver.refundBatch(campaignA, ticketsA)).receipt);
    expect([...failedRefunds].sort()).toEqual([blockedForever, blockedThenFreed].sort());
    await sync([campaignA, campaignB]);
    await assertProjectionMatchesChain();

    // A later refund of the same ticket wins over its failure.
    await driver.setBlocked(BUYER_4, false);
    recordRefunds((await driver.refundBatch(campaignA, [blockedThenFreed])).receipt);
    expect([...failedRefunds]).toEqual([blockedForever]);
    await sync([campaignA, campaignB]);

    await driver.payMerchant(campaignA);
    await driver.release(campaignA);
    await driver.release(campaignB);
    await sync([campaignA, campaignB]);

    const unprocessed = await db<{ n: bigint }[]>`
      select count(*) as n from chain_events where processed_at is null
    `;
    expect(unprocessed[0]?.n).toBe(0n);
    await assertProjectionMatchesChain();
    const [statuses] = await db<{ refunded: bigint; failed: bigint }[]>`
      select count(*) filter (where status = 'refunded') as refunded,
             count(*) filter (where status = 'refund_failed') as failed
      from tickets
    `;
    expect(statuses?.failed).toBe(1n);
    expect(statuses?.refunded).toBe(BigInt(ticketsA.length - 1));
  });

  it("projects an event applied again, in order or out of order, only once", async () => {
    const before = await projectionSnapshot(db);
    const rows = await db<
      {
        tx_hash: `0x${string}`;
        log_index: number;
        block_number: bigint;
        block_time: Date | null;
        name: string;
        args: Record<string, string | number | boolean>;
        created_at: Date;
      }[]
    >`select * from chain_events order by block_number, log_index`;
    // In chain order, then backwards: a failed refund seen after the refund that followed it,
    // a pause seen after the settlement, and so on, change nothing.
    for (const row of [...rows, ...[...rows].reverse()]) {
      const event: StoredChainEvent = {
        txHash: row.tx_hash,
        logIndex: row.log_index,
        blockNumber: row.block_number,
        blockTime: row.block_time,
        name: row.name,
        args: row.args,
        createdAt: row.created_at,
      };
      await db.begin(async (tx) => {
        await projectChainEvent(tx, event);
      });
    }
    expect(await projectionSnapshot(db)).toEqual(before);
  });

  it("retries a purchase whose campaign id is not written yet, without holding back others", async () => {
    // Campaign C exists on-chain; the creation job has not written its onchain_id yet.
    const c = await driver.createCampaign({
      merchant: env.accounts.merchant.address,
      symbol: OTHER_SYMBOL,
      unitPrice: parseUsd("9.5"),
      refundBps: 10_000,
      budget: 100n * USDC,
      salesCloseInSeconds: HOUR,
    });
    const cSalesClose = new Date(Number(c.salesClose) * 1000);
    const cRow = await seedCampaign(db, {
      merchantId: await seedMerchant(db, "late-c"),
      symbol: OTHER_SYMBOL,
      unitPrice: parseUsd("9.5"),
      refundBps: 10_000,
      budget: 100n * USDC,
      salesClose: cSalesClose,
      onchainId: null,
      slug: "late-c-ark",
    });
    seeded.set("late-c-ark", { budget: 100n * USDC, salesClose: cSalesClose });
    // Campaign D, of another merchant on the same instrument, is known from the start.
    const d = await driver.createCampaign({
      merchant: MERCHANT_2,
      symbol: OTHER_SYMBOL,
      unitPrice: parseUsd("4"),
      refundBps: 7_500,
      budget: 100n * USDC,
      salesCloseInSeconds: HOUR,
    });
    const dSalesClose = new Date(Number(d.salesClose) * 1000);
    await seedCampaign(db, {
      merchantId: await seedMerchant(db, "early-d"),
      symbol: OTHER_SYMBOL,
      unitPrice: parseUsd("4"),
      refundBps: 7_500,
      budget: 100n * USDC,
      salesClose: dSalesClose,
      onchainId: d.id,
      slug: "early-d-ark",
    });
    seeded.set("early-d-ark", { budget: 100n * USDC, salesClose: dSalesClose });

    const ticketC = await driver.buy(c.id, BUYER_1, 2, USDC);
    const ticketD = await driver.buy(d.id, BUYER_2, 3, USDC);

    await poller.pollOnce();
    const first = await projector.runPass();
    expect(first.failed).toBe(0);
    // CampaignCreated and TicketPurchased of C wait; D's events (created after) do not.
    expect(first.deferred).toBe(2);
    await assertExposureMatchesTickets();
    const pending = await db<{ name: string }[]>`
      select name from chain_events where processed_at is null order by block_number, log_index
    `;
    expect(pending.map((row) => row.name)).toEqual(["CampaignCreated", "TicketPurchased"]);
    const known = await db<{ onchain_id: bigint }[]>`
      select onchain_id from tickets where onchain_id in
        (${ticketC.ticketId.toString()}::bigint, ${ticketD.ticketId.toString()}::bigint)
    `;
    expect(known.map((row) => row.onchain_id)).toEqual([ticketD.ticketId]);
    await assertExposureMatchesChain([d.id]);

    // Still unknown: a second pass changes nothing.
    expect((await projector.runPass()).deferred).toBe(2);

    // The creation job writes the id; the next pass applies C's events.
    await db`update campaigns set onchain_id = ${c.id.toString()}::bigint where id = ${cRow}`;
    const second = await projector.runPass();
    expect(second).toEqual({ applied: 2, ignored: 0, deferred: 0, failed: 0 });
    await assertExposureMatchesTickets();
    await assertExposureMatchesChain([c.id, d.id]);

    // FIFO follows the chain: C's lot comes before D's although it was projected after.
    const lots = await db<{ ticket: bigint }[]>`
      select t.onchain_id as ticket from lots l join tickets t on t.id = l.ticket_id
      where l.instrument = ${OTHER_SYMBOL} order by l.seq
    `;
    expect(lots.map((row) => row.ticket)).toEqual([ticketC.ticketId, ticketD.ticketId]);
    const [cStatus] = await db<
      { status: string }[]
    >`select status from campaigns where id = ${cRow}`;
    expect(cStatus?.status).toBe("live");
    await assertProjectionMatchesChain();
  });

  it("rebuilds exactly the same rows when every event is projected again", async () => {
    const before = await projectionSnapshot(db);
    expect(before.tickets.length).toBeGreaterThan(5);

    await db.begin(async (tx) => {
      await tx`delete from live_campaigns`;
      await tx`delete from lots`;
      await tx`delete from positions`;
      await tx`delete from tickets`;
      for (const [slug, row] of seeded) {
        await tx`
          update campaigns
          set status = 'funding', live_at = null, outcome = null,
              budget = ${row.budget.toString()}::bigint, sales_close = ${row.salesClose}
          where slug = ${slug}
        `;
      }
      await tx`update chain_events set processed_at = null`;
    });

    const result = await projector.runPass();
    expect(result.failed).toBe(0);
    expect(result.deferred).toBe(0);
    expect(await projectionSnapshot(db)).toEqual(before);
    await assertProjectionMatchesChain();
  });

  it("reads only the escrow's logs", async () => {
    const names = await db<{ name: string }[]>`select distinct name from chain_events`;
    const escrowEvents = new Set<string>(
      winzEscrowAbi.filter((item) => item.type === "event").map((item) => item.name),
    );
    for (const { name } of names) expect(escrowEvents.has(name), name).toBe(true);
    expect(names.map((row) => row.name)).not.toContain("Transfer");
    // The instrument ids stored on-chain are the catalogue's.
    const [campaign] = await db<{ onchain_id: string }[]>`
      select i.onchain_id from instruments i where i.symbol = ${SYMBOL}
    `;
    expect(campaign?.onchain_id).toBe(instrumentId(SYMBOL));
  });
});
