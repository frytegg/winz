import { z } from "zod";

import {
  CAMPAIGN_STATUSES,
  CHECKOUT_STATUSES,
  EXECUTION_VENUES,
  INSTRUMENT_TYPES,
  MERCHANT_CATEGORIES,
  ORDER_KINDS,
  ORDER_STATUSES,
  OUTCOMES,
  SALE_STATES,
  SPORTS,
  TICKET_PHASES,
  USER_ROLES,
} from "../domain";

/**
 * Wire format of the HTTP API (SPEC section 10). Frozen after gate G0: the front and the back
 * both build against these shapes.
 *
 * JSON conventions:
 * - money is a string of micro-USDC digits ("20000000" = $20.00), because JSON has no bigint;
 * - probabilities, rates and prices are integers in basis points (1240 = 12.4 %);
 * - contract quantities are strings of micro-contract digits;
 * - timestamps are ISO 8601 strings in UTC.
 */

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

export const microUsdcSchema = z.string().regex(/^\d+$/, "micro-USDC as a string of digits");
/** A strictly positive amount: the contract refuses a zero unit price. */
export const positiveMicroUsdcSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "a positive amount of micro-USDC as a string of digits");
export const microContractsSchema = z
  .string()
  .regex(/^\d+$/, "micro-contracts as a string of digits");
export const bpsSchema = z.number().int().min(0).max(10_000);
export const isoDateSchema = z.iso.datetime();
/**
 * A `timestamptz` as Postgres writes it in a row pushed by Supabase Realtime: with an offset and
 * microseconds ("2026-11-21T20:00:00.123456+00:00"), never the "Z" of `toISOString()` that the
 * API's own answers end with. `isoDateSchema` refuses that form, so a row checked with it was
 * dropped on every push. Both forms pass here.
 */
export const pgTimestampSchema = z.iso.datetime({ offset: true });
export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/);
export const emailSchema = z.email();

export const merchantCategorySchema = z.enum(MERCHANT_CATEGORIES);
export const sportSchema = z.enum(SPORTS);
export const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES);
export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export const saleStateSchema = z.enum(SALE_STATES);
export const outcomeSchema = z.enum(OUTCOMES);
export const ticketPhaseSchema = z.enum(TICKET_PHASES);
export const checkoutStatusSchema = z.enum(CHECKOUT_STATUSES);
export const userRoleSchema = z.enum(USER_ROLES);
export const executionVenueSchema = z.enum(EXECUTION_VENUES);

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export const API_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "invalid_request",
  "sales_paused",
  "sales_closed",
  "no_book",
  "conflict",
  "internal",
] as const;

/** Body of every non-2xx answer. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    /** English, safe to show to the user. */
    message: z.string(),
  }),
});

// ---------------------------------------------------------------------------------------------
// Identity: GET /api/me, POST /api/merchants
// ---------------------------------------------------------------------------------------------

export const merchantSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  category: merchantCategorySchema,
  logoUrl: z.url().nullable(),
  /** Usual margin pre-filled on screen M6 for this category. */
  defaultUsualMarginBps: bpsSchema,
});

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: emailSchema,
    roles: z.array(userRoleSchema),
    /** Only for the collapsed "technical details" of the merchant settings. Never shown to a fan. */
    walletAddress: addressSchema.nullable(),
  }),
  merchant: merchantSchema.nullable(),
  /** Available now, and waiting for a game to settle. Merchant only; null for a fan. */
  balance: z
    .object({
      available: microUsdcSchema,
      pending: microUsdcSchema,
    })
    .nullable(),
});

export const createMerchantRequestSchema = z.object({
  name: z.string().min(1).max(80),
  category: merchantCategorySchema,
  logoUrl: z.url().optional(),
});
export const createMerchantResponseSchema = merchantSchema;

// ---------------------------------------------------------------------------------------------
// Catalogue: GET /api/events?sport=
// ---------------------------------------------------------------------------------------------

export const teamSchema = z.object({
  name: z.string(),
  abbreviation: z.string(),
  logoUrl: z.url().nullable(),
});

/** Which team of the game a condition is about. */
export const TEAM_SIDES = ["home", "away"] as const;
export const teamSideSchema = z.enum(TEAM_SIDES);

