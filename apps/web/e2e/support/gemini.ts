import pino from "pino";

import type { Book, Outcome } from "@winz/shared";

import type { BookTransport, BookTransportListener } from "../../../engine/src/market-data";
import {
  GeminiRestClient,
  type FetchLike,
  type FetchResponseLike,
} from "../../../engine/src/market-data";
import type { WorldClock } from "./clock";

/**
 * Gemini, simulated on both of the engine's paths into it:
 *
 * - the REST API the catalogue sync reads (`GeminiRestClient` with an injected `fetch`): one
 *   American football game with two moneyline contracts, then, once `settle` is called, the same
 *   game in the recently-settled list with each contract's `resolutionSide`, exactly as Gemini
 *   publishes a result;
 * - the live order books, through a hand-fed `BookTransport` the engine's real `BookFeed` runs on.
 *   The test sets the book of an instrument; the transport delivers it when the feed subscribes,
 *   again on every change, and keeps re-delivering it (stamped with the world's clock) like a live
 *   socket, until the test silences the instrument.
 */

/** One USDC / one contract, in micro-units. */
export const MICRO = 1_000_000n;

export interface Game {
  ticker: string;
  title: string;
  startsAt: Date;
  salesCloseAt: Date;
  /** Texas, the favourite: "Texas wins". */
  home: { symbol: string; label: string };
  /** Arkansas, the underdog: "Arkansas wins". */
  away: { symbol: string; label: string };
}

export interface MarketBook {
  bidBps: number | null;
  askBps: number | null;
  /** Micro-contracts at each best level. */
  depth: bigint;
}

