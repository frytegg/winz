/**
 * The projection does not depend on the order in which events reach `chain_events`. The three
 * sources (receipt, Streams, logs) do not arrive in chain order: a receipt can be lost and its
 * events read by the poller after later events were projected. Also: two projectors at once,
 * the hedged share of a campaign, and the failure logs of an event that cannot be applied.
 */
import pino, { type Logger } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";

import { parseUsd } from "@winz/shared";

import type { Db } from "../db";
import { startAnvil, type AnvilInstance } from "../testing/anvil";
import { deployTestEscrow, type TestEscrow } from "../testing/escrow";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { decodeEscrowLogs, insertChainEvents } from "./events";
import {
  capturingLogger,
  EscrowDriver,
  exposureCheck,
  projectionSnapshot,
  seedCampaign,
  seedInstrument,
  seedMerchant,
  type Mined,
  type ProjectionSnapshot,
} from "./ingest-test-support";
import { LogPoller } from "./log-poller";
import { ChainProjector, projectChainEvent, type StoredChainEvent } from "./projector";
import type { DecodedEvent, JsonObject } from "./types";

const SYMBOL = "GEMI-CFBTEXARK-2611290030-TEXAS-MONEYLINE-YES";
const USDC = 1_000_000n;
const HOUR = 3_600n;
const BUYER_1: Address = getAddress("0x00000000000000000000000000000000000b0b01");
const BUYER_2: Address = getAddress("0x00000000000000000000000000000000000b0b02");
const BUYER_3: Address = getAddress("0x00000000000000000000000000000000000b0b03");
const MERCHANT_2: Address = getAddress("0x000000000000000000000000000000000000ba12");
const MERCHANT_3: Address = getAddress("0x000000000000000000000000000000000000ba13");

/** Off-chain status of each `IWinzEscrow.Status`. */
const STATUS_BY_INDEX = ["live", "paused", "settled_yes", "settled_no", "void"] as const;

function silent(): Logger {
  return pino({ level: "silent" });
}

interface Setup {
  anvil: AnvilInstance;
  env: TestEscrow;
  database: TestDatabase;
  db: Db;
  driver: EscrowDriver;
}

async function openSetup(): Promise<Setup> {
  const anvil = await startAnvil();
  try {
    const env = await deployTestEscrow(anvil);
    const database = await createTestDatabase();
    await seedInstrument(database.db, SYMBOL);
    return { anvil, env, database, db: database.db, driver: new EscrowDriver(env) };
  } catch (error: unknown) {
    await anvil.stop();
    throw error;
  }
}

async function closeSetup(setup: Setup | undefined): Promise<void> {
  await setup?.database.drop();
  await setup?.anvil.stop();
}

async function withSetup(run: (setup: Setup) => Promise<void>): Promise<void> {
  const setup = await openSetup();
  try {
    await run(setup);
  } finally {
    await closeSetup(setup);
  }
}

interface SeededCampaign {
  id: bigint;
  rowId: string;
  slug: string;
  budget: bigint;
  salesClose: Date;
  created: Mined;
}

/** A campaign on-chain and the row the API wrote for it, with its onchain_id. */
async function createCampaign(
  setup: Setup,
  input: { merchant: Address; label: string; budget: bigint; unitPrice?: bigint },
): Promise<SeededCampaign> {
  const unitPrice = input.unitPrice ?? parseUsd("10");
  const created = await setup.driver.createCampaign({
    merchant: input.merchant,
    symbol: SYMBOL,
    unitPrice,
    refundBps: 5_000,
    budget: input.budget,
    salesCloseInSeconds: HOUR,
  });
  const salesClose = new Date(Number(created.salesClose) * 1000);
  const slug = `${input.label}-texas`;
  const rowId = await seedCampaign(setup.db, {
    merchantId: await seedMerchant(setup.db, input.label),
    symbol: SYMBOL,
    unitPrice,
    refundBps: 5_000,
    budget: input.budget,
    salesClose,
    onchainId: created.id,
    slug,
  });
  return { id: created.id, rowId, slug, budget: input.budget, salesClose, created };
}

/** Writes a mined transaction's escrow events as the receipt path does. */
async function insertReceipt(setup: Setup, mined: Mined): Promise<number> {
  const { events } = decodeEscrowLogs(mined.receipt.logs, setup.env.escrow);
  return insertChainEvents(setup.db, events, mined.blockTime);
}

