import type { Book } from "@winz/shared";
import { z } from "zod";

import type { Db } from "./db";
import { serverLogger } from "./logger";
import type { LiveQuoteRow } from "./wire";

/**
 * Order books as the engine stores them in `book_cache` (migration 20261117020000): `bids` and
 * `asks` are JSON arrays of `{"priceBps": integer, "qty": "<micro-contracts as digits>"}`, best
 * level first, and `observed_at` says how old the book is. The web app never talks to Gemini.
 */

const storedLevelSchema = z
  .object({
    priceBps: z.number().int().min(0).max(10_000),
    qty: z.string().regex(/^\d+$/, "micro-contracts as digits"),
  })
  .transform((level) => ({ priceBps: BigInt(level.priceBps), qty: BigInt(level.qty) }));

const bookCacheRowSchema = z.object({
  symbol: z.string().min(1),
  bids: z.array(storedLevelSchema),
  asks: z.array(storedLevelSchema),
  observed_at: z.date(),
});

/** Raised when a `book_cache` row does not have the documented shape. */
export class BookCacheRowError extends Error {
  constructor(
    public readonly symbol: string,
    public readonly issues: readonly string[],
  ) {
    super(`book_cache row of ${symbol} is malformed: ${issues[0] ?? "unknown"}`);
    this.name = "BookCacheRowError";
  }
}

/** Parses one `book_cache` row (as postgres.js returns it) into the shared `Book`. */
export function parseBookCacheRow(symbol: string, row: unknown): Book {
  const parsed = bookCacheRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new BookCacheRowError(
      symbol,
      parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join(".") || "$"}: ${issue.message}`,
      ),
    );
  }
  return {
    instrumentSymbol: parsed.data.symbol,
    bids: parsed.data.bids,
    asks: parsed.data.asks,
    observedAtMs: parsed.data.observed_at.getTime(),
  };
}

/**
 * The latest cached book of `symbol`, or null when the engine has none yet. A malformed row is
 * logged as an error and treated as no book: the caller then shows "no price yet", never a price
 * computed on a book it could not read. The caller still checks the book's age.
 */
export async function readCachedBook(db: Db, symbol: string): Promise<Book | null> {
  const rows = await db`
    select symbol, bids, asks, observed_at from book_cache where symbol = ${symbol}
  `;
  const row: unknown = rows[0];
  if (row === undefined) return null;
  try {
    return parseBookCacheRow(symbol, row);
  } catch (error: unknown) {
    if (!(error instanceof BookCacheRowError)) throw error;
    serverLogger("books").error({ err: error, symbol }, "unreadable book_cache row");
    return null;
  }
}

/**
 * Exposure already sold on the instrument and not hedged yet, in micro-contracts: `exposure −
 * held` of its `positions` row, floored at zero, and zero without a row. That slice of the asks is
 * promised to earlier sales, so a new sale is priced behind it.
 */
export async function unhedgedExposure(db: Db, symbol: string): Promise<bigint> {
  const [row] = await db<{ pending: bigint }[]>`
    select greatest(exposure - held, 0)::bigint as pending from positions where instrument = ${symbol}
  `;
  return row?.pending ?? 0n;
}

/** The engine's live quote of `symbol` (`live_instruments`), or null when it has none. */
export async function readLiveQuote(db: Db, symbol: string): Promise<LiveQuoteRow | null> {
  const [row] = await db<LiveQuoteRow[]>`
    select mid_bps, stale, observed_at from live_instruments where symbol = ${symbol}
  `;
  return row ?? null;
}
