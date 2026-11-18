/**
 * Two paths of the service that its anvil harness cannot hold still, on a real Postgres with a
 * fake outbox (it queues `chargeHedge` transactions in `chain_txs` as the real one does, and never
 * sends them) and the paper venue fed by a hand-driven book:
 *
 * - The restore: a runner rebuilt from the database gets the version (`asOf`) of the read it was
 *   rebuilt from, so a read taken before it (the listing of the same pass, read before a sale
 *   raised the exposure) is ignored when it reaches the fresh runner.
 * - `finalize` has one deadline, `finalizeTimeoutMs` from its start, shared by its reconciliation
 *   and its wait for the charges.
 */
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hedgeInstrumentSchema, type HedgeInstrument } from "@winz/shared";

import type { EnqueueResult, TxRequest } from "../../chain";
import { capturingLogger, type LogEntry } from "../../chain/ingest-test-support";
import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { recordFill } from "../allocation";
import {
  createCampaign,
  createLot,
  createMarket,
  createOrder,
  type CampaignFixture,
  type MarketFixture,
} from "../allocation/test-support";
import { HedgeFinalizeError } from "./errors";
import { startHedging, type Hedging, type StartHedgingOptions } from "./index";
import { CONTRACT, HandBookSource, OffsetClock, waitFor } from "./test-support";

const QUIET = { bid: 4000n, ask: 4600n } as const;
const ESCROW = "0x00000000000000000000000000000000000e5c00" as const;
const STALE_READ_LOG = "exposure read older than what the runner has: ignored";
const RUNNER_STARTED_LOG = "hedging runner started";

/** The outbox as the charger sees it: requests queued in `chain_txs`, never sent. */
class QueueOnlyOutbox {
  readonly requests: TxRequest[] = [];

  constructor(private readonly database: TestDatabase) {}

  async enqueue(request: TxRequest): Promise<EnqueueResult> {
    this.requests.push(request);
    const db = this.database.db;
    const [row] = await db<{ id: string }[]>`
      insert into chain_txs (idempotency_key, signer, kind, to_address, data, payload)
      values (${request.idempotencyKey}, ${request.signer}, ${request.kind}, ${request.to},
              ${request.data}, ${db.json(request.payload as Record<string, string[]>)})
      on conflict (idempotency_key) do nothing
      returning id
    `;
    if (row !== undefined) return { id: row.id, created: true };
    const [existing] = await db<{ id: string }[]>`
      select id from chain_txs where idempotency_key = ${request.idempotencyKey}
    `;
    return { id: existing?.id ?? randomUUID(), created: false };
  }
}

let database: TestDatabase;
let market: MarketFixture;
let campaign: CampaignFixture;
let logs: LogEntry[];
let clock: OffsetClock;
let books: HandBookSource;
let refresher: ReturnType<typeof setInterval> | null;
const running: { controller: AbortController; hedging: Hedging }[] = [];

beforeEach(async () => {
  database = await createTestDatabase();
  market = await createMarket(database.db);
  campaign = await createCampaign(database.db, market);
  logs = [];
  clock = new OffsetClock();
  books = new HandBookSource(clock);
  books.push(market.instrument, QUIET.bid, QUIET.ask);
  // A feed that keeps delivering: the runner's book never goes stale.
  refresher = setInterval(() => books.refresh(market.instrument), 100);
});

afterEach(async () => {
  if (refresher !== null) clearInterval(refresher);
  refresher = null;
  for (const service of running.splice(0)) {
    service.controller.abort();
    await service.hedging.stopped;
  }
  await database?.drop();
});

function start(options: Partial<StartHedgingOptions> = {}): Hedging {
  const captured = capturingLogger();
  logs = captured.entries;
  const controller = new AbortController();
  const hedging = startHedging({
    db: database.db,
    bookFeed: books,
    txSender: new QueueOnlyOutbox(database),
    venueName: "paper",
    escrowAddress: ESCROW,
    logger: captured.logger,
    signal: controller.signal,
    clock,
    exposureIntervalMs: 100,
    tickIntervalMs: 100,
    chargeIntervalMs: 200,
    deskMinIntervalMs: 100,
    ...options,
  });
  running.push({ controller, hedging });
  return hedging;
}