/**
 * A team on the events list (screen M3): `teamSchema` plus its chance of winning. Only the events
 * list carries the chance; every other answer uses `teamSchema`.
 */
export const eventTeamSchema = teamSchema.extend({
  /**
   * The team's chance of winning: the mid ((best bid + best ask) / 2, rounded down) of its own
   * moneyline contract, from the same catalogue quote as the templates' `probabilityBps`. Null
   * when the game has no moneyline contract for this team or no fresh two-sided quote for it.
   * The home and away chances are two separate markets: they need not add up to 100 %.
   */
  winProbabilityBps: bpsSchema.nullable(),
});

/**
 * The game a campaign or a ticket is about, from the event's row: what screens C1, C3 and the
 * merchant's detail need for the teams, their abbreviations and the sport's illustration.
 */
export const campaignEventSchema = z.object({
  sport: sportSchema,
  league: z.string(),
  home: teamSchema,
  away: teamSchema,
});

/** One ready-made promo for a game (screen M4). */
export const promoTemplateSchema = z.object({
  id: z.string(),
  instrumentSymbol: z.string(),
  type: instrumentTypeSchema,
  /** The condition alone: "Texas wins by 14+". */
  conditionLabel: z.string(),
  /** The card title: "Free if Texas wins by 14+". */
  headline: z.string(),
  /**
   * The team the condition is about, as the label writes it: "Texas" for "Texas wins by 14+".
   * Null when the condition is not about one team: a game total ("Over 45.5 points") or a draw.
   */
  subjectName: z.string().nullable(),
  /**
   * Which team of the game `subjectName` is: null when the condition is not about one team, and
   * also, rarely, when the catalogue could not tell which side a contract is on (some spread
   * contracts come without one): then `subjectName` is still set. Never guessed from the names.
   */
  team: teamSideSchema.nullable(),
  refundBps: bpsSchema,
  /** Market probability of the condition (mid price). Null when the book has no two-sided quote. */
  probabilityBps: bpsSchema.nullable(),
  /** Estimated cost of one sale as a share of its price, fees included. Null without a quote. */
  costBps: bpsSchema.nullable(),
  /** False when the contract has no two-sided book: the card is shown disabled. */
  available: z.boolean(),
  unavailableReason: z.enum(["no_book", "stale_book"]).nullable(),
});

export const eventSummarySchema = z.object({
  ticker: z.string(),
  title: z.string(),
  sport: sportSchema,
  league: z.string(),
  startsAt: isoDateSchema,
  /** Five minutes before the start. */
  salesCloseAt: isoDateSchema,
  home: eventTeamSchema,
  away: eventTeamSchema,
  templates: z.array(promoTemplateSchema),
});

export const eventsQuerySchema = z.object({
  sport: sportSchema.optional(),
  search: z.string().max(80).optional(),
});
export const eventsResponseSchema = z.object({
  events: z.array(eventSummarySchema),
});

// ---------------------------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------------------------

/** What the merchant sets on screens M5 and M6. */
export const campaignTermsSchema = z.object({
  instrumentSymbol: z.string(),
  unitPrice: positiveMicroUsdcSchema,
  refundBps: bpsSchema.min(1),
  usualMarginBps: bpsSchema,
  minMarginBps: bpsSchema,
  budget: microUsdcSchema,
});

/** POST /api/campaigns/preview: recomputed at every move of a slider on M6. */
export const campaignPreviewRequestSchema = campaignTermsSchema;
export const campaignPreviewResponseSchema = z.object({
  /** Usual margin minus minimum margin. */
  maxCostBps: bpsSchema,
  /** "Your promo pauses if the chances go above X %". */
  pauseThresholdBps: bpsSchema,
  currentProbabilityBps: bpsSchema.nullable(),
  /** Cost of one sale at the current price, fees included. Null without a quote. */
  costPerSale: microUsdcSchema.nullable(),
  marginKeptPerSale: microUsdcSchema.nullable(),
  marginKeptBps: bpsSchema.nullable(),
  capacity: z.object({
    /** "Up to N sales". */
    sales: z.number().int().min(0),
    limitedBy: z.enum(["budget", "depth"]),
  }),
  /** Whether the campaign could sell right now with these terms. */
  saleState: saleStateSchema,
  bookAsOf: isoDateSchema.nullable(),
});

