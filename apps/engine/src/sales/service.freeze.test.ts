/**
 * The incident of 19-20 November: the sale states stopped moving for about 98 minutes while the
 * rest of the engine worked, so promos 15 to 19 stayed `live` past their sales close until a
 * redeploy. A pass awaits nothing but the database, so a pass that never ends is a database call
 * that never settles, and passes never overlap: one such call froze every sale state, the
 * automatic pauses included. Each test below freezes a pass in one of the ways that can happen and
 * checks that the campaign still reaches `sales_closed`; on the code of the incident each of them
 * waits forever.
 */
import pino, { type Logger } from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../db";
import { TcpProxy } from "../leader/test-support";
import type { BookFeedListener } from "../market-data";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { SaleStateRunner, startSaleStates, type SaleBookSource } from "./service";
import { JOE_TERMS } from "./test-support";

const T0 = Date.parse("2026-11-19T23:00:00.000Z");
const SALES_CLOSE = T0 + 55 * 60_000;
const STARTS_AT = SALES_CLOSE + 5 * 60_000;
const SYMBOL = "KXFREEZE-YES";

/** No book ever: a campaign pauses for the missing book (grace off), which is all these need. */
class NoBooks implements SaleBookSource {
  getBook(): null {
    return null;
  }
  isStale(): boolean {
    return false;
  }
  subscribe(listener: BookFeedListener): () => void {
    void listener;
    return () => undefined;
  }
}

/** A logger whose lines the test reads. */
function capture(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const raw: string[] = [];
  const logger = pino({ level: "debug" }, { write: (line: string) => raw.push(line) });
  return {
    logger,
    lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

let database: TestDatabase;
let db: Db;
let merchantId: string;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await db`
    insert into events (ticker, title, sport, league, home_name, home_abbreviation,
                        away_name, away_abbreviation, starts_at, sales_close_at)
    values ('KXFREEZE', 'Texas at Arkansas', 'football', 'NCAAF', 'Arkansas', 'ARK', 'Texas', 'TEX',
            ${new Date(STARTS_AT)}, ${new Date(SALES_CLOSE)})
  `;
  await db`
    insert into instruments (symbol, event_ticker, label, type, onchain_id)
    values (${SYMBOL}, 'KXFREEZE', ${SYMBOL}, 'moneyline', ${`0x${"ab".repeat(32)}`})
  `;
  const [user] = await db<{ id: string }[]>`
    insert into users (email) values ('joe@example.com') returning id::text as id
  `;
  const [merchant] = await db<{ id: string }[]>`
    insert into merchants (user_id, name, category) values (${user?.id ?? ""}, 'Joe''s Pizza', 'pizza')
    returning id::text as id
  `;
  merchantId = merchant?.id ?? "";
});

afterAll(async () => {
  await database.drop();
});