/** A buy fill of `qty` at $0.41 recorded on an order of the instrument (allocated as recorded). */
async function bought(qty: bigint): Promise<void> {
  const orderId = await createOrder(database.db, market, "buy", {
    kind: "maker",
    qty,
    priceBps: 4100,
  });
  const result = await recordFill(database.db, {
    orderId,
    venueFillId: `seed-${randomUUID()}`,
    priceBps: 4100n,
    qty,
    fee: 0n,
    at: new Date(),
    bookRef: null,
  });
  expect(result.status).toBe("recorded");
}

async function deskRow(): Promise<HedgeInstrument | null> {
  const [row] = await database.db<{ payload: unknown }[]>`
    select payload from live_hedge_desk where instrument = ${market.instrument}
  `;
  return row === undefined ? null : hedgeInstrumentSchema.parse(row.payload);
}

/** Orders the service placed (the seeded ones have no client order id). */
async function placedOrders(): Promise<{ venue_order_id: string; side: string }[]> {
  return database.db<{ venue_order_id: string; side: string }[]>`
    select venue_order_id, side from orders
    where instrument = ${market.instrument} and venue_order_id is not null
  `;
}

describe("a runner restored after the read its pass is about to hand it", () => {
  it("ignores that older read (older_read): it keeps the newer exposure and places no order", async () => {
    // 5 contracts sold and hedged; 5 more bought ahead of exposure: E 5, H 10.
    await createLot(database.db, market, campaign, 5n * CONTRACT, 2_500_000n);
    await bought(10n * CONTRACT);
    await database.db`
      insert into positions (instrument, exposure, held, venue)
      values (${market.instrument}, ${(5n * CONTRACT).toString()}::bigint,
              ${(10n * CONTRACT).toString()}::bigint, 'paper')
    `;

    // A sale of 5 contracts in progress, as the projection writes it (its lot and the exposure in
    // one transaction). The transaction also holds `engine_params`, which the service reads right
    // between the listing of its pass and the restore of the runner: the listing is taken while
    // the sale is in progress (E 5), the restore after it committed (E 10).
    let commitSale: () => void = () => undefined;
    const saleMayCommit = new Promise<void>((resolve) => {
      commitSale = resolve;
    });
    let markWritten: () => void = () => undefined;
    const saleWritten = new Promise<void>((resolve) => {
      markWritten = resolve;
    });
    const sale = database.db.begin(async (tx) => {
      const [ticket] = await tx<{ id: string }[]>`
        insert into tickets (onchain_id, campaign_id, buyer, qty, paid, refundable, max_hedge_cost,
                             access_token)
        values (${(9_000_000n + BigInt(Date.now() % 1_000_000)).toString()}::bigint,
                ${campaign.campaignId}, '0x00000000000000000000000000000000000b0b07', 1,
                ${(5n * CONTRACT).toString()}::bigint, ${(5n * CONTRACT).toString()}::bigint,
                2500000, ${randomUUID()})
        returning id
      `;
      if (ticket === undefined) throw new Error("ticket insert failed");
      await tx`
        insert into lots (ticket_id, campaign_id, instrument, qty, max_hedge_cost)
        values (${ticket.id}, ${campaign.campaignId}, ${market.instrument},
                ${(5n * CONTRACT).toString()}::bigint, 2500000)
      `;
      await tx`
        update positions set exposure = ${(10n * CONTRACT).toString()}::bigint
        where instrument = ${market.instrument}
      `;
      await tx`lock table engine_params in access exclusive mode`;
      markWritten();
      await saleMayCommit;
    });
    try {
      // The sale's transaction ends only once the test lets it: ending before is a failure.
      await Promise.race([
        saleWritten,
        sale.then(() => {
          throw new Error("the sale ended before it was held open");
        }),
      ]);
      // One pass only: no later pass can hand the runner a read of its own.
      start({ exposureIntervalMs: 600_000 });
      // The pass listed the instrument (E 5) and now waits to read the risk parameters.
      await waitFor(async () => {
        const [row] = await database.db<{ n: bigint }[]>`
          select count(*)::bigint as n
          from pg_locks l
          join pg_class c on c.oid = l.relation
          join pg_stat_activity a on a.pid = l.pid
          where c.relname = 'engine_params' and not l.granted
            and a.query like '%from engine_params%'
        `;
        return (row?.n ?? 0n) > 0n;
      }, "the pass waiting to restore the runner, its listing read");
      expect(logs.some((entry) => entry.msg === RUNNER_STARTED_LOG)).toBe(false);
    } finally {
      commitSale();
      await sale;
    }

    await waitFor(
      async () => logs.some((entry) => entry.msg === RUNNER_STARTED_LOG),
      "the runner restored",
    );
    expect(logs.find((entry) => entry.msg === RUNNER_STARTED_LOG)).toMatchObject({
      instrument: market.instrument,
      exposure: (10n * CONTRACT).toString(),
      held: (10n * CONTRACT).toString(),
    });
    // The listing reached the fresh runner after its restore, and was not applied.
    await waitFor(
      async () => logs.some((entry) => entry.msg === STALE_READ_LOG),
      "the listing's read handed to the runner and ignored",
      5_000,
    );
    expect(logs.filter((entry) => entry.msg === STALE_READ_LOG)).toEqual([
      expect.objectContaining({
        instrumentSymbol: market.instrument,
        reason: "older_read",
        readExposure: (5n * CONTRACT).toString(),
        exposure: (10n * CONTRACT).toString(),
      }),
    ]);

    // The runner keeps the newer exposure: E 10 = H 10, nothing to buy or sell.
    await waitFor(async () => {
      const desk = await deskRow();
      return desk !== null;
    }, "the desk row of the runner");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const desk = await deskRow();
    expect({ exposure: desk?.exposure, held: desk?.held }).toEqual({
      exposure: (10n * CONTRACT).toString(),
      held: (10n * CONTRACT).toString(),
    });
    expect(await placedOrders()).toEqual([]);
  });
});

