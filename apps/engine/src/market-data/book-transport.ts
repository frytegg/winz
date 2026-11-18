import type { Book, Bps, MicroContracts } from "@winz/shared";

/**
 * Where a book came from; the `source` column of book_cache. 'demo' is a book driven from the
 * admin panel (demo_overrides, SPEC MDB-4), never a transport's: see `DemoBookStore`.
 */
export type BookSource = "ws" | "rest" | "demo";

/** One trade printed on Gemini, YES side. */
export interface TradePrint {
  instrumentSymbol: string;
  priceBps: Bps;
  qty: MicroContracts;
  /** Gemini's event time, epoch milliseconds. */
  atMs: number;
}

/** What a transport reports to the feed. */
export interface BookTransportListener {
  /**
   * A complete book (top levels of both sides). `sequence` is the exchange update id when the
   * transport has one, so the feed can drop a message older than the book it holds.
   */
  onBook(book: Book, sequence: number | null): void;
  onTrade(trade: TradePrint): void;
  /** The transport can (true) or can no longer (false) deliver books. */
  onConnectionChange(connected: boolean): void;
}

/**
 * A source of books. The feed tells it which instruments to follow; it reports what it gets.
 * Implementations never throw out of their own loops and never call the listener after `stop`.
 */
export interface BookTransport {
  readonly source: BookSource;
  start(listener: BookTransportListener): void;
  /** Replaces the set of followed instruments (catalogue symbols, upper case). */
  setSymbols(symbols: ReadonlySet<string>): void;
  /** Whether books are flowing now. */
  isConnected(): boolean;
  /** Resolves once nothing runs any more: no timer, no socket, no request in flight. */
  stop(): Promise<void>;
}