/**
 * POST /api/campaigns: creates the draft and the payment of its budget (screen M7). The request is
 * idempotent on its `requestId`: sent again by the same merchant, it answers the same campaign and
 * the same payment and creates nothing (one exception, on `requestId` below).
 */
export const createCampaignRequestSchema = campaignTermsSchema.extend({
  product: z.string().min(1).max(80),
  /**
   * Chosen by the front once per "Fund" tap (a uuid) and kept for every retry of that request.
   * Required: a request without it is refused 400 (`invalid_request`), because nothing else
   * tells a double tap or a retry after a network cut from a new request, and either would
   * create a second campaign and a second payment. The same `requestId` with other terms
   * answers 409.
   * One exception to "the same campaign and the same payment": a `funding` campaign whose payment
   * was cancelled at Stripe before being paid is discarded, and the repeat answers a NEW
   * `campaignId` and a new payment; the front always uses the `campaignId` and `clientSecret` of
   * the LAST answer.
   */
  requestId: z.uuid(),
});
export const createCampaignResponseSchema = z.object({
  campaignId: z.string(),
  status: campaignStatusSchema,
  budgetPayment: z.object({
    paymentIntentId: z.string(),
    clientSecret: z.string(),
    amount: microUsdcSchema,
  }),
});

export const campaignSummarySchema = z.object({
  id: z.string(),
  /** Null until the campaign is live on-chain. */
  slug: slugSchema.nullable(),
  product: z.string(),
  /** "100% back if Texas wins by 14+". */
  promise: z.string(),
  status: campaignStatusSchema,
  saleState: saleStateSchema,
  eventTitle: z.string(),
  /** The game: sport, league and both teams. */
  event: campaignEventSchema,
  startsAt: isoDateSchema,
  salesCloseAt: isoDateSchema,
  /** Units sold. */
  sales: z.number().int().min(0),
  /** Total paid by customers. */
  revenue: microUsdcSchema,
  /** When the merchant created it (POST /api/campaigns). */
  createdAt: isoDateSchema,
  /**
   * When it went live on-chain; null until then. A campaign whose budget was never paid stays
   * `funding` with `liveAt` null: the back end never expires it.
   */
  liveAt: isoDateSchema.nullable(),
});

export const campaignReportSchema = z.object({
  sales: z.number().int().min(0),
  newCustomers: z.number().int().min(0),
  hedgeCost: microUsdcSchema,
  /** Real cost of the promo as a share of revenue. */
  hedgeCostBps: bpsSchema,
  /** The flat discount that would have cost the same. */
  equivalentDiscountBps: bpsSchema,
  refundsPaid: microUsdcSchema,
  paidToMerchant: microUsdcSchema,
});

export const campaignDetailSchema = campaignSummarySchema.extend({
  conditionLabel: z.string(),
  /** The team the condition is about, as `conditionLabel` writes it ("Texas"); null otherwise. */
  subjectName: z.string().nullable(),
  /**
   * The condition in the past tense once settled: "Texas won by 14+" on YES, "Texas did not win
   * by 14+" on NO. Null before the result and for a void game.
   */
  resultLabel: z.string().nullable(),
  instrumentSymbol: z.string(),
  unitPrice: microUsdcSchema,
  refundBps: bpsSchema,
  usualMarginBps: bpsSchema,
  minMarginBps: bpsSchema,
  pauseThresholdBps: bpsSchema,
  probabilityBps: bpsSchema.nullable(),
  budget: microUsdcSchema,
  hedgeSpent: microUsdcSchema,
  hedgeReserved: microUsdcSchema,
  budgetAvailable: microUsdcSchema,
  /** Sum of refundable amounts: what the hedge must pay on YES. */
  exposure: microUsdcSchema,
  /** Share of the exposure already hedged (the 0–100 % gauge). */
  hedgedBps: bpsSchema,
  capacitySales: z.number().int().min(0),
  /** Non-refundable part already paid to the merchant. */
  received: microUsdcSchema,
  /** Refundable part, released or paid after the game. */
  pending: microUsdcSchema,
  outcome: outcomeSchema.nullable(),
  /** Public link of the campaign page; null until live. */
  url: z.url().nullable(),
  /** Collapsed "technical details" of the settings screen. */
  onchain: z
    .object({
      campaignId: z.string(),
      escrowAddress: addressSchema,
      explorerUrl: z.url(),
    })
    .nullable(),
  report: campaignReportSchema.nullable(),
  demo: z.boolean(),
});