describe("finalize has one deadline", () => {
  it("gives up at finalizeTimeoutMs from its start when the reconciliation took most of it", async () => {
    const finalizeTimeoutMs = 2_000;
    const reconcileHoldMs = 1_500;
    // 5 contracts sold and hedged: E 5, H 5. Its charge is queued and never sent.
    const lot = await createLot(database.db, market, campaign, 5n * CONTRACT, 2_500_000n);
    await bought(5n * CONTRACT);
    await database.db`
      insert into positions (instrument, exposure, held, venue)
      values (${market.instrument}, ${(5n * CONTRACT).toString()}::bigint,
              ${(5n * CONTRACT).toString()}::bigint, 'paper')
    `;
    let reconciliations = 0;
    const hedging = start({
      finalizeTimeoutMs,
      reconcileTimeoutMs: 10_000,
      testHooks: {
        // The finalizer's reconciliation takes most of its time (a book slow to settle, say).
        beforeReconcile: async (instrument: string): Promise<void> => {
          if (instrument !== market.instrument) return;
          reconciliations += 1;
          await new Promise((resolve) => setTimeout(resolve, reconcileHoldMs));
        },
      },
    });
    await waitFor(
      async () => logs.some((entry) => entry.msg === RUNNER_STARTED_LOG),
      "the runner restored",
    );

    const startedAt = Date.now();
    const outcome = await hedging.finalizer
      .finalize({
        id: campaign.campaignId,
        onchainId: campaign.campaignOnchainId,
        instrument: market.instrument,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    const elapsedMs = Date.now() - startedAt;

    expect(reconciliations).toBe(1);
    expect(outcome).toBeInstanceOf(HedgeFinalizeError);
    expect(String(outcome)).toContain("still pending");
    // The charge it waited for is the lot's, queued and never sent.
    const [queued] = await database.db<{ status: string; tickets: string[] }[]>`
      select status, payload -> 'ticketIds' as tickets from chain_txs where kind = 'chargeHedge'
    `;
    expect(queued).toEqual({ status: "queued", tickets: [lot.ticketOnchainId.toString()] });
    // The reconciliation used most of the time; the wait for the charges only what was left. Two
    // deadlines (one per part) would give up at reconcileHoldMs + finalizeTimeoutMs (3.5 s) or
    // later; one deadline at finalizeTimeoutMs plus at most a poll (200 ms) and a database round.
    expect(elapsedMs).toBeGreaterThanOrEqual(finalizeTimeoutMs);
    expect(elapsedMs).toBeLessThan(finalizeTimeoutMs + 700);
  });
});
