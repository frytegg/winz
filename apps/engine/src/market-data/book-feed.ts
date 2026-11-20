import type { Logger } from "pino";

import { BOOK_STALE_AFTER_MS, type Book } from "@winz/shared";

import type { Db } from "../db";
import type { LoopHeartbeat } from "../health/loops";
import { wsBookSocketFactory, type WsBookSocketOptions } from "./book-socket";
import { PgBookStore, type BookStore, type MarkStaleOptions } from "./book-store";
import type {
  BookSource,
  BookTransport,
  BookTransportListener,
  TradePrint,
} from "./book-transport";
import { parseDemoBook, PgDemoBookStore, type DemoBookStore } from "./demo-book-store";
import { describeError } from "./errors";
import { RestBookPoller, type BookFetcher } from "./rest-book-poller";
import { systemScheduler, type CancelTimer, type Scheduler } from "./scheduler";
import { WsBookTransport, type DepthStream } from "./ws-book-transport";
import { BOOK_DEPTH } from "./ws-messages";

export type BookFeedEvent =
  { kind: "book"; book: Book; source: BookSource } | { kind: "trade"; trade: TradePrint };

export type BookFeedListener = (event: BookFeedEvent) => void;

export interface BookFeedStats {
  /** Books accepted into memory, by transport. */
  accepted: Record<BookSource, number>;
  /** Books written to book_cache and live_instruments, by transport. */
  written: Record<BookSource, number>;
  /** Books dropped because they were older than the one held. */
  ignoredOutOfOrder: number;
  /**
   * REST books dropped because the socket is up and gave this instrument a book within `wsGapMs`:
   * a REST answer has no sequence and may describe the market from before that socket book.
   */
  ignoredRestWhileWsLive: number;
  /** live_instruments.stale updates that failed (each is retried on the next watchdog tick). */
  failedStaleMarks: number;
  /** Gemini books (socket or REST) of an instrument whose demo book was in force, set aside. */
  ignoredWhileDemo: number;
  trades: number;
  failedWrites: number;
}

export interface BookFeedOptions {
  store: BookStore;
  /** REST fallback and gap filler. */
  rest: BookTransport;
  /** Primary transport; null runs on REST alone. */
  ws: BookTransport | null;
  logger: Logger;
  scheduler?: Scheduler;
  /** How often the tracked set is read from Postgres. */
  trackedRefreshMs?: number;
  /** How often staleness and REST gap filling are checked. */
  watchdogMs?: number;
  /** Minimum time between two writes of one instrument; the latest state is always written. */
  writeThrottleMs?: number;
  staleAfterMs?: number;
  /** With the socket up, an instrument without a socket book for this long is polled over REST. */
  wsGapMs?: number;
  /**
   * Demo books (SPEC MDB-4, demo_overrides). Absent or null: no demo mode, the feed behaves as
   * if the table did not exist.
   */
  demo?: DemoBookStore | null;
  /** How often demo_overrides is read and the demo books re-stamped. Default 1 000. */
  demoRefreshMs?: number;
}

export interface BookFeedRun {
  /** Resolves once the feed has stopped: signal aborted, transports closed, pending writes done. */
  stopped: Promise<void>;
}

interface HeldBook {
  book: Book;
  source: BookSource;
}

interface StaleMark {
  options: MarkStaleOptions;
  failures: number;
  inFlight: boolean;
}

interface WriteState {
  lastWriteAtMs: number;
  dirty: boolean;
  cancelTimer: CancelTimer | null;
  writtenObservedAtMs: number;
}

/**
 * MD-2: live books of every instrument a campaign (live, paused, or sales closed and not settled
 * yet: the game is on) or the web app (tracked_instruments) needs.
 *
 * Books come from the WebSocket when it is up and from REST polling otherwise, or for instruments
 * the socket has been silent on for `wsGapMs`. Every accepted book is held in memory (`getBook`,
 * `subscribe`) and written, at most once per `writeThrottleMs` per instrument, to book_cache and
 * live_instruments. A watchdog flags an instrument stale once its book is older than 10 s.
 *
 * Demo mode (MDB-4, option `demo`): a small layer inside the feed, not a transport, because a
 * demo book is not something the feed asks for, it is something the feed must obey. Every
 * `demoRefreshMs` the valid demo_overrides books are read; each one is THE book of its
 * instrument: published with source 'demo', written to book_cache (source 'demo') and
 * live_instruments, and re-stamped with the current time on every pass so it never turns stale
 * while the row exists. Its instrument is tracked even if no campaign uses it. Gemini books of
 * that instrument keep their ordering checks but are set aside (`ignoredWhileDemo`); the latest
 * one is kept so that, the moment the row is removed, it replaces the demo book in memory and in
 * Postgres (`DemoBookStore.releaseDemoBook`) without waiting for the demo book to age out. An
 * invalid row is ignored (as if absent) and logged once per distinct content.
 */