function two(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Gemini's ticker date: yyMMddHHmm in UTC. */
function tickerDate(date: Date): string {
  return (
    two(date.getUTCFullYear() % 100) +
    two(date.getUTCMonth() + 1) +
    two(date.getUTCDate()) +
    two(date.getUTCHours()) +
    two(date.getUTCMinutes())
  );
}

/** A game starting `startsInMs` after `nowMs`, with Gemini's naming. */
export function newGame(nowMs: number, startsInMs: number): Game {
  // Whole minutes, as Gemini lists start times.
  const startsAt = new Date(Math.ceil((nowMs + startsInMs) / 60_000) * 60_000);
  const ticker = `NCAAF-${tickerDate(startsAt)}-ARK-TEX-M`;
  return {
    ticker,
    title: "Arkansas vs Texas",
    startsAt,
    salesCloseAt: new Date(startsAt.getTime() - 5 * 60_000),
    home: { symbol: `GEMI-${ticker}-TEX`, label: "Texas wins" },
    away: { symbol: `GEMI-${ticker}-ARK`, label: "Arkansas wins" },
  };
}

function priceString(bps: number): string {
  return (bps / 10_000).toString();
}

interface RawContractJson {
  id: string;
  label: string;
  instrumentSymbol: string;
  status: string;
  marketState: string;
  prices: { bestBid?: string; bestAsk?: string };
  sportsSide: "home" | "away";
  isCombo: boolean;
  resolutionSide?: "yes" | "no";
}

export class SimulatedGemini {
  readonly game: Game;
  /** Every REST URL requested, in order. */
  readonly requests: string[] = [];
  private result: ReadonlyMap<string, Outcome> | null = null;
  private readonly books = new Map<string, MarketBook>();
  private readonly silenced = new Set<string>();
  private transports = new Set<MarketTransport>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly clock: WorldClock,
    game: Game,
    private readonly redeliverMs = 400,
  ) {
    this.game = game;
  }

  // -------------------------------------------------------------------------------------------
  // REST: catalogue and results
  // -------------------------------------------------------------------------------------------

  /** A REST client on the simulated API. Its limiter never waits: the sync has its own pace. */
  client(): GeminiRestClient {
    const fetch: FetchLike = (url) => {
      this.requests.push(url);
      const body = url.includes("/recently-settled") ? this.settledPage() : this.activePage();
      const response: FetchResponseLike = {
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify(body)),
      };
      return Promise.resolve(response);
    };
    return new GeminiRestClient({
      baseUrl: "https://gemini.simulated",
      logger: pino({ level: "silent" }),
      fetch,
      limiter: { acquire: () => Promise.resolve() },
      maxAttempts: 1,
    });
  }

  /** The game ends: Gemini lists it as settled with this side of each contract. */
  settle(outcomes: { home: Outcome; away: Outcome }): void {
    this.result = new Map([
      [this.game.home.symbol, outcomes.home],
      [this.game.away.symbol, outcomes.away],
    ]);
  }

  private contract(
    side: "home" | "away",
    status: "active" | "settled",
    resolution: Outcome | undefined,
  ): RawContractJson {
    const instrument = side === "home" ? this.game.home : this.game.away;
    const book = this.books.get(instrument.symbol);
    const fallback = side === "home" ? { bid: 8800, ask: 9000 } : { bid: 1000, ask: 1200 };
    const bid = book?.bidBps ?? fallback.bid;
    const ask = book?.askBps ?? fallback.ask;
    const contract: RawContractJson = {
      id: `${this.game.ticker}-${side}`,
      label: side === "home" ? "Texas" : "Arkansas",
      instrumentSymbol: instrument.symbol,
      status,
      marketState: status === "active" ? "open" : "closed",
      prices: status === "active" ? { bestBid: priceString(bid), bestAsk: priceString(ask) } : {},
      sportsSide: side,
      isCombo: false,
    };
    if (resolution === "yes" || resolution === "no") contract.resolutionSide = resolution;
    return contract;
  }

  private event(status: "active" | "settled"): unknown {
    const result = this.result;
    return {
      ticker: this.game.ticker,
      title: this.game.title,
      status,
      category: "Sports",
      startTime: this.game.startsAt.toISOString(),
      gameId: `game-${this.game.ticker}`,
      participants: [
        { name: "Texas Longhorns", abbreviation: "TEX", side: "home" },
        { name: "Arkansas Razorbacks", abbreviation: "ARK", side: "away" },
      ],
      sportsMarket: {
        sport: "american_football",
        type: "moneyline",
        subject: "contest",
        scope: { type: "full_contest" },
      },
      contracts: [
        this.contract(
          "home",
          status === "active" ? "active" : "settled",
          result?.get(this.game.home.symbol),
        ),
        this.contract(
          "away",
          status === "active" ? "active" : "settled",
          result?.get(this.game.away.symbol),
        ),
      ],
    };
  }

  private activePage(): unknown {
    const data = this.result === null ? [this.event("active")] : [];
    return { data, pagination: { limit: 50, offset: 0, total: data.length } };
  }

  private settledPage(): unknown {
    const data = this.result === null ? [] : [this.event("settled")];
    return { data, pagination: { limit: 50, offset: 0, total: data.length } };
  }

  // -------------------------------------------------------------------------------------------
  // Order books
  // -------------------------------------------------------------------------------------------

  /** Sets the book of an instrument (one level a side) and delivers it at once. */
  setBook(
    symbol: string,
    book: { bidBps: number | null; askBps: number | null; depth?: bigint },
  ): void {
    this.books.set(symbol, {
      bidBps: book.bidBps,
      askBps: book.askBps,
      depth: book.depth ?? 1_000n * MICRO,
    });
    this.deliverAll();
  }

  /** The instrument's book stops arriving: nothing is delivered until `resume`. */
  silence(symbol: string): void {
    this.silenced.add(symbol);
  }

  resume(symbol: string): void {
    this.silenced.delete(symbol);
    this.deliverAll();
  }

  /** The book of `symbol` as a live socket would deliver it now, or null when there is none. */
  bookNow(symbol: string): Book | null {
    const book = this.books.get(symbol);
    if (book === undefined || this.silenced.has(symbol)) return null;
    return {
      instrumentSymbol: symbol,
      bids: book.bidBps === null ? [] : [{ priceBps: BigInt(book.bidBps), qty: book.depth }],
      asks: book.askBps === null ? [] : [{ priceBps: BigInt(book.askBps), qty: book.depth }],
      observedAtMs: this.clock.now(),
    };
  }

  /** A transport for one run of the engine's book feed. */
  transport(): MarketTransport {
    return new MarketTransport(this);
  }

  /** Re-delivers every book now (also called by the world after it moved chain time). */
  deliverAll(): void {
    for (const transport of this.transports) transport.deliverAll();
  }

  /** @internal */
  attach(transport: MarketTransport): void {
    this.transports.add(transport);
    if (this.ticker === null) {
      this.ticker = setInterval(() => {
        this.deliverAll();
      }, this.redeliverMs);
    }
  }

  /** @internal */
  detach(transport: MarketTransport): void {
    this.transports.delete(transport);
    if (this.transports.size === 0 && this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  /** Stops the re-delivery timer. */
  close(): void {
    for (const transport of [...this.transports]) this.detach(transport);
  }
}

/** The live socket of the simulated Gemini, as the engine's `BookFeed` sees it. */
export class MarketTransport implements BookTransport {
  readonly source = "ws" as const;
  private listener: BookTransportListener | null = null;
  private symbols: ReadonlySet<string> = new Set<string>();

  constructor(private readonly gemini: SimulatedGemini) {}

  start(listener: BookTransportListener): void {
    this.listener = listener;
    this.gemini.attach(this);
    listener.onConnectionChange(true);
  }

  setSymbols(symbols: ReadonlySet<string>): void {
    const added = [...symbols].filter((symbol) => !this.symbols.has(symbol));
    this.symbols = new Set(symbols);
    // Like Gemini after a subscribe: a snapshot of each new instrument, delivered after the call.
    for (const symbol of added) {
      queueMicrotask(() => {
        this.deliver(symbol);
      });
    }
  }

  isConnected(): boolean {
    return this.listener !== null;
  }

  stop(): Promise<void> {
    this.gemini.detach(this);
    this.listener = null;
    return Promise.resolve();
  }

  deliverAll(): void {
    for (const symbol of this.symbols) this.deliver(symbol);
  }

  private deliver(symbol: string): void {
    const listener = this.listener;
    if (listener === null || !this.symbols.has(symbol)) return;
    const book = this.gemini.bookNow(symbol);
    if (book !== null) listener.onBook(book, null);
  }
}

/** The REST side of the feed: never connected, never delivers (the socket covers everything). */
export class SilentTransport implements BookTransport {
  readonly source = "rest" as const;

  start(): void {
    // Nothing to start: this transport never delivers.
  }

  setSymbols(): void {
    // Nothing to follow.
  }

  isConnected(): boolean {
    return false;
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}
