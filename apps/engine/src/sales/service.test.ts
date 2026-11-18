import { createHook } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";

import pino from "pino";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { JOB_KINDS } from "@winz/shared";
import type { Book, SaleState } from "@winz/shared";

import type { Db } from "../db";
import type { BookFeedEvent, BookFeedListener } from "../market-data";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { RESUME_DELAY_MS } from "./evaluate";
import {
  SaleStateRunner,
  startSaleStates,
  type BreakerStatus,
  type SaleBookSource,
} from "./service";
import { loadCampaignSaleRows, writeSaleState } from "./store";
import { JOE_TERMS, bookAt, emptyBook } from "./test-support";

const T0 = Date.parse("2026-11-17T20:00:00.000Z");
const STARTS_AT = T0 + 2 * 3_600_000;
const SYMBOL = "KXTEST-YES";
const OTHER_SYMBOL = "KXOTHER-YES";
const silent = pino({ level: "silent" });

/** A book source driven by hand, with the shape of the book feed. */
class HandBookSource implements SaleBookSource {
  private readonly books = new Map<string, Book>();
  private readonly stale = new Set<string>();
  readonly listeners = new Set<BookFeedListener>();

  getBook(symbol: string): Book | null {
    return this.books.get(symbol) ?? null;
  }

  isStale(symbol: string): boolean {
    return this.stale.has(symbol);
  }

