import type { Book, BookLevel } from "@winz/shared";

import type { Db } from "../db";
import type { BookSource } from "./book-transport";

/** What the book feed reads and writes in Postgres. */
export interface BookStore {
  /**
   * Instruments to follow: those of campaigns whose status is live, paused or sales_closed (not
   * settled yet), plus the tracked_instruments rows whose expires_at is after `nowMs`.
   */
  listTrackedSymbols(nowMs: number): Promise<string[]>;
  /** Upserts book_cache and live_instruments (stale = false). An older book never overwrites a newer one. */
  writeBook(book: Book, source: BookSource): Promise<void>;
  /**
   * Sets live_instruments.stale = true; a no-op when the instrument has no row. With
   * `observedAtOrBeforeMs`, only a row whose book is no newer than that is marked, so a writer
   * that stops (shutdown during a redeploy overlap) never flags the book another writer just put.
   *
   * The flag is best effort (a crashed engine sets nothing): readers must also check that
   * observed_at is within BOOK_STALE_AFTER_MS, never trust `stale = false` alone.
   */
  markStale(symbol: string, options?: MarkStaleOptions): Promise<void>;
}

export interface MarkStaleOptions {
  observedAtOrBeforeMs?: number;
}

/** One level as stored in book_cache: price as a number of bps, quantity as micro-contract digits. */
export interface StoredBookLevel {
  priceBps: number;
  qty: string;
}

export function serializeBookSide(levels: readonly BookLevel[]): StoredBookLevel[] {
  return levels.map((level) => ({ priceBps: Number(level.priceBps), qty: level.qty.toString() }));
}

/** Best bid, best ask and the floor of their mean, in bps; null where a side is empty. */
export function topOfBook(book: Book): {
  bidBps: number | null;
  askBps: number | null;
  midBps: number | null;
} {
  const bid = book.bids[0]?.priceBps ?? null;
  const ask = book.asks[0]?.priceBps ?? null;
  const mid = bid !== null && ask !== null ? (bid + ask) / 2n : null;
  return {
    bidBps: bid === null ? null : Number(bid),
    askBps: ask === null ? null : Number(ask),
    midBps: mid === null ? null : Number(mid),
  };
}

/**
 * A campaign needs its book until it settles, not only while it sells: once sales close (at
 * kick-off) the ticket shows the live chance during the game (SPEC 5.4), the merchant dashboard
 * and the Hedge desk follow it, and the hedge reconciles at sales close on it (HE-6). The same
 * statuses as the catalogue's and the settlement's "not settled yet".
 */
const TRACKED_CAMPAIGN_STATUSES = ["live", "paused", "sales_closed"] as const;

export class PgBookStore implements BookStore {
  constructor(private readonly db: Db) {}

  async listTrackedSymbols(nowMs: number): Promise<string[]> {
    const rows = await this.db<{ symbol: string }[]>`
      select instrument as symbol from campaigns
       where status in ${this.db(TRACKED_CAMPAIGN_STATUSES)}
      union
      select symbol from tracked_instruments where expires_at > ${new Date(nowMs)}
      order by symbol
    `;
    return rows.map((row) => row.symbol);
  }

  async writeBook(book: Book, source: BookSource): Promise<void> {
    const observedAt = new Date(book.observedAtMs);
    // Passed through `sql.json`: a JSON string bound to a jsonb parameter would be stored as a string.
    const bids = this.db.json(serializeBookSide(book.bids));
    const asks = this.db.json(serializeBookSide(book.asks));
    const top = topOfBook(book);
    await this.db.begin(async (sql) => {
      await sql`
        insert into book_cache (symbol, bids, asks, observed_at, source)
        values (${book.instrumentSymbol}, ${bids}, ${asks}, ${observedAt}, ${source})
        on conflict (symbol) do update
          set bids = excluded.bids,
              asks = excluded.asks,
              observed_at = excluded.observed_at,
              source = excluded.source
          where book_cache.observed_at <= excluded.observed_at
      `;
      await sql`
        insert into live_instruments (symbol, bid_bps, ask_bps, mid_bps, observed_at, stale)
        values (${book.instrumentSymbol}, ${top.bidBps}, ${top.askBps}, ${top.midBps}, ${observedAt}, false)
        on conflict (symbol) do update
          set bid_bps = excluded.bid_bps,
              ask_bps = excluded.ask_bps,
              mid_bps = excluded.mid_bps,
              observed_at = excluded.observed_at,
              stale = false
          where live_instruments.observed_at <= excluded.observed_at
      `;
    });
  }

  async markStale(symbol: string, options: MarkStaleOptions = {}): Promise<void> {
    const bound = options.observedAtOrBeforeMs;
    if (bound === undefined) {
      await this
        .db`update live_instruments set stale = true where symbol = ${symbol} and not stale`;
      return;
    }
    await this.db`
      update live_instruments set stale = true
       where symbol = ${symbol} and not stale and observed_at <= ${new Date(bound)}
    `;
  }
}
