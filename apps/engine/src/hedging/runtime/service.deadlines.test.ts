/**
 * Two paths of the service that its anvil harness cannot hold still, on a real Postgres with a
 * fake outbox (it queues `chargeHedge` transactions in `chain_txs` as the real one does, and never
 * sends them) and the paper venue fed by a hand-driven book:
 *
 * - The restore: a runner rebuilt from the database gets the version (`asOf`) of the read it was
 *   rebuilt from, so a read taken before it (the listing of the same pass, read before a sale
 *   raised the exposure) is ignored when it reaches the fresh runner.
 * - `finalize` has one deadline, `finalizeTimeoutMs` from its start, shared by its reconciliation
 *   and its wait for the charges, and every wait in it is bounded by that deadline: its own
 *   reconciliation (`reconcile(entry, notAfter)`), the wait for one the sales-close pass is running
 *   (`waitUntil`), and nothing new is started once the deadline has passed.
 *
 * Elapsed-time bounds. One Postgres serves every test file of a run, so a database round can take
 * hundreds of milliseconds under load. Each upper bound below sits about halfway between what the
 * code does (the deadline plus a poll and a round or two) and what the defect it guards against
 * would take, and each comment states the margin on both sides.
 */
import { createHook } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hedgeInstrumentSchema, type HedgeInstrument } from "@winz/shared";

import type { EnqueueResult, TxRequest } from "../../chain";
import { capturingLogger, type LogEntry } from "../../chain/ingest-test-support";
import { createDb } from "../../db";
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
import { HedgeFinalizeError, HedgeNotReconciledError } from "./errors";
import { startHedging, type Hedging, type StartHedgingOptions } from "./index";
import { CONTRACT, HandBookSource, OffsetClock, waitFor } from "./test-support";

/**
 * The finalizer's deadline is armed with `Date.now()` and waited with `setTimeout`, which runs on
 * the monotonic clock rounded to whole milliseconds: measured on the wall clock, giving up exactly
 * at the deadline can read 1 ms short (1 499 ms for 1 500 ms, seen on CI). The lower bounds
 * allow two milliseconds for that rounding and nothing else: they still fail a finalizer that
 * gives up before its deadline.
 */
const CLOCK_SLACK_MS = 2;

const QUIET = { bid: 4000n, ask: 4600n } as const;
const ESCROW = "0x00000000000000000000000000000000000e5c00" as const;
const STALE_READ_LOG = "exposure read older than what the runner has: ignored";
const RUNNER_STARTED_LOG = "hedging runner started";
const SALES_CLOSE_LOG = "sales closed: position reconciled and remaining lots charged";
const SALES_CLOSE_FAILED_LOG = "sales-close reconciliation failed";

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
  await stopServices();
  await database?.drop();
});

/** Stops every service the test started and waits until each has stopped. */
async function stopServices(): Promise<void> {
  for (const service of running.splice(0)) {
    service.controller.abort();
    await service.hedging.stopped;
  }
}

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

/** The instrument's position row, as the projection would have left it. */
async function seedPosition(exposure: bigint, held: bigint): Promise<void> {
  await database.db`
    insert into positions (instrument, exposure, held, venue)
    values (${market.instrument}, ${exposure.toString()}::bigint, ${held.toString()}::bigint,
            'paper')
  `;
}

/** The campaign's sales closed a minute ago: the first exposure pass starts a reconciliation. */
async function closeSales(): Promise<void> {
  await database.db`
    update campaigns set sales_close = now() - interval '1 minute'
    where id = ${campaign.campaignId}
  `;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * A gate the test opens. It also opens by itself after `safetyMs`, so that code which waits for it
 * with no bound (the defect a test guards against) still ends; its timer is cleared once open.
 */
interface Gate {
  opened: Promise<void>;
  open: () => void;
}

function gate(safetyMs: number): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, safetyMs);
    open = (): void => {
      clearTimeout(timer);
      resolve();
    };
  });
  return { opened, open };
}