export const campaignsResponseSchema = z.object({
  campaigns: z.array(campaignSummarySchema),
});

/** POST /api/campaigns/:id/pause | /resume | /close */
export const campaignActionResponseSchema = z.object({
  status: campaignStatusSchema,
  saleState: saleStateSchema,
});

/**
 * POST /api/campaigns/:id/top-up (SPEC CA-6): the merchant adds hedge budget to their running
 * campaign, paid by card like the first budget. `requestId` makes the request idempotent: sent
 * again, it answers the same payment and creates nothing.
 */
export const topUpCampaignRequestSchema = z.object({
  /** The top-up, micro-USDC, a whole number of cents between $0.50 and $999,999.99. */
  amount: positiveMicroUsdcSchema,
  /** Chosen by the front once per top-up and kept for its retries. */
  requestId: z.uuid(),
});
export const topUpCampaignResponseSchema = z.object({
  campaignId: z.string(),
  requestId: z.uuid(),
  /** The top-up, micro-USDC. */
  amount: microUsdcSchema,
  /** Same shape as `createCampaignResponseSchema.budgetPayment`: what Stripe's sheet needs. */
  budgetPayment: z.object({
    paymentIntentId: z.string(),
    clientSecret: z.string(),
    amount: microUsdcSchema,
  }),
  /**
   * Where the top-up stands: `requires_payment` (the sheet can be paid), `processing` (paid, on
   * its way to the escrow) or `credited` (in the budget: nothing more to pay). A repeated request
   * for a top-up that ended otherwise (cancelled, declined, replaced, refunded) answers 409.
   */
  status: z.enum(["requires_payment", "processing", "credited"]).optional(),
});

// ---------------------------------------------------------------------------------------------
// Public campaign page: GET /api/c/:slug
// ---------------------------------------------------------------------------------------------

export const publicCampaignSchema = z.object({
  slug: slugSchema,
  merchant: z.object({
    name: z.string(),
    logoUrl: z.url().nullable(),
    category: merchantCategorySchema,
  }),
  product: z.string(),
  unitPrice: microUsdcSchema,
  refundBps: bpsSchema,
  promise: z.string(),
  conditionLabel: z.string(),
  /** The team the condition is about, as `conditionLabel` writes it ("Texas"); null otherwise. */
  subjectName: z.string().nullable(),
  /** The condition in the past tense once settled ("Texas won by 14+"); null before and on void. */
  resultLabel: z.string().nullable(),
  eventTitle: z.string(),
  /** The game: sport, league and both teams. */
  event: campaignEventSchema,
  /** "12 % chance it's free". Null when no fresh quote exists. */
  probabilityBps: bpsSchema.nullable(),
  saleState: saleStateSchema,
  startsAt: isoDateSchema,
  salesCloseAt: isoDateSchema,
  outcome: outcomeSchema.nullable(),
  /** Realtime key: subscribe to `live_instruments` with this symbol for the live odds. */
  instrumentSymbol: z.string(),
  demo: z.boolean(),
});

// ---------------------------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------------------------

/** POST /api/checkout. Answers 409 `sales_paused` or `sales_closed` when the promo cannot sell. */
export const checkoutRequestSchema = z.object({
  slug: slugSchema,
  qty: z.number().int().min(1).max(20),
});
export const checkoutResponseSchema = z.object({
  paymentIntentId: z.string(),
  /** For Stripe's Express Checkout Element. The card is authorized, not captured. */
  clientSecret: z.string(),
  amount: microUsdcSchema,
});

/** POST /api/checkout/:pi/confirm and GET /api/checkout/:pi. Poll until `ticketed` or a failure. */
export const checkoutStatusResponseSchema = z.object({
  status: checkoutStatusSchema,
  /** Set when `ticketed`: open `/t/<ticketToken>`. */
  ticketToken: z.string().nullable(),
  /** Set on `cancelled_paused` ("Promo just paused, you were not charged") or `failed`. */
  message: z.string().nullable(),
});

