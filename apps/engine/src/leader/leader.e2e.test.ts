/**
 * Two (and three) real engines on ONE database and ONE local chain: each one is the real
 * `startEngine` composition (transaction sender, book feed, chain ingest, hedging, sale states,
 * settlement, job worker) wrapped by an `EngineLeader`, with its own database pool, as two
 * processes would be.
 *
 * - a clean handover with a purchase in flight (its transaction broadcast, not mined): the
 *   standby works within 2 s of the leader's stop, the purchase ends ticketed once, the outbox
 *   holds no duplicate, the hedge holds the exposure once;
 * - a crash (no renewal, no release): the standby works after the ttl, not before;
 * - self-fencing: the leader's database access is cut; its services stop before the lease
 *   expires (database times), and it can lead again afterwards;
 * - a stolen lease: the leader stops at once;
 * - a redeploy as Railway does it: B starts while A leads, B's /healthz answers 200 standby, A gets
 *   its stop, B leads within 2 s, and at most one engine ever ran services.
 *
 * The handover and the redeploy are also run the way the process worked before the lease (each
 * engine starts its services at once): the same service log then shows two engines working.
 * What that control shows is the overlap of two engines' services, nothing more: it does not
 * spawn the pre-lease `index.ts`, and it does not show a duplicated effect. An experiment with
 * two engines started this way and three purchases (three runs) found none either: the jobs, the
 * outbox and the hedge allocation are guarded by the database (README, "A frozen process"), and
 * on these hand-fed books no hedge order filled, so a doubled hedge order could not show as held
 * beyond the exposure.
 */
import { performance } from "node:perf_hooks";

import pino, { type Logger } from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { JOB_KINDS, jobIdempotencyKey } from "@winz/shared";

import { capturingLogger, type LogEntry } from "../chain/ingest-test-support";
import { createDb, type Db } from "../db";
import { startHealthServer, type HealthServer } from "../health/server";
import { defaultCursorName } from "../chain";
import { hedgeTables } from "../hedging/runtime/test-support";
import { enqueueJob } from "../jobs/enqueue";
import { SELLING_ASKS, SELLING_BIDS } from "../jobs/handlers/campaign-actions.test-support";
import {
  createJobsHarness,
  createLiveCampaign,
  onchainTickets,
  seedPayment,
  txRows,
  type JobsHarness,
  type LiveCampaign,
} from "../jobs/handlers/test-support";
import {
  EngineLeader,
  fenceOverrunSlackMs,
  type FenceOverrun,
  type LeaderServices,
} from "./leader";
import { PgEngineLease, type LeaseRow } from "./lease";
import { fenceAfterMs, type LeaseSettings } from "./settings";
import {
  FaultyLease,
  LEADER_E2E_TUNING,
  ServiceLog,
  TcpProxy,
  engineComposition,
} from "./test-support";

/** A short lease, so a scenario lasts seconds: fence after 2.5 s without a renewal. */
const SETTINGS: LeaseSettings = {
  ttlMs: 4_500,
  renewMs: 400,
  standbyPollMs: 100,
  fenceMarginMs: 2_000,
};

let harness: JobsHarness;
let campaign: LiveCampaign;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  harness = await createJobsHarness();
  campaign = await createLiveCampaign(harness, "leader");
  harness.books.set(campaign.symbol, { asks: SELLING_ASKS, bids: SELLING_BIDS });
  // The harness's own sender created the campaign; from here on only the engines send.
  await harness.sender.stop();
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await harness.anvil.rpc("evm_setAutomine", [true]);
  await harness.db`delete from engine_lease`;
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(
  what: string,
  condition: () => boolean | Promise<boolean>,
  ms = 20_000,
): Promise<void> {
  const deadline = performance.now() + ms;
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await delay(20);
  }
}

async function dbNow(): Promise<number> {
  const [row] = await harness.db<{ t: Date }[]>`select clock_timestamp() as t`;
  if (row === undefined) throw new Error("no time");
  return row.t.getTime();
}

async function leaseRow(): Promise<LeaseRow | null> {
  return new PgEngineLease({ db: harness.db, holder: "eng-reader000000", ttlMs: 1_000 }).read();
}

