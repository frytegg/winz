import { z } from "zod";

import { parseContracts, parsePriceBps } from "@winz/shared";
import type { BookLevel, Bps, MicroContracts } from "@winz/shared";

/**
 * Messages of the Gemini public WebSocket (wss://ws.gemini.com), as recorded on 17 Nov 2026
 * (apps/engine/fixtures/gemini-ws, README there). Prices and quantities are decimal strings;
 * symbols come back lower-cased; event times `E` are nanoseconds since the epoch.
 */

/** A frame we could not read. The feed logs it and carries on. */
export class GeminiWsMessageError extends Error {
  constructor(
    message: string,
    /** First characters of the frame, for the log. */
    public readonly snippet: string,
  ) {
    super(message);
    this.name = "GeminiWsMessageError";
  }
}

function parses(parse: (input: string) => bigint): (input: string) => boolean {
  return (input) => {
    try {
      parse(input);
      return true;
    } catch {
      // The parser's only failure is "not a valid decimal"; zod reports it with the path.
      return false;
    }
  };
}

const priceSchema = z.string().refine(parses(parsePriceBps), "must be a decimal price in [0, 1]");
const quantitySchema = z
  .string()
  .refine(parses(parseContracts), "must be a decimal contract quantity");
/** Update ids are about 1.8e15 today, inside the exact range of a double. */
const idSchema = z.number().int().nonnegative();
/** Nanoseconds; beyond 2^53, so read as a double and only used at millisecond precision. */
const nanosSchema = z.number().nonnegative();
const levelSchema = z.tuple([priceSchema, quantitySchema]);

const replySchema = z.object({
  id: z.number().int().nullable(),
  status: z.number().int(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number().int(), msg: z.string() }).optional(),
});

/** `<symbol>@depth10` (every second) and `<symbol>@depth10@100ms`: the top 10 levels, no `e`. */
const depthSnapshotSchema = z.object({
  lastUpdateId: idSchema,
  symbol: z.string().min(1),
  bids: z.array(levelSchema),
  asks: z.array(levelSchema),
});

/** `<symbol>@depth`: changed levels only, quantity "0.00" removes the level. */
const depthUpdateSchema = z.object({
  e: z.literal("depthUpdate"),
  E: nanosSchema,
  s: z.string().min(1),
  U: idSchema,
  u: idSchema,
  b: z.array(levelSchema),
  a: z.array(levelSchema),
});

/** An empty side of a book ticker is sent as "" (both price and quantity). */
const emptyString = z.literal("");

/**
 * `<symbol>@bookTicker`: best bid and ask, "" for an empty side. `c`/`C` (last trade) appear only
 * on the first message after subscribing, and only when the instrument has traded.
 */
const bookTickerSchema = z.object({
  u: idSchema,
  E: nanosSchema,
  s: z.string().min(1),
  b: z.union([emptyString, priceSchema]).optional(),
  B: z.union([emptyString, quantitySchema]).optional(),
  a: z.union([emptyString, priceSchema]).optional(),
  A: z.union([emptyString, quantitySchema]).optional(),
  c: z.union([emptyString, priceSchema]).optional(),
  C: z.union([emptyString, quantitySchema]).optional(),
});

/** `<symbol>@trade`: one print. `m` is true when the buyer was the maker. No `e` field. */
const tradeSchema = z.object({
  E: nanosSchema,
  s: z.string().min(1),
  t: idSchema,
  p: priceSchema,
  q: quantitySchema,
  m: z.boolean(),
});

export interface WsReply {
  kind: "reply";
  id: number | null;
  status: number;
  result: unknown;
  error: { code: number; msg: string } | null;
}

