/**
 * Demo books (SPEC MDB-4): demo_overrides rows drive the feed. Real Postgres, the fake socket,
 * fake fetch and a hand-driven clock, as in book-feed.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { readCachedBook } from "./book-cache-reader";
import { BookFeed, type BookFeedEvent, type BookFeedRun } from "./book-feed";
import { PgBookStore } from "./book-store";
import {
  ManualScheduler,
  SPORTS_SYMBOLS,
  fakeSocketFactory,
  liveInstrumentRow,
  recordingLogger,
  seedCampaign,
  seedInstruments,
  type FakeSocketFactory,
  type RecordingLogger,
} from "./book-test-support";
import {
  PgDemoBookStore,
  parseDemoBook,
  DemoBookError,
  type DemoBookRow,
  type DemoBookStore,
} from "./demo-book-store";
import { GeminiRestClient } from "./gemini-rest-client";
import { TokenBucket } from "./rate-limiter";
import { RestBookPoller } from "./rest-book-poller";
import { schedulerSleep } from "./scheduler";
import { fakeFetch, jsonResponse } from "./test-support";
import { WsBookTransport } from "./ws-book-transport";

const [NYK, MURR, HOU] = SPORTS_SYMBOLS;

const REST_BODY = {
  bids: [{ price: "0.52", amount: "10.0" }],
  asks: [{ price: "0.6", amount: "20.0" }],
};

/** The book the admin route writes: 0.30 / 0.34, 50 contracts a side. */
const DEMO_BOOK = {
  bids: [{ priceBps: 3_000, qty: "50000000" }],
  asks: [{ priceBps: 3_400, qty: "50000000" }],
};

interface Harness {
  db: Db;
  feed: BookFeed;
  run: BookFeedRun;
  controller: AbortController;
  scheduler: ManualScheduler;
  sockets: FakeSocketFactory;
  restUrls: string[];
  log: RecordingLogger;
  events: BookFeedEvent[];
}

/**
 * The Postgres demo store, with reads or release writes made to fail on demand, as when the
 * connection drops or the table cannot be read.
 */
class FlakyDemoBookStore implements DemoBookStore {
  /** listDemoBooks rejects while true. */
  failReads = false;
  /** The next N releaseDemoBook calls reject. */
  failReleases = 0;
  reads = 0;
  readonly releases: { symbol: string; demoObservedAtMs: number; restored: boolean }[] = [];

  constructor(private readonly inner: PgDemoBookStore) {}

  async listDemoBooks(): Promise<DemoBookRow[]> {
    this.reads += 1;
    if (this.failReads) throw new Error('relation "demo_overrides" does not exist');
    return this.inner.listDemoBooks();
  }

  async releaseDemoBook(...args: Parameters<DemoBookStore["releaseDemoBook"]>): Promise<void> {
    const [symbol, demoObservedAtMs, live] = args;
    this.releases.push({ symbol, demoObservedAtMs, restored: live !== null });
    if (this.failReleases > 0) {
      this.failReleases -= 1;
      throw new Error("connection terminated unexpectedly");
    }
    await this.inner.releaseDemoBook(...args);
  }
}

let database: TestDatabase | null = null;
let harness: Harness | null = null;

afterEach(async () => {
  if (harness !== null) {
    await stopFeed(harness);
    harness = null;
  }
  if (database !== null) {
    await database.drop();
    database = null;
  }
});

async function setup(
  options: {
    campaigns?: [string, string][];
    demo?: boolean;
    /** Wraps the Postgres demo store, e.g. to make it fail. */
    demoStore?: (store: PgDemoBookStore) => DemoBookStore;
  } = {},
): Promise<Harness> {
  database = await createTestDatabase();
  const { db } = database;
  await seedInstruments(db, SPORTS_SYMBOLS);
  for (const [symbol, status] of options.campaigns ?? [[NYK, "live"]]) {
    await seedCampaign(db, symbol, status);
  }
  const scheduler = new ManualScheduler(Date.now());
  const sleep = schedulerSleep(scheduler);
  const log = recordingLogger();
  const sockets = fakeSocketFactory();
  const http = fakeFetch(() => jsonResponse(REST_BODY));
  const limiter = new TokenBucket({
    capacity: 1_000,
    refillPerMinute: 60_000,
    now: scheduler.now,
    sleep,
  });
  const client = new GeminiRestClient({
    baseUrl: "https://gemini.test",
    logger: log.logger,
    fetch: http.fetch,
    now: scheduler.now,
    sleep,
    limiter,
    maxAttempts: 1,
  });
  const ws = new WsBookTransport({
    socketFactory: sockets.factory,
    logger: log.logger,
    scheduler,
    random: () => 0.5,
  });
  const rest = new RestBookPoller({
    client,
    logger: log.logger,
    scheduler,
    minIntervalPerSymbolMs: 1_000,
    maxRequestsPerMinute: 600,
  });
  const feed = new BookFeed({
    store: new PgBookStore(db),
    ws,
    rest,
    logger: log.logger,
    scheduler,
    demo:
      options.demo === false
        ? null
        : (options.demoStore ?? ((store: PgDemoBookStore): DemoBookStore => store))(
            new PgDemoBookStore(db),
          ),
  });
  const events: BookFeedEvent[] = [];
  feed.subscribe((event) => events.push(event));
  const controller = new AbortController();
  const run = feed.start({ signal: controller.signal });
  harness = { db, feed, run, controller, scheduler, sockets, restUrls: http.urls, log, events };
  sockets.latest().open();
  return harness;
}

