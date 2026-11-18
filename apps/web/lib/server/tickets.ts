import type {
  InstrumentType,
  MerchantCategory,
  Outcome,
  PublicCampaign,
  SaleState,
  Ticket,
  TicketPhase,
  TicketsResponse,
} from "@winz/shared";

import { conditionWords } from "./condition";
import type { Db } from "./db";
import { serverLogger } from "./logger";
import { ApiRouteError } from "./route";
import {
  digits,
  effectiveSaleState,
  isoDate,
  liveProbabilityBps,
  safeUrl,
  toCampaignEvent,
  type EventTeamsRow,
} from "./wire";

/**
 * Customer-facing reads (A-04): the public campaign page, a ticket by its secret link, and the
 * signed-in fan's tickets. Nothing here may name a wallet or any on-chain term (SPEC section 5):
 * the answers carry no buyer address, no transaction, no on-chain id.
 */

// ---------------------------------------------------------------------------------------------
// Ticket phase
// ---------------------------------------------------------------------------------------------

export interface PhaseInput {
  /** `tickets.status`. */
  ticketStatus: "issued" | "refunded" | "refund_failed";
  /** `campaigns.outcome`. */
  outcome: Outcome | null;
  startsAt: Date;
  now: Date;
}

/**
 * The phase the live ticket shows (SPEC 5.4), first match wins: `refunded` once the ticket is
 * refunded; `cancelled` when the game was voided; `not_this_time` on NO; `in_game` once the game
 * has started (which also covers a YES whose refund is still on its way); `pre_game` otherwise.
 */
export function ticketPhase(input: PhaseInput): TicketPhase {
  if (input.ticketStatus === "refunded") return "refunded";
  if (input.outcome === "void") return "cancelled";
  if (input.outcome === "no") return "not_this_time";
  if (input.now.getTime() >= input.startsAt.getTime()) return "in_game";
  return "pre_game";
}

// ---------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------

export interface TicketRow extends EventTeamsRow {
  campaign_id: string;
  access_token: string;
  status: "issued" | "refunded" | "refund_failed";
  qty: number;
  paid: bigint;
  refundable: bigint;
  purchased_at: Date;
  refunded_at: Date | null;
  slug: string | null;
  product: string;
  promise: string;
  condition_label: string;
  instrument: string;
  /** `instruments.type`: how `condition_label` is read (`condition.ts`). */
  instrument_type: InstrumentType;
  outcome: Outcome | null;
  demo: boolean;
  merchant_name: string;
  merchant_logo_url: string | null;
  event_title: string;
  starts_at: Date;
  live_mid_bps: number | null;
  live_stale: boolean | null;
  live_observed_at: Date | null;
}

/** A ticket whose campaign has no slug: no database constraint rules it out, but none should exist. */
export class TicketWithoutSlugError extends Error {
  constructor(readonly campaignId: string) {
    super(`ticket of an unpublished campaign (no slug): campaign ${campaignId}`);
    this.name = "TicketWithoutSlugError";
  }
}

/** A ticket on the wire (`ticketSchema`). */
export function toTicket(row: TicketRow, now: Date): Ticket {
  if (row.slug === null) {
    // A ticket exists only for a live campaign, which always has a slug.
    throw new TicketWithoutSlugError(row.campaign_id);
  }
  const phase = ticketPhase({
    ticketStatus: row.status,
    outcome: row.outcome,
    startsAt: row.starts_at,
    now,
  });
  const live =
    row.live_observed_at === null
      ? null
      : {
          mid_bps: row.live_mid_bps,
          stale: row.live_stale ?? true,
          observed_at: row.live_observed_at,
        };
  const settled = row.outcome !== null || phase === "refunded";
  const words = conditionWords(row.instrument_type, row.condition_label, row.outcome);
  return {
    token: row.access_token,
    campaignSlug: row.slug,
    merchant: { name: row.merchant_name, logoUrl: safeUrl(row.merchant_logo_url) },
    product: row.product,
    qty: row.qty,
    paid: digits(row.paid),
    refundable: digits(row.refundable),
    promise: row.promise,
    conditionLabel: words.conditionLabel,
    subjectName: words.subjectName,
    resultLabel: words.resultLabel,
    eventTitle: row.event_title,
    event: toCampaignEvent(row),
    phase,
    probabilityBps: liveProbabilityBps(live, settled, now),
    startsAt: isoDate(row.starts_at),
    purchasedAt: isoDate(row.purchased_at),
    refundedAt: row.refunded_at === null ? null : isoDate(row.refunded_at),
    instrumentSymbol: row.instrument,
    demo: row.demo,
  };
}

async function selectTickets(
  db: Db,
  filter: { token: string } | { buyer: string },
): Promise<TicketRow[]> {
  const token = "token" in filter ? filter.token : null;
  const buyer = "buyer" in filter ? filter.buyer : null;
  return db<TicketRow[]>`
    select
      t.campaign_id, t.access_token, t.status, t.qty, t.paid, t.refundable, t.purchased_at, t.refunded_at,
      c.slug, c.product, c.promise, c.condition_label, c.instrument, c.outcome, c.demo,
      i.type as instrument_type,
      m.name as merchant_name, m.logo_url as merchant_logo_url,
      e.title as event_title, e.starts_at, e.sport as event_sport, e.league as event_league,
      e.home_name, e.home_abbreviation, e.home_logo_url,
      e.away_name, e.away_abbreviation, e.away_logo_url,
      l.mid_bps as live_mid_bps, l.stale as live_stale, l.observed_at as live_observed_at
    from tickets t
    join campaigns c on c.id = t.campaign_id
    join instruments i on i.symbol = c.instrument
    join merchants m on m.id = c.merchant_id
    join events e on e.ticker = c.event_ticker
    left join live_instruments l on l.symbol = c.instrument
    where (${token}::text is null or t.access_token = ${token}::text)
      and (${buyer}::text is null or t.buyer = ${buyer}::text)
    order by t.purchased_at desc, t.id
  `;
}