export interface WsDepthSnapshot {
  kind: "depthSnapshot";
  /** Lower-cased by Gemini. */
  symbol: string;
  lastUpdateId: number;
  /** Best first, zero-quantity levels dropped. */
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface WsDepthUpdate {
  kind: "depthUpdate";
  symbol: string;
  eventTimeMs: number;
  firstUpdateId: number;
  lastUpdateId: number;
  /** As sent: a zero quantity removes the level. */
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface WsBookTicker {
  kind: "bookTicker";
  symbol: string;
  updateId: number;
  eventTimeMs: number;
  bid: BookLevel | null;
  ask: BookLevel | null;
}

export interface WsTrade {
  kind: "trade";
  symbol: string;
  tradeId: number;
  eventTimeMs: number;
  priceBps: Bps;
  qty: MicroContracts;
  buyerIsMaker: boolean;
}

export type GeminiWsMessage = WsReply | WsDepthSnapshot | WsDepthUpdate | WsBookTicker | WsTrade;

/** Reads one text frame. Throws `GeminiWsMessageError` on anything we do not recognise. */
export function parseGeminiWsMessage(text: string): GeminiWsMessage {
  const snippet = text.slice(0, 200);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GeminiWsMessageError("frame is not JSON", snippet);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new GeminiWsMessageError("frame is not a JSON object", snippet);
  }

  if ("id" in json && "status" in json) {
    const reply = check(replySchema, json, snippet, "reply");
    return {
      kind: "reply",
      id: reply.id,
      status: reply.status,
      result: reply.result,
      error: reply.error ?? null,
    };
  }
  if ("lastUpdateId" in json) {
    const snapshot = check(depthSnapshotSchema, json, snippet, "depth snapshot");
    return {
      kind: "depthSnapshot",
      symbol: snapshot.symbol,
      lastUpdateId: snapshot.lastUpdateId,
      bids: bookSide(snapshot.bids, "bids"),
      asks: bookSide(snapshot.asks, "asks"),
    };
  }
  if ("e" in json) {
    const update = check(depthUpdateSchema, json, snippet, "depth update");
    return {
      kind: "depthUpdate",
      symbol: update.s,
      eventTimeMs: nanosToMs(update.E),
      firstUpdateId: update.U,
      lastUpdateId: update.u,
      bids: update.b.map(toLevel),
      asks: update.a.map(toLevel),
    };
  }
  if ("t" in json && "p" in json) {
    const trade = check(tradeSchema, json, snippet, "trade");
    return {
      kind: "trade",
      symbol: trade.s,
      tradeId: trade.t,
      eventTimeMs: nanosToMs(trade.E),
      priceBps: parsePriceBps(trade.p),
      qty: parseContracts(trade.q),
      buyerIsMaker: trade.m,
    };
  }
  if ("u" in json && "s" in json) {
    const ticker = check(bookTickerSchema, json, snippet, "book ticker");
    return {
      kind: "bookTicker",
      symbol: ticker.s,
      updateId: ticker.u,
      eventTimeMs: nanosToMs(ticker.E),
      bid: tickerLevel(ticker.b, ticker.B),
      ask: tickerLevel(ticker.a, ticker.A),
    };
  }
  throw new GeminiWsMessageError("unknown message kind", snippet);
}

function check<S extends z.ZodType>(
  schema: S,
  json: unknown,
  snippet: string,
  what: string,
): z.infer<S> {
  const parsed = schema.safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue === undefined ? "$" : issue.path.map(String).join(".") || "$";
  throw new GeminiWsMessageError(
    `malformed ${what} at ${path}: ${issue?.message ?? "invalid"}`,
    snippet,
  );
}

function tickerLevel(price: string | undefined, quantity: string | undefined): BookLevel | null {
  if (price === undefined || quantity === undefined || price === "" || quantity === "") return null;
  return toLevel([price, quantity]);
}

function toLevel([price, quantity]: readonly [string, string]): BookLevel {
  return { priceBps: parsePriceBps(price), qty: parseContracts(quantity) };
}

/** Best first (bids descending, asks ascending), empty levels dropped, at most 10. */
export function bookSide(
  levels: readonly (readonly [string, string])[],
  side: "bids" | "asks",
): BookLevel[] {
  return levels
    .map(toLevel)
    .filter((level) => level.qty > 0n)
    .sort((a, b) => {
      const diff = side === "bids" ? b.priceBps - a.priceBps : a.priceBps - b.priceBps;
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    })
    .slice(0, BOOK_DEPTH);
}

/** Levels kept per side, in memory and in book_cache. */
export const BOOK_DEPTH = 10;

function nanosToMs(nanos: number): number {
  return Math.floor(nanos / 1_000_000);
}