async function stopFeed(h: Harness): Promise<void> {
  h.controller.abort();
  let done = false;
  const stopped = h.run.stopped.then(() => {
    done = true;
  });
  for (let round = 0; round < 200 && !done; round += 1) await h.scheduler.advance(100);
  await stopped;
}

async function waitTracked(h: Harness, symbols: readonly string[]): Promise<void> {
  await vi.waitFor(() => {
    expect(h.feed.trackedSymbols()).toEqual([...symbols].sort());
  });
}

function snapshot(
  symbol: string,
  id: number,
  bids: [string, string][],
  asks: [string, string][],
): string {
  return JSON.stringify({ lastUpdateId: id, symbol: symbol.toLowerCase(), bids, asks });
}

async function setOverride(db: Db, symbol: string, book: unknown): Promise<void> {
  await db`
    insert into demo_overrides (instrument, book) values (${symbol}, ${db.json(book as never)})
    on conflict (instrument) do update set book = excluded.book
  `;
}

async function removeOverride(db: Db, symbol: string): Promise<void> {
  await db`delete from demo_overrides where instrument = ${symbol}`;
}

interface CacheRow {
  bids: unknown;
  asks: unknown;
  observed_at: Date;
  source: string;
}

async function bookCacheRow(db: Db, symbol: string): Promise<CacheRow | null> {
  const rows = await db<CacheRow[]>`
    select bids, asks, observed_at, source from book_cache where symbol = ${symbol}
  `;
  return rows[0] ?? null;
}

