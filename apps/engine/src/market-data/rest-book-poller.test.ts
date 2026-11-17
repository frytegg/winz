import { describe, expect, it } from "vitest";

import type { Book } from "@winz/shared";

import { ManualScheduler, recordingLogger } from "./book-test-support";
import type { BookTransportListener } from "./book-transport";
import { GeminiRestClient } from "./gemini-rest-client";
import { TokenBucket } from "./rate-limiter";
import { RestBookPoller, type RestBookPollerOptions } from "./rest-book-poller";
import { schedulerSleep } from "./scheduler";
import { fakeFetch, jsonResponse, type FakeResponse } from "./test-support";

const BOOK_BODY = {
  bids: [{ price: "0.55", amount: "100.0" }],
  asks: [{ price: "0.57", amount: "200.0" }],
};

function setup(
  options: {
    capacity?: number;
    refillPerMinute?: number;
    respond?: (url: string, call: number) => FakeResponse;
  } & Partial<Omit<RestBookPollerOptions, "client" | "logger" | "scheduler">> = {},
): {
  poller: RestBookPoller;
  scheduler: ManualScheduler;
  limiter: TokenBucket;
  urls: string[];
  books: Book[];
  connection: boolean[];
} {
  const scheduler = new ManualScheduler();
  const sleep = schedulerSleep(scheduler);
  const limiter = new TokenBucket({
    capacity: options.capacity ?? 1_000,
    refillPerMinute: options.refillPerMinute ?? 60_000,
    now: scheduler.now,
    sleep,
  });
  const http = fakeFetch(options.respond ?? (() => jsonResponse(BOOK_BODY)));
  const client = new GeminiRestClient({
    baseUrl: "https://gemini.test",
    logger: recordingLogger().logger,
    fetch: http.fetch,
    now: scheduler.now,
    sleep,
    limiter,
    maxAttempts: 1,
  });
  const books: Book[] = [];
  const connection: boolean[] = [];
  const listener: BookTransportListener = {
    onBook: (book) => books.push(book),
    onTrade: () => undefined,
    onConnectionChange: (connected) => connection.push(connected),
  };
  const poller = new RestBookPoller({
    client,
    logger: recordingLogger().logger,
    scheduler,
    minIntervalPerSymbolMs: options.minIntervalPerSymbolMs ?? 0,
    maxRequestsPerMinute: options.maxRequestsPerMinute ?? 6_000,
    idleCheckMs: options.idleCheckMs,
  });
  poller.start(listener);
  return { poller, scheduler, limiter, urls: http.urls, books, connection };
}

/** A request may be waiting on the limiter, whose sleeps run on the manual clock: keep it moving. */
async function stopPoller(poller: RestBookPoller, scheduler: ManualScheduler): Promise<void> {
  let done = false;
  const stopping = poller.stop().then(() => {
    done = true;
  });
  while (!done) await scheduler.advance(100);
  await stopping;
}

function countBySymbol(urls: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const url of urls) {
    const symbol = decodeURIComponent(url.split("/v1/book/")[1] ?? "");
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  return counts;
}

const symbols = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `GEMI-TEST-${index.toString().padStart(2, "0")}`);

describe("RestBookPoller", () => {
  it("shares a tight limiter fairly across many instruments: none starves", async () => {
    const instruments = symbols(7);
    const { poller, scheduler, urls, books } = setup({ capacity: 5, refillPerMinute: 30 });
    poller.setSymbols(new Set(instruments));
    await scheduler.advance(120_000);
    await stopPoller(poller, scheduler);

    // At most the burst plus two minutes of refill went out.
    expect(urls.length).toBeLessThanOrEqual(5 + 60 + 1);
    expect(urls.length).toBeGreaterThanOrEqual(60);
    const counts = [...countBySymbol(urls).values()];
    expect(counts).toHaveLength(7);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // The request in flight when the poller stopped is dropped.
    expect(books.length).toBeGreaterThanOrEqual(urls.length - 1);
  });

  it("leaves room for another user of the same limiter", async () => {
    const instruments = symbols(20);
    const { poller, scheduler, limiter, urls } = setup({ capacity: 5, refillPerMinute: 60 });
    poller.setSymbols(new Set(instruments));
    let otherServed = 0;
    // The catalogue sync wants 10 requests at once while the poller is busy.
    const other = Array.from({ length: 10 }, () =>
      limiter.acquire().then(() => {
        otherServed += 1;
      }),
    );
    await scheduler.advance(30_000);
    await Promise.all(other);
    expect(otherServed).toBe(10);
    await stopPoller(poller, scheduler);
    // Bucket total over 30 s: 5 + 30; the poller took the rest.
    expect(urls.length + otherServed).toBeLessThanOrEqual(5 + 30 + 1);
  });

  it("keeps under its own ceiling when the limiter would allow more", async () => {
    const { poller, scheduler, urls } = setup({ maxRequestsPerMinute: 60 });
    poller.setSymbols(new Set(symbols(3)));
    await scheduler.advance(60_000);
    await stopPoller(poller, scheduler);
    expect(urls.length).toBeLessThanOrEqual(61);
    expect(urls.length).toBeGreaterThanOrEqual(59);
  });

  it("polls one instrument no more often than its minimum interval", async () => {
    const { poller, scheduler, urls } = setup({ minIntervalPerSymbolMs: 2_000 });
    poller.setSymbols(new Set(symbols(1)));
    await scheduler.advance(60_000);
    await stopPoller(poller, scheduler);
    expect(urls.length).toBeLessThanOrEqual(31);
    expect(urls.length).toBeGreaterThanOrEqual(29);
  });

  it("polls only the instruments it is handed, and nothing when handed none", async () => {
    const { poller, scheduler, urls } = setup({ minIntervalPerSymbolMs: 1_000 });
    await scheduler.advance(10_000);
    expect(urls).toEqual([]);
    poller.setSymbols(new Set(["GEMI-A"]));
    await scheduler.advance(5_000);
    poller.setSymbols(new Set());
    const before = urls.length;
    await scheduler.advance(5_000);
    await stopPoller(poller, scheduler);
    expect(before).toBeGreaterThan(3);
    expect(urls.length).toBe(before);
  });

  it("reports failures and recovery as connection changes, and keeps polling", async () => {
    const { poller, scheduler, books, connection } = setup({
      minIntervalPerSymbolMs: 1_000,
      respond: (_url, call) => (call < 3 ? { status: 503, body: "down" } : jsonResponse(BOOK_BODY)),
    });
    poller.setSymbols(new Set(["GEMI-A"]));
    await scheduler.advance(10_000);
    await stopPoller(poller, scheduler);
    expect(connection).toEqual([false, true]);
    expect(books.length).toBeGreaterThan(3);
    expect(books[0]?.bids[0]).toEqual({ priceBps: 5500n, qty: 100_000_000n });
  });

  it("stops with no timer left", async () => {
    const { poller, scheduler } = setup({ minIntervalPerSymbolMs: 5_000 });
    poller.setSymbols(new Set(["GEMI-A"]));
    await scheduler.advance(1_000);
    await stopPoller(poller, scheduler);
    expect(scheduler.pendingTimers()).toBe(0);
  });
});