async function campaignRow(
  db: Db,
  id: bigint,
): Promise<{ status: string; budget: bigint } | undefined> {
  const [row] = await db<{ status: string; budget: bigint }[]>`
    select status, budget from campaigns where onchain_id = ${id.toString()}::bigint
  `;
  return row;
}

async function unprocessed(db: Db): Promise<bigint> {
  const [row] = await db<{ n: bigint }[]>`
    select count(*) as n from chain_events where processed_at is null
  `;
  return row?.n ?? 0n;
}

describe("state set by an event that reaches chain_events late", () => {
  it("counts every top-up when an earlier one arrives after a later one", async () => {
    await withSetup(async (setup) => {
      const { db, driver, env } = setup;
      const campaign = await createCampaign(setup, {
        merchant: env.accounts.merchant.address,
        label: "topups",
        budget: 200n * USDC,
      });
      const projector = new ChainProjector(db, silent());
      await insertReceipt(setup, campaign.created);
      // The receipt of the first top-up is lost; the second one comes by its receipt.
      await driver.topUp(campaign.id, 10n * USDC);
      const second = await driver.topUp(campaign.id, 25n * USDC);
      await insertReceipt(setup, second);
      await projector.runPass();
      expect((await campaignRow(db, campaign.id))?.budget).toBe(225n * USDC);

      // The poller then reads both: the first top-up is projected after the second.
      const poller = new LogPoller(
        db,
        env.publicClient,
        { escrowAddress: env.escrow, fromBlock: env.deployedAtBlock },
        silent(),
      );
      await poller.pollOnce();
      expect((await projector.runPass()).failed).toBe(0);
      expect(await unprocessed(db)).toBe(0n);
      const onchain = await driver.getCampaign(campaign.id);
      expect(onchain.hedgeBudget).toBe(235n * USDC);
      expect((await campaignRow(db, campaign.id))?.budget).toBe(onchain.hedgeBudget);

      // Applying the earlier top-up once more changes nothing either.
      const [first] = await db<StoredRow[]>`
        select * from chain_events where name = 'BudgetToppedUp'
        order by block_number, log_index limit 1
      `;
      if (first === undefined) throw new Error("no top-up stored");
      await db.begin(async (tx) => {
        await projectChainEvent(tx, toStored(first));
      });
      expect((await campaignRow(db, campaign.id))?.budget).toBe(onchain.hedgeBudget);
    });
  });

  it("keeps the last pause or resume on-chain, whichever is projected last", async () => {
    await withSetup(async (setup) => {
      const { db, driver, env } = setup;
      const campaign = await createCampaign(setup, {
        merchant: env.accounts.merchant.address,
        label: "late-pause",
        budget: 200n * USDC,
      });
      const projector = new ChainProjector(db, silent());
      const poller = new LogPoller(
        db,
        env.publicClient,
        { escrowAddress: env.escrow, fromBlock: env.deployedAtBlock },
        silent(),
      );
      await poller.pollOnce();
      await projector.runPass();
      await driver.buy(campaign.id, BUYER_1, 2, USDC);

      // A pause whose receipt was missed, then a resume that came by its receipt.
      await driver.setPaused(campaign.id, true);
      await insertReceipt(setup, await driver.setPaused(campaign.id, false));
      await projector.runPass();
      await poller.pollOnce();
      expect((await projector.runPass()).failed).toBe(0);
      expect(await unprocessed(db)).toBe(0n);
      let onchain = await driver.getCampaign(campaign.id);
      expect({ db: (await campaignRow(db, campaign.id))?.status, chain: onchain.status }).toEqual({
        db: "live",
        chain: 0,
      });

      // The other way round: a resume seen after the pause that followed it.
      const pausedFirst = await driver.setPaused(campaign.id, true);
      const resumed = await driver.setPaused(campaign.id, false);
      const pausedLast = await driver.setPaused(campaign.id, true);
      await insertReceipt(setup, pausedLast);
      await insertReceipt(setup, pausedFirst);
      await projector.runPass();
      await insertReceipt(setup, resumed);
      await projector.runPass();
      await poller.pollOnce();
      expect((await projector.runPass()).failed).toBe(0);
      onchain = await driver.getCampaign(campaign.id);
      expect({ db: (await campaignRow(db, campaign.id))?.status, chain: onchain.status }).toEqual({
        db: "paused",
        chain: 1,
      });
    });
  });

  it("does not reopen a campaign whose sales are closed off-chain", async () => {
    await withSetup(async (setup) => {
      const { db, driver, env } = setup;
      const campaign = await createCampaign(setup, {
        merchant: env.accounts.merchant.address,
        label: "closed-sales",
        budget: 200n * USDC,
      });
      const projector = new ChainProjector(db, silent());
      await insertReceipt(setup, campaign.created);
      await projector.runPass();
      await driver.setPaused(campaign.id, true);
      await driver.setPaused(campaign.id, false);
      await insertReceipt(setup, await driver.closeSales(campaign.id));
      await projector.runPass();
      // Another writer moves the campaign to sales_closed (CA-4), then the poller brings the
      // pause and the resume, which happened before the sales closed.
      await db`update campaigns set status = 'sales_closed' where id = ${campaign.rowId}`;
      await new LogPoller(
        db,
        env.publicClient,
        { escrowAddress: env.escrow, fromBlock: env.deployedAtBlock },
        silent(),
      ).pollOnce();
      expect((await projector.runPass()).failed).toBe(0);
      expect(await unprocessed(db)).toBe(0n);
      expect((await campaignRow(db, campaign.id))?.status).toBe("sales_closed");
    });
  });
});