/** Optional measures for the README, written only when asked (LEADER_REPORT=1). */
function report(line: string): void {
  if (process.env.LEADER_REPORT === "1") process.stderr.write(`[leader-e2e] ${line}\n`);
}

interface TestEngine {
  name: string;
  leader: EngineLeader;
  lease: FaultyLease;
  db: Db;
  logs: LogEntry[];
  logger: Logger;
  /** Database time just after each stop of its services completed, and how long it took. */
  stops: { atDb: number; ms: number }[];
}

function newEngine(
  name: string,
  log: ServiceLog,
  options: { url?: string; onFenceOverrun?: (overrun: FenceOverrun) => void } = {},
): TestEngine {
  const db = createDb(options.url ?? harness.database.url, { max: 12 });
  const { logger, entries } = capturingLogger();
  const holder = `eng-${name.padEnd(12, "0")}`;
  const lease = new FaultyLease(new PgEngineLease({ db, holder, ttlMs: SETTINGS.ttlMs }));
  const compose = engineComposition({
    name,
    harness,
    db,
    logger,
    log,
    symbols: () => [campaign.symbol],
  });
  const stops: TestEngine["stops"] = [];
  const startServices = async (signal: AbortSignal): Promise<LeaderServices> => {
    const services = await compose(signal);
    let abortedAt = 0;
    signal.addEventListener("abort", () => (abortedAt = performance.now()), { once: true });
    return {
      stopped: services.stopped.then(async () => {
        const ms = performance.now() - abortedAt;
        stops.push({ atDb: await dbNow(), ms });
      }),
    };
  };
  const leader = new EngineLeader({
    lease,
    settings: SETTINGS,
    logger: logger.child({ module: "leader" }),
    startServices,
    ...(options.onFenceOverrun === undefined ? {} : { onFenceOverrun: options.onFenceOverrun }),
  });
  const engine: TestEngine = { name, leader, lease, db, logs: entries, logger, stops };
  cleanups.push(async () => {
    lease.dead = false;
    lease.unfreeze();
    await leader.stop();
    await db.end({ timeout: 5 });
  });
  return engine;
}

/** A standby that has seen the lease at least once. */
function standingBy(engine: TestEngine): boolean {
  return engine.leader.phase === "standby" && engine.leader.view().holder !== null;
}

function errorsOf(engine: TestEngine): LogEntry[] {
  return engine.logs.filter((entry) => Number(entry.level) >= 50);
}

/** A purchase as the web app enqueues it, after the checkout. */
async function enqueuePurchase(label: string): Promise<{ pi: string; jobId: string }> {
  const pi = await seedPayment(harness, {
    campaignId: campaign.campaignId,
    qty: 1,
    unitPrice: campaign.terms.unitPrice,
    email: `${label}-${Date.now().toString(36)}@example.com`,
  });
  await harness.clock.sync(harness.escrow);
  const { id } = await enqueueJob(harness.db, {
    kind: JOB_KINDS.purchase,
    payload: { paymentIntentId: pi },
    idempotencyKey: jobIdempotencyKey.purchase(pi),
  });
  return { pi, jobId: id };
}

async function paymentStatus(pi: string): Promise<string | undefined> {
  const [row] = await harness.db<{ status: string }[]>`
    select status from payments where stripe_pi = ${pi}
  `;
  return row?.status;
}