beforeEach(async () => {
  await db`delete from live_campaigns`;
  await db`delete from campaigns`;
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

let onchainCounter = 0;

/** A live, open campaign whose sales close at `SALES_CLOSE`, as promos 15 to 19 were. */
async function seedLiveCampaign(): Promise<string> {
  onchainCounter += 1;
  const slug = `freeze-${onchainCounter.toString()}`;
  const [row] = await db<{ id: string }[]>`
    insert into campaigns (merchant_id, instrument, event_ticker, product, condition_label, promise,
                           unit_price, refund_bps, usual_margin_bps, min_margin_bps,
                           pause_threshold_bps, budget, sales_close, status, sale_state, slug,
                           onchain_id)
    values (${merchantId}, ${SYMBOL}, 'KXFREEZE', 'Pizza', 'Texas wins', 'Pizza refunded',
            ${JOE_TERMS.unitPrice.toString()}::bigint, ${Number(JOE_TERMS.refundBps)},
            ${Number(JOE_TERMS.usualMarginBps)}, ${Number(JOE_TERMS.minMarginBps)},
            ${Number(JOE_TERMS.pauseThresholdBps)}, 1000000000, ${new Date(SALES_CLOSE)},
            'live', 'open', ${slug}, ${onchainCounter})
    returning id::text as id
  `;
  await db`insert into live_campaigns (slug, sale_state) values (${slug}, 'open')`;
  if (row === undefined) throw new Error("campaign not inserted");
  return row.id;
}

async function stateOf(id: string): Promise<{ sale: string; status: string }> {
  const [row] = await db<{ sale_state: string; status: string }[]>`
    select sale_state, status from campaigns where id = ${id}
  `;
  if (row === undefined) throw new Error(`campaign ${id} not found`);
  return { sale: row.sale_state, status: row.status };
}

describe("sale states: a pass that never ends", () => {
  it("a connection that goes silent mid-pass: the campaign still closes at its sales close", async () => {
    const proxy = await TcpProxy.start(Number(new URL(database.url).port));
    // The sale states' pool goes through the proxy; the test reads the database directly. Short
    // client bounds so the dead connections are dropped within the test (production: 30 s).
    const pool = createDb(proxy.rewrite(database.url), {
      max: 2,
      queryTimeoutS: 1,
      queueTimeoutS: 1,
      cancelTimeoutS: 1,
    });
    cleanups.push(() => proxy.close());
    cleanups.push(() => pool.end({ timeout: 1 }));
    cleanups.push(() => proxy.restore());

    const campaign = await seedLiveCampaign();
    const log = capture();
    let nowMs = T0;
    const stop = new AbortController();
    const service = startSaleStates({
      db: pool,
      bookFeed: new NoBooks(),
      logger: log.logger,
      signal: stop.signal,
      intervalMs: 20,
      startupGraceMs: 0,
      clock: () => nowMs,
      passTimeoutMs: 500,
      slowPassMs: 200,
    });
    cleanups.push(async () => {
      stop.abort();
      await proxy.restore();
      await service.stopped;
    });

    // A first pass works through the pool: no book, the campaign pauses.
    expect(
      await waitFor(async () => (await stateOf(campaign)).sale === "paused_depth", 5_000),
    ).toBe(true);

    // Every connection the pool holds goes silent, as one through a pooler that stopped
    // answering; the database itself is fine and a new connection would be answered. Then the
    // sales close passes.
    proxy.silenceOpen();
    nowMs = SALES_CLOSE + 1_000;

    const closed = await waitFor(
      async () => (await stateOf(campaign)).status === "sales_closed",
      12_000,
    );
    expect(closed, "the campaign must reach sales_closed although a pass hung").toBe(true);
    expect(await stateOf(campaign)).toEqual({ sale: "closed", status: "sales_closed" });

    const timedOut = log.lines().filter((line) => line.msg === "sale state pass timed out");
    expect(timedOut.length).toBeGreaterThan(0);
    expect(timedOut[0]?.level).toBe(50);
    expect(timedOut[0]?.waitingOn).toMatch(/^(reading the campaigns|writing the sale state)/);
  }, 20_000);

  it("a database call whose promise never settles: the pass is ended and the next one closes the campaign", async () => {
    const campaign = await seedLiveCampaign();
    const log = capture();
    let nowMs = T0;
    let hangNext = false;
    // `begin` answers a promise that never settles, once, when asked to: nothing (no timeout of
    // the client, no statement timeout of the server) can end that call.
    const flaky = new Proxy(db, {
      get: (target, property, receiver): unknown => {
        if (property === "begin" && hangNext) {
          hangNext = false;
          return (): Promise<never> => new Promise<never>(() => undefined);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const stop = new AbortController();
    const service = startSaleStates({
      db: flaky,
      bookFeed: new NoBooks(),
      logger: log.logger,
      signal: stop.signal,
      intervalMs: 20,
      startupGraceMs: 0,
      clock: () => nowMs,
      passTimeoutMs: 300,
      slowPassMs: 100,
    });
    cleanups.push(async () => {
      stop.abort();
      await service.stopped;
    });

    expect(
      await waitFor(async () => (await stateOf(campaign)).sale === "paused_depth", 5_000),
    ).toBe(true);
    hangNext = true;
    nowMs = SALES_CLOSE + 1_000;

    const closed = await waitFor(
      async () => (await stateOf(campaign)).status === "sales_closed",
      5_000,
    );
    expect(closed, "the campaign must reach sales_closed although a pass hung").toBe(true);

    // The hung call is the next transaction, the read of a pass or a write of the pass in flight,
    // whichever the scheduler makes first: the log names it either way.
    const timedOut = log.lines().find((line) => line.msg === "sale state pass timed out");
    expect(timedOut).toMatchObject({ level: 50, timeoutMs: 300 });
    expect(timedOut?.waitingOn).toMatch(
      /^(reading the campaigns|writing the sale state of campaign [0-9a-f-]{36})$/,
    );
    expect(timedOut?.elapsedMs).toBeGreaterThanOrEqual(295);
    expect(timedOut?.elapsedMs).toBeLessThan(2_000);
    // Logged at error level before, by the watchdog, while the pass was still running.
    expect(
      log
        .lines()
        .some(
          (line) =>
            line.msg === "sale state pass is overrunning: every sale state is frozen until it ends",
        ),
    ).toBe(true);
  }, 15_000);
});

describe("sale states: what the loop does around a pass that fails or is ended", () => {
  /** A heartbeat that counts its beats. */
  function counter(): { beat: () => void; count: () => number } {
    let beats = 0;
    return {
      beat: () => {
        beats += 1;
      },
      count: () => beats,
    };
  }

  it("beats after each completed full pass, never for a pass that failed or timed out, and goes on", async () => {
    await seedLiveCampaign();
    const heartbeat = counter();
    let mode: "work" | "fail" | "hang" = "work";
    const db2 = new Proxy(db, {
      get: (target, property, receiver): unknown => {
        if (property === "begin" && mode === "fail") {
          return (): Promise<never> => Promise.reject(new Error("connection reset"));
        }
        if (property === "begin" && mode === "hang") {
          return (): Promise<never> => new Promise<never>(() => undefined);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const log = capture();
    const stop = new AbortController();
    const service = startSaleStates({
      db: db2,
      bookFeed: new NoBooks(),
      logger: log.logger,
      signal: stop.signal,
      intervalMs: 10,
      retryMaxMs: 20,
      startupGraceMs: 0,
      clock: () => T0,
      passTimeoutMs: 100,
      slowPassMs: 50,
      heartbeat,
    });
    cleanups.push(async () => {
      stop.abort();
      await service.stopped;
    });

    expect(await waitFor(() => Promise.resolve(heartbeat.count() >= 3), 3_000)).toBe(true);

    mode = "fail";
    await waitFor(
      () => Promise.resolve(log.lines().some((line) => line.msg === "sale state pass failed")),
      3_000,
    );
    // A pass in flight when the mode changed may still complete: let it, then count.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const beforeFailures = heartbeat.count();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(heartbeat.count()).toBe(beforeFailures);

    mode = "hang";
    expect(
      await waitFor(
        () => Promise.resolve(log.lines().some((line) => line.msg === "sale state pass timed out")),
        3_000,
      ),
    ).toBe(true);
    expect(heartbeat.count()).toBe(beforeFailures);

    // Positive control: the database answers again, the loop is still there and beats again.
    mode = "work";
    expect(await waitFor(() => Promise.resolve(heartbeat.count() > beforeFailures), 3_000)).toBe(
      true,
    );
    expect(log.lines().some((line) => line.msg === "sale states recovered")).toBe(true);
  });

  it("stops at once while a pass hangs, instead of waiting on it for good", async () => {
    await seedLiveCampaign();
    let hang = false;
    const db2 = new Proxy(db, {
      get: (target, property, receiver): unknown =>
        property === "begin" && hang
          ? (): Promise<never> => new Promise<never>(() => undefined)
          : Reflect.get(target, property, receiver),
    });
    const heartbeat = counter();
    const stop = new AbortController();
    const log = capture();
    const service = startSaleStates({
      db: db2,
      bookFeed: new NoBooks(),
      logger: log.logger,
      signal: stop.signal,
      intervalMs: 10,
      startupGraceMs: 0,
      clock: () => T0,
      // Long: only the stop can end the pass here.
      passTimeoutMs: 60_000,
      slowPassMs: 30_000,
      heartbeat,
    });
    expect(await waitFor(() => Promise.resolve(heartbeat.count() >= 1), 3_000)).toBe(true);
    hang = true;
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stoppingAt = Date.now();
    stop.abort();
    await service.stopped;
    expect(Date.now() - stoppingAt).toBeLessThan(1_000);
    expect(
      log.lines().some((line) => line.msg === "sale state pass ended: the service is stopping"),
    ).toBe(true);
  });

  it("a pass ended while its write waits writes nothing, and forgets the campaign's timings instead of recording its decision", async () => {
    const campaign = await seedLiveCampaign();
    let gate: Promise<void> | null = null;
    // Set once the runner exists; the gate holds only the runner's writes.
    let writing: () => boolean = () => false;
    const gated = new Proxy(db, {
      get: (target, property, receiver): unknown => {
        if (property !== "begin") return Reflect.get(target, property, receiver);
        const begin = Reflect.get(target, property, receiver) as (
          ...args: unknown[]
        ) => Promise<unknown>;
        return (...args: unknown[]): Promise<unknown> => {
          const held = gate;
          if (held !== null && writing()) return held.then(() => begin.apply(target, args));
          return begin.apply(target, args);
        };
      },
    });
    const runner = new SaleStateRunner({
      db: gated,
      bookFeed: new NoBooks(),
      logger: pino({ level: "silent" }),
      clock: () => T0,
      startupGraceMs: 0,
    });
    writing = () => runner.waitingOn()?.startsWith("writing") === true;

    // A first pass, not held: the campaign pauses for the missing book, its timings recorded.
    await expect(runner.runPass()).resolves.toMatchObject({ transitions: 1 });
    expect(runner.memoryOf(campaign)).not.toBeNull();

    // Someone sets it open again, so the next pass writes again; its write is held.
    await db`update campaigns set sale_state = 'open' where id = ${campaign}`;
    let open: () => void = () => undefined;
    gate = new Promise<void>((resolve) => (open = resolve));
    const pass = new AbortController();
    const running = runner.runPass(undefined, pass.signal);
    running.catch(() => undefined);
    expect(await waitFor(() => Promise.resolve(writing()), 2_000)).toBe(true);
    expect(runner.waitingOn()).toBe(`writing the sale state of campaign ${campaign}`);
    pass.abort(new Error("ended by the test"));
    open();
    await expect(running).rejects.toThrow("ended by the test");
    // The transaction was granted after the end: it sent nothing, and the timings are forgotten.
    expect(await stateOf(campaign)).toEqual({ sale: "open", status: "live" });
    expect(runner.memoryOf(campaign)).toBeNull();
    expect(runner.waitingOn()).toBeNull();

    // Positive control: the same held write, not ended, is written and its decision recorded.
    gate = new Promise<void>((resolve) => (open = resolve));
    const kept = runner.runPass(undefined, new AbortController().signal);
    expect(await waitFor(() => Promise.resolve(writing()), 2_000)).toBe(true);
    open();
    await expect(kept).resolves.toMatchObject({ transitions: 1 });
    expect((await stateOf(campaign)).sale).toBe("paused_depth");
    expect(runner.memoryOf(campaign)).not.toBeNull();
  });
});
