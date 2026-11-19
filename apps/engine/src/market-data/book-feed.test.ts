import { afterEach, describe, expect, it, vi } from "vitest";

import { BOOK_STALE_AFTER_MS } from "@winz/shared";

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
  wsFixtureFrames,
  wsFixtureRows,
  type FakeSocketFactory,
  type RecordingLogger,
} from "./book-test-support";
import { GeminiRestClient } from "./gemini-rest-client";
import { TokenBucket } from "./rate-limiter";
import { RestBookPoller } from "./rest-book-poller";
import { schedulerSleep } from "./scheduler";
import { fakeFetch, jsonResponse, type FakeResponse } from "./test-support";
import { WsBookTransport } from "./ws-book-transport";

const [NYK, MURR, HOU] = SPORTS_SYMBOLS;
const TRADE_SYMBOL = "GEMI-ETH15M2611171630-UP";

const REST_BODY = {
  bids: [{ price: "0.52", amount: "10.0" }],
  asks: [{ price: "0.6", amount: "20.0" }],
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

interface SetupOptions {
  /** Campaign statuses to create, by instrument. */
  campaigns?: [string, string][];
  respond?: (url: string, call: number) => FakeResponse;
  limiter?: { capacity: number; refillPerMinute: number };
  withWebSocket?: boolean;
  /** Opens the socket at once. */
  socketUp?: boolean;
}

async function setup(options: SetupOptions = {}): Promise<Harness> {
  database = await createTestDatabase();
  const { db } = database;
  await seedInstruments(db, [...SPORTS_SYMBOLS, TRADE_SYMBOL]);
  for (const [symbol, status] of options.campaigns ?? [[NYK, "live"]]) {
    await seedCampaign(db, symbol, status);
  }
  // Wall-clock start: tracked_instruments rows compare expires_at with the feed's clock.
  const scheduler = new ManualScheduler(Date.now());
  const sleep = schedulerSleep(scheduler);
  const log = recordingLogger();
  const sockets = fakeSocketFactory();
  const http = fakeFetch(options.respond ?? (() => jsonResponse(REST_BODY)));
  const limiter = new TokenBucket({
    capacity: options.limiter?.capacity ?? 1_000,
    refillPerMinute: options.limiter?.refillPerMinute ?? 60_000,
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
  const ws =
    options.withWebSocket === false
      ? null
      : new WsBookTransport({
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
  });
  const events: BookFeedEvent[] = [];
  feed.subscribe((event) => events.push(event));
  const controller = new AbortController();
  const run = feed.start({ signal: controller.signal });
  harness = { db, feed, run, controller, scheduler, sockets, restUrls: http.urls, log, events };
  // The socket connects as soon as the feed starts; tests that want it up open it before the
  // tracked set is read, otherwise the first watchdog tick rightly falls back to REST.
  if (options.socketUp === true) sockets.latest().open();
  return harness;
}

async function stopFeed(h: Harness): Promise<void> {
  h.controller.abort();
  let done = false;
  const stopped = h.run.stopped.then(() => {
    done = true;
  });
  // A REST request may wait on the limiter, whose sleeps run on the manual clock.
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

async function bookCacheRow(
  db: Db,
  symbol: string,
): Promise<{ bids: unknown; asks: unknown; observed_at: Date; source: string } | null> {
  const rows = await db<{ bids: unknown; asks: unknown; observed_at: Date; source: string }[]>`
    select bids, asks, observed_at, source from book_cache where symbol = ${symbol}
  `;
  return rows[0] ?? null;
}

describe("BookFeed", () => {
  it("writes a recorded socket book to book_cache and live_instruments", async () => {
    const h = await setup({ socketUp: true });
    await waitTracked(h, [NYK]);
    const frame = wsFixtureFrames("sports-depth10").find(
      (text) => text.includes("lastUpdateId") && text.includes("nyk-tor-m-nyk"),
    );
    h.sockets.latest().receive(frame ?? "");
    const observedAtMs = h.scheduler.now();

    await vi.waitFor(async () => {
      expect(await bookCacheRow(h.db, NYK)).not.toBeNull();
    });
    const row = await bookCacheRow(h.db, NYK);
    expect(row?.source).toBe("ws");
    expect(row?.observed_at.getTime()).toBe(observedAtMs);
    expect(row?.bids).toEqual([
      { priceBps: 5600, qty: "953000000" },
      { priceBps: 5500, qty: "1623000000" },
      { priceBps: 5400, qty: "450000000" },
      { priceBps: 5200, qty: "500000000" },
      { priceBps: 5100, qty: "750000000" },
    ]);
    expect(row?.asks).toEqual([
      { priceBps: 5700, qty: "4250000000" },
      { priceBps: 5800, qty: "2497000000" },
      { priceBps: 5900, qty: "550000000" },
    ]);
    const live = await liveInstrumentRow(h.db, NYK);
    expect(live).toMatchObject({ bid_bps: 5600, ask_bps: 5700, mid_bps: 5650, stale: false });
    expect(live?.observed_at.getTime()).toBe(observedAtMs);

    // The reader gives back exactly the book held in memory.
    expect(await readCachedBook(h.db, NYK)).toEqual(h.feed.getBook(NYK));
    expect(h.events.filter((event) => event.kind === "book")).toHaveLength(1);
  });

  it("floors the mid, keeps 10 levels a side and drops empty ones", async () => {
    const h = await setup({ socketUp: true });
    await waitTracked(h, [NYK]);
    const bids: [string, string][] = Array.from({ length: 12 }, (_, index) => [
      `0.${(40 + index).toString()}01`,
      index === 11 ? "0.00" : "1.00",
    ]);
    h.sockets.latest().receive(snapshot(NYK, 1, bids, [["0.6000", "2.00"]]));
    await vi.waitFor(async () => {
      expect(await liveInstrumentRow(h.db, NYK)).not.toBeNull();
    });
    // Best bid 0.5001 (the 0.5101 level is empty), ask 0.6000: mid 5500.5 floors to 5500.
    expect(await liveInstrumentRow(h.db, NYK)).toMatchObject({
      bid_bps: 5001,
      ask_bps: 6000,
      mid_bps: 5500,
    });
    const book = await readCachedBook(h.db, NYK);
    expect(book?.bids).toHaveLength(10);
    expect(book?.bids[0]?.priceBps).toBe(5001n);
    expect(book?.bids[9]?.priceBps).toBe(4101n);
  });

  it("replays the recorded session: every snapshot (all 750 ms or more apart) is written, last book wins", async () => {
    const h = await setup({
      campaigns: SPORTS_SYMBOLS.map((symbol) => [symbol, "live"]),
      socketUp: true,
    });
    await waitTracked(h, SPORTS_SYMBOLS);
    const rows = wsFixtureRows("sports-depth10").filter((row) => row.kind === "msg");
    let previousMs = rows[0]?.t ?? 0;
    const lastSnapshot = new Map<string, string>();
    for (const row of rows) {
      await h.scheduler.advance(row.t - previousMs, 250);
      previousMs = row.t;
      const text = row.data as string;
      h.sockets.latest().receive(text);
      if (text.includes("lastUpdateId")) {
        lastSnapshot.set((JSON.parse(text) as { symbol: string }).symbol, text);
        // Let Postgres keep up with the recorded pace, so the count below does not depend on its speed.
        await vi.waitFor(() => {
          expect(h.feed.stats().written.ws).toBe(h.feed.stats().accepted.ws);
        });
      }
    }
    const snapshots = rows.filter((row) => (row.data as string).includes("lastUpdateId")).length;
    expect(h.feed.stats().accepted.ws).toBe(snapshots);
    expect(h.feed.stats().written.ws).toBe(snapshots);
    expect(h.feed.stats().written.rest).toBe(0);
    expect(h.restUrls).toEqual([]);
    for (const symbol of SPORTS_SYMBOLS) {
      const last = JSON.parse(lastSnapshot.get(symbol.toLowerCase()) ?? "{}") as {
        bids: [string, string][];
      };
      const live = await liveInstrumentRow(h.db, symbol);
      expect(live?.bid_bps).toBe(Math.round(Number(last.bids[0]?.[0]) * 10_000));
      expect(live?.stale).toBe(false);
    }
  });

  it("throttles writes to one per 500 ms per instrument and always writes the latest state", async () => {
    const h = await setup({ socketUp: true });
    await waitTracked(h, [NYK]);
    h.sockets.latest().receive(snapshot(NYK, 1, [["0.5000", "1.00"]], [["0.6000", "1.00"]]));
    await vi.waitFor(() => {
      expect(h.feed.stats().written.ws).toBe(1);
    });
    for (let id = 2; id <= 5; id += 1) {
      await h.scheduler.advance(100);
      h.sockets
        .latest()
        .receive(snapshot(NYK, id, [[`0.5${id.toString()}00`, "1.00"]], [["0.6000", "1.00"]]));
    }
    // 400 ms after the first write: four books accepted, none written yet.
    await h.scheduler.advance(0);
    expect(h.feed.stats().accepted.ws).toBe(5);
    expect(h.feed.stats().written.ws).toBe(1);
    expect((await liveInstrumentRow(h.db, NYK))?.bid_bps).toBe(5000);

    await h.scheduler.advance(100);
    // The counter moves when the feed's write call returns, which can be just after the row is
    // visible to another connection: both are waited for, and the count must end at exactly 2.
    await vi.waitFor(async () => {
      expect((await liveInstrumentRow(h.db, NYK))?.bid_bps).toBe(5500);
      expect(h.feed.stats().written.ws).toBe(2);
    });
    expect(h.feed.stats().accepted.ws).toBe(5);
    expect(h.feed.stats().written.ws).toBe(2);
  });

  it("subscribes to every tracked instrument again after a reconnect", async () => {
    const h = await setup({ campaigns: SPORTS_SYMBOLS.map((symbol) => [symbol, "live"]) });
    await waitTracked(h, SPORTS_SYMBOLS);
    h.sockets.latest().open();
    h.sockets.latest().serverClose(1006, "simulated cut");
    await h.scheduler.advance(1_000);
    expect(h.sockets.sockets).toHaveLength(2);
    h.sockets.latest().open();
    const lowered = new Set(
      h.sockets
        .latest()
        .subscribedStreams()
        .map((stream) => stream.split("@")[0]),
    );
    expect(lowered).toEqual(new Set(SPORTS_SYMBOLS.map((symbol) => symbol.toLowerCase())));
    expect(h.log.messages()).toContain("gemini websocket disconnected");
  });

  it("falls back to REST while the socket is down and back to the socket when it returns", async () => {
    const h = await setup();
    await waitTracked(h, [NYK]);
    // The socket never opens: REST takes over at the next watchdog tick.
    await h.scheduler.advance(2_000);
    await vi.waitFor(async () => {
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("rest");
    });
    expect(h.restUrls.length).toBeGreaterThan(0);
    expect((await liveInstrumentRow(h.db, NYK))?.bid_bps).toBe(5200);

    h.sockets.latest().open();
    expect(h.log.messages()).toContain("book feed: websocket up, REST fallback off");
    let id = 10;
    for (let tick = 0; tick < 20; tick += 1) {
      h.sockets.latest().receive(snapshot(NYK, id, [["0.5500", "1.00"]], [["0.5700", "1.00"]]));
      id += 1;
      await h.scheduler.advance(500);
    }
    const restCallsWhileUp = h.restUrls.length;
    for (let tick = 0; tick < 10; tick += 1) {
      h.sockets.latest().receive(snapshot(NYK, id, [["0.5500", "1.00"]], [["0.5700", "1.00"]]));
      id += 1;
      await h.scheduler.advance(500);
    }
    expect(h.restUrls.length).toBe(restCallsWhileUp);
    await vi.waitFor(async () => {
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("ws");
    });

    // Cut again: REST again.
    h.sockets.latest().serverClose(1006);
    expect(h.log.messages()).toContain("book feed: websocket down, falling back to REST");
    await h.scheduler.advance(600);
    expect(h.restUrls.length).toBeGreaterThan(restCallsWhileUp);
  });

  it("fills from REST an instrument the socket stays silent on, while the socket is up", async () => {
    const h = await setup({
      campaigns: [
        [NYK, "live"],
        [MURR, "live"],
      ],
      socketUp: true,
    });
    await waitTracked(h, [NYK, MURR]);
    for (let tick = 0; tick < 10; tick += 1) {
      h.sockets
        .latest()
        .receive(snapshot(NYK, tick + 1, [["0.5500", "1.00"]], [["0.5700", "1.00"]]));
      await h.scheduler.advance(500);
    }
    const polled = new Set(
      h.restUrls.map((url) => decodeURIComponent(url.split("/v1/book/")[1] ?? "")),
    );
    expect(polled).toEqual(new Set([MURR]));
    expect(h.log.messages()).toContain("no websocket book, filling from REST");
  });

  it("shares a small REST budget fairly across instruments when the socket is down", async () => {
    const h = await setup({
      campaigns: SPORTS_SYMBOLS.map((symbol) => [symbol, "live"]),
      limiter: { capacity: 2, refillPerMinute: 12 },
    });
    await waitTracked(h, SPORTS_SYMBOLS);
    await h.scheduler.advance(60_000, 500);
    const counts = new Map<string, number>();
    for (const url of h.restUrls) {
      const symbol = decodeURIComponent(url.split("/v1/book/")[1] ?? "");
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    expect(h.restUrls.length).toBeLessThanOrEqual(2 + 12 + 1);
    expect([...counts.keys()].sort()).toEqual([...SPORTS_SYMBOLS].sort());
    const values = [...counts.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });

  it("flags an instrument stale within 11 s of its last book, and fresh again on the next", async () => {
    const h = await setup({ respond: () => ({ status: 503, body: "down" }), socketUp: true });
    await waitTracked(h, [NYK]);
    h.sockets.latest().receive(snapshot(NYK, 1, [["0.5000", "1.00"]], [["0.6000", "1.00"]]));
    const lastBookAtMs = h.scheduler.now();
    await vi.waitFor(async () => {
      expect((await liveInstrumentRow(h.db, NYK))?.stale).toBe(false);
    });

    await h.scheduler.advance(BOOK_STALE_AFTER_MS - 100);
    expect(h.feed.isStale(NYK)).toBe(false);
    await h.scheduler.advance(1_000);
    expect(h.scheduler.now() - lastBookAtMs).toBeLessThan(11_000);
    expect(h.feed.isStale(NYK)).toBe(true);
    await vi.waitFor(async () => {
      expect((await liveInstrumentRow(h.db, NYK))?.stale).toBe(true);
    });
    expect(h.log.messages()).toContain("instrument stale");

    h.sockets.latest().receive(snapshot(NYK, 2, [["0.5100", "1.00"]], [["0.6000", "1.00"]]));
    expect(h.feed.isStale(NYK)).toBe(false);
    await vi.waitFor(async () => {
      expect(await liveInstrumentRow(h.db, NYK)).toMatchObject({ stale: false, bid_bps: 5100 });
    });
    expect(h.log.messages()).toContain("instrument fresh");
  });

  it("flags stale a tracked instrument that never gets a book", async () => {
    const h = await setup({ respond: () => ({ status: 503, body: "down" }) });
    await h.db`
      insert into live_instruments (symbol, bid_bps, ask_bps, mid_bps, observed_at, stale)
      values (${NYK}, 5000, 6000, 5500, now() - interval '1 hour', false)
    `;
    await waitTracked(h, [NYK]);
    await h.scheduler.advance(BOOK_STALE_AFTER_MS + 600);
    await vi.waitFor(async () => {
      expect((await liveInstrumentRow(h.db, NYK))?.stale).toBe(true);
    });
  });

  it("follows live and paused campaigns plus unexpired tracked_instruments", async () => {
    const h = await setup({
      campaigns: [
        [NYK, "live"],
        [MURR, "paused"],
        [HOU, "draft"],
      ],
    });
    await waitTracked(h, [NYK, MURR]);
    const expiresAt = new Date(h.scheduler.now() + 5_000);
    await h.db`insert into tracked_instruments (symbol, expires_at) values (${HOU}, ${expiresAt})`;
    await h.scheduler.advance(3_000);
    await waitTracked(h, [NYK, MURR, HOU]);
    h.sockets.latest().open();
    expect(
      new Set(
        h.sockets
          .latest()
          .subscribedStreams()
          .map((stream) => stream.split("@")[0]),
      ),
    ).toEqual(new Set(SPORTS_SYMBOLS.map((symbol) => symbol.toLowerCase())));
    h.sockets.latest().receive(snapshot(HOU, 1, [["0.9000", "1.00"]], [["0.9500", "1.00"]]));
    await vi.waitFor(async () => {
      expect((await liveInstrumentRow(h.db, HOU))?.stale).toBe(false);
    });

    // The tracked row expires and the paused campaign closes: both leave the set.
    await h.db`update campaigns set status = 'sales_closed' where instrument = ${MURR}`;
    await h.scheduler.advance(3_000);
    await waitTracked(h, [NYK]);
    expect(
      h.sockets
        .latest()
        .unsubscribedStreams()
        .map((stream) => stream.split("@")[0])
        .sort(),
    ).toEqual(
      [MURR.toLowerCase(), MURR.toLowerCase(), HOU.toLowerCase(), HOU.toLowerCase()].sort(),
    );
    expect(h.feed.getBook(HOU)).toBeNull();
    await vi.waitFor(async () => {
      expect((await liveInstrumentRow(h.db, HOU))?.stale).toBe(true);
    });
  });

  it("ignores a book older than the one it holds", async () => {
    const h = await setup({ socketUp: true });
    await waitTracked(h, [NYK]);
    h.sockets.latest().receive(snapshot(NYK, 100, [["0.5000", "1.00"]], [["0.6000", "1.00"]]));
    await h.scheduler.advance(100);
    h.sockets.latest().receive(snapshot(NYK, 99, [["0.4000", "1.00"]], [["0.6000", "1.00"]]));
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(5000n);
    expect(h.feed.stats().ignoredOutOfOrder).toBe(1);
    // The same update id again is the same book, seen later: accepted as a refresh.
    h.sockets.latest().receive(snapshot(NYK, 100, [["0.5000", "1.00"]], [["0.6000", "1.00"]]));
    expect(h.feed.getBook(NYK)?.observedAtMs).toBe(h.scheduler.now());
    await h.scheduler.advance(1_000);
    await vi.waitFor(async () => {
      expect((await liveInstrumentRow(h.db, NYK))?.bid_bps).toBe(5000);
    });
  });

  it("logs and skips a malformed frame without stopping the feed", async () => {
    const h = await setup({ socketUp: true });
    await waitTracked(h, [NYK]);
    h.sockets.latest().receive("garbage");
    h.sockets
      .latest()
      .receive(
        '{"lastUpdateId":1,"symbol":"gemi-nba-2611180030-nyk-tor-m-nyk","bids":"x","asks":[]}',
      );
    h.sockets.latest().receive(snapshot(NYK, 2, [["0.5000", "1.00"]], [["0.6000", "1.00"]]));
    expect(
      h.log.messages().filter((message) => message === "gemini websocket frame skipped"),
    ).toHaveLength(2);
    expect(h.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(5000n);
    expect(h.sockets.sockets).toHaveLength(1);
  });

  it("passes trade prints of followed instruments to subscribers", async () => {
    const h = await setup({ campaigns: [], socketUp: true });
    await h.db`
      insert into tracked_instruments (symbol, expires_at) values (${TRADE_SYMBOL}, ${new Date(h.scheduler.now() + 600_000)})
    `;
    await h.scheduler.advance(3_000);
    await waitTracked(h, [TRADE_SYMBOL]);
    for (const frame of wsFixtureFrames("crypto-trades")) h.sockets.latest().receive(frame);
    const trades = h.events.flatMap((event) => (event.kind === "trade" ? [event.trade] : []));
    expect(trades).toHaveLength(3);
    expect(trades[0]).toEqual({
      instrumentSymbol: TRADE_SYMBOL,
      priceBps: 3000n,
      qty: 5_000_000n,
      atMs: 1_794_932_625_041,
    });
  });

  it("runs on REST alone when built without a socket", async () => {
    const h = await setup({ withWebSocket: false });
    await waitTracked(h, [NYK]);
    await h.scheduler.advance(1_000);
    await vi.waitFor(async () => {
      expect((await bookCacheRow(h.db, NYK))?.source).toBe("rest");
    });
  });

  it("stops on abort with no timer left, after writing the latest pending book", async () => {
    const h = await setup({ socketUp: true });
    await waitTracked(h, [NYK]);
    h.sockets.latest().receive(snapshot(NYK, 1, [["0.5000", "1.00"]], [["0.6000", "1.00"]]));
    await h.scheduler.advance(100);
    h.sockets.latest().receive(snapshot(NYK, 2, [["0.5300", "1.00"]], [["0.6000", "1.00"]]));
    await stopFeed(h);
    harness = null;
    expect(h.scheduler.pendingTimers()).toBe(0);
    expect(h.sockets.latest().closedByClient).toBe(true);
    expect((await liveInstrumentRow(h.db, NYK))?.bid_bps).toBe(5300);
    expect(h.log.messages()).toContain("book feed stopped");
    // Nothing runs any more.
    const written = h.feed.stats().written.ws;
    await h.scheduler.advance(30_000);
    expect(h.feed.stats().written.ws).toBe(written);
    expect(h.scheduler.pendingTimers()).toBe(0);
  });

  it("stops at once when started with an aborted signal", async () => {
    const h = await setup();
    const controller = new AbortController();
    controller.abort();
    const other = new BookFeed({
      store: new PgBookStore(h.db),
      ws: null,
      rest: new RestBookPoller({
        client: { getBook: () => Promise.reject(new Error("unused")) },
        logger: h.log.logger,
      }),
      logger: h.log.logger,
    });
    await other.start({ signal: controller.signal }).stopped;
  });
});