interface StoredRow {
  tx_hash: `0x${string}`;
  log_index: number;
  block_number: bigint;
  block_time: Date | null;
  name: string;
  args: JsonObject;
  created_at: Date;
}

function toStored(row: StoredRow): StoredChainEvent {
  return {
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: row.block_number,
    blockTime: row.block_time,
    name: row.name,
    args: row.args,
    createdAt: row.created_at,
  };
}

/** Deterministic shuffle (mulberry32), so a failing order can be replayed. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const value = copy[index] as T;
    copy[index] = copy[other] as T;
    copy[other] = value;
  }
  return copy;
}

describe("projection of a whole history in any arrival order", () => {
  let setup: Setup | undefined;
  let campaigns: SeededCampaign[] = [];
  let events: { event: DecodedEvent; blockTime: Date }[] = [];
  let baseline: ProjectionSnapshot;

  function ready(): Setup {
    if (setup === undefined) throw new Error("setup missing");
    return setup;
  }

  /** Empties every projected table and `chain_events`, and puts back the API's rows. */
  async function reset(): Promise<void> {
    const { db } = ready();
    await db.begin(async (tx) => {
      await tx`delete from live_campaigns`;
      await tx`delete from lots`;
      await tx`delete from positions`;
      await tx`delete from tickets`;
      await tx`delete from chain_events`;
      for (const campaign of campaigns) {
        await tx`
          update campaigns
          set status = 'funding', live_at = null, outcome = null,
              budget = ${campaign.budget.toString()}::bigint, sales_close = ${campaign.salesClose}
          where id = ${campaign.rowId}
        `;
      }
    });
  }

  async function insertOne(entry: { event: DecodedEvent; blockTime: Date }): Promise<void> {
    expect(await insertChainEvents(ready().db, [entry.event], entry.blockTime)).toBe(1);
  }

  /** Passes until every event is processed; at most `limit`. */
  async function drain(projector: ChainProjector, limit = 10): Promise<void> {
    for (let pass = 0; pass < limit && (await unprocessed(ready().db)) > 0n; pass += 1) {
      await projector.runPass();
    }
    expect(await unprocessed(ready().db)).toBe(0n);
  }

  async function assertExposureInvariant(): Promise<void> {
    for (const row of await exposureCheck(ready().db)) {
      expect(row.exposure, `exposure of ${row.instrument}`).toBe(row.refundable);
    }
  }

  /** Campaign status and budget, and the instrument's exposure, as the contract has them. */
  async function assertMatchesChain(): Promise<void> {
    const { db, driver } = ready();
    let exposure = 0n;
    for (const campaign of campaigns) {
      const onchain = await driver.getCampaign(campaign.id);
      const row = await campaignRow(db, campaign.id);
      expect(row?.status, `status of ${campaign.slug}`).toBe(STATUS_BY_INDEX[onchain.status]);
      expect(row?.budget, `budget of ${campaign.slug}`).toBe(onchain.hedgeBudget);
      if (onchain.status <= 1) exposure += onchain.lockedRefunds;
    }
    const [position] = await db<{ exposure: bigint }[]>`
      select exposure from positions where instrument = ${SYMBOL}
    `;
    expect(position?.exposure).toBe(exposure);
  }

  /** Inserts the events one by one in `order`, with a projector pass after each. */
  async function projectInArrivalOrder(
    order: readonly { event: DecodedEvent; blockTime: Date }[],
  ): Promise<void> {
    await reset();
    const projector = new ChainProjector(ready().db, silent());
    for (const entry of order) {
      await insertOne(entry);
      await projector.runPass();
      await assertExposureInvariant();
    }
    await drain(projector);
    await assertExposureInvariant();
  }

  beforeAll(async () => {
    setup = await openSetup();
    const current = setup;
    const { driver, env } = current;
    const a = await createCampaign(current, {
      merchant: env.accounts.merchant.address,
      label: "order-a",
      budget: 300n * USDC,
    });
    const b = await createCampaign(current, {
      merchant: MERCHANT_2,
      label: "order-b",
      budget: 200n * USDC,
      unitPrice: parseUsd("7.5"),
    });
    // C stays unsettled: its last pause on-chain decides its status.
    const c = await createCampaign(current, {
      merchant: MERCHANT_3,
      label: "order-c",
      budget: 100n * USDC,
    });
    campaigns = [a, b, c];

    const ticketsA = [
      (await driver.buy(a.id, BUYER_1, 3, 3n * USDC)).ticketId,
      (await driver.buy(a.id, BUYER_3, 2, 3n * USDC)).ticketId,
    ];
    const ticketsB = [(await driver.buy(b.id, BUYER_2, 2, 3n * USDC)).ticketId];
    await driver.buy(c.id, BUYER_1, 4, 3n * USDC);
    await driver.topUp(a.id, 10n * USDC);
    await driver.topUp(a.id, 25n * USDC);
    await driver.topUp(b.id, 7n * USDC);
    await driver.setPaused(a.id, true);
    await driver.setPaused(a.id, false);
    await driver.setPaused(c.id, true);
    await driver.setPaused(c.id, false);
    await driver.setPaused(c.id, true);
    ticketsA.push((await driver.buy(a.id, BUYER_2, 1, 3n * USDC)).ticketId);
    const charged = [...ticketsA, ...ticketsB];
    await driver.chargeHedge(
      charged,
      charged.map((_, index) => (index % 2 === 0 ? 1_250_000n + BigInt(index) : 0n)),
    );
    await driver.closeSales(a.id);
    await env.advanceTime(HOUR + 1n);
    await driver.settle(a.id, 0);
    await driver.settle(b.id, 1);
    // EC-7: the refund of a blocked buyer fails, then succeeds once unblocked.
    await driver.setBlocked(BUYER_3, true);
    await driver.refundBatch(a.id, ticketsA);
    await driver.setBlocked(BUYER_3, false);
    const blockedTicket = ticketsA[1];
    if (blockedTicket === undefined) throw new Error("ticket missing");
    await driver.refundBatch(a.id, [blockedTicket]);
    await driver.payMerchant(a.id);

    const head = await env.publicClient.getBlockNumber({ cacheTime: 0 });
    const logs = await env.publicClient.getLogs({
      address: env.escrow,
      fromBlock: env.deployedAtBlock,
      toBlock: head,
    });
    const decoded = decodeEscrowLogs(logs, env.escrow);
    expect(decoded.undecodable).toEqual([]);
    const times = new Map<bigint, Date>();
    for (const event of decoded.events) {
      if (!times.has(event.blockNumber)) {
        const block = await env.publicClient.getBlock({ blockNumber: event.blockNumber });
        times.set(event.blockNumber, new Date(Number(block.timestamp) * 1000));
      }
    }
    events = decoded.events.map((event) => ({
      event,
      blockTime: times.get(event.blockNumber) ?? new Date(0),
    }));
    const names = new Set(events.map((entry) => entry.event.name));
    for (const name of ["BudgetToppedUp", "CampaignPaused", "RefundFailed", "TicketRefunded"]) {
      expect(names.has(name), name).toBe(true);
    }

    // The reference: every event in chain order.
    await projectInArrivalOrder(events);
    await assertMatchesChain();
    baseline = await projectionSnapshot(current.db);
    expect(baseline.tickets.length).toBe(5);
  });

  afterAll(async () => {
    await closeSetup(setup);
  });

  it.each([
    ["backwards", (list: typeof events): typeof events => [...list].reverse()],
    ["shuffled (seed 1)", (list: typeof events): typeof events => shuffled(list, 1)],
    ["shuffled (seed 7)", (list: typeof events): typeof events => shuffled(list, 7)],
    ["shuffled (seed 2026)", (list: typeof events): typeof events => shuffled(list, 2026)],
    [
      "every other event late",
      (list: typeof events): typeof events => [
        ...list.filter((_, index) => index % 2 === 1),
        ...list.filter((_, index) => index % 2 === 0),
      ],
    ],
  ])("ends in the same rows when the events arrive %s", async (_label, reorder) => {
    await projectInArrivalOrder(reorder(events));
    await assertMatchesChain();
    expect(await projectionSnapshot(ready().db)).toEqual(baseline);
  });

  it("applies each event once when three projectors run at the same time", async () => {
    const { db } = ready();
    await reset();
    for (const entry of events) await insertOne(entry);
    const projectors = [0, 1, 2].map(() => new ChainProjector(db, silent()));
    let processed = 0;
    for (let round = 0; round < 10 && (await unprocessed(db)) > 0n; round += 1) {
      const results = await Promise.all(projectors.map(async (p) => p.runPass()));
      for (const result of results) processed += result.applied + result.ignored;
      await assertExposureInvariant();
    }
    expect(await unprocessed(db)).toBe(0n);
    // Each row was taken by exactly one projector.
    expect(processed).toBe(events.length);
    await assertMatchesChain();
    expect(await projectionSnapshot(db)).toEqual(baseline);
  });

  it("reports the hedged share of a campaign's lots in basis points, rounded down", async () => {
    const { db } = ready();
    await reset();
    await projectInArrivalOrder(events);
    const c = campaigns[2];
    if (c === undefined) throw new Error("campaign missing");
    // Hedging fills part of C's lot (the hedging lane writes filled_qty).
    const [lot] = await db<{ qty: bigint }[]>`
      select qty from lots where campaign_id = ${c.rowId}
    `;
    if (lot === undefined) throw new Error("lot missing");
    const filled = lot.qty / 3n + 1n;
    await db`update lots set filled_qty = ${filled.toString()}::bigint where campaign_id = ${c.rowId}`;
    // Any event of C refreshes its public row; apply its last one again.
    const [last] = await db<StoredRow[]>`
      select * from chain_events
      where args ->> 'id' = ${c.id.toString()}
      order by block_number desc, log_index desc limit 1
    `;
    if (last === undefined) throw new Error("no event of C");
    await db.begin(async (tx) => {
      await projectChainEvent(tx, toStored(last));
    });
    const [live] = await db<{ hedged_bps: number }[]>`
      select hedged_bps from live_campaigns where slug = ${c.slug}
    `;
    const expected = (filled * 10_000n) / lot.qty;
    // A third of the lot and a bit: not a whole number of basis points, so ceil would differ.
    expect((filled * 10_000n) % lot.qty).not.toBe(0n);
    expect(expected).toBeGreaterThan(0n);
    expect(BigInt(live?.hedged_bps ?? -1)).toBe(expected);
  });
});

