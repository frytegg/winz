import { z } from "zod";

import type { Book } from "@winz/shared";

import type { Db } from "../db";

/**
 * Reads book_cache back into the shared `Book`. Written for the engine, meant to be copied by the
 * web app's API lane (which never talks to Gemini): it depends on zod and the row only.
 */

const storedLevelSchema = z
  .object({
    priceBps: z.number().int().min(0).max(10_000),
    qty: z.string().regex(/^\d+$/, "must be micro-contracts as digits"),
  })
  .transform((level) => ({ priceBps: BigInt(level.priceBps), qty: BigInt(level.qty) }));

export const bookCacheRowSchema = z.object({
  symbol: z.string().min(1),
  bids: z.array(storedLevelSchema),
  asks: z.array(storedLevelSchema),
  /** A `Date` from postgres.js, an ISO string from supabase-js. */
  observed_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  source: z.enum(["ws", "rest", "demo"]),
});
export type BookCacheRow = z.input<typeof bookCacheRowSchema>;

/** Raised when a book_cache row does not have the documented shape. */
export class BookCacheRowError extends Error {
  constructor(
    public readonly symbol: string,
    public readonly issues: readonly string[],
  ) {
    super(`book_cache row of ${symbol} is malformed: ${issues[0] ?? "unknown"}`);
    this.name = "BookCacheRowError";
  }
}

/** Parses one book_cache row. Levels are kept in stored order (best first). */
export function parseBookCacheRow(row: unknown): Book & { source: "ws" | "rest" | "demo" } {
  const parsed = bookCacheRowSchema.safeParse(row);
  if (!parsed.success) {
    const symbol =
      typeof row === "object" && row !== null && "symbol" in row && typeof row.symbol === "string"
        ? row.symbol
        : "?";
    throw new BookCacheRowError(
      symbol,
      parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join(".") || "$"}: ${issue.message}`,
      ),
    );
  }
  const { symbol, bids, asks, observed_at: observedAt, source } = parsed.data;
  const observedAtMs = observedAt instanceof Date ? observedAt.getTime() : Date.parse(observedAt);
  return { instrumentSymbol: symbol, bids, asks, observedAtMs, source };
}

/**
 * The latest cached book of `symbol`, or null when the engine has none. The caller still checks
 * `observedAtMs` against BOOK_STALE_AFTER_MS: a cached book can be old.
 */
export async function readCachedBook(db: Db, symbol: string): Promise<Book | null> {
  const rows = await db`
    select symbol, bids, asks, observed_at, source from book_cache where symbol = ${symbol}
  `;
  const row: unknown = rows[0];
  if (row === undefined) return null;
  const { source: _source, ...book } = parseBookCacheRow(row);
  return book;
}