// ---------------------------------------------------------------------------------------------
// Tickets: GET /api/t/:token, GET /api/tickets
// ---------------------------------------------------------------------------------------------

export const ticketSchema = z.object({
  /** Secret capability: whoever holds the link sees the ticket. */
  token: z.string(),
  campaignSlug: slugSchema,
  merchant: z.object({
    name: z.string(),
    logoUrl: z.url().nullable(),
  }),
  product: z.string(),
  qty: z.number().int().min(1),
  paid: microUsdcSchema,
  refundable: microUsdcSchema,
  promise: z.string(),
  conditionLabel: z.string(),
  /** The team the condition is about, as `conditionLabel` writes it ("Texas"); null otherwise. */
  subjectName: z.string().nullable(),
  /** The condition in the past tense once settled ("Texas won by 14+"); null before and on void. */
  resultLabel: z.string().nullable(),
  eventTitle: z.string(),
  /** The game: sport, league and both teams. */
  event: campaignEventSchema,
  phase: ticketPhaseSchema,
  /** Live chance; null once the game is settled or when no fresh quote exists. */
  probabilityBps: bpsSchema.nullable(),
  startsAt: isoDateSchema,
  purchasedAt: isoDateSchema,
  refundedAt: isoDateSchema.nullable(),
  /** Realtime key for the live odds. */
  instrumentSymbol: z.string(),
  demo: z.boolean(),
});

export const ticketsResponseSchema = z.object({
  tickets: z.array(ticketSchema),
  refundedTotal: microUsdcSchema,
});

// ---------------------------------------------------------------------------------------------
// Hedge desk: GET /api/hedge-desk
// ---------------------------------------------------------------------------------------------

export const hedgeOrderSchema = z.object({
  id: z.string(),
  kind: z.enum(ORDER_KINDS),
  side: z.enum(["buy", "sell"]),
  priceBps: bpsSchema,
  qty: microContractsSchema,
  filledQty: microContractsSchema,
  status: z.enum(ORDER_STATUSES),
  at: isoDateSchema,
});

export const hedgeFillSchema = z.object({
  id: z.string(),
  kind: z.enum(ORDER_KINDS),
  priceBps: bpsSchema,
  qty: microContractsSchema,
  fee: microUsdcSchema,
  at: isoDateSchema,
});

export const hedgeInstrumentSchema = z.object({
  symbol: z.string(),
  label: z.string(),
  eventTitle: z.string(),
  startsAt: isoDateSchema,
  bidBps: bpsSchema.nullable(),
  askBps: bpsSchema.nullable(),
  bookAsOf: isoDateSchema.nullable(),
  stale: z.boolean(),
  /** E: contracts owed if YES. */
  exposure: microContractsSchema,
  /** H: contracts held. */
  held: microContractsSchema,
  /** W: maker orders resting. */
  working: microContractsSchema,
  /** (E − H) × price, in dollars. Must stay under `params.uMax`. */
  unhedgedNotional: microUsdcSchema,
  breaker: z.object({
    active: z.boolean(),
    reason: z.enum(["venue_down", "stale_book", "unhedged_limit"]).nullable(),
  }),
  orders: z.array(hedgeOrderSchema),
  fills: z.array(hedgeFillSchema),
  /** What maker execution saved against filling everything as taker. */
  makerSavings: microUsdcSchema,
});