/** Runs the clock in 250 ms steps, letting Postgres answer between two steps. */
async function advance(h: Harness, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 250) {
    await h.scheduler.advance(Math.min(250, ms - elapsed));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("BookFeed with demo books", () => {
  it("serves the demo book instead of Gemini's, and sets Gemini's books aside", async () => {
    const h = await setup();
    await waitTracked(h, [NYK]);
    h.sockets.latest().receive(snapshot(NYK, 1, [["0.5600", "1.00"]], [["0.5700", "1.00"]]));
    await vi.waitFor(async () => {
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("ws");
    });

    await setOverride(h.db, NYK, DEMO_BOOK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("demo");
    });
    const row = await bookCacheRow(h.db, NYK);
    expect(row?.bids).toEqual(DEMO_BOOK.bids);
    expect(row?.asks).toEqual(DEMO_BOOK.asks);
    expect(await liveInstrumentRow(h.db, NYK)).toMatchObject({
      bid_bps: 3_000,
      ask_bps: 3_400,
      mid_bps: 3_200,
      stale: false,
    });
    expect(h.feed.getBook(NYK)?.bids).toEqual([{ priceBps: 3_000n, qty: 50_000_000n }]);
    const demoEvents = h.events.filter((event) => event.kind === "book" && event.source === "demo");
    expect(demoEvents.length).toBeGreaterThan(0);

    // A Gemini book now: counted, not served, not written.
    const before = h.feed.stats().written;
    h.sockets.latest().receive(snapshot(NYK, 2, [["0.6100", "1.00"]], [["0.6200", "1.00"]]));
    await advance(h, 250);
    expect(h.feed.stats().ignoredWhileDemo).toBe(1);
    expect(h.feed.stats().accepted.ws).toBe(1);
    expect(h.feed.stats().written.ws).toBe(before.ws);
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(3_000n);
    expect((await bookCacheRow(h.db, NYK))?.source).toBe("demo");
    expect((await liveInstrumentRow(h.db, NYK))?.bid_bps).toBe(3_000);
    expect(h.events.filter((event) => event.kind === "book" && event.source === "ws")).toHaveLength(
      1,
    );
    // The reader sees the demo book as any other book.
    expect((await readCachedBook(h.db, NYK))?.asks).toEqual([
      { priceBps: 3_400n, qty: 50_000_000n },
    ]);
  });

  it("tracks an instrument with a demo book although no campaign uses it", async () => {
    const h = await setup();
    await waitTracked(h, [NYK]);
    await setOverride(h.db, MURR, DEMO_BOOK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect(h.feed.trackedSymbols()).toEqual([MURR, NYK].sort());
    });
    await vi.waitFor(async () => {
      expect((await bookCacheRow(h.db, MURR))?.source).toBe("demo");
    });
    // Gemini is asked to stream it too, so its real book is at hand when the override goes.
    expect(
      h.sockets
        .latest()
        .subscribedStreams()
        .some((stream) => stream.toUpperCase().startsWith(MURR)),
    ).toBe(true);
    // No REST poll for a demo instrument: its Gemini book would be set aside anyway.
    await advance(h, 5_000);
    expect(h.restUrls.filter((url) => decodeURIComponent(url).includes(MURR))).toEqual([]);
  });

  it("re-stamps the demo book on every pass: it never turns stale while the row exists", async () => {
    const h = await setup();
    await waitTracked(h, [NYK]);
    await setOverride(h.db, NYK, DEMO_BOOK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("demo");
    });
    const firstAt = (await bookCacheRow(h.db, NYK))?.observed_at.getTime() ?? 0;

    await advance(h, 25_000);
    expect(h.feed.isStale(NYK)).toBe(false);
    const nowMs = h.scheduler.now();
    expect(nowMs - (h.feed.getBook(NYK)?.observedAtMs ?? 0)).toBeLessThanOrEqual(1_000);
    await vi.waitFor(async () => {
      const live = await liveInstrumentRow(h.db, NYK);
      expect(live?.stale).toBe(false);
      expect(nowMs - (live?.observed_at.getTime() ?? 0)).toBeLessThanOrEqual(1_500);
    });
    const cached = await bookCacheRow(h.db, NYK);
    expect(cached?.observed_at.getTime()).toBeGreaterThan(firstAt + 20_000);
    expect(h.log.messages()).not.toContain("instrument stale");
  });

  it("goes back to the latest Gemini book at once when the override is removed", async () => {
    const h = await setup();
    await waitTracked(h, [NYK]);
    await setOverride(h.db, NYK, DEMO_BOOK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("demo");
    });
    await advance(h, 2_000);
    // Gemini keeps streaming during the demo: this book is set aside, and kept.
    h.sockets.latest().receive(snapshot(NYK, 7, [["0.4400", "3.00"]], [["0.4600", "2.00"]]));
    const liveAtMs = h.scheduler.now();
    await advance(h, 2_000);
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(3_000n);

    await removeOverride(h.db, NYK);
    const removedAtMs = h.scheduler.now();
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(4_400n);
    });
    // One demo pass after the removal, not the 10 s the demo book would need to age out.
    expect(h.scheduler.now() - removedAtMs).toBeLessThanOrEqual(1_250);
    await vi.waitFor(async () => {
      const row = await bookCacheRow(h.db, NYK);
      expect(row?.source).toBe("ws");
      expect(row?.observed_at.getTime()).toBe(liveAtMs);
    });
    expect(await liveInstrumentRow(h.db, NYK)).toMatchObject({
      bid_bps: 4_400,
      ask_bps: 4_600,
      stale: false,
    });
    expect((await liveInstrumentRow(h.db, NYK))?.observed_at.getTime()).toBe(liveAtMs);
    const lastEvent = h.events.filter((event) => event.kind === "book").at(-1);
    expect(lastEvent).toMatchObject({ source: "ws" });

    // The next Gemini book is served and written as usual. It is sent off the 250 ms grid the
    // clock moves on, so no REST answer lands in the same millisecond: the feed does not write a
    // second book observed in the very millisecond of the one it last wrote.
    await advance(h, 510);
    h.sockets.latest().receive(snapshot(NYK, 8, [["0.4500", "3.00"]], [["0.4700", "2.00"]]));
    // Within the 500 ms write throttle, before REST gap filling (3 s of socket silence) starts.
    await advance(h, 500);
    await vi.waitFor(async () => {
      expect((await liveInstrumentRow(h.db, NYK))?.bid_bps).toBe(4_500);
    });
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(4_500n);
  });

  it("drops the demo book at once when no Gemini book is at hand, and takes the next one", async () => {
    const h = await setup();
    await waitTracked(h, [NYK]);
    await setOverride(h.db, NYK, DEMO_BOOK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("demo");
    });
    await advance(h, 1_000);

    await removeOverride(h.db, NYK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect(h.feed.getBook(NYK)).toBeNull();
    });
    await vi.waitFor(async () => {
      expect(await bookCacheRow(h.db, NYK)).toBeNull();
      expect((await liveInstrumentRow(h.db, NYK))?.stale).toBe(true);
    });

    h.sockets.latest().receive(snapshot(NYK, 9, [["0.5100", "1.00"]], [["0.5300", "1.00"]]));
    const liveAtMs = h.scheduler.now();
    await vi.waitFor(async () => {
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("ws");
    });
    expect(await liveInstrumentRow(h.db, NYK)).toMatchObject({ bid_bps: 5_100, stale: false });
    expect((await liveInstrumentRow(h.db, NYK))?.observed_at.getTime()).toBe(liveAtMs);
  });

  it("untracks an instrument no campaign uses once its override is removed, and clears its rows", async () => {
    const h = await setup();
    await waitTracked(h, [NYK]);
    await setOverride(h.db, HOU, DEMO_BOOK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, HOU))?.source).toBe("demo");
    });
    await removeOverride(h.db, HOU);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect(h.feed.trackedSymbols()).toEqual([NYK]);
    });
    await vi.waitFor(async () => {
      expect(await bookCacheRow(h.db, HOU)).toBeNull();
      expect((await liveInstrumentRow(h.db, HOU))?.stale).toBe(true);
    });
    expect(h.feed.getBook(HOU)).toBeNull();
  });

  it("ignores an invalid override, logs it once, and keeps serving the others", async () => {
    const h = await setup();
    await waitTracked(h, [NYK]);
    h.sockets.latest().receive(snapshot(NYK, 1, [["0.5600", "1.00"]], [["0.5700", "1.00"]]));
    // Crossed: best bid above best ask.
    await setOverride(h.db, NYK, {
      bids: [{ priceBps: 6_000, qty: "1000000" }],
      asks: [{ priceBps: 5_000, qty: "1000000" }],
    });
    // Bad shape: price as a string.
    await setOverride(h.db, MURR, { bids: [{ priceBps: "3000", qty: "1" }], asks: [] });
    await setOverride(h.db, HOU, DEMO_BOOK);

    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, HOU))?.source).toBe("demo");
    });
    await advance(h, 3_000);

    const invalid = h.log.lines.filter(
      (line) => line.msg === "demo override ignored: its book is invalid",
    );
    expect(invalid.map((line) => line.symbol).sort()).toEqual([MURR, NYK].sort());
    expect(h.feed.trackedSymbols()).toEqual([HOU, NYK].sort());
    // NYK keeps Gemini's books (the socket's, then REST's once the socket is silent for 3 s).
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).not.toBe(6_000n);
    expect((await bookCacheRow(h.db, NYK))?.source).not.toBe("demo");
    expect(h.feed.stats().ignoredWhileDemo).toBe(0);
    expect(await bookCacheRow(h.db, MURR)).toBeNull();

    // Fixed by the admin: served from the next pass, and a new invalid content is logged again.
    await setOverride(h.db, NYK, DEMO_BOOK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("demo");
    });
    await setOverride(h.db, NYK, { bids: "nope", asks: [] });
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect(
        h.log.lines.filter(
          (line) =>
            line.msg === "demo override ignored: its book is invalid" && line.symbol === NYK,
        ),
      ).toHaveLength(2);
    });
    // Invalid now means no override: Gemini's book is back.
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, NYK))?.source).not.toBe("demo");
    });
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).not.toBe(3_000n);
  });

  it("keeps running while demo_overrides cannot be read, lets the demo book turn stale, and serves it again once readable", async () => {
    let flaky: FlakyDemoBookStore | null = null;
    const h = await setup({
      campaigns: [
        [NYK, "live"],
        [MURR, "live"],
      ],
      demoStore: (store) => (flaky = new FlakyDemoBookStore(store)),
    });
    if (flaky === null) throw new Error("the feed was built without the demo store");
    const store: FlakyDemoBookStore = flaky;
    await waitTracked(h, [MURR, NYK]);
    await setOverride(h.db, NYK, DEMO_BOOK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("demo");
    });
    await advance(h, 1_000);

    store.failReads = true;
    const readsBefore = store.reads;
    // Let the pass in flight end: from now on no pass re-stamps the demo book.
    await advance(h, 1_250);
    const stampMs = h.feed.getBook(NYK)?.observedAtMs ?? 0;
    // The rest of the feed keeps working: another instrument's Gemini book is served and written.
    h.sockets.latest().receive(snapshot(MURR, 1, [["0.2100", "1.00"]], [["0.2300", "1.00"]]));
    await vi.waitFor(async () => {
      expect((await bookCacheRow(h.db, MURR))?.source).toBe("ws");
    });

    // Not stale before 10 s...
    await advance(h, stampMs + 9_500 - h.scheduler.now());
    expect(h.feed.isStale(NYK)).toBe(false);
    // ...stale after: the demo book was not re-stamped while the table could not be read.
    await advance(h, 1_500);
    expect(h.feed.isStale(NYK)).toBe(true);
    expect(h.feed.getBook(NYK)?.observedAtMs).toBe(stampMs);
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(3_000n);
    await vi.waitFor(async () => {
      expect((await liveInstrumentRow(h.db, NYK))?.stale).toBe(true);
    });
    expect(
      h.log.lines.filter((line) => line.msg === "instrument stale" && line.symbol === NYK),
    ).toHaveLength(1);
    // Every pass kept trying, the failure was logged once, and an unreadable table is not a
    // removed override: nothing was released.
    expect(store.reads - readsBefore).toBeGreaterThanOrEqual(10);
    expect(
      h.log.lines.filter(
        (line) => line.msg === "demo overrides could not be read, demo books not refreshed",
      ),
    ).toHaveLength(1);
    expect(store.releases).toEqual([]);
    expect(h.feed.trackedSymbols()).toEqual([MURR, NYK].sort());
    expect(h.feed.isStale(MURR)).toBe(false);

    // Readable again: the demo book is fresh again from the next pass.
    store.failReads = false;
    const backAtMs = h.scheduler.now();
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect(h.feed.isStale(NYK)).toBe(false);
    });
    expect(h.scheduler.now() - backAtMs).toBeLessThanOrEqual(1_250);
    expect(h.log.messages().filter((msg) => msg === "demo overrides readable again")).toHaveLength(
      1,
    );
    expect(h.feed.getBook(NYK)?.observedAtMs).toBeGreaterThan(stampMs + 10_000);
    await vi.waitFor(async () => {
      const live = await liveInstrumentRow(h.db, NYK);
      expect(live).toMatchObject({ bid_bps: 3_000, ask_bps: 3_400, stale: false });
      expect(live?.observed_at.getTime()).toBeGreaterThan(stampMs + 10_000);
    });
    const cached = await bookCacheRow(h.db, NYK);
    expect(cached?.source).toBe("demo");
    expect(cached?.observed_at.getTime()).toBeGreaterThan(stampMs + 10_000);
  });

  it("retries a release whose write failed on the next pass, and ends with the Gemini book", async () => {
    let flaky: FlakyDemoBookStore | null = null;
    const h = await setup({ demoStore: (store) => (flaky = new FlakyDemoBookStore(store)) });
    if (flaky === null) throw new Error("the feed was built without the demo store");
    const store: FlakyDemoBookStore = flaky;
    await waitTracked(h, [NYK]);
    await setOverride(h.db, NYK, DEMO_BOOK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("demo");
    });
    await advance(h, 2_000);
    h.sockets.latest().receive(snapshot(NYK, 7, [["0.4400", "3.00"]], [["0.4600", "2.00"]]));
    await advance(h, 250);

    store.failReleases = 1;
    await removeOverride(h.db, NYK);
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(4_400n);
    });
    await vi.waitFor(() => {
      expect(h.log.messages()).toContain("demo book release failed");
    });
    const failedAtMs = h.scheduler.now();
    // The failed write left the demo book in Postgres...
    const left = await bookCacheRow(h.db, NYK);
    expect(left?.source).toBe("demo");
    expect((await liveInstrumentRow(h.db, NYK))?.bid_bps).toBe(3_000);

    // ...and the next pass removes it, without waiting for a newer Gemini book.
    await vi.waitFor(async () => {
      await advance(h, 250);
      expect(await bookCacheRow(h.db, NYK)).toBeNull();
    });
    expect(h.scheduler.now() - failedAtMs).toBeLessThanOrEqual(1_250);
    expect(await liveInstrumentRow(h.db, NYK)).toMatchObject({ bid_bps: 3_000, stale: true });
    expect(store.releases).toHaveLength(2);
    expect(store.releases[1]).toEqual({
      symbol: NYK,
      demoObservedAtMs: store.releases[0]?.demoObservedAtMs,
      restored: false,
    });
    expect(h.log.messages().filter((msg) => msg === "demo book release failed")).toHaveLength(1);
    // Nothing is retried once the release went through.
    await advance(h, 1_000);
    expect(store.releases).toHaveLength(2);
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(4_400n);

    // The next Gemini book is written as usual: Postgres ends with Gemini's book, fresh.
    h.sockets.latest().receive(snapshot(NYK, 8, [["0.4500", "3.00"]], [["0.4700", "2.00"]]));
    const liveAtMs = h.scheduler.now();
    await advance(h, 500);
    await vi.waitFor(async () => {
      const row = await bookCacheRow(h.db, NYK);
      expect(row?.source).toBe("ws");
      expect(row?.observed_at.getTime()).toBe(liveAtMs);
    });
    expect(await liveInstrumentRow(h.db, NYK)).toMatchObject({
      bid_bps: 4_500,
      ask_bps: 4_700,
      stale: false,
    });
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(4_500n);
  });

  it("changes nothing when demo_overrides is empty", async () => {
    const withDemo = await setup();
    await waitTracked(withDemo, [NYK]);
    withDemo.sockets.latest().receive(snapshot(NYK, 1, [["0.5600", "1.00"]], [["0.5700", "1.00"]]));
    await advance(withDemo, 3_000);
    const demoRun = {
      stats: withDemo.feed.stats(),
      tracked: withDemo.feed.trackedSymbols(),
      events: withDemo.events.length,
      messages: withDemo.log.messages(),
      row: await bookCacheRow(withDemo.db, NYK),
      restUrls: [...withDemo.restUrls],
    };
    await stopFeed(withDemo);
    harness = null;
    await database?.drop();
    database = null;

    const plain = await setup({ demo: false });
    await waitTracked(plain, [NYK]);
    plain.sockets.latest().receive(snapshot(NYK, 1, [["0.5600", "1.00"]], [["0.5700", "1.00"]]));
    await advance(plain, 3_000);

    expect(demoRun.stats).toEqual(plain.feed.stats());
    expect(demoRun.tracked).toEqual(plain.feed.trackedSymbols());
    expect(demoRun.events).toBe(plain.events.length);
    expect(demoRun.messages).toEqual(plain.log.messages());
    expect(demoRun.restUrls).toEqual(plain.restUrls);
    const plainRow = await bookCacheRow(plain.db, NYK);
    expect(demoRun.row?.source).toBe(plainRow?.source);
    expect(demoRun.row?.bids).toEqual(plainRow?.bids);
  });
});

