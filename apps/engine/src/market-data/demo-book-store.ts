import { z } from "zod";

import type { Book } from "@winz/shared";

import type { Db } from "../db";
import { serializeBookSide, topOfBook } from "./book-store";
import type { BookSource } from "./book-transport";

/**
 * Demo mode (SPEC MDB-4): a book driven from the admin panel. The web app's admin route writes a
 * row of demo_overrides with a `book`; while that row exists, the book feed treats it as THE book
 * of the instrument (see `BookFeed`, option `demo`). Demo mode is announced, never disguised: the
 * book is written to book_cache with source 'demo'.
 */

/** One demo_overrides row that carries a book, as stored (not validated yet). */
export interface DemoBookRow {
  symbol: string;
  /** The `book` jsonb as postgres.js returns it. */
  book: unknown;
}

/** What the book feed reads and writes in Postgres for demo books. */
export interface DemoBookStore {
  /** Every demo_overrides row whose `book` is not null, in symbol order. */
  listDemoBooks(): Promise<DemoBookRow[]>;
  /**
   * The override of `symbol` is gone: the demo book written at `demoObservedAtMs` (or earlier)
   * must stop being served at once, without waiting for it to age out.
   *
   * In one transaction: the book_cache row is replaced by `live` (the latest Gemini book the
   * feed kept while the override was active) or deleted when there is none, and live_instruments
   * gets `live`'s top of book, or is flagged stale when there is none. Only rows the demo book
   * still holds (observed at or before `demoObservedAtMs`) are touched: a newer live book written
   * meanwhile is kept.
   */
  releaseDemoBook(
    symbol: string,
    demoObservedAtMs: number,
    live: { book: Book; source: BookSource } | null,
  ): Promise<void>;
}

/** A demo_overrides book that cannot be served (bad shape, crossed). */
export class DemoBookError extends Error {
  constructor(
    public readonly symbol: string,
    public readonly reason: string,
  ) {
    super(`demo book of ${symbol} is invalid: ${reason}`);
    this.name = "DemoBookError";
  }
}

const demoLevelSchema = z.object({
  // A binary contract trades strictly between 0 and 1.
  priceBps: z.number().int().min(1).max(9_999),
  qty: z.string().regex(/^\d+$/, "must be micro-contracts as digits"),
});

/** The documented shape: {"bids":[{"priceBps":n,"qty":"digits"}],"asks":[...]}. */
const demoBookSchema = z.object({
  bids: z.array(demoLevelSchema),
  asks: z.array(demoLevelSchema),
});

/**
 * The demo book of a row, stamped `observedAtMs`, as stored (levels in stored order; the feed
 * sorts and trims them). Throws `DemoBookError` when the jsonb does not have the documented shape
 * or when the best bid is not strictly below the best ask.
 */
export function parseDemoBook(symbol: string, raw: unknown, observedAtMs: number): Book {
  const parsed = demoBookSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? "" : issue.path.map(String).join(".");
    throw new DemoBookError(
      symbol,
      `${where === "" ? "" : `${where}: `}${issue?.message ?? "invalid shape"}`,
    );
  }
  const toLevel = (level: { priceBps: number; qty: string }): Book["bids"][number] => ({
    priceBps: BigInt(level.priceBps),
    qty: BigInt(level.qty),
  });
  const bids = parsed.data.bids.map(toLevel);
  const asks = parsed.data.asks.map(toLevel);
  let bestBid: bigint | null = null;
  for (const level of bids) {
    if (level.qty > 0n && (bestBid === null || level.priceBps > bestBid)) bestBid = level.priceBps;
  }
  let bestAsk: bigint | null = null;
  for (const level of asks) {
    if (level.qty > 0n && (bestAsk === null || level.priceBps < bestAsk)) bestAsk = level.priceBps;
  }
  if (bestBid !== null && bestAsk !== null && bestBid >= bestAsk) {
    throw new DemoBookError(
      symbol,
      `crossed book: best bid ${bestBid.toString()} >= best ask ${bestAsk.toString()}`,
    );
  }
  return { instrumentSymbol: symbol, bids, asks, observedAtMs };
}

export class PgDemoBookStore implements DemoBookStore {
  constructor(private readonly db: Db) {}

  async listDemoBooks(): Promise<DemoBookRow[]> {
    const rows = await this.db<{ symbol: string; book: unknown }[]>`
      select instrument as symbol, book from demo_overrides
       where book is not null
       order by instrument
    `;
    return rows.map((row) => ({ symbol: row.symbol, book: row.book }));
  }

  async releaseDemoBook(
    symbol: string,
    demoObservedAtMs: number,
    live: { book: Book; source: BookSource } | null,
  ): Promise<void> {
    const demoAt = new Date(demoObservedAtMs);
    await this.db.begin(async (sql) => {
      await sql`
        delete from book_cache
         where symbol = ${symbol} and source = 'demo' and observed_at <= ${demoAt}
      `;
      if (live === null) {
        await sql`
          update live_instruments set stale = true
           where symbol = ${symbol} and not stale and observed_at <= ${demoAt}
        `;
        return;
      }
      const { book, source } = live;
      const observedAt = new Date(book.observedAtMs);
      const bids = sql.json(serializeBookSide(book.bids));
      const asks = sql.json(serializeBookSide(book.asks));
      const top = topOfBook(book);
      // The demo row is gone, so the usual "never older over newer" guard holds again here.
      await sql`
        insert into book_cache (symbol, bids, asks, observed_at, source)
        values (${symbol}, ${bids}, ${asks}, ${observedAt}, ${source})
        on conflict (symbol) do update
          set bids = excluded.bids,
              asks = excluded.asks,
              observed_at = excluded.observed_at,
              source = excluded.source
          where book_cache.observed_at <= excluded.observed_at
      `;
      // The live book is older than the demo stamp it replaces: the guard is the demo stamp.
      await sql`
        insert into live_instruments (symbol, bid_bps, ask_bps, mid_bps, observed_at, stale)
        values (${symbol}, ${top.bidBps}, ${top.askBps}, ${top.midBps}, ${observedAt}, false)
        on conflict (symbol) do update
          set bid_bps = excluded.bid_bps,
              ask_bps = excluded.ask_bps,
              mid_bps = excluded.mid_bps,
              observed_at = excluded.observed_at,
              stale = false
          where live_instruments.observed_at <= ${demoAt}
      `;
    });
  }
}