/** What must hold after every handover: each purchase done exactly once, the hedge not doubled. */
async function expectNothingDoneTwice(pis: readonly string[]): Promise<void> {
  // Each payment: ticketed, one capture, one buyFor row mined (its key is unique in the outbox).
  for (const pi of pis) {
    expect(await paymentStatus(pi), pi).toBe("ticketed");
    expect(harness.gateway.effectsOf(pi).captures, `captures of ${pi}`).toBe(1);
    const rows = await txRows(harness, `buyFor:${pi}:`);
    expect(
      rows.filter((row) => row.status === "mined"),
      `buyFor of ${pi}`,
    ).toHaveLength(1);
  }
  // The outbox: no idempotency key twice, no nonce twice for a key on the chain.
  const [dupKeys] = await harness.db<{ n: bigint }[]>`
    select count(*)::bigint as n from (
      select idempotency_key from chain_txs group by idempotency_key having count(*) > 1
    ) d
  `;
  expect(dupKeys?.n).toBe(0n);
  const [dupNonces] = await harness.db<{ n: bigint }[]>`
    select count(*)::bigint as n from (
      select signer_address, chain_id, nonce from chain_txs where nonce is not null
      group by signer_address, chain_id, nonce having count(*) > 1
    ) d
  `;
  expect(dupNonces?.n).toBe(0n);
  // On-chain: one ticket per payment's buyer for this campaign's sales.
  const tickets = (await onchainTickets(harness)).filter(
    (ticket) => ticket.campaignId === campaign.onchainId,
  );
  const [ticketed] = await harness.db<{ n: bigint }[]>`
    select count(*)::bigint as n from payments
    where campaign_id = ${campaign.campaignId} and status = 'ticketed'
  `;
  expect(BigInt(tickets.length)).toBe(ticketed?.n);
  // The hedge: every order id once, and never more held or working than the exposure.
  const tables = await hedgeTables(harness.db, campaign.symbol);
  expect(new Set(tables.orders.map((order) => order.venue_order_id)).size).toBe(
    tables.orders.length,
  );
  const exposure = tables.position?.exposure ?? 0n;
  const held = tables.position?.held ?? 0n;
  const filled = tables.fills.reduce((sum, fill) => sum + fill.qty, 0n);
  const working = tables.orders
    .filter((order) => order.status === "working")
    .reduce((sum, order) => sum + order.qty - order.filled_qty, 0n);
  expect(filled).toBe(held);
  expect(held + working).toBeLessThanOrEqual(exposure + 10_000n);
}