export class BookFeed {
  private readonly store: BookStore;
  private readonly rest: BookTransport;
  private readonly ws: BookTransport | null;
  private readonly logger: Logger;
  private readonly scheduler: Scheduler;
  private readonly trackedRefreshMs: number;
  private readonly watchdogMs: number;
  private readonly writeThrottleMs: number;
  private readonly staleAfterMs: number;
  private readonly wsGapMs: number;

  private readonly tracked = new Map<string, { sinceMs: number }>();
  private readonly books = new Map<string, HeldBook>();
  private readonly lastSequence = new Map<string, number>();
  /** Last socket book, or the moment the socket became responsible for the instrument. */
  private readonly wsCoveredAtMs = new Map<string, number>();
  private readonly stale = new Set<string>();
  /** Stale flags not yet confirmed in Postgres: retried on every watchdog tick until one succeeds. */
  private readonly staleMarks = new Map<string, StaleMark>();
  /** Instruments polled over REST while the socket is up (gap filling), for transition logs. */
  private readonly gapFilled = new Set<string>();
  /** Whether the feed currently runs on REST because the socket is down (or not yet up). */
  private onRestFallback = false;
  private readonly writes = new Map<string, WriteState>();
  private readonly dbChains = new Map<string, Promise<void>>();
  private readonly listeners = new Set<BookFeedListener>();
  private readonly demo: DemoBookStore | null;
  private readonly demoRefreshMs: number;
  /** Instruments whose demo book is in force. */
  private readonly demoActive = new Set<string>();
  /** The latest Gemini book of each instrument in demo, restored when the override goes. */
  private readonly liveShadow = new Map<string, HeldBook>();
  /** Releases whose Postgres write failed, retried on the next demo pass: symbol → demo stamp. */
  private readonly pendingReleases = new Map<string, number>();
  /** Invalid demo rows already logged: symbol → the raw content that was logged. */
  private readonly invalidDemoLogged = new Map<string, string>();
  /** The tracked set as Postgres last gave it (campaigns and tracked_instruments). */
  private storeTracked: ReadonlySet<string> = new Set<string>();
  private demoInFlight: Promise<void> = Promise.resolve();
  private demoFailing = false;
  private cancelDemo: CancelTimer | null = null;
  private readonly counters: BookFeedStats = {
    accepted: { ws: 0, rest: 0, demo: 0 },
    written: { ws: 0, rest: 0, demo: 0 },
    ignoredOutOfOrder: 0,
    ignoredRestWhileWsLive: 0,
    failedStaleMarks: 0,
    ignoredWhileDemo: 0,
    trades: 0,
    failedWrites: 0,
  };
  private started = false;
  private stopping = false;
  private refreshHeartbeat: LoopHeartbeat | undefined;
  private refreshInFlight: Promise<void> = Promise.resolve();
  private refreshFailing = false;
  private cancelRefresh: CancelTimer | null = null;
  private cancelWatchdog: CancelTimer | null = null;

  constructor(options: BookFeedOptions) {
    this.store = options.store;
    this.rest = options.rest;
    this.ws = options.ws;
    this.logger = options.logger;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.trackedRefreshMs = options.trackedRefreshMs ?? 3_000;
    this.watchdogMs = options.watchdogMs ?? 500;
    this.writeThrottleMs = options.writeThrottleMs ?? 500;
    this.staleAfterMs = options.staleAfterMs ?? BOOK_STALE_AFTER_MS;
    this.wsGapMs = options.wsGapMs ?? 3_000;
    this.demo = options.demo ?? null;
    this.demoRefreshMs = options.demoRefreshMs ?? 1_000;
  }

  /** The latest book of a followed instrument, or null. Check `observedAtMs` before pricing on it. */
  getBook(symbol: string): Book | null {
    return this.books.get(symbol)?.book ?? null;
  }

