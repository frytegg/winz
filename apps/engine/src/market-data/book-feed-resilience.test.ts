import { afterEach, describe, expect, it, vi } from "vitest";

import type { Book } from "@winz/shared";

import { BookFeed, type BookFeedRun } from "./book-feed";
import type { BookStore, MarkStaleOptions } from "./book-store";
import type { BookSource, BookTransport, BookTransportListener } from "./book-transport";
import { ManualScheduler, SPORTS_SYMBOLS, recordingLogger, settle } from "./book-test-support";

// The feed against a store and transports driven by hand: database failures and transport races
// that a real Postgres and the real transports cannot be made to produce on demand.

const [NYK, MURR] = SPORTS_SYMBOLS;

class HandTransport implements BookTransport {
  listener: BookTransportListener | null = null;
  connected: boolean;
  symbols: ReadonlySet<string> = new Set();

  constructor(
    readonly source: BookSource,
    connected: boolean,
  ) {
    this.connected = connected;
  }

  start(listener: BookTransportListener): void {
    this.listener = listener;
  }

  setSymbols(symbols: ReadonlySet<string>): void {
    this.symbols = new Set(symbols);
  }

  isConnected(): boolean {
    return this.connected;
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  book(symbol: string, bidBps: bigint, observedAtMs: number, sequence: number | null): void {
    this.listener?.onBook(
      {
        instrumentSymbol: symbol,
        bids: [{ priceBps: bidBps, qty: 1_000_000n }],
        asks: [{ priceBps: 9_000n, qty: 1_000_000n }],
        observedAtMs,
      },
      sequence,
    );
  }
}

class HandStore implements BookStore {
  tracked: string[] = [NYK];
  readonly written: { book: Book; source: BookSource }[] = [];
  readonly staleMarks: { symbol: string; options: MarkStaleOptions | undefined }[] = [];
  /** How many of the next markStale calls fail. */
  failMarkStale = 0;

  listTrackedSymbols(): Promise<string[]> {
    return Promise.resolve([...this.tracked]);
  }

  writeBook(book: Book, source: BookSource): Promise<void> {
    this.written.push({ book, source });
    return Promise.resolve();
  }

  markStale(symbol: string, options?: MarkStaleOptions): Promise<void> {
    this.staleMarks.push({ symbol, options });
    if (this.failMarkStale > 0) {
      this.failMarkStale -= 1;
      return Promise.reject(new Error("connection reset"));
    }
    return Promise.resolve();
  }
}

interface Rig {
  feed: BookFeed;
  run: BookFeedRun;
  controller: AbortController;
  scheduler: ManualScheduler;
  store: HandStore;
  ws: HandTransport;
  rest: HandTransport;
}

let rig: Rig | null = null;

afterEach(async () => {
  if (rig !== null) {
    rig.controller.abort();
    await rig.run.stopped;
    rig = null;
  }
});

async function startRig(tracked: string[] = [NYK]): Promise<Rig> {
  const scheduler = new ManualScheduler();
  const store = new HandStore();
  store.tracked = tracked;
  const ws = new HandTransport("ws", true);
  const rest = new HandTransport("rest", true);
  const feed = new BookFeed({ store, ws, rest, logger: recordingLogger().logger, scheduler });
  const controller = new AbortController();
  const run = feed.start({ signal: controller.signal });
  rig = { feed, run, controller, scheduler, store, ws, rest };
  await vi.waitFor(() => {
    expect(feed.trackedSymbols()).toEqual([...tracked].sort());
  });
  return rig;
}

describe("BookFeed, REST books while the socket is live", () => {
  it("keeps the socket book when a REST answer arrives just after it", async () => {
    const r = await startRig();
    r.ws.book(NYK, 5_600n, r.scheduler.now(), 10);
    await r.scheduler.advance(50);
    // A gap-fill request sent before that socket book comes back now, stamped with its arrival.
    r.rest.book(NYK, 4_000n, r.scheduler.now(), null);
    expect(r.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(5_600n);
    expect(r.feed.stats().ignoredRestWhileWsLive).toBe(1);
    expect(r.feed.stats().accepted.rest).toBe(0);
  });

  it("takes the REST book once the socket has been silent on the instrument for the gap", async () => {
    const r = await startRig();
    r.ws.book(NYK, 5_600n, r.scheduler.now(), 10);
    await r.scheduler.advance(3_100);
    r.rest.book(NYK, 4_000n, r.scheduler.now(), null);
    expect(r.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(4_000n);
  });

  it("takes the REST book at once while the socket is down", async () => {
    const r = await startRig();
    r.ws.book(NYK, 5_600n, r.scheduler.now(), 10);
    r.ws.connected = false;
    r.ws.listener?.onConnectionChange(false);
    await r.scheduler.advance(50);
    r.rest.book(NYK, 4_000n, r.scheduler.now(), null);
    expect(r.feed.getBook(NYK)?.bids[0]?.priceBps).toBe(4_000n);
  });
});

describe("BookFeed, stale flag in Postgres", () => {
  it("retries a failed stale flag on the next watchdog tick until it is written", async () => {
    const r = await startRig();
    r.ws.book(NYK, 5_600n, r.scheduler.now(), 1);
    r.store.failMarkStale = 2;
    await r.scheduler.advance(10_600);
    expect(r.feed.isStale(NYK)).toBe(true);
    await r.scheduler.advance(1_000);
    await settle();
    expect(r.store.staleMarks.map((mark) => mark.symbol)).toEqual([NYK, NYK, NYK]);
    expect(r.feed.stats().failedStaleMarks).toBe(2);
    // Written: no more attempts.
    await r.scheduler.advance(3_000);
    expect(r.store.staleMarks).toHaveLength(3);
  });

  it("stops retrying once a new book makes the instrument fresh", async () => {
    const r = await startRig();
    r.ws.book(NYK, 5_600n, r.scheduler.now(), 1);
    r.store.failMarkStale = 1_000;
    await r.scheduler.advance(11_000);
    const attempts = r.store.staleMarks.length;
    expect(attempts).toBeGreaterThan(0);
    r.ws.book(NYK, 5_700n, r.scheduler.now(), 2);
    await r.scheduler.advance(3_000);
    expect(r.store.staleMarks).toHaveLength(attempts);
    expect(r.feed.isStale(NYK)).toBe(false);
  });

  it("on shutdown flags stale each row it wrote last, bounded by that book's time", async () => {
    const r = await startRig([NYK, MURR]);
    const observedAtMs = r.scheduler.now();
    r.ws.book(NYK, 5_600n, observedAtMs, 1);
    await settle();
    expect(r.store.written).toHaveLength(1);
    expect(r.store.staleMarks).toEqual([]);
    r.controller.abort();
    await r.run.stopped;
    rig = null;
    // MURR never got a book from this feed: its row, if any, belongs to someone else.
    expect(r.store.staleMarks).toEqual([
      { symbol: NYK, options: { observedAtOrBeforeMs: observedAtMs } },
    ]);
    expect(r.scheduler.pendingTimers()).toBe(0);
  });
});
