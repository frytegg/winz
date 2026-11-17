import type { Bps, MicroContracts } from "./units";

/** One price level of an order book. */
export interface BookLevel {
  priceBps: Bps;
  qty: MicroContracts;
}

/**
 * Order book of one Gemini instrument, YES side.
 * `bids` are sorted best (highest) first, `asks` best (lowest) first.
 */
export interface Book {
  instrumentSymbol: string;
  bids: readonly BookLevel[];
  asks: readonly BookLevel[];
  /** When the snapshot was observed, epoch milliseconds. A book older than 10 s is stale. */
  observedAtMs: number;
}

/** A book is stale, and must not be priced or traded against, after this many milliseconds. */
export const BOOK_STALE_AFTER_MS = 10_000;

export const MERCHANT_CATEGORIES = ["bar", "pizza", "burger", "retail", "other"] as const;
export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];

/** Usual margin pre-filled on screen M6, by category, in basis points. The merchant can change it. */
export const DEFAULT_USUAL_MARGIN_BPS: Record<MerchantCategory, number> = {
  bar: 7000,
  pizza: 6500,
  burger: 6000,
  retail: 4500,
  other: 5000,
};

export const SPORTS = ["football", "basketball", "hockey", "baseball", "soccer", "other"] as const;
export type Sport = (typeof SPORTS)[number];

export const INSTRUMENT_TYPES = ["moneyline", "spread", "total"] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

/** Off-chain lifecycle of a campaign (SPEC CA-4). `funding` = draft waiting for its budget payment. */
export const CAMPAIGN_STATUSES = [
  "draft",
  "funding",
  "live",
  "paused",
  "sales_closed",
  "settled_yes",
  "settled_no",
  "void",
  "closed",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * Whether a campaign can sell right now, and if not, why (SPEC CA-5).
 * Only `paused_manual` is written on-chain; every other pause is the backend refusing to sign quotes.
 */
export const SALE_STATES = [
  "open",
  "paused_price",
  "paused_budget",
  "paused_depth",
  "paused_stale",
  "paused_breaker",
  "paused_manual",
  "closed",
] as const;
export type SaleState = (typeof SALE_STATES)[number];

export const OUTCOMES = ["yes", "no", "void"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** What the live ticket shows (SPEC 5.4). */
export const TICKET_PHASES = [
  "pre_game",
  "in_game",
  "refunded",
  "not_this_time",
  "cancelled",
] as const;
export type TicketPhase = (typeof TICKET_PHASES)[number];

export const CHECKOUT_STATUSES = [
  "requires_payment",
  "processing",
  "ticketed",
  "cancelled_paused",
  "failed",
] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

export const USER_ROLES = ["merchant", "fan"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Where hedge orders execute. `paper` fills are simulated against the live production book. */
export const EXECUTION_VENUES = ["paper", "gemini-sandbox", "gemini"] as const;
export type ExecutionVenueName = (typeof EXECUTION_VENUES)[number];

export const ORDER_KINDS = ["maker", "taker"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export const ORDER_STATUSES = [
  "working",
  "filled",
  "partially_filled",
  "cancelled",
  "rejected",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Default risk parameters of the execution policy (SPEC 9.3). Still to be validated by Alexandre. */
export const DEFAULT_RISK_PARAMS = {
  /** Largest unhedged notional per instrument, micro-USDC ($300). */
  uMaxMicroUsdc: 300_000_000n,
  makerTtlSeconds: 90,
  /** A maker order is abandoned for taker when the ask moves up by this many ticks. */
  askMoveTicks: 2,
  /** Guarantee tolerance added to the quoted cost, in ticks. */
  toleranceTicks: 1,
  /** Everything is taker once the event starts in less than this. */
  forceTakerMinutes: 60,
} as const;

/** Sales close this long before the event starts (SPEC 4.5). */
export const SALES_CLOSE_BEFORE_START_MS = 5 * 60 * 1000;

/** Signed quotes are valid this long; they are created at purchase time, never before payment. */
export const QUOTE_TTL_SECONDS = 60;

/** Refunds are pushed on-chain in batches of this many tickets (SPEC ST-2). */
export const REFUND_BATCH_SIZE = 50;