  subscribe(listener: BookFeedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setBook(book: Book): void {
    this.books.set(book.instrumentSymbol, book);
    const event: BookFeedEvent = { kind: "book", book, source: "ws" };
    for (const listener of this.listeners) listener(event);
  }

  flagStale(symbol: string, stale: boolean): void {
    if (stale) this.stale.add(symbol);
    else this.stale.delete(symbol);
  }
}

class ManualClock {
  constructor(public nowMs: number) {}
  readonly now = (): number => this.nowMs;
  advance(ms: number): number {
    this.nowMs += ms;
    return this.nowMs;
  }
}

let database: TestDatabase;
let db: Db;
let merchantId: string;
let slugCounter = 0;

async function installWriteLog(sql: Db): Promise<void> {
  await sql.unsafe(`
    create table test_write_log (id bigserial primary key, tbl text not null, op text not null);
    create function test_log_write() returns trigger language plpgsql as $$
    begin
      insert into test_write_log (tbl, op) values (tg_table_name, tg_op);
      return null;
    end $$;
    create trigger campaigns_test_write_log after update on campaigns
      for each row execute function test_log_write();
    create trigger live_campaigns_test_write_log after insert or update on live_campaigns
      for each row execute function test_log_write();
  `);
}

async function writesSince(mark: bigint): Promise<{ campaigns: number; live: number }> {
  const rows = await db<{ tbl: string; n: bigint }[]>`
    select tbl, count(*) as n from test_write_log where id > ${mark.toString()}::bigint group by tbl
  `;
  const count = (table: string): number => Number(rows.find((r) => r.tbl === table)?.n ?? 0n);
  return { campaigns: count("campaigns"), live: count("live_campaigns") };
}

async function writeMark(): Promise<bigint> {
  const [row] = await db<{ id: bigint | null }[]>`select max(id) as id from test_write_log`;
  return row?.id ?? 0n;
}

interface SeedOptions {
  symbol?: string;
  status?: string;
  saleState?: SaleState;
  slug?: boolean;
  onchain?: boolean;
  budget?: bigint;
  salesCloseMs?: number;
}

let onchainCounter = 0n;

/** A campaign with Joe's terms; with a slug, its live_campaigns row mirrors its sale state. */
async function seedCampaign(
  options: SeedOptions = {},
): Promise<{ id: string; slug: string | null }> {
  const symbol = options.symbol ?? SYMBOL;
  const saleState = options.saleState ?? "open";
  slugCounter += 1;
  const slug = options.slug === false ? null : `promo-${slugCounter.toString()}`;
  onchainCounter += 1n;
  const onchainId = options.onchain === false ? null : onchainCounter.toString();
  const salesClose = new Date(options.salesCloseMs ?? STARTS_AT - 5 * 60_000);
  const [row] = await db<{ id: string }[]>`
    insert into campaigns (merchant_id, instrument, event_ticker, product, condition_label, promise,
                           unit_price, refund_bps, usual_margin_bps, min_margin_bps,
                           pause_threshold_bps, budget, sales_close, status, sale_state, slug,
                           onchain_id)
    values (${merchantId}, ${symbol}, 'KXTEST', 'Pizza', 'Texas wins', 'Pizza refunded',
            ${JOE_TERMS.unitPrice.toString()}::bigint, ${Number(JOE_TERMS.refundBps)},
            ${Number(JOE_TERMS.usualMarginBps)}, ${Number(JOE_TERMS.minMarginBps)},
            ${Number(JOE_TERMS.pauseThresholdBps)}, ${(options.budget ?? 1_000_000_000n).toString()}::bigint,
            ${salesClose}, ${options.status ?? "live"}, ${saleState}, ${slug},
            ${onchainId}::bigint)
    returning id::text as id
  `;
  if (row === undefined) throw new Error("campaign not inserted");
  if (slug !== null) {
    await db`insert into live_campaigns (slug, sale_state) values (${slug}, ${saleState})`;
  }
  return { id: row.id, slug };
}

async function storedState(
  id: string,
): Promise<{ sale: string; status: string; live: string | null }> {
  const [row] = await db<{ sale_state: string; status: string; live: string | null }[]>`
    select c.sale_state, c.status, lc.sale_state as live
    from campaigns c left join live_campaigns lc on lc.slug = c.slug
    where c.id = ${id}
  `;
  if (row === undefined) throw new Error(`campaign ${id} not found`);
  return { sale: row.sale_state, status: row.status, live: row.live };
}

async function enqueuePauseJob(campaignId: string, paused: boolean, at: Date): Promise<void> {
  const requestId = randomUUID();
  await db`
    insert into jobs (kind, payload, idempotency_key, created_at, status)
    values (${JOB_KINDS.setPaused}, ${db.json({ campaignId, paused, requestId })},
            ${`${JOB_KINDS.setPaused}:${requestId}`}, ${at}, 'queued')
  `;
}

let txCounter = 0;

/** Stores a `CampaignPaused` event as the log poller does, not projected yet. Returns its tx hash. */
async function storePauseEvent(campaignId: string, paused: boolean, at: Date): Promise<string> {
  txCounter += 1;
  const txHash = `0x${txCounter.toString(16).padStart(64, "0")}`;
  const [campaign] = await db<{ onchain_id: bigint }[]>`
    select onchain_id from campaigns where id = ${campaignId}
  `;
  await db`
    insert into chain_events (tx_hash, log_index, block_number, block_time, name, args, source)
    values (${txHash}, 0, ${txCounter}, ${at}, 'CampaignPaused',
            ${db.json({ id: String(campaign?.onchain_id ?? ""), paused })}, 'receipt')
  `;
  return txHash;
}

/** What the projector does with a stored `CampaignPaused`: the status, then `processed_at`. */
async function projectPause(campaignId: string, paused: boolean, txHash: string): Promise<void> {
  await db.begin(async (tx) => {
    await tx`update campaigns set status = ${paused ? "paused" : "live"} where id = ${campaignId}`;
    await tx`update chain_events set processed_at = now() where tx_hash = ${txHash}`;
  });
}

/** A `CampaignPaused` mined, stored and projected. */
async function minePause(campaignId: string, paused: boolean, at: Date): Promise<void> {
  await projectPause(campaignId, paused, await storePauseEvent(campaignId, paused, at));
}

/** A ticket and its lot reserving `maxHedgeCost` on the campaign's budget. */
async function reserve(
  campaignId: string,
  maxHedgeCost: bigint,
  charged: bigint | null,
): Promise<void> {
  const [ticket] = await db<{ id: string }[]>`
    insert into tickets (campaign_id, buyer, qty, paid, refundable, max_hedge_cost, access_token)
    values (${campaignId}, ${`0x${"ab".repeat(20)}`}, 1, 20000000, 20000000,
            ${maxHedgeCost.toString()}::bigint, ${randomBytes(18).toString("base64url")})
    returning id::text as id
  `;
  await db`
    insert into lots (ticket_id, campaign_id, instrument, qty, max_hedge_cost, charged, charged_amount)
    values (${ticket?.id ?? ""}, ${campaignId}, ${SYMBOL}, 20000000, ${maxHedgeCost.toString()}::bigint,
            ${charged !== null}, ${charged === null ? null : charged.toString()}::bigint)
  `;
}

function runnerFor(
  books: SaleBookSource,
  clock: ManualClock,
  breakerStatus?: BreakerStatus,
  options: { statementTimeoutMs?: number } = {},
): SaleStateRunner {
  return new SaleStateRunner({
    db,
    bookFeed: books,
    logger: silent,
    clock: clock.now,
    ...(breakerStatus === undefined ? {} : { breakerStatus }),
    ...options,
  });
}

/**
 * Holds a lock in its own transaction until `release` is called. `lockSql` runs inside it, e.g.
 * `lock table campaigns in access exclusive mode`.
 */
async function holdLock(
  lock: (tx: TransactionSql) => Promise<unknown>,
): Promise<{ release: () => Promise<void> }> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => undefined;
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const done = db.begin(async (tx) => {
    await lock(tx);
    locked();
    await released;
  });
  await isLocked;
  return {
    release: async (): Promise<void> => {
      release();
      await done;
    },
  };
}

