import type { Logger } from "pino";

import type { Book } from "@winz/shared";

import type { BookTransport, BookTransportListener } from "./book-transport";
import { describeError } from "./errors";
import { systemScheduler, type CancelTimer, type Scheduler } from "./scheduler";

/** The part of `GeminiRestClient` the poller uses. */
export interface BookFetcher {
  getBook(instrumentSymbol: string): Promise<Book>;
}

export interface RestBookPollerOptions {
  /**
   * The engine's `GeminiRestClient`. Its rate limiter is the engine-wide budget: share the client
   * (or its limiter) with the catalogue sync so the whole engine stays under 100 requests a minute.
   */
  client: BookFetcher;
  logger: Logger;
  scheduler?: Scheduler;
  /** Shortest time between two polls of the same instrument. */
  minIntervalPerSymbolMs?: number;
  /**
   * The poller's own ceiling, below the shared limiter, so a large fallback never takes the whole
   * budget from the catalogue and settlement sync.
   */
  maxRequestsPerMinute?: number;
  /** How often to look again when no instrument is due. */
  idleCheckMs?: number;
}

/**
 * Polls `GET /v1/book/{symbol}` for the instruments the feed hands it: all of them while the
 * socket is down, the silent ones while it is up.
 *
 * One request at a time. The next instrument is always the one polled least recently among those
 * due, so with N instruments and a budget of R requests a minute each gets R / N, none starves.
 */
export class RestBookPoller implements BookTransport {
  readonly source = "rest" as const;

  private readonly client: BookFetcher;
  private readonly logger: Logger;
  private readonly scheduler: Scheduler;
  private readonly minIntervalPerSymbolMs: number;
  private readonly spacingMs: number;
  private readonly idleCheckMs: number;

  private listener: BookTransportListener | null = null;
  private symbols: ReadonlySet<string> = new Set();
  private readonly lastPolledAtMs = new Map<string, number>();
  private lastRequestAtMs = Number.NEGATIVE_INFINITY;
  private connected = true;
  private started = false;
  private stopped = false;
  private loop: Promise<void> = Promise.resolve();
  private wake: (() => void) | null = null;

  constructor(options: RestBookPollerOptions) {
    this.client = options.client;
    this.logger = options.logger;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.minIntervalPerSymbolMs = options.minIntervalPerSymbolMs ?? 2_000;
    const maxPerMinute = options.maxRequestsPerMinute ?? 60;
    if (!(maxPerMinute > 0))
      throw new RangeError("RestBookPoller: maxRequestsPerMinute must be positive");
    this.spacingMs = 60_000 / maxPerMinute;
    this.idleCheckMs = options.idleCheckMs ?? 250;
  }

  start(listener: BookTransportListener): void {
    if (this.started) throw new Error("RestBookPoller: already started");
    this.started = true;
    this.listener = listener;
    this.loop = this.run();
  }

  setSymbols(symbols: ReadonlySet<string>): void {
    const wasEmpty = this.symbols.size === 0;
    this.symbols = new Set(symbols);
    for (const symbol of [...this.lastPolledAtMs.keys()]) {
      // Forget instruments no longer handed over, so a later fallback treats them as never polled.
      if (!this.symbols.has(symbol)) this.lastPolledAtMs.delete(symbol);
    }
    if (wasEmpty && this.symbols.size > 0) this.wake?.();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const nowMs = this.scheduler.now();
        const spacingLeftMs = this.lastRequestAtMs + this.spacingMs - nowMs;
        if (spacingLeftMs > 0) {
          await this.pause(spacingLeftMs);
          continue;
        }
        const next = this.pickNext(nowMs);
        if (next.symbol === null) {
          await this.pause(Math.max(1, Math.min(this.idleCheckMs, next.waitMs)));
          continue;
        }
        await this.poll(next.symbol);
      } catch (error: unknown) {
        // Only a throwing logger or listener lands here; keep the loop alive, but do not spin.
        this.logger.error({ err: describeError(error) }, "rest book poller iteration failed");
        await this.pause(this.idleCheckMs);
      }
    }
  }

  /** Least recently polled due instrument, or how long until one is due. */
  private pickNext(nowMs: number): { symbol: string | null; waitMs: number } {
    let best: string | null = null;
    let bestPolledAt = Number.POSITIVE_INFINITY;
    let waitMs = Number.POSITIVE_INFINITY;
    for (const symbol of this.symbols) {
      const polledAt = this.lastPolledAtMs.get(symbol) ?? Number.NEGATIVE_INFINITY;
      const dueInMs = polledAt + this.minIntervalPerSymbolMs - nowMs;
      if (dueInMs > 0) {
        waitMs = Math.min(waitMs, dueInMs);
        continue;
      }
      if (
        polledAt < bestPolledAt ||
        (polledAt === bestPolledAt && best !== null && symbol < best)
      ) {
        best = symbol;
        bestPolledAt = polledAt;
      }
    }
    return { symbol: best, waitMs };
  }

  private async poll(symbol: string): Promise<void> {
    const startedAtMs = this.scheduler.now();
    this.lastPolledAtMs.set(symbol, startedAtMs);
    this.lastRequestAtMs = startedAtMs;
    let book: Book;
    try {
      book = await this.client.getBook(symbol);
    } catch (error: unknown) {
      if (this.stopped) return;
      this.logger.warn({ symbol, err: describeError(error) }, "gemini REST book poll failed");
      this.setConnected(false);
      return;
    }
    if (this.stopped) return;
    this.setConnected(true);
    // The instrument may have left the set while the request was in flight: the feed decides.
    this.listener?.onBook(book, null);
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.listener?.onConnectionChange(connected);
  }

  /** Waits `ms` on the scheduler; `stop` or new work cuts it short. */
  private pause(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      let cancel: CancelTimer = () => undefined;
      const done = (): void => {
        cancel();
        this.wake = null;
        resolve();
      };
      this.wake = done;
      cancel = this.scheduler.setTimeout(done, ms);
    });
  }
}