export const hedgeDeskResponseSchema = z.object({
  venue: executionVenueSchema,
  /** Shown as-is: "PAPER · live Gemini book". */
  venueLabel: z.string(),
  /** The known limit of the venue, in one sentence. */
  venueNote: z.string(),
  params: z.object({
    uMax: microUsdcSchema,
    makerTtlSeconds: z.number().int().positive(),
    askMoveTicks: z.number().int().positive(),
    toleranceTicks: z.number().int().min(0),
    forceTakerMinutes: z.number().int().positive(),
  }),
  instruments: z.array(hedgeInstrumentSchema),
  totals: z.object({
    makerSavings: microUsdcSchema,
    /** Paid by Winz when a fill came in above a quote's guarantee. */
    guaranteeLosses: microUsdcSchema,
    crossingGains: microUsdcSchema,
  }),
  /**
   * The latest run of the real-order check on the Gemini sandbox (SPEC HE-10): a maker order
   * placed, then cancelled, and an order filled, each read back from Gemini. Null when it never
   * ran. A failed run says at which step and why. Runs recorded before the check had runs (rows of
   * `venue_checks` alone) carry nulls in the fields they do not have.
   */
  venueCheck: z
    .object({
      ranAt: isoDateSchema,
      /** Where the orders went: "gemini-sandbox" (test funds). */
      venue: executionVenueSchema.nullable(),
      outcome: z.enum(["proven", "failed"]).nullable(),
      failedStep: z
        .enum(["preflight", "instrument", "placed_maker", "cancelled", "filled"])
        .nullable(),
      /** Why it failed, in one line. */
      failure: z.string().nullable(),
      orders: z.array(
        z.object({
          venueOrderId: z.string(),
          instrumentSymbol: z.string(),
          action: z.enum(["placed_maker", "cancelled", "filled"]),
          at: isoDateSchema,
          side: z.enum(["buy", "sell"]).nullable(),
          kind: z.enum(ORDER_KINDS).nullable(),
          priceBps: bpsSchema.nullable(),
          qty: microContractsSchema.nullable(),
          filledQty: microContractsSchema.nullable(),
          /** Gemini's own status when read back: "open", "cancelled", "filled". */
          status: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
  demo: z.boolean(),
});

// ---------------------------------------------------------------------------------------------
// Demo mode: POST /api/admin/demo/* (header `x-admin-key`)
// ---------------------------------------------------------------------------------------------

/** POST /api/admin/demo/book: drive the simulated book of one instrument. */
export const demoBookRequestSchema = z.object({
  instrumentSymbol: z.string(),
  bidBps: bpsSchema,
  askBps: bpsSchema,
  /** Contracts available at each of the best levels. */
  depth: microContractsSchema,
});

/** POST /api/admin/demo/result: force the result of an instrument. */
export const demoResultRequestSchema = z.object({
  instrumentSymbol: z.string(),
  outcome: outcomeSchema,
});

/** POST /api/admin/demo/sale: replay a sale without a card. */
export const demoSaleRequestSchema = z.object({
  slug: slugSchema,
  qty: z.number().int().min(1).max(20),
  email: emailSchema,
});

/** POST /api/admin/demo/reset: drop every demo override. */
export const demoResetRequestSchema = z.object({});

export const demoResponseSchema = z.object({
  ok: z.literal(true),
  demo: z.literal(true),
  /** Set by /sale once the ticket is issued; null while it is not, and for the other routes. */
  ticketToken: z.string().nullable(),
  /**
   * Set by /sale: the payment of the replayed sale. When `ticketToken` is still null, follow it
   * with GET /api/checkout/:pi exactly like a card payment. Null for the other routes.
   */
  paymentIntentId: z.string().nullable(),
});

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------

export const webhookAckSchema = z.object({
  received: z.literal(true),
});

// ---------------------------------------------------------------------------------------------
// Realtime rows (public Supabase tables, read-only, no personal data)
// ---------------------------------------------------------------------------------------------
//
// A pushed row is not written like an answer of the API. Supabase Realtime builds the record with
// `realtime.cast`, that is `to_jsonb(value::type)` (supabase/realtime,
// lib/realtime/tenants/repo/migrations/20260218120000_fix_bytea_double_encoding_in_cast.ex), sends
// it as JSON, and realtime-js converts each field by its column type (@supabase/realtime-js
// 2.119.0, src/lib/transformers.ts `convertCell`: int2, int4, int8 and numeric through `toNumber`,
// which leaves a number as it is; bool through `toBoolean`; text and timestamptz unchanged). Column
// by column (supabase/migrations/20261117000000_init.sql), checked with to_jsonb on Postgres 16:
//
// - text: a JSON string;
// - integer: a JSON number;
// - bigint: a JSON number with every digit, which `JSON.parse` rounds beyond 2^53 - 1
//   (9007199254740993 arrives as 9007199254740992);
// - boolean: true or false;
// - timestamptz: "2026-11-21T20:00:00.123456+00:00", an offset and 0 to 6 decimals;
// - NULL: null.
//
// The schemas accept exactly that and hand the screens the types of the API's schemas: money as a
// string of micro-USDC digits.

/**
 * `live_instruments`: symbol text, bid_bps / ask_bps / mid_bps integer (nullable), observed_at
 * timestamptz, stale boolean.
 */
export const liveInstrumentRowSchema = z.object({
  symbol: z.string(),
  bid_bps: z.number().int().nullable(),
  ask_bps: z.number().int().nullable(),
  mid_bps: z.number().int().nullable(),
  observed_at: pgTimestampSchema,
  stale: z.boolean(),
});

/**
 * `live_campaigns`: slug text, sale_state text, sales integer, exposure bigint, hedged_bps integer,
 * outcome text (nullable), updated_at timestamptz.
 *
 * `exposure` arrives as a number and leaves as the API's string of digits; the API's string is
 * still accepted. A value beyond `Number.MAX_SAFE_INTEGER` micro-USDC (about 9 billion dollars) has
 * been rounded by `JSON.parse` before any code of ours sees it: the exact amount is gone, so the
 * row is refused (`.int()` accepts only safe integers) rather than shown with an amount that is
 * not the database's.
 */
export const liveCampaignRowSchema = z.object({
  slug: slugSchema,
  sale_state: saleStateSchema,
  sales: z.number().int(),
  exposure: z.union([
    z
      .number()
      .int()
      .nonnegative()
      .transform((value) => String(value)),
    microUsdcSchema,
  ]),
  hedged_bps: z.number().int(),
  outcome: outcomeSchema.nullable(),
  updated_at: pgTimestampSchema,
});

// ---------------------------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------------------------

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export type Merchant = z.infer<typeof merchantSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type CreateMerchantRequest = z.infer<typeof createMerchantRequestSchema>;
export type Team = z.infer<typeof teamSchema>;
export type TeamSide = z.infer<typeof teamSideSchema>;
export type EventTeam = z.infer<typeof eventTeamSchema>;
export type CampaignEvent = z.infer<typeof campaignEventSchema>;
export type PromoTemplate = z.infer<typeof promoTemplateSchema>;
export type EventSummary = z.infer<typeof eventSummarySchema>;
export type EventsQuery = z.infer<typeof eventsQuerySchema>;
export type EventsResponse = z.infer<typeof eventsResponseSchema>;
export type CampaignTerms = z.infer<typeof campaignTermsSchema>;
export type CampaignPreviewRequest = z.infer<typeof campaignPreviewRequestSchema>;
export type CampaignPreviewResponse = z.infer<typeof campaignPreviewResponseSchema>;
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;
export type CreateCampaignResponse = z.infer<typeof createCampaignResponseSchema>;
export type CampaignSummary = z.infer<typeof campaignSummarySchema>;
export type CampaignReport = z.infer<typeof campaignReportSchema>;
export type CampaignDetail = z.infer<typeof campaignDetailSchema>;
export type CampaignsResponse = z.infer<typeof campaignsResponseSchema>;
export type CampaignActionResponse = z.infer<typeof campaignActionResponseSchema>;
export type PublicCampaign = z.infer<typeof publicCampaignSchema>;
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;
export type CheckoutStatusResponse = z.infer<typeof checkoutStatusResponseSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type TicketsResponse = z.infer<typeof ticketsResponseSchema>;
export type HedgeOrder = z.infer<typeof hedgeOrderSchema>;
export type HedgeFill = z.infer<typeof hedgeFillSchema>;
export type HedgeInstrument = z.infer<typeof hedgeInstrumentSchema>;
export type HedgeDeskResponse = z.infer<typeof hedgeDeskResponseSchema>;
export type DemoBookRequest = z.infer<typeof demoBookRequestSchema>;
export type DemoResultRequest = z.infer<typeof demoResultRequestSchema>;
export type DemoSaleRequest = z.infer<typeof demoSaleRequestSchema>;
export type DemoResponse = z.infer<typeof demoResponseSchema>;
export type LiveInstrumentRow = z.infer<typeof liveInstrumentRowSchema>;
export type LiveCampaignRow = z.infer<typeof liveCampaignRowSchema>;
export type TopUpCampaignRequest = z.infer<typeof topUpCampaignRequestSchema>;
export type TopUpCampaignResponse = z.infer<typeof topUpCampaignResponseSchema>;