/**
 * Runs `work` while `lock` is held and returns how it settled within `withinMs`: its value, its
 * error, or "still waiting". The lock is released and `work` awaited before returning, so a pass
 * that would wait forever without a timeout makes the test fail instead of hang.
 */
async function settleWhileLocked<T>(
  lock: { release: () => Promise<void> },
  work: () => Promise<T>,
  withinMs = 3_000,
): Promise<T | Error | "still waiting"> {
  const running = work().then(
    (value) => value,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
  try {
    return await Promise.race([
      running,
      new Promise<"still waiting">((resolve) =>
        setTimeout(() => {
          resolve("still waiting");
        }, withinMs),
      ),
    ]);
  } finally {
    await lock.release();
    await running;
  }
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await installWriteLog(db);
  await db`
    insert into events (ticker, title, sport, league, home_name, home_abbreviation,
                        away_name, away_abbreviation, starts_at, sales_close_at)
    values ('KXTEST', 'Texas at Arkansas', 'football', 'NCAAF', 'Arkansas', 'ARK', 'Texas', 'TEX',
            ${new Date(STARTS_AT)}, ${new Date(STARTS_AT - 5 * 60_000)})
  `;
  for (const symbol of [SYMBOL, OTHER_SYMBOL]) {
    const onchain = `0x${Buffer.from(symbol).toString("hex").padEnd(64, "0")}`;
    await db`
      insert into instruments (symbol, event_ticker, label, type, onchain_id)
      values (${symbol}, 'KXTEST', ${symbol}, 'moneyline', ${onchain})
    `;
  }
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
  // Each test starts with no campaign on the shared instruments.
  await db`delete from live_campaigns`;
  await db`delete from lots`;
  await db`delete from tickets`;
  await db`delete from jobs`;
  await db`delete from chain_events`;
  await db`delete from positions`;
  await db`delete from campaigns`;
});

