import { z } from "zod";

import { parseContracts, parsePriceBps } from "@winz/shared";

/**
 * Shapes of the Gemini Prediction Markets REST responses, as observed on 17 Nov 2026.
 *
 * Lenient on what we do not use (unknown keys are dropped, unknown enum values pass as
 * strings), strict on what we do: a field we rely on that is missing or malformed fails
 * the whole response, so a silent API change cannot reach pricing or settlement.
 */

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

/** Dollar price of a contract, "0.54" or "0.9": between 0 and 1, at most 4 decimals. */
const priceStringSchema = z
  .string()
  .refine(parses(parsePriceBps), "must be a decimal price between 0 and 1");

/** Contract quantity, "441.19" or "100.0": at most 6 decimals. */
const quantityStringSchema = z
  .string()
  .refine(parses(parseContracts), "must be a decimal contract quantity");

export const rawContractSchema = z.object({
  label: z.string(),
  instrumentSymbol: z.string().min(1),
  /** Seen: "active", "approved" (listed, not trading yet), "settled". */
  status: z.string(),
  /** Seen: "open", "post_only", "closed". */
  marketState: z.string().nullish(),
  prices: z
    .object({
      /** Absent when that side of the book is empty. */
      bestBid: priceStringSchema.nullish(),
      bestAsk: priceStringSchema.nullish(),
    })
    .nullish(),
  /** "home" | "away" | "tie" on moneylines; often absent on spreads and totals. */
  sportsSide: z.string().nullish(),
  /** `type` seen: "spread", "over". */
  strike: z.object({ type: z.string(), value: z.string() }).nullish(),
  isCombo: z.boolean().nullish(),
  /** Present only once the contract is resolved. */
  resolutionSide: z.enum(["yes", "no"]).nullish(),
});
export type RawContract = z.infer<typeof rawContractSchema>;

export const rawParticipantSchema = z.object({
  name: z.string(),
  abbreviation: z.string(),
  /** "home" | "away". */
  side: z.string().nullish(),
});
export type RawParticipant = z.infer<typeof rawParticipantSchema>;

export const rawSportsMarketSchema = z.object({
  /** Seen: "american_football", "basketball", "hockey", "soccer". */
  sport: z.string(),
  /** Seen: "moneyline", "spread", "total", "prop", "to_advance". */
  type: z.string(),
  /** Seen: "contest", "team", "player". A total with subject "team" is a team total. */
  subject: z.string().nullish(),
  /** `type` seen: "full_contest", "regulation" (soccer), "half", "quarter". */
  scope: z.object({ type: z.string() }).nullish(),
  /** Seen: "points", "goals", and player statistics on props. */
  metric: z.string().nullish(),
});
export type RawSportsMarket = z.infer<typeof rawSportsMarketSchema>;

const rawEventFields = {
  ticker: z.string().min(1),
  title: z.string(),
  /** Seen: "active", "approved", "settled". "invalid" is documented, never observed. */
  status: z.string(),
  category: z.string().nullish(),
  /** Absent on futures ("MLS Cup Champion") and other non-game events. */
  startTime: z.iso.datetime().nullish(),
  /**
   * When Gemini resolved the event. Present on settled events; the recently-settled list is
   * sorted on it, newest first (checked on the whole list, 280 events, 19 Nov 2026).
   */
  resolvedAt: z.iso.datetime().nullish(),
  participants: z.array(rawParticipantSchema).nullish(),
  /** Shared by every market of the same game; the only reliable link between them. */
  gameId: z.string().nullish(),
  sportsMarket: rawSportsMarketSchema.nullish(),
  contracts: z.array(rawContractSchema),
};

/** A market nested under a game (spread, total, period markets, props). */
export const rawChildEventSchema = z.object(rawEventFields);
export type RawChildEvent = z.infer<typeof rawChildEventSchema>;

export const rawEventSchema = z.object({
  ...rawEventFields,
  /** The other markets of the same game. They also appear as top-level events. */
  events: z.array(rawChildEventSchema).nullish(),
});
export type RawEvent = z.infer<typeof rawEventSchema>;

export const paginationSchema = z.object({
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const eventsResponseSchema = z.object({
  data: z.array(rawEventSchema),
  pagination: paginationSchema,
});
export type EventsResponse = z.infer<typeof eventsResponseSchema>;

const rawBookLevelSchema = z.object({
  price: priceStringSchema,
  amount: quantityStringSchema,
});

export const bookResponseSchema = z.object({
  bids: z.array(rawBookLevelSchema),
  asks: z.array(rawBookLevelSchema),
});
export type BookResponse = z.infer<typeof bookResponseSchema>;