/** GET /api/t/:token: a ticket by its secret link, without signing in. 404 for an unknown token. */
export async function ticketByToken(db: Db, token: string, now: Date): Promise<Ticket> {
  const [row] = await selectTickets(db, { token });
  if (!row) throw new ApiRouteError(404, "not_found", "Ticket not found");
  return toTicket(row, now);
}

/**
 * GET /api/tickets (C4): the signed-in person's tickets, matched by the wallet their purchases were
 * made with, newest first, with the total already refunded to them. Empty while they have none.
 */
export async function myTickets(
  db: Db,
  walletAddress: string | null,
  now: Date,
): Promise<TicketsResponse> {
  if (walletAddress === null) return { tickets: [], refundedTotal: "0" };
  const rows = await selectTickets(db, { buyer: walletAddress.toLowerCase() });
  // The total is what was refunded to this person, whether or not each ticket can be shown.
  const refundedTotal = rows
    .filter((row) => row.status === "refunded")
    .reduce((total, row) => total + row.refundable, 0n);
  // One inconsistent row (a campaign without a slug) must not take the whole list down: it is left
  // out and logged as an error for someone to repair; the other tickets are still shown.
  const tickets: Ticket[] = [];
  for (const row of rows) {
    if (row.slug === null) {
      serverLogger("tickets").error(
        { campaignId: row.campaign_id },
        "ticket of a campaign without a slug left out of the list",
      );
      continue;
    }
    tickets.push(toTicket(row, now));
  }
  return { tickets, refundedTotal: digits(refundedTotal) };
}

// ---------------------------------------------------------------------------------------------
// Public campaign page
// ---------------------------------------------------------------------------------------------

export interface PublicCampaignRow extends EventTeamsRow {
  slug: string;
  product: string;
  unit_price: bigint;
  refund_bps: number;
  promise: string;
  condition_label: string;
  instrument: string;
  /** `instruments.type`: how `condition_label` is read (`condition.ts`). */
  instrument_type: InstrumentType;
  sale_state: SaleState;
  sales_close: Date;
  outcome: Outcome | null;
  demo: boolean;
  merchant_name: string;
  merchant_logo_url: string | null;
  merchant_category: MerchantCategory;
  event_title: string;
  starts_at: Date;
  live_mid_bps: number | null;
  live_stale: boolean | null;
  live_observed_at: Date | null;
}

/** A campaign on the public page (`publicCampaignSchema`). */
export function toPublicCampaign(row: PublicCampaignRow, now: Date): PublicCampaign {
  const live =
    row.live_observed_at === null
      ? null
      : {
          mid_bps: row.live_mid_bps,
          stale: row.live_stale ?? true,
          observed_at: row.live_observed_at,
        };
  const words = conditionWords(row.instrument_type, row.condition_label, row.outcome);
  return {
    slug: row.slug,
    merchant: {
      name: row.merchant_name,
      logoUrl: safeUrl(row.merchant_logo_url),
      category: row.merchant_category,
    },
    product: row.product,
    unitPrice: digits(row.unit_price),
    refundBps: row.refund_bps,
    promise: row.promise,
    conditionLabel: words.conditionLabel,
    subjectName: words.subjectName,
    resultLabel: words.resultLabel,
    eventTitle: row.event_title,
    event: toCampaignEvent(row),
    probabilityBps: liveProbabilityBps(live, row.outcome !== null, now),
    saleState: effectiveSaleState(row.sale_state, row.sales_close, now),
    startsAt: isoDate(row.starts_at),
    salesCloseAt: isoDate(row.sales_close),
    outcome: row.outcome,
    instrumentSymbol: row.instrument,
    demo: row.demo,
  };
}

/**
 * Campaigns not published yet: a draft or a campaign still being funded may already hold a slug,
 * but its page is not public.
 */
export const UNPUBLISHED_STATUSES = ["draft", "funding"] as const;

/**
 * GET /api/c/:slug (C1, CO-1): the public page of a published campaign. 404 when unknown or not
 * published yet (draft, funding), exactly alike.
 */
export async function publicCampaign(db: Db, slug: string, now: Date): Promise<PublicCampaign> {
  const [row] = await db<PublicCampaignRow[]>`
    select
      c.slug, c.product, c.unit_price, c.refund_bps, c.promise, c.condition_label, c.instrument,
      c.sale_state, c.sales_close, c.outcome, c.demo, i.type as instrument_type,
      m.name as merchant_name, m.logo_url as merchant_logo_url, m.category as merchant_category,
      e.title as event_title, e.starts_at, e.sport as event_sport, e.league as event_league,
      e.home_name, e.home_abbreviation, e.home_logo_url,
      e.away_name, e.away_abbreviation, e.away_logo_url,
      l.mid_bps as live_mid_bps, l.stale as live_stale, l.observed_at as live_observed_at
    from campaigns c
    join instruments i on i.symbol = c.instrument
    join merchants m on m.id = c.merchant_id
    join events e on e.ticker = c.event_ticker
    left join live_instruments l on l.symbol = c.instrument
    where c.slug = ${slug}
      and c.status not in ${db(UNPUBLISHED_STATUSES)}
  `;
  if (!row) throw new ApiRouteError(404, "not_found", "Promo not found");
  return toPublicCampaign(row, now);
}