describe("an event that keeps failing", () => {
  it("is logged once while it fails the same way, and once more when it is applied", async () => {
    await withSetup(async (setup) => {
      const { db, driver, env } = setup;
      const campaign = await createCampaign(setup, {
        merchant: env.accounts.merchant.address,
        label: "failing",
        budget: 200n * USDC,
      });
      const { logger, entries } = capturingLogger();
      const projector = new ChainProjector(db, logger);
      await insertReceipt(setup, campaign.created);
      const bought = await driver.buy(campaign.id, BUYER_1, 1, 2n * USDC);
      // The charge arrives; the purchase it charges does not, yet.
      await insertReceipt(setup, await driver.chargeHedge([bought.ticketId], [1_000_000n]));
      for (let pass = 0; pass < 4; pass += 1) {
        expect((await projector.runPass()).failed).toBe(1);
      }
      const failures = entries.filter((entry) => entry.level === 50);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.event).toBe("HedgeCharged");
      expect(failures[0]?.failingEvents).toBe(1);
      expect(projector.failingEvents).toBe(1);

      await insertReceipt(setup, bought);
      expect((await projector.runPass()).failed).toBe(0);
      expect(projector.failingEvents).toBe(0);
      expect(await unprocessed(db)).toBe(0n);
      expect(entries.filter((entry) => entry.level === 50)).toHaveLength(1);
      expect(entries.some((entry) => entry.msg === "chain event projected after failing")).toBe(
        true,
      );
    });
  });
});