describe("SaleStateRunner against Postgres", () => {
  it("does not flap: one pause, one reopening, and exactly one write per transition", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign();
    const runner = runnerFor(books, clock);
    const mark = await writeMark();

    let transitions = 0;
    // 40 s of a price oscillating every second between 19 % and 18 %, then 17 % for good.
    for (let second = 0; second < 60; second += 1) {
      const price = second < 40 ? (second % 2 === 0 ? 1_900n : 1_800n) : 1_700n;
      books.setBook(bookAt(price, clock.nowMs, 1_000_000_000n, SYMBOL));
      const result = await runner.runPass();
      transitions += result.transitions;
      const state = (await storedState(campaign.id)).sale;
      if (second < 49) expect(state, `second ${String(second)}`).toBe("paused_price");
      if (second >= 50) expect(state, `second ${String(second)}`).toBe("open");
      clock.advance(1_000);
    }
    expect(transitions).toBe(2);
    expect(await writesSince(mark)).toEqual({ campaigns: 2, live: 2 });
    expect((await storedState(campaign.id)).live).toBe("open");
  });

  it("pauses a stale book within the pass after it turns stale and reopens 10 s after books return", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign();
    const runner = runnerFor(books, clock);

    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("open");

    clock.advance(10_000);
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("open");
    clock.advance(1);
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_stale");

    clock.advance(5_000);
    books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
    const back = clock.nowMs;
    await runner.runPass();
    for (const offset of [5_000, RESUME_DELAY_MS - 1]) {
      clock.nowMs = back + offset;
      books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
      await runner.runPass();
      expect((await storedState(campaign.id)).sale).toBe("paused_stale");
    }
    clock.nowMs = back + RESUME_DELAY_MS;
    books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    expect(await storedState(campaign.id)).toMatchObject({ sale: "open", live: "open" });
  });

  it("follows the feed's stale flag", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign();
    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    books.flagStale(SYMBOL, true);
    await runnerFor(books, clock).runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_stale");
  });

  it("is paused_depth without a book and with an empty book", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign();
    const runner = runnerFor(books, clock);
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_depth");
    books.setBook(emptyBook(T0, SYMBOL));
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_depth");
  });

  it("counts the pending exposure of the instrument (exposure minus held)", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign();
    await db`insert into positions (instrument, exposure, held) values (${SYMBOL}, 990000000, 0)`;
    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    const runner = runnerFor(books, clock);
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_depth");

    await db`update positions set held = 20000000 where instrument = ${SYMBOL}`;
    const [row] = (await loadCampaignSaleRows(db)).rows;
    expect(row?.pending).toBe(970_000_000n);
  });

  it("pauses an exhausted budget and reopens after a top-up plus the delay", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    // Budget $10: $4 charged, $4 reserved, $2 left; one sale at 12 % needs $2.748.
    const campaign = await seedCampaign({ budget: 10_000_000n });
    await reserve(campaign.id, 4_000_000n, 4_000_000n);
    await reserve(campaign.id, 4_000_000n, null);
    const runner = runnerFor(books, clock);
    const [loaded] = (await loadCampaignSaleRows(db)).rows;
    expect(loaded?.availableBudget).toBe(2_000_000n);

    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_budget");

    await db`update campaigns set budget = 20000000 where id = ${campaign.id}`;
    const toppedAt = clock.advance(1_000);
    books.setBook(bookAt(1_200n, toppedAt, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_budget");
    clock.nowMs = toppedAt + RESUME_DELAY_MS - 1;
    books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_budget");
    clock.nowMs = toppedAt + RESUME_DELAY_MS;
    books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("open");
  });

  it("pauses at once on the breaker and waits 10 s after it ends", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign();
    let active = false;
    const runner = runnerFor(books, clock, (symbol) => ({
      active: active && symbol === SYMBOL,
      reason: active ? "venue_down" : null,
    }));
    const tick = async (): Promise<string> => {
      books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
      await runner.runPass();
      return (await storedState(campaign.id)).sale;
    };
    expect(await tick()).toBe("open");
    active = true;
    clock.advance(1_000);
    expect(await tick()).toBe("paused_breaker");
    active = false;
    const endedAt = clock.advance(1_000);
    expect(await tick()).toBe("paused_breaker");
    clock.nowMs = endedAt + RESUME_DELAY_MS - 1;
    expect(await tick()).toBe("paused_breaker");
    clock.nowMs = endedAt + RESUME_DELAY_MS;
    expect(await tick()).toBe("open");
  });

  describe("manual pause", () => {
    async function setup(): Promise<{
      id: string;
      runner: SaleStateRunner;
      pass: () => Promise<{ sale: string; status: string; live: string | null }>;
      clock: ManualClock;
      books: HandBookSource;
    }> {
      const clock = new ManualClock(T0);
      const books = new HandBookSource();
      const campaign = await seedCampaign();
      const runner = runnerFor(books, clock);
      const pass = async (): Promise<{ sale: string; status: string; live: string | null }> => {
        books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
        await runner.runPass();
        return storedState(campaign.id);
      };
      return { id: campaign.id, runner, pass, clock, books };
    }

    /** What the web API does on pause: paused_manual at once, and the job. */
    async function apiPause(id: string, at: Date): Promise<void> {
      await db`update campaigns set sale_state = 'paused_manual' where id = ${id}`;
      await enqueuePauseJob(id, true, at);
    }

    it("pause requested then mined, then resume requested then mined", async () => {
      const { id, pass, clock } = await setup();
      expect((await pass()).sale).toBe("open");

      await apiPause(id, new Date(clock.nowMs));
      // Before mining: kept paused_manual, and live_campaigns follows it.
      expect(await pass()).toMatchObject({
        sale: "paused_manual",
        status: "live",
        live: "paused_manual",
      });
      clock.advance(3_000);
      await minePause(id, true, new Date(clock.nowMs));
      expect(await pass()).toMatchObject({ sale: "paused_manual", status: "paused" });

      clock.advance(60_000);
      await enqueuePauseJob(id, false, new Date(clock.nowMs));
      expect((await pass()).sale).toBe("paused_manual");
      clock.advance(3_000);
      await minePause(id, false, new Date(clock.nowMs));
      // Resumed by hand: open at once, no delay.
      expect(await pass()).toMatchObject({ sale: "open", status: "live", live: "open" });
    });

    it("pause then resume both requested before either is mined", async () => {
      const { id, pass, clock } = await setup();
      expect((await pass()).sale).toBe("open");
      await apiPause(id, new Date(clock.nowMs));
      expect((await pass()).sale).toBe("paused_manual");
      clock.advance(1_000);
      await enqueuePauseJob(id, false, new Date(clock.nowMs));
      // The merchant's last word is "resume", nothing is paused on-chain.
      expect((await pass()).sale).toBe("open");
      clock.advance(2_000);
      await minePause(id, true, new Date(clock.nowMs));
      expect((await pass()).sale).toBe("paused_manual");
      clock.advance(2_000);
      await minePause(id, false, new Date(clock.nowMs));
      expect((await pass()).sale).toBe("open");
    });

    it("stays paused while the pause is mined and stored but not projected yet", async () => {
      const { id, pass, clock } = await setup();
      expect((await pass()).sale).toBe("open");
      await apiPause(id, new Date(clock.nowMs));
      clock.advance(2_000);
      // The log poller stored the event; the projector has not applied it: status still live.
      const txHash = await storePauseEvent(id, true, new Date(clock.nowMs));
      for (let i = 0; i < 3; i += 1) {
        clock.advance(1_000);
        expect(await pass()).toMatchObject({
          sale: "paused_manual",
          status: "live",
          live: "paused_manual",
        });
      }
      await projectPause(id, true, txHash);
      clock.advance(1_000);
      expect(await pass()).toMatchObject({ sale: "paused_manual", status: "paused" });
    });

    it("is never overwritten by an automatic state", async () => {
      const { id, pass, clock, books, runner } = await setup();
      await apiPause(id, new Date(clock.nowMs));
      for (const price of [1_900n, 1_200n, 2_500n]) {
        clock.advance(1_000);
        books.setBook(bookAt(price, clock.nowMs, 1_000_000_000n, SYMBOL));
        await runner.runPass();
        expect((await storedState(id)).sale).toBe("paused_manual");
      }
      books.flagStale(SYMBOL, true);
      clock.advance(30_000);
      expect((await pass()).sale).toBe("paused_manual");
    });
  });

  it("closes at the exact instant of the sales close, sets sales_closed, and nothing reopens it", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const closeAt = T0 + 5_000;
    const campaign = await seedCampaign({ salesCloseMs: closeAt });
    const runner = runnerFor(books, clock);
    const pass = async (): Promise<{ sale: string; status: string; live: string | null }> => {
      books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
      await runner.runPass();
      return storedState(campaign.id);
    };
    expect((await pass()).sale).toBe("open");
    clock.nowMs = closeAt - 1;
    expect(await pass()).toMatchObject({ sale: "open", status: "live" });
    clock.nowMs = closeAt;
    expect(await pass()).toEqual({ sale: "closed", status: "sales_closed", live: "closed" });
    const mark = await writeMark();
    for (let i = 1; i <= 3; i += 1) {
      clock.nowMs = closeAt + i * 15_000;
      expect(await pass()).toEqual({ sale: "closed", status: "sales_closed", live: "closed" });
    }
    expect(await writesSince(mark)).toEqual({ campaigns: 0, live: 0 });
  });

  it("closes sales 5 min before the event starts even if sales_close says later, but sets sales_closed only at sales_close", async () => {
    const clock = new ManualClock(STARTS_AT - 5 * 60_000);
    const books = new HandBookSource();
    const campaign = await seedCampaign({ salesCloseMs: STARTS_AT });
    const runner = runnerFor(books, clock);
    books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    // No sale 5 min before the start; the status, which is final, waits for the escrow's close.
    expect(await storedState(campaign.id)).toMatchObject({ sale: "closed", status: "live" });

    // The event is rescheduled an hour later: the escrow still sells, so the campaign does.
    await db`update events set starts_at = starts_at + interval '1 hour' where ticker = 'KXTEST'`;
    try {
      clock.advance(1_000);
      books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
      await runner.runPass();
      expect(await storedState(campaign.id)).toMatchObject({ sale: "open", status: "live" });

      clock.nowMs = STARTS_AT;
      books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
      await runner.runPass();
      expect(await storedState(campaign.id)).toMatchObject({
        sale: "closed",
        status: "sales_closed",
      });
    } finally {
      await db`update events set starts_at = starts_at - interval '1 hour' where ticker = 'KXTEST'`;
    }
  });

  it("closes a paused campaign at the sales close (status sales_closed)", async () => {
    const clock = new ManualClock(T0 + 10_000);
    const books = new HandBookSource();
    const campaign = await seedCampaign({
      salesCloseMs: T0,
      status: "paused",
      saleState: "paused_manual",
    });
    await runnerFor(books, clock).runPass();
    expect(await storedState(campaign.id)).toMatchObject({
      sale: "closed",
      status: "sales_closed",
    });
  });

  it("keeps a campaign closed early by the merchant closed while the close is on its way", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign({ saleState: "closed" });
    await db`
      insert into jobs (kind, payload, idempotency_key)
      values (${JOB_KINDS.closeSales}, ${db.json({ campaignId: campaign.id })},
              ${`${JOB_KINDS.closeSales}:${campaign.id}`})
    `;
    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    await runnerFor(books, clock).runPass();
    expect((await storedState(campaign.id)).sale).toBe("closed");
  });

  it("closes a settled campaign and a campaign without an on-chain id", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const settled = await seedCampaign({ status: "settled_yes", saleState: "open" });
    const unborn = await seedCampaign({ status: "live", saleState: "open", onchain: false });
    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    const result = await runnerFor(books, clock).runPass();
    expect(result.transitions).toBe(2);
    expect((await storedState(settled.id)).sale).toBe("closed");
    expect((await storedState(unborn.id)).sale).toBe("closed");
  });

  it("writes live_campaigns only for campaigns that have a slug", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const noSlug = await seedCampaign({ slug: false, saleState: "closed" });
    const withSlug = await seedCampaign({ saleState: "closed" });
    // A slug whose live row was never written by the projection.
    await db`delete from live_campaigns where slug = ${withSlug.slug ?? ""}`;
    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    await runnerFor(books, clock).runPass();
    expect((await storedState(noSlug.id)).sale).toBe("open");
    const live = await db<{ slug: string; sale_state: string; sales: number }[]>`
      select slug, sale_state, sales from live_campaigns
    `;
    expect(live).toEqual([{ slug: withSlug.slug, sale_state: "open", sales: 0 }]);
  });

  it("after a restart, a stored automatic pause waits its full 10 s again", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign({ saleState: "paused_depth" });
    const runner = runnerFor(books, clock);
    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_depth");
    clock.nowMs = T0 + RESUME_DELAY_MS - 1;
    books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("paused_depth");
    clock.nowMs = T0 + RESUME_DELAY_MS;
    books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
    await runner.runPass();
    expect((await storedState(campaign.id)).sale).toBe("open");
  });

  it("after a restart, a stored paused_price keeps its one-tick margin: no reopening at p_max", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign({ saleState: "paused_price" });
    const runner = runnerFor(books, clock);
    const mark = await writeMark();
    for (let second = 0; second <= 12; second += 1) {
      books.setBook(bookAt(1_800n, clock.nowMs, 1_000_000_000n, SYMBOL));
      await runner.runPass();
      expect((await storedState(campaign.id)).sale, `second ${String(second)}`).toBe(
        "paused_price",
      );
      clock.advance(1_000);
    }
    expect(await writesSince(mark)).toEqual({ campaigns: 0, live: 0 });
    const below = clock.nowMs;
    for (const offset of [0, RESUME_DELAY_MS - 1, RESUME_DELAY_MS]) {
      clock.nowMs = below + offset;
      books.setBook(bookAt(1_700n, clock.nowMs, 1_000_000_000n, SYMBOL));
      await runner.runPass();
    }
    expect((await storedState(campaign.id)).sale).toBe("open");
  });

  it("a failed write keeps the price margin and restarts the delay (row locked past the timeout)", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const campaign = await seedCampaign();
    const runner = runnerFor(books, clock, undefined, { statementTimeoutMs: 200 });
    const tick = async (price: bigint): Promise<string> => {
      books.setBook(bookAt(price, clock.nowMs, 1_000_000_000n, SYMBOL));
      await runner.runPass();
      clock.advance(1_000);
      return (await storedState(campaign.id)).sale;
    };
    expect(await tick(1_200n)).toBe("open");
    expect(await tick(1_900n)).toBe("paused_price");
    books.flagStale(SYMBOL, true);
    expect(await tick(1_900n)).toBe("paused_stale");
    books.flagStale(SYMBOL, false);

    // The campaign row is locked elsewhere and live_campaigns disagrees: the write times out.
    const lock = await holdLock(
      (tx) => tx`select 1 from campaigns where id = ${campaign.id} for update`,
    );
    await db`update live_campaigns set sale_state = 'open' where slug = ${campaign.slug ?? ""}`;
    books.setBook(bookAt(1_800n, clock.nowMs, 1_000_000_000n, SYMBOL));
    const failed = await settleWhileLocked(lock, () => runner.runPass());
    expect(failed).toMatchObject({ failures: 1 });
    expect(runner.memoryOf(campaign.id)).toMatchObject({
      state: "paused_stale",
      acceptedSinceMs: null,
      priceRefused: true,
    });
    // At exactly p_max, it never reopens.
    for (let second = 0; second <= 12; second += 1) {
      expect(await tick(1_800n), `second ${String(second)}`).toBe("paused_stale");
    }
    expect((await storedState(campaign.id)).live).toBe("paused_stale");
  });

  describe("fails closed when a campaign cannot be evaluated", () => {
    it("pauses an open campaign when the breaker status throws, and reopens 10 s after it works", async () => {
      const clock = new ManualClock(T0);
      const books = new HandBookSource();
      const campaign = await seedCampaign();
      let broken = false;
      const runner = runnerFor(books, clock, () => {
        if (broken) throw new Error("hedging lane down");
        return { active: false, reason: null };
      });
      const tick = async (): Promise<{ sale: string; failures: number }> => {
        books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
        const result = await runner.runPass();
        return { sale: (await storedState(campaign.id)).sale, failures: result.failures };
      };
      expect(await tick()).toEqual({ sale: "open", failures: 0 });
      broken = true;
      for (let i = 0; i < 3; i += 1) {
        clock.advance(1_000);
        expect(await tick()).toEqual({ sale: "paused_breaker", failures: 1 });
      }
      broken = false;
      const fixedAt = clock.advance(1_000);
      expect(await tick()).toEqual({ sale: "paused_breaker", failures: 0 });
      clock.nowMs = fixedAt + RESUME_DELAY_MS - 1;
      expect(await tick()).toEqual({ sale: "paused_breaker", failures: 0 });
      clock.nowMs = fixedAt + RESUME_DELAY_MS;
      expect(await tick()).toEqual({ sale: "open", failures: 0 });
    });

    it("pauses an open campaign when the book source throws", async () => {
      const clock = new ManualClock(T0);
      const books = new HandBookSource();
      const campaign = await seedCampaign();
      books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
      const runner = runnerFor(books, clock);
      await runner.runPass();
      expect((await storedState(campaign.id)).sale).toBe("open");
      const throwing: SaleBookSource = {
        getBook: (): Book | null => {
          throw new Error("feed exploded");
        },
        isStale: (): boolean => {
          throw new Error("feed exploded");
        },
        subscribe: (listener) => books.subscribe(listener),
      };
      const result = await runnerFor(throwing, clock).runPass();
      expect(result.failures).toBe(1);
      expect((await storedState(campaign.id)).sale).toBe("paused_depth");
    });

    it("pauses an open campaign when the pricing rejects its inputs (a malformed book)", async () => {
      const clock = new ManualClock(T0);
      const books = new HandBookSource();
      const campaign = await seedCampaign();
      const runner = runnerFor(books, clock);
      books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
      await runner.runPass();
      expect((await storedState(campaign.id)).sale).toBe("open");
      // Asks not sorted best first: computeQuote throws a PricingInputError.
      books.setBook({
        instrumentSymbol: SYMBOL,
        bids: [],
        asks: [
          { priceBps: 1_500n, qty: 1_000_000_000n },
          { priceBps: 1_200n, qty: 1_000_000_000n },
        ],
        observedAtMs: T0,
      });
      const result = await runner.runPass();
      expect(result).toMatchObject({ failures: 1, evaluated: 0, transitions: 1 });
      expect(await storedState(campaign.id)).toMatchObject({
        sale: "paused_breaker",
        live: "paused_breaker",
      });
    });

    it("still closes at the sales close and keeps a manual pause", async () => {
      const clock = new ManualClock(T0 + 10_000);
      const books = new HandBookSource();
      const closing = await seedCampaign({ salesCloseMs: T0 });
      const manual = await seedCampaign({ status: "paused", saleState: "paused_manual" });
      const runner = runnerFor(books, clock, () => {
        throw new Error("hedging lane down");
      });
      books.setBook(bookAt(1_200n, clock.nowMs, 1_000_000_000n, SYMBOL));
      await runner.runPass();
      expect(await storedState(closing.id)).toMatchObject({
        sale: "closed",
        status: "sales_closed",
      });
      expect((await storedState(manual.id)).sale).toBe("paused_manual");
    });
  });

  it("a pass stuck behind a lock fails after the statement timeout instead of hanging", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    await seedCampaign();
    const runner = runnerFor(books, clock, undefined, { statementTimeoutMs: 200 });
    const lock = await holdLock((tx) => tx`lock table campaigns in access exclusive mode`);
    const outcome = await settleWhileLocked(lock, () => runner.runPass());
    expect(outcome).toBeInstanceOf(Error);
    expect(String(outcome)).toMatch(/timeout/);
  });

  it("drops a decision when the web API changed the sale state in between", async () => {
    const campaign = await seedCampaign({ saleState: "open" });
    await db`update campaigns set sale_state = 'paused_manual' where id = ${campaign.id}`;
    const result = await writeSaleState(db, {
      campaignId: campaign.id,
      expectedState: "open",
      state: "paused_price",
      syncLive: true,
      closeStatus: false,
    });
    expect(result).toEqual({ applied: false, rowsWritten: 0, statusClosed: false });
    expect((await storedState(campaign.id)).sale).toBe("paused_manual");
  });

  it("evaluates only the campaigns of the given instruments in a scoped pass", async () => {
    const clock = new ManualClock(T0);
    const books = new HandBookSource();
    const here = await seedCampaign({ saleState: "closed" });
    const there = await seedCampaign({ symbol: OTHER_SYMBOL, saleState: "closed" });
    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, OTHER_SYMBOL));
    const result = await runnerFor(books, clock).runPass([SYMBOL]);
    expect(result.evaluated).toBe(1);
    expect((await storedState(here.id)).sale).toBe("open");
    expect((await storedState(there.id)).sale).toBe("closed");
  });
});