describe("two real engines on one database", () => {
  it("hands over on a clean stop with a purchase in flight: nothing done twice", async () => {
    const log = new ServiceLog();
    const a = newEngine("a", log);
    const b = newEngine("b", log);
    void a.leader.run();
    await until("A leading", () => a.leader.servicesRunning());
    void b.leader.run();
    await until("B standing by", () => standingBy(b));
    expect(b.leader.view()).toMatchObject({ role: "standby", holder: a.leader.holder });

    // A first sale, done under A: its lot is hedged by A.
    const first = await enqueuePurchase("first");
    await until(
      "the first sale ticketed",
      async () => (await paymentStatus(first.pi)) === "ticketed",
    );
    await until("A hedging the first lot", async () => {
      const tables = await hedgeTables(harness.db, campaign.symbol);
      return tables.orders.length > 0;
    });

    // A second sale in flight at the handover: its buyFor is broadcast and not mined.
    await harness.anvil.rpc("evm_setAutomine", [false]);
    const second = await enqueuePurchase("second");
    await until("the second buyFor broadcast", async () =>
      (await txRows(harness, `buyFor:${second.pi}:`)).some((row) => row.status === "sent"),
    );

    const stopAt = performance.now();
    await a.leader.stop();
    const stopMs = a.stops[0]?.ms ?? NaN;
    report(`clean stop of A with a purchase in flight: ${stopMs.toFixed(0)} ms`);
    expect(stopMs).toBeLessThan(SETTINGS.fenceMarginMs);
    await until("B leading", () => b.leader.servicesRunning(), 2_000);
    const handoverMs = performance.now() - stopAt;
    report(`handover (A's stop called -> B's services running): ${handoverMs.toFixed(0)} ms`);
    expect(handoverMs).toBeLessThan(2_000 + stopMs);

    const released = await leaseRow();
    expect(released?.holder).toBe(b.leader.holder);
    // B mines what A broadcast.
    await harness.anvil.rpc("evm_setAutomine", [true]);
    await harness.anvil.rpc("evm_mine", []);
    await until(
      "the second sale ticketed",
      async () => (await paymentStatus(second.pi)) === "ticketed",
      30_000,
    );
    // Let B's hedging and charging run on the new exposure.
    await delay(1_500);

    log.assertAtMostOne();
    expect(log.starts("a")).toBe(1);
    expect(log.starts("b")).toBe(1);
    await expectNothingDoneTwice([first.pi, second.pi]);
    expect(errorsOf(a).map((entry) => entry.msg)).toEqual([]);
  }, 90_000);

  it("after a crash, the standby works after the ttl and not before", async () => {
    const log = new ServiceLog();
    const a = newEngine("a", log);
    const b = newEngine("b", log);
    void a.leader.run();
    await until("A leading", () => a.leader.servicesRunning());
    void b.leader.run();
    await until("B standing by", () => standingBy(b));
    await delay(SETTINGS.renewMs * 2);

    // A's lease calls all fail from now on: no renewal, no release (a dead connection).
    a.lease.dead = true;
    const lastGrant = await leaseRow();
    const expiresAt = lastGrant?.expiresAt.getTime() ?? 0;
    await until("B leading", () => b.leader.servicesRunning(), SETTINGS.ttlMs * 3);
    const tookOver = await dbNow();

    const row = await leaseRow();
    expect(row?.holder).toBe(b.leader.holder);
    expect(row?.acquiredAt.getTime()).toBeGreaterThanOrEqual(expiresAt);
    expect(tookOver).toBeGreaterThanOrEqual(expiresAt);
    // A fenced itself before its lease expired, so B never ran beside it.
    expect(a.stops[0]?.atDb).toBeLessThan(expiresAt);
    report(`fenced stop of A (renewals failing): ${(a.stops[0]?.ms ?? NaN).toFixed(0)} ms`);
    log.assertAtMostOne();
  }, 60_000);

  it("fences itself when its database refuses connections: stopped before the lease expires, then leads again", async () => {
    const proxy = await TcpProxy.start(Number(new URL(harness.database.url).port));
    cleanups.push(() => proxy.close());
    const log = new ServiceLog();
    const overruns: FenceOverrun[] = [];
    const a = newEngine("a", log, {
      url: proxy.rewrite(harness.database.url),
      onFenceOverrun: (overrun) => overruns.push(overrun),
    });
    const b = newEngine("b", log);
    void a.leader.run();
    await until("A leading", () => a.leader.servicesRunning());
    void b.leader.run();
    await until("B standing by", () => standingBy(b));
    await delay(SETTINGS.renewMs * 2);

    await proxy.cut("refuse");
    const cutAt = performance.now();
    const lastGrant = await leaseRow();
    const expiresAt = lastGrant?.expiresAt.getTime() ?? 0;
    await until("A's services stopped", () => a.stops.length === 1, SETTINGS.ttlMs * 2);
    // Stopped after the fence deadline (counted from its last renewal), before the expiry.
    expect(performance.now() - cutAt).toBeGreaterThanOrEqual(
      fenceAfterMs(SETTINGS) - SETTINGS.renewMs - 100,
    );
    expect(a.stops[0]?.atDb).toBeLessThan(expiresAt);
    expect(overruns).toEqual([]);
    report(`fenced stop of A (database refusing): ${(a.stops[0]?.ms ?? NaN).toFixed(0)} ms`);
    expect(
      a.logs.some(
        (entry) =>
          entry.level === 50 &&
          entry.msg ===
            "the engine lease could not be renewed in time: stopping the engine's services before it expires",
      ),
    ).toBe(true);
    await until("A back to standby", () => a.leader.phase === "standby", 1_000);

    // B takes over once the lease has expired, not before.
    await until("B leading", () => b.leader.servicesRunning(), SETTINGS.ttlMs * 2);
    expect((await leaseRow())?.acquiredAt.getTime()).toBeGreaterThanOrEqual(expiresAt);

    // The database answers A again: A is a standby, and leads once B stops.
    await proxy.restore();
    await delay(SETTINGS.standbyPollMs * 5);
    expect(a.leader.servicesRunning()).toBe(false);
    await b.leader.stop();
    // postgres.js reconnects after a backoff that grows with each refused connection (up to
    // 20 s): A leads again once its pool has a connection.
    await until("A leading again", () => a.leader.servicesRunning(), 30_000);
    log.assertAtMostOne();
    expect(log.starts("a")).toBe(2);
  }, 60_000);

  it("a fenced stop stuck on a database that stops answering is declared before the lease expires", async () => {
    const proxy = await TcpProxy.start(Number(new URL(harness.database.url).port));
    cleanups.push(() => proxy.close());
    const log = new ServiceLog();
    const overruns: { overrun: FenceOverrun; atDb: number }[] = [];
    const a = newEngine("a", log, {
      url: proxy.rewrite(harness.database.url),
      onFenceOverrun: (overrun) => {
        // In production the process exits here (src/index.ts): its services end with it.
        log.record("a", "stopped");
        void dbNow().then((atDb) => overruns.push({ overrun, atDb }));
      },
    });
    const b = newEngine("b", log);
    void a.leader.run();
    await until("A leading", () => a.leader.servicesRunning());
    void b.leader.run();
    await until("B standing by", () => standingBy(b));
    // Whatever the test's outcome, A's database answers again before A is stopped: a stalled
    // query never ends, and the stop of A in the cleanup would wait for it.
    cleanups.push(() => proxy.restore());
    await delay(SETTINGS.renewMs * 2);
    // The cut falls just after a renewal was answered, the next one `renewMs` away: none is in
    // flight, so the row read after the cut is the grant A counts from.
    const renewedBefore = (await leaseRow())?.renewedAt.getTime() ?? 0;
    await until(
      "a renewal of A",
      async () => ((await leaseRow())?.renewedAt.getTime() ?? 0) > renewedBefore,
      SETTINGS.ttlMs,
    );
    await delay(SETTINGS.renewMs / 8);

    // A's database goes silent: every query of A waits for an answer that never comes, and its
    // services cannot stop.
    await proxy.cut("stall");
    const lastGrant = await leaseRow();
    const expiresAt = lastGrant?.expiresAt.getTime() ?? 0;
    await until("the overrun declared", () => overruns.length === 1, SETTINGS.ttlMs * 2);
    expect(a.stops).toEqual([]);
    expect(overruns[0]?.overrun).toMatchObject({ holder: a.leader.holder, reason: "expired" });
    expect(overruns[0]?.atDb).toBeLessThan(expiresAt);
    expect(expiresAt - (overruns[0]?.atDb ?? 0)).toBeLessThanOrEqual(
      fenceOverrunSlackMs(SETTINGS) + 200,
    );
    expect(
      a.logs.find(
        (entry) =>
          entry.msg ===
          "the engine's services did not stop before the lease can expire: a service is stuck",
      ),
    ).toMatchObject({ level: 60, reason: "expired" });

    await until("B leading", () => b.leader.servicesRunning(), SETTINGS.ttlMs * 2);
    expect((await leaseRow())?.acquiredAt.getTime()).toBeGreaterThanOrEqual(expiresAt);
    log.assertAtMostOne();
    // Let A's stuck stop finish before the cleanup.
    await proxy.restore();
    await until("A's services stopped", () => a.stops.length === 1, 30_000);
  }, 90_000);

  it("stops at once when the lease is rewritten to another holder", async () => {
    const log = new ServiceLog();
    const a = newEngine("a", log);
    void a.leader.run();
    await until("A leading", () => a.leader.servicesRunning());
    const stolenAt = performance.now();
    await harness.db`
      update engine_lease set holder = 'eng-thief0000000', acquired_at = now(), renewed_at = now(),
        expires_at = now() + interval '1 hour'
    `;
    await until("A's services stopped", () => a.stops.length === 1, SETTINGS.ttlMs);
    const stoppedAfter = performance.now() - stolenAt;
    expect(stoppedAfter).toBeLessThan(fenceAfterMs(SETTINGS));
    const error = a.logs.find(
      (entry) =>
        entry.msg ===
        "the engine lease is held by another engine: this engine stops its services at once",
    );
    expect(error).toMatchObject({
      level: 50,
      holder: a.leader.holder,
      otherHolder: "eng-thief0000000",
    });
    await delay(SETTINGS.standbyPollMs * 3);
    expect(a.leader.phase).toBe("standby");
    expect(log.starts("a")).toBe(1);
  }, 60_000);

  it("a redeploy as the platform runs it: B healthy as standby, A stopped, B leads within 2 s", async () => {
    const log = new ServiceLog();
    const a = newEngine("a", log);
    void a.leader.run();
    await until("A leading", () => a.leader.servicesRunning());
    const healthA = await probe(a);

    // The new container starts while the old one leads.
    const b = newEngine("b", log);
    void b.leader.run();
    const healthB = await probe(b);
    await until("B standing by", () => standingBy(b));
    const fromB = await getHealth(healthB);
    expect(fromB.status).toBe(200);
    expect(fromB.body).toMatchObject({
      status: "ok",
      role: "standby",
      sender: "stopped",
      jobs: "stopped",
      lease: { holder: a.leader.holder },
    });
    const fromA = await getHealth(healthA);
    expect(fromA.status).toBe(200);
    expect(fromA.body).toMatchObject({ role: "leader", sender: "running", jobs: "running" });

    // The platform stops the old container once the new one is healthy.
    const sigtermAt = performance.now();
    await a.leader.stop();
    await healthA.close();
    await until("B leading", () => b.leader.servicesRunning(), 2_000);
    report(
      `redeploy: A's stop called -> B's services running: ${(performance.now() - sigtermAt).toFixed(0)} ms`,
    );
    expect(performance.now() - sigtermAt).toBeLessThan(2_000 + (a.stops[0]?.ms ?? 0));
    await delay(2_100); // past the health cache
    const leading = await getHealth(healthB);
    expect(leading.body).toMatchObject({ role: "leader", lease: { holder: b.leader.holder } });
    expect(leading.status).toBe(200);
    log.assertAtMostOne();
  }, 60_000);
});