describe("parseDemoBook", () => {
  it("reads the documented shape", () => {
    expect(parseDemoBook(NYK, DEMO_BOOK, 42)).toEqual({
      instrumentSymbol: NYK,
      bids: [{ priceBps: 3_000n, qty: 50_000_000n }],
      asks: [{ priceBps: 3_400n, qty: 50_000_000n }],
      observedAtMs: 42,
    });
  });

  it.each([
    ["not an object", null],
    ["no asks", { bids: [] }],
    ["price out of range", { bids: [{ priceBps: 10_000, qty: "1" }], asks: [] }],
    ["fractional price", { bids: [{ priceBps: 30.5, qty: "1" }], asks: [] }],
    ["quantity not digits", { bids: [{ priceBps: 3_000, qty: "-1" }], asks: [] }],
    [
      "locked book",
      { bids: [{ priceBps: 3_000, qty: "1" }], asks: [{ priceBps: 3_000, qty: "1" }] },
    ],
  ])("refuses %s", (_name, raw) => {
    expect(() => parseDemoBook(NYK, raw, 0)).toThrow(DemoBookError);
  });

  it("ignores empty levels when checking for a crossed book", () => {
    const book = parseDemoBook(
      NYK,
      {
        bids: [
          { priceBps: 6_000, qty: "0" },
          { priceBps: 3_000, qty: "1" },
        ],
        asks: [{ priceBps: 4_000, qty: "1" }],
      },
      0,
    );
    expect(book.bids).toHaveLength(2);
  });
});