describe("startSaleStates", () => {
  /**
   * Timers created by the service (its own code or the sleep it uses) that are still pending.
   * Timers of the Postgres client are not counted: they are not the service's.
   */
  function trackServiceTimers(): { pending: () => number; stop: () => void } {
    const pending = new Set<number>();
    const hook = createHook({
      init(asyncId: number, type: string): void {
        if (type !== "Timeout") return;
        const stack = new Error().stack ?? "";
        if (/sales[\\/]service\.ts|chain[\\/]clock\.ts/u.test(stack)) pending.add(asyncId);
      },
      destroy(asyncId: number): void {
        pending.delete(asyncId);
      },
    });
    hook.enable();
    return { pending: () => pending.size, stop: () => hook.disable() };
  }

  async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error("condition not met in time");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it("runs on its interval and on book updates, and stops on abort with no timer left", async () => {
    const books = new HandBookSource();
    const campaign = await seedCampaign({ saleState: "closed" });
    const timers = trackServiceTimers();
    const stop = new AbortController();
    // A long interval: after the first pass, only book updates can trigger an evaluation.
    const service = startSaleStates({
      db,
      bookFeed: books,
      logger: silent,
      signal: stop.signal,
      intervalMs: 60_000,
      clock: () => T0,
    });
    expect(books.listeners.size).toBe(1);

    // First full pass: no book yet.
    await waitFor(async () => (await storedState(campaign.id)).sale === "paused_depth");
    // Newly paused from a stored `closed`: a book reopens it only after the delay, so check the
    // book-triggered pass with a price refusal instead (immediate).
    books.setBook(bookAt(2_500n, T0, 1_000_000_000n, SYMBOL));
    await waitFor(async () => (await storedState(campaign.id)).sale === "paused_price");

    stop.abort();
    await service.stopped;
    expect(books.listeners.size).toBe(0);
    // Destroy hooks of cleared timers are emitted asynchronously.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(timers.pending()).toBe(0);
    timers.stop();

    // Nothing runs after the stop.
    books.setBook(bookAt(1_200n, T0, 1_000_000_000n, SYMBOL));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await storedState(campaign.id)).sale).toBe("paused_price");
  });

  it("never throws out of its loop when the database fails, and still stops", async () => {
    const books = new HandBookSource();
    const broken = new Proxy(db, {
      apply: (): never => {
        throw new Error("database unavailable");
      },
    });
    const stop = new AbortController();
    const service = startSaleStates({
      db: broken,
      bookFeed: books,
      logger: silent,
      signal: stop.signal,
      intervalMs: 10,
      retryMaxMs: 20,
      clock: () => T0,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    stop.abort();
    await expect(service.stopped).resolves.toBeUndefined();
  });

  it("logs a pass that overruns, and stops once it ends", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (line: string) => lines.push(line) });
    let fail: (error: Error) => void = () => undefined;
    const hung = new Promise<never>((_, reject) => {
      fail = reject;
    });
    // A connection that stopped answering: every transaction waits forever.
    const stuck = new Proxy(db, {
      get: (target, property, receiver): unknown =>
        property === "begin" ? (): Promise<never> => hung : Reflect.get(target, property, receiver),
    });
    const stop = new AbortController();
    const service = startSaleStates({
      db: stuck,
      bookFeed: new HandBookSource(),
      logger,
      signal: stop.signal,
      intervalMs: 10,
      slowPassMs: 50,
      clock: () => T0,
    });
    await waitFor(() => Promise.resolve(lines.some((line) => line.includes("overrunning"))));
    const entry = JSON.parse(lines.find((line) => line.includes("overrunning")) ?? "{}") as {
      level?: number;
      elapsedMs?: number;
    };
    expect(entry.level).toBe(50);
    // About the 50 ms of `slowPassMs`: a Node timer can fire a millisecond before the wall clock
    // has counted its full delay, so the measured time may read 49.
    expect(entry.elapsedMs).toBeGreaterThanOrEqual(45);
    stop.abort();
    fail(new Error("connection reset"));
    await expect(service.stopped).resolves.toBeUndefined();
  });

  it("refuses a non-positive interval", () => {
    expect(() =>
      startSaleStates({
        db,
        bookFeed: new HandBookSource(),
        logger: silent,
        signal: new AbortController().signal,
        intervalMs: 0,
      }),
    ).toThrow(/intervalMs/);
  });
});