  /** Called on every accepted book and every trade print of a followed instrument. Returns the unsubscribe. */
  subscribe(listener: BookFeedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  trackedSymbols(): string[] {
    return [...this.tracked.keys()].sort();
  }

  isStale(symbol: string): boolean {
    return this.stale.has(symbol);
  }

  stats(): BookFeedStats {
    return {
      accepted: { ...this.counters.accepted },
      written: { ...this.counters.written },
      ignoredOutOfOrder: this.counters.ignoredOutOfOrder,
      ignoredRestWhileWsLive: this.counters.ignoredRestWhileWsLive,
      failedStaleMarks: this.counters.failedStaleMarks,
      ignoredWhileDemo: this.counters.ignoredWhileDemo,
      trades: this.counters.trades,
      failedWrites: this.counters.failedWrites,
    };
  }

  /**
   * Starts the transports and the refreshes. `heartbeat` is told of every read of the tracked set
   * that succeeded (`/healthz`, `health/loops.ts`).
   */
  start({ signal, heartbeat }: { signal: AbortSignal; heartbeat?: LoopHeartbeat }): BookFeedRun {
    if (this.started) throw new Error("BookFeed: already started");
    this.started = true;
    this.refreshHeartbeat = heartbeat;
    if (signal.aborted) {
      this.stopping = true;
      return { stopped: Promise.resolve() };
    }

    const stopped = new Promise<void>((resolve) => {
      const onAbort = (): void => {
        this.shutdown()
          .catch((error: unknown) => {
            this.logger.error({ err: describeError(error) }, "book feed shutdown failed");
          })
          .finally(() => {
            this.logger.info("book feed stopped");
            resolve();
          });
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });

    this.ws?.start(this.listenerFor("ws"));
    this.rest.start(this.listenerFor("rest"));
    this.logger.info(
      { transports: this.ws === null ? ["rest"] : ["ws", "rest"] },
      "book feed started",
    );
    if (this.demo !== null) this.refreshDemo();
    this.refreshTracked();
    this.scheduleWatchdog();
    return { stopped };
  }

  private listenerFor(source: BookSource): BookTransportListener {
    return {
      onBook: (book, sequence) => {
        this.guard(() => {
          this.accept(book, source, sequence);
        });
      },
      onTrade: (trade) => {
        this.guard(() => {
          this.acceptTrade(trade);
        });
      },
      onConnectionChange: (connected) => {
        this.guard(() => {
          this.connectionChanged(source, connected);
        });
      },
    };
  }

  /** Nothing a transport reports may throw back into it. */
  private guard(action: () => void): void {
    try {
      action();
    } catch (error: unknown) {
      this.logger.error({ err: describeError(error) }, "book feed failed to handle an event");
    }
  }

  private connectionChanged(source: BookSource, connected: boolean): void {
    if (this.stopping) return;
    if (source === "rest") {
      if (connected) this.logger.info("gemini REST books answering again");
      else this.logger.warn("gemini REST book poll failing");
      return;
    }
    if (connected) {
      const nowMs = this.scheduler.now();
      for (const symbol of this.tracked.keys()) this.wsCoveredAtMs.set(symbol, nowMs);
    }
    // The watchdog logs the fallback transitions and hands REST its instruments.
    this.watchdog();
  }

  private accept(raw: Book, source: BookSource, sequence: number | null): void {
    const symbol = raw.instrumentSymbol;
    if (this.stopping || !this.tracked.has(symbol)) return;
    const inDemo = this.demoActive.has(symbol);
    // In demo, Gemini books are checked against the last Gemini book, not against the demo book.
    const held = inDemo ? this.liveShadow.get(symbol) : this.books.get(symbol);
    if (sequence !== null) {
      const last = this.lastSequence.get(symbol);
      if (last !== undefined && sequence < last) {
        this.counters.ignoredOutOfOrder += 1;
        this.logger.debug({ symbol, sequence, last }, "out-of-order book ignored");
        return;
      }
    }
    if (held !== undefined && raw.observedAtMs < held.book.observedAtMs) {
      this.counters.ignoredOutOfOrder += 1;
      this.logger.debug(
        { symbol, source, observedAtMs: raw.observedAtMs, heldAtMs: held.book.observedAtMs },
        "older book ignored",
      );
      return;
    }
    if (source === "rest" && held?.source === "ws" && this.wsLiveFor(held.book)) {
      // The request may have left before that socket book: the socket is authoritative while live.
      this.counters.ignoredRestWhileWsLive += 1;
      this.logger.debug({ symbol }, "REST book ignored, the socket covers the instrument");
      return;
    }
    const book = normalizeBook(raw);
    if (inDemo) {
      this.liveShadow.set(symbol, { book, source });
      if (sequence !== null) this.lastSequence.set(symbol, sequence);
      if (source === "ws") this.wsCoveredAtMs.set(symbol, this.scheduler.now());
      this.counters.ignoredWhileDemo += 1;
      this.logger.debug({ symbol, source }, "gemini book set aside, a demo book is in force");
      return;
    }
    this.books.set(symbol, { book, source });
    // The write below sets stale = false: a pending stale flag must not be retried after it.
    this.staleMarks.delete(symbol);
    if (sequence !== null) this.lastSequence.set(symbol, sequence);
    if (source === "ws") this.wsCoveredAtMs.set(symbol, this.scheduler.now());
    this.counters.accepted[source] += 1;
    if (this.stale.delete(symbol)) {
      this.logger.info({ symbol, source }, "instrument fresh");
    }
    this.emit({ kind: "book", book, source });
    this.scheduleWrite(symbol);
  }

  private wsLiveFor(wsBook: Book): boolean {
    if (!(this.ws?.isConnected() ?? false)) return false;
    return this.scheduler.now() - wsBook.observedAtMs <= this.wsGapMs;
  }

  private acceptTrade(trade: TradePrint): void {
    if (this.stopping || !this.tracked.has(trade.instrumentSymbol)) return;
    this.counters.trades += 1;
    this.emit({ kind: "trade", trade });
  }

  private emit(event: BookFeedEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        this.logger.error({ err: describeError(error) }, "book feed listener threw");
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Writes: per instrument, serialized, throttled, always the latest state.
  // ---------------------------------------------------------------------------------------------

  private writeState(symbol: string): WriteState {
    let state = this.writes.get(symbol);
    if (state === undefined) {
      state = {
        lastWriteAtMs: Number.NEGATIVE_INFINITY,
        dirty: false,
        cancelTimer: null,
        writtenObservedAtMs: Number.NEGATIVE_INFINITY,
      };
      this.writes.set(symbol, state);
    }
    return state;
  }

  private scheduleWrite(symbol: string): void {
    const state = this.writeState(symbol);
    state.dirty = true;
    if (state.cancelTimer !== null) return;
    const waitMs = state.lastWriteAtMs + this.writeThrottleMs - this.scheduler.now();
    if (waitMs <= 0) {
      this.flushWrite(symbol);
      return;
    }
    state.cancelTimer = this.scheduler.setTimeout(() => {
      state.cancelTimer = null;
      this.flushWrite(symbol);
    }, waitMs);
  }

  private flushWrite(symbol: string): void {
    const state = this.writes.get(symbol);
    if (state === undefined || !state.dirty) return;
    state.dirty = false;
    state.lastWriteAtMs = this.scheduler.now();
    this.enqueueDb(symbol, async () => {
      // Read at write time, not at schedule time: the latest book wins.
      const held = this.books.get(symbol);
      if (held === undefined || held.book.observedAtMs <= state.writtenObservedAtMs) return;
      try {
        await this.store.writeBook(held.book, held.source);
      } catch (error: unknown) {
        this.counters.failedWrites += 1;
        // Written again with the next book; the watchdog flags it stale if none comes.
        this.logger.error({ symbol, err: describeError(error) }, "book write failed");
        return;
      }
      state.writtenObservedAtMs = held.book.observedAtMs;
      this.counters.written[held.source] += 1;
    });
  }

  private enqueueDb(symbol: string, operation: () => Promise<void>): void {
    const previous = this.dbChains.get(symbol) ?? Promise.resolve();
    const next = previous.then(operation).catch((error: unknown) => {
      this.logger.error(
        { symbol, err: describeError(error) },
        "book feed database operation failed",
      );
    });
    this.dbChains.set(symbol, next);
    void next.then(() => {
      if (this.dbChains.get(symbol) === next) this.dbChains.delete(symbol);
    });
  }

  /**
   * Flags the instrument stale in Postgres. A failed update is kept in `staleMarks` and retried by
   * the watchdog, so a database hiccup cannot leave a dead book marked fresh.
   */
  private markStale(symbol: string, options: MarkStaleOptions = {}): void {
    const mark: StaleMark = { options, failures: 0, inFlight: false };
    this.staleMarks.set(symbol, mark);
    this.sendStaleMark(symbol, mark);
  }

  private sendStaleMark(symbol: string, mark: StaleMark): void {
    mark.inFlight = true;
    this.enqueueDb(symbol, async () => {
      try {
        await this.store.markStale(symbol, mark.options);
      } catch (error: unknown) {
        mark.inFlight = false;
        mark.failures += 1;
        this.counters.failedStaleMarks += 1;
        const fields = { symbol, failures: mark.failures, err: describeError(error) };
        if (mark.failures === 1) this.logger.error(fields, "stale flag write failed, will retry");
        else this.logger.debug(fields, "stale flag write failed again");
        return;
      }
      mark.inFlight = false;
      if (this.staleMarks.get(symbol) === mark) this.staleMarks.delete(symbol);
      if (mark.failures > 0) this.logger.info({ symbol }, "stale flag written after retry");
    });
  }

  private retryStaleMarks(): void {
    for (const [symbol, mark] of this.staleMarks) {
      if (!mark.inFlight && mark.failures > 0) this.sendStaleMark(symbol, mark);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Tracked set
  // ---------------------------------------------------------------------------------------------

  private refreshTracked(): void {
    this.cancelRefresh = null;
    if (this.stopping) return;
    this.refreshInFlight = this.loadTracked()
      .catch((error: unknown) => {
        this.logger.error({ err: describeError(error) }, "book feed refresh failed");
      })
      .finally(() => {
        if (this.stopping) return;
        this.cancelRefresh = this.scheduler.setTimeout(() => {
          this.refreshTracked();
        }, this.trackedRefreshMs);
      });
  }

  private async loadTracked(): Promise<void> {
    let symbols: string[];
    try {
      symbols = await this.store.listTrackedSymbols(this.scheduler.now());
    } catch (error: unknown) {
      if (!this.refreshFailing) {
        this.logger.error(
          { err: describeError(error) },
          "tracked instruments could not be read, keeping the current set",
        );
      }
      this.refreshFailing = true;
      return;
    }
    if (this.refreshFailing) this.logger.info("tracked instruments readable again");
    this.refreshFailing = false;
    try {
      this.refreshHeartbeat?.beat();
    } catch {
      // The health report must never stop the feed.
    }
    if (this.stopping) return;
    this.storeTracked = new Set(symbols);
    this.applyTracked(this.wantedSymbols());
  }

  /** What Postgres asks for, plus every instrument whose demo book is in force. */
  private wantedSymbols(): Set<string> {
    return new Set([...this.storeTracked, ...this.demoActive]);
  }

  private applyTracked(wanted: ReadonlySet<string>): void {
    const nowMs = this.scheduler.now();
    let changed = false;
    for (const symbol of wanted) {
      if (this.tracked.has(symbol)) continue;
      this.tracked.set(symbol, { sinceMs: nowMs });
      this.wsCoveredAtMs.set(symbol, nowMs);
      changed = true;
      this.logger.info({ symbol }, "instrument tracked");
    }
    for (const symbol of [...this.tracked.keys()]) {
      if (wanted.has(symbol)) continue;
      this.untrack(symbol);
      changed = true;
    }
    if (!changed) return;
    this.ws?.setSymbols(new Set(this.tracked.keys()));
    this.watchdog();
  }

  private untrack(symbol: string): void {
    this.tracked.delete(symbol);
    this.books.delete(symbol);
    this.demoActive.delete(symbol);
    this.liveShadow.delete(symbol);
    this.lastSequence.delete(symbol);
    this.wsCoveredAtMs.delete(symbol);
    this.stale.delete(symbol);
    this.gapFilled.delete(symbol);
    const state = this.writes.get(symbol);
    state?.cancelTimer?.();
    this.writes.delete(symbol);
    // Nobody refreshes it any more: whatever live_instruments holds can no longer be trusted.
    this.markStale(symbol);
    this.logger.info({ symbol }, "instrument untracked");
  }

  // ---------------------------------------------------------------------------------------------
  // Demo books (SPEC MDB-4)
  // ---------------------------------------------------------------------------------------------

  private refreshDemo(): void {
    this.cancelDemo = null;
    if (this.stopping) return;
    this.demoInFlight = this.loadDemo()
      .catch((error: unknown) => {
        this.logger.error({ err: describeError(error) }, "demo book refresh failed");
      })
      .finally(() => {
        if (this.stopping) return;
        this.cancelDemo = this.scheduler.setTimeout(() => {
          this.refreshDemo();
        }, this.demoRefreshMs);
      });
  }

  private async loadDemo(): Promise<void> {
    const store = this.demo;
    if (store === null) return;
    let rows: { symbol: string; book: unknown }[];
    try {
      rows = await store.listDemoBooks();
    } catch (error: unknown) {
      // The books in force are not re-stamped: if this lasts, the watchdog flags them stale.
      if (!this.demoFailing) {
        this.logger.error(
          { err: describeError(error) },
          "demo overrides could not be read, demo books not refreshed",
        );
      }
      this.demoFailing = true;
      return;
    }
    if (this.demoFailing) this.logger.info("demo overrides readable again");
    this.demoFailing = false;
    if (this.stopping) return;
    this.guard(() => {
      this.applyDemo(rows);
    });
  }

  private applyDemo(rows: readonly { symbol: string; book: unknown }[]): void {
    const nowMs = this.scheduler.now();
    const valid = new Map<string, Book>();
    for (const row of rows) {
      let book: Book;
      try {
        book = parseDemoBook(row.symbol, row.book, nowMs);
      } catch (error: unknown) {
        this.logInvalidDemo(row.symbol, row.book, error);
        continue;
      }
      this.invalidDemoLogged.delete(row.symbol);
      valid.set(row.symbol, book);
    }
    for (const symbol of [...this.invalidDemoLogged.keys()]) {
      if (!rows.some((row) => row.symbol === symbol)) this.invalidDemoLogged.delete(symbol);
    }

    // Overrides that went away (or turned invalid): live books again, at once.
    for (const symbol of [...this.demoActive]) {
      if (!valid.has(symbol)) this.releaseDemo(symbol);
    }
    for (const [symbol, demoAtMs] of [...this.pendingReleases]) {
      if (valid.has(symbol)) this.pendingReleases.delete(symbol);
      else this.sendRelease(symbol, demoAtMs, null);
    }

    const entering = [...valid.keys()].filter((symbol) => !this.demoActive.has(symbol));
    for (const symbol of entering) {
      this.demoActive.add(symbol);
      // The Gemini book held now is the one to restore if the override goes before another comes.
      const held = this.books.get(symbol);
      if (held !== undefined) this.liveShadow.set(symbol, held);
      this.logger.info({ symbol }, "demo book in force, gemini books set aside");
    }
    this.applyTracked(this.wantedSymbols());

    for (const [symbol, raw] of valid) {
      if (!this.tracked.has(symbol)) continue;
      const book = normalizeBook(raw);
      this.books.set(symbol, { book, source: "demo" });
      this.staleMarks.delete(symbol);
      this.counters.accepted.demo += 1;
      if (this.stale.delete(symbol))
        this.logger.info({ symbol, source: "demo" }, "instrument fresh");
      this.emit({ kind: "book", book, source: "demo" });
      this.scheduleWrite(symbol);
    }
  }

  private logInvalidDemo(symbol: string, raw: unknown, error: unknown): void {
    let content: string;
    try {
      content = JSON.stringify(raw) ?? "null";
    } catch {
      content = String(raw);
    }
    if (this.invalidDemoLogged.get(symbol) === content) return;
    this.invalidDemoLogged.set(symbol, content);
    this.logger.error(
      { symbol, err: describeError(error) },
      "demo override ignored: its book is invalid",
    );
  }

  /**
   * The override of `symbol` is gone: the latest Gemini book (if still fresh and the instrument
   * stays tracked) takes the demo book's place in memory and in Postgres, or the demo book is
   * removed from both and the instrument waits for the next Gemini book.
   */
  private releaseDemo(symbol: string): void {
    this.demoActive.delete(symbol);
    const held = this.books.get(symbol);
    const demoAtMs = held?.source === "demo" ? held.book.observedAtMs : this.scheduler.now();
    const shadow = this.liveShadow.get(symbol);
    this.liveShadow.delete(symbol);
    const nowMs = this.scheduler.now();
    const restored =
      shadow !== undefined &&
      this.storeTracked.has(symbol) &&
      nowMs - shadow.book.observedAtMs <= this.staleAfterMs
        ? shadow
        : null;

    // Pending throttled writes would write the demo book again: drop them.
    const state = this.writeState(symbol);
    state.cancelTimer?.();
    state.cancelTimer = null;
    state.dirty = false;
    // With nothing restored, the next Gemini book is written as soon as it comes.
    state.lastWriteAtMs = restored === null ? Number.NEGATIVE_INFINITY : nowMs;
    state.writtenObservedAtMs = restored?.book.observedAtMs ?? Number.NEGATIVE_INFINITY;

    if (restored === null) {
      this.books.delete(symbol);
    } else {
      this.books.set(symbol, restored);
      this.emit({ kind: "book", book: restored.book, source: restored.source });
    }
    this.logger.info(
      { symbol, restored: restored?.source ?? null },
      "demo book removed, back to gemini books",
    );
    this.sendRelease(symbol, demoAtMs, restored);
  }

  private sendRelease(symbol: string, demoAtMs: number, live: HeldBook | null): void {
    const store = this.demo;
    if (store === null) return;
    this.pendingReleases.delete(symbol);
    this.enqueueDb(symbol, async () => {
      try {
        await store.releaseDemoBook(symbol, demoAtMs, live);
      } catch (error: unknown) {
        this.counters.failedWrites += 1;
        // Retried (without the live book: a newer one may have come) on the next demo pass.
        if (!this.demoActive.has(symbol)) this.pendingReleases.set(symbol, demoAtMs);
        this.logger.error({ symbol, err: describeError(error) }, "demo book release failed");
        return;
      }
      if (live !== null) this.counters.written[live.source] += 1;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Watchdog: staleness and REST gap filling
  // ---------------------------------------------------------------------------------------------

  private scheduleWatchdog(): void {
    this.cancelWatchdog = this.scheduler.setTimeout(() => {
      this.cancelWatchdog = null;
      this.guard(() => {
        this.watchdog();
      });
      if (!this.stopping) this.scheduleWatchdog();
    }, this.watchdogMs);
  }

  private watchdog(): void {
    if (this.stopping) return;
    const nowMs = this.scheduler.now();
    const wsUp = this.ws?.isConnected() ?? false;
    const needRest = new Set<string>();
    if (this.ws !== null && !wsUp && !this.onRestFallback) {
      this.onRestFallback = true;
      this.logger.warn(
        { instruments: this.tracked.size },
        "book feed: websocket down, falling back to REST",
      );
    } else if (wsUp && this.onRestFallback) {
      this.onRestFallback = false;
      this.logger.info(
        { instruments: this.tracked.size },
        "book feed: websocket up, REST fallback off",
      );
    }
    for (const [symbol, { sinceMs }] of this.tracked) {
      const observedAtMs = this.books.get(symbol)?.book.observedAtMs ?? sinceMs;
      const ageMs = nowMs - observedAtMs;
      if (ageMs > this.staleAfterMs && !this.stale.has(symbol)) {
        this.stale.add(symbol);
        this.logger.warn({ symbol, ageMs, hasBook: this.books.has(symbol) }, "instrument stale");
        this.markStale(symbol);
      }

      // A demo book needs no REST poll: Gemini's books are set aside anyway.
      if (this.demoActive.has(symbol)) continue;
      const coveredAtMs = this.wsCoveredAtMs.get(symbol) ?? sinceMs;
      const gap = !wsUp || nowMs - coveredAtMs > this.wsGapMs;
      if (gap) needRest.add(symbol);
      const gapFilling = wsUp && gap;
      if (gapFilling && !this.gapFilled.has(symbol)) {
        this.gapFilled.add(symbol);
        this.logger.info(
          { symbol, silentMs: nowMs - coveredAtMs },
          "no websocket book, filling from REST",
        );
      } else if (!gapFilling && this.gapFilled.has(symbol)) {
        this.gapFilled.delete(symbol);
        if (wsUp) this.logger.info({ symbol }, "websocket books back, REST fill off");
      }
    }
    this.rest.setSymbols(needRest);
    this.retryStaleMarks();
  }

  private async shutdown(): Promise<void> {
    this.stopping = true;
    this.cancelRefresh?.();
    this.cancelRefresh = null;
    this.cancelWatchdog?.();
    this.cancelWatchdog = null;
    this.cancelDemo?.();
    this.cancelDemo = null;
    await Promise.allSettled([this.ws?.stop() ?? Promise.resolve(), this.rest.stop()]);
    await this.refreshInFlight;
    await this.demoInFlight;
    // The latest state of every instrument still waiting for its throttle slot is written now.
    for (const [symbol, state] of this.writes) {
      if (state.cancelTimer !== null) {
        state.cancelTimer();
        state.cancelTimer = null;
        this.flushWrite(symbol);
      }
    }
    // Nobody refreshes these rows any more. Only a row still holding the book this feed wrote
    // last is flagged: during a redeploy overlap the next engine's fresher rows stay fresh.
    for (const symbol of this.tracked.keys()) {
      const state = this.writes.get(symbol);
      if (state === undefined) continue;
      this.enqueueDb(symbol, async () => {
        // Read once the final flush above has run: it is queued before this on the same chain.
        if (!Number.isFinite(state.writtenObservedAtMs)) return;
        try {
          await this.store.markStale(symbol, { observedAtOrBeforeMs: state.writtenObservedAtMs });
        } catch (error: unknown) {
          this.counters.failedStaleMarks += 1;
          this.logger.error({ symbol, err: describeError(error) }, "stale flag on shutdown failed");
        }
      });
    }
    // One last attempt for flags still unconfirmed (instruments untracked while Postgres failed).
    for (const [symbol, mark] of this.staleMarks) {
      if (!this.tracked.has(symbol) && !mark.inFlight) this.sendStaleMark(symbol, mark);
    }
    while (this.dbChains.size > 0) {
      await Promise.allSettled([...this.dbChains.values()]);
    }
    this.logger.info(
      { instruments: this.tracked.size },
      "book feed: tracked instruments flagged stale on shutdown",
    );
  }
}

/** Sorted best first, empty levels dropped, at most 10 a side. */
export function normalizeBook(book: Book): Book {
  const bids = book.bids
    .filter((level) => level.qty > 0n)
    .sort((a, b) => (a.priceBps === b.priceBps ? 0 : a.priceBps < b.priceBps ? 1 : -1))
    .slice(0, BOOK_DEPTH);
  const asks = book.asks
    .filter((level) => level.qty > 0n)
    .sort((a, b) => (a.priceBps === b.priceBps ? 0 : a.priceBps > b.priceBps ? 1 : -1))
    .slice(0, BOOK_DEPTH);
  return { instrumentSymbol: book.instrumentSymbol, bids, asks, observedAtMs: book.observedAtMs };
}

export interface CreateBookFeedOptions {
  db: Db;
  /** The engine's REST client: its limiter is the engine-wide budget. */
  client: BookFetcher;
  logger: Logger;
  /** False runs on REST polling alone. */
  websocket?: boolean;
  /** Socket options, e.g. `proxyUrl` where egress goes through a CONNECT proxy. */
  socket?: WsBookSocketOptions;
  depthStream?: DepthStream;
  /** Ceiling of the REST poller, see `RestBookPollerOptions.maxRequestsPerMinute`. */
  restMaxRequestsPerMinute?: number;
  scheduler?: Scheduler;
  /**
   * Obey demo_overrides books (SPEC MDB-4). Default true: rows are only written by the admin
   * routes behind the admin demo key, and with the table empty the feed is unchanged.
   */
  demoBooks?: boolean;
  /** See `BookFeedOptions.demoRefreshMs`. */
  demoRefreshMs?: number;
}

/**
 * The feed with its production parts: Postgres store, Gemini WebSocket, REST poller, and the
 * demo_overrides books unless `demoBooks` is false.
 */
export function createBookFeed(options: CreateBookFeedOptions): BookFeed {
  const scheduler = options.scheduler ?? systemScheduler;
  const ws =
    options.websocket === false
      ? null
      : new WsBookTransport({
          socketFactory: wsBookSocketFactory(options.socket),
          logger: options.logger.child({ transport: "ws" }),
          scheduler,
          depthStream: options.depthStream,
        });
  const rest = new RestBookPoller({
    client: options.client,
    logger: options.logger.child({ transport: "rest" }),
    scheduler,
    maxRequestsPerMinute: options.restMaxRequestsPerMinute,
  });
  return new BookFeed({
    store: new PgBookStore(options.db),
    rest,
    ws,
    logger: options.logger,
    scheduler,
    demo: options.demoBooks === false ? null : new PgDemoBookStore(options.db),
    demoRefreshMs: options.demoRefreshMs,
  });
}