describe("positive control: the same scenarios without the lease (the process before)", () => {
  /** Starts an engine's services at once, as `index.ts` did: no lease, no standby. */
  async function startDirectly(name: string, log: ServiceLog): Promise<() => Promise<void>> {
    const db = createDb(harness.database.url, { max: 12 });
    const compose = engineComposition({
      name,
      harness,
      db,
      logger: pino({ level: "silent" }),
      log,
      symbols: () => [campaign.symbol],
      tuning: LEADER_E2E_TUNING,
    });
    const controller = new AbortController();
    const services = await compose(controller.signal);
    const stop = async (): Promise<void> => {
      controller.abort();
      await services.stopped;
      await db.end({ timeout: 5 });
    };
    cleanups.push(stop);
    return stop;
  }

  it("a handover without the lease: the second engine works beside the first", async () => {
    const log = new ServiceLog();
    const stopA = await startDirectly("a", log);
    await startDirectly("b", log);
    await stopA();
    expect(() => log.assertAtMostOne()).toThrow(/two engines worked at once/);
  }, 60_000);

  it("a redeploy without the lease: both containers run their services until the old one stops", async () => {
    const log = new ServiceLog();
    const stopA = await startDirectly("a", log);
    await startDirectly("b", log);
    expect(log.running().sort()).toEqual(["a", "b"]);
    await stopA();
    expect(log.overlaps()).toHaveLength(1);
  }, 60_000);
});

/** A health listener for one test engine, as `index.ts` wires it. */
async function probe(engine: TestEngine): Promise<HealthServer> {
  const server = await startHealthServer({
    port: 0,
    host: "127.0.0.1",
    logger: pino({ level: "silent" }),
    db: engine.db,
    chain: harness.escrow.publicClient,
    chainId: harness.escrow.chainId,
    cursorName: defaultCursorName(harness.escrow.escrow),
    startedAt: new Date(),
    services: () => {
      const state = engine.leader.servicesRunning() ? "running" : "stopped";
      return { sender: state, jobs: state };
    },
    lease: () => engine.leader.view(),
  });
  cleanups.push(() => server.close());
  return server;
}

async function getHealth(server: HealthServer): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${server.port.toString()}/healthz`);
  return { status: response.status, body: await response.json() };
}