/** True for a stack frame of the hedging engine's own source: not its tests, not their helpers. */
function isHedgingSourceFrame(frame: string): boolean {
  return /\/src\/hedging\//.test(frame) && !/\.test\.ts|test-support/.test(frame);
}

interface TimerWatch {
  /** The stacks that armed the timers still running: neither fired nor cleared. */
  alive: () => string[];
  stop: () => void;
}

/**
 * Follows every timer armed from the hedging engine's source from now on: recorded with the stack
 * that armed it, forgotten when it fires or is cleared (Node emits `destroy` for a timer at that
 * moment). Counting the process's active timers instead cannot tell one timer left by the service
 * from the timers of the database pool and of the test runner, which come and go: a timer planted
 * in the service went unnoticed that way.
 */
function watchHedgingTimers(): TimerWatch {
  const armed = new Map<number, string>();
  const hook = createHook({
    init(asyncId: number, type: string): void {
      if (type !== "Timeout") return;
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 50;
      const stack = new Error("timer armed here").stack ?? "";
      Error.stackTraceLimit = limit;
      const frames = stack.split("\n");
      // The database pool's own timers (a connection's idle timer, a query's time bound) are
      // armed and cleared by the pool, even when a hedging call is lower on the stack.
      const caller = frames[frames.findIndex((frame) => /\bsetTimeout\b/.test(frame)) + 1] ?? "";
      if (/node_modules[\\/].*postgres[\\/]/.test(caller)) return;
      if (frames.some(isHedgingSourceFrame)) armed.set(asyncId, stack);
    },
    destroy(asyncId: number): void {
      armed.delete(asyncId);
    },
  });
  hook.enable();
  return {
    alive: (): string[] => [...armed.values()],
    stop: (): void => {
      hook.disable();
    },
  };
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
    // deadlines (one per part) would give up at reconcileHoldMs + finalizeTimeoutMs (3.5 s; 3.6 s
    // measured) or later; one deadline at finalizeTimeoutMs plus at most a poll (200 ms) and a
    // database round. The bound, 3 000 ms, leaves 1 000 ms above the deadline for that poll and
    // rounds slowed by the other test files sharing the cluster, and fails 500 ms (600 ms
    // measured) below what two deadlines take.
    expect(elapsedMs).toBeGreaterThanOrEqual(finalizeTimeoutMs - CLOCK_SLACK_MS);
    expect(elapsedMs).toBeLessThan(3_000);
  });

  it("caps its own reconciliation at its deadline, not at reconcileTimeoutMs (notAfter)", async () => {
    const finalizeTimeoutMs = 1_500;
    const reconcileTimeoutMs = 8_000;
    // 10 contracts sold, 5 held, and no ask: the 5 missing cannot be bought, so the reconciliation
    // never converges and only a deadline ends it.
    await createLot(database.db, market, campaign, 10n * CONTRACT, 5_000_000n);
    await bought(5n * CONTRACT);
    await seedPosition(10n * CONTRACT, 5n * CONTRACT);
    books.push(market.instrument, QUIET.bid, null);
    let reconciliations = 0;
    const hedging = start({
      finalizeTimeoutMs,
      reconcileTimeoutMs,
      testHooks: {
        beforeReconcile: async (instrument: string): Promise<void> => {
          if (instrument === market.instrument) reconciliations += 1;
          await Promise.resolve();
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

    // Its own reconciliation, which did not converge: H 5 against E 10.
    expect(reconciliations).toBe(1);
    expect(outcome).toBeInstanceOf(HedgeNotReconciledError);
    expect(String(outcome)).toContain(
      `held ${(5n * CONTRACT).toString()}, exposure ${(10n * CONTRACT).toString()}`,
    );
    // Capped at the finalize deadline (1.5 s) plus a reconciliation poll (100 ms) and a database
    // round; a reconciliation that ignored `notAfter` would wait reconcileTimeoutMs (8 s). The
    // bound, 4 000 ms, leaves 2 500 ms above the deadline and fails 4 000 ms below 8 s.
    expect(elapsedMs).toBeGreaterThanOrEqual(finalizeTimeoutMs - CLOCK_SLACK_MS);
    expect(elapsedMs).toBeLessThan(4_000);
  });

  it("stops waiting for a sales-close reconciliation still running at its deadline (waitUntil)", async () => {
    const finalizeTimeoutMs = 1_500;
    // E 5, H 5: once let go, the sales-close reconciliation converges at once.
    await createLot(database.db, market, campaign, 5n * CONTRACT, 2_500_000n);
    await bought(5n * CONTRACT);
    await seedPosition(5n * CONTRACT, 5n * CONTRACT);
    await closeSales();
    // Opens the held reconciliation; replaced by the gate's own `open` once the gate exists.
    let release: () => void = () => undefined;
    let reconciliations = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    // Every timer the hedging engine arms from here on, until it fires or is cleared.
    const timers = watchHedgingTimers();
    try {
      // Held until the test lets it go; on its own after 8 s at most (see `gate`).
      const held = gate(8_000);
      release = held.open;
      const hedging = start({
        finalizeTimeoutMs,
        reconcileTimeoutMs: 10_000,
        testHooks: {
          beforeReconcile: async (instrument: string): Promise<void> => {
            if (instrument !== market.instrument) return;
            reconciliations += 1;
            // The first is the sales-close pass's: held past the finalizer's deadline.
            if (reconciliations === 1) await held.opened;
          },
        },
      });
      await waitFor(async () => reconciliations > 0, "the sales-close reconciliation started");

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

      expect(outcome).toBeInstanceOf(HedgeNotReconciledError);
      expect(String(outcome)).toContain(
        "another reconciliation of the instrument kept running until the finalizer's deadline",
      );
      // It started no reconciliation of its own: the sales-close one is still the only one.
      expect(reconciliations).toBe(1);
      // Gave up at its deadline (1.5 s) plus a timer's lateness; a wait with no bound would last
      // until the held reconciliation ends (8 s here, the gate's own limit). The bound, 3 000 ms,
      // leaves 1 500 ms above the deadline and fails 5 000 ms below 8 s.
      expect(elapsedMs).toBeGreaterThanOrEqual(finalizeTimeoutMs - CLOCK_SLACK_MS);
      expect(elapsedMs).toBeLessThan(3_000);

      // The held reconciliation goes on unharmed and ends cleanly once let go.
      held.open();
      await waitFor(
        async () => logs.some((entry) => entry.msg === SALES_CLOSE_LOG),
        "the sales-close reconciliation completed",
      );
      expect(logs.filter((entry) => entry.msg === SALES_CLOSE_FAILED_LOG)).toEqual([]);
      expect(reconciliations).toBe(1);

      // Nothing the finalizer's wait set up outlives the service: no timer left running.
      await stopServices();
      await sleep(50);
      expect(timers.alive()).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      timers.stop();
      release();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("starts no reconciliation of its own once the deadline passed during its wait for another", async () => {
    // Before the deadline the test must: sleep 300 ms, take the lock, let the first
    // reconciliation end (reconcileTimeoutMs 300 ms plus a 100 ms poll) and run a few database
    // rounds, about 1 s in all. 3 000 ms leaves about 2 s for rounds slowed by the other test
    // files sharing the cluster.
    const finalizeTimeoutMs = 3_000;
    // 10 contracts sold, 5 held, and no ask: a reconciliation ends incomplete (after
    // reconcileTimeoutMs), so a finalizer back from waiting for one still has one to run.
    await createLot(database.db, market, campaign, 10n * CONTRACT, 5_000_000n);
    await bought(5n * CONTRACT);
    await seedPosition(10n * CONTRACT, 5n * CONTRACT);
    books.push(market.instrument, QUIET.bid, null);
    const held = gate(10_000);
    let reconciliations = 0;
    const hedging = start({
      finalizeTimeoutMs,
      reconcileTimeoutMs: 300,
      // One exposure pass only (it starts the runner): the instrument listing is then read by the
      // finalizers alone, so the lock check below can only match one of them. Sales are open: no
      // pass reconciles. (A single sales-close pass cannot start the other reconciliation: when
      // another session's commit lands between its listing and the runner's restore, the runner
      // ignores that listing as older and the pass ends before its sales-close check.)
      exposureIntervalMs: 600_000,
      testHooks: {
        beforeReconcile: async (instrument: string): Promise<void> => {
          if (instrument !== market.instrument) return;
          reconciliations += 1;
          if (reconciliations === 1) await held.opened;
        },
      },
    });
    await waitFor(
      async () => logs.some((entry) => entry.msg === RUNNER_STARTED_LOG),
      "the runner restored",
    );
    const target = {
      id: campaign.campaignId,
      onchainId: campaign.campaignOnchainId,
      instrument: market.instrument,
    };
    // The other reconciliation: a first finalize's, held by the hook until the test lets it go.
    const first = hedging.finalizer.finalize(target).then(
      () => null,
      (error: unknown) => error,
    );
    await waitFor(async () => reconciliations > 0, "the first finalizer's reconciliation started");

    // A second client, so that the lock and the checks below never wait for a connection of the
    // service's pool that the lock itself keeps busy.
    const locker = createDb(database.url, { max: 2 });
    let unlock: () => void = () => undefined;
    const mayUnlock = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    let lock: Promise<void> | null = null;
    try {
      const startedAt = Date.now();
      const finalizing = hedging.finalizer.finalize(target).then(
        () => null,
        (error: unknown) => error,
      );
      // The second finalizer is now waiting for the first one's reconciliation.
      await sleep(300);

      // The read it takes once back from that wait is held past its deadline: `events`, which only
      // the instrument listing reads, is locked until the test lets it go.
      let markLocked: () => void = () => undefined;
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve;
      });
      lock = locker
        .begin(async (tx) => {
          await tx`lock table events in access exclusive mode`;
          markLocked();
          await mayUnlock;
        })
        .then(() => undefined);
      await Promise.race([
        locked,
        lock.then(() => {
          throw new Error("the lock ended before it was held");
        }),
      ]);
      held.open();
      // The first finalizer's reconciliation ends incomplete, and so does that finalizer.
      const firstOutcome = await first;
      expect(firstOutcome).toBeInstanceOf(HedgeNotReconciledError);
      expect(String(firstOutcome)).toContain(
        `held ${(5n * CONTRACT).toString()}, exposure ${(10n * CONTRACT).toString()}`,
      );
      // The wait ended before the deadline; the second's read of the instrument is blocked.
      expect(Date.now()).toBeLessThan(startedAt + finalizeTimeoutMs);
      await waitFor(async () => {
        const [row] = await locker<{ n: bigint }[]>`
          select count(*)::bigint as n
          from pg_locks l
          join pg_class c on c.oid = l.relation
          join pg_stat_activity a on a.pid = l.pid
          where c.relname = 'events' and not l.granted and a.query like '%with candidates%'
            and l.database = (select oid from pg_database where datname = current_database())
        `;
        return (row?.n ?? 0n) > 0n;
      }, "the second finalizer reading the instrument again, held by the lock");
      await sleep(startedAt + finalizeTimeoutMs + 200 - Date.now());
      unlock();
      await lock;

      const outcome = await finalizing;
      // The first finalizer's reconciliation is the only one: the second started none.
      expect(reconciliations).toBe(1);
      expect(outcome).toBeInstanceOf(HedgeNotReconciledError);
      expect(String(outcome)).toContain(
        "the finalizer's deadline passed before its reconciliation could start",
      );
    } finally {
      unlock();
      held.open();
      await first;
      await lock?.catch(() => undefined);
      await locker.end({ timeout: 5 });
    }
  });
});
