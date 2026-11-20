import type { CampaignEvent, Ticket, TicketPhase, TicketsResponse } from "@winz/shared";

import { copy } from "@/lib/copy";
import { bpsToWholePercent, formatMoney } from "@/lib/format";

/**
 * « My tickets » (C4, LT-2): what the list shows, from `GET /api/tickets` as it is. Pure, so every
 * phase and every total is tested (`tickets-view.test.ts`); the screen only lays it out.
 *
 * SPEC C4 names three groups, Live, Won and Not this time. Every phase of the schema has one:
 * before the game and game on are Live, refunded is Won, and a promo that did not hit is Not this
 * time, with a cancelled game (no refund, the purchase stands), which keeps its own label.
 */

export type TicketGroupKey = "live" | "won" | "notThisTime";

export const TICKET_GROUP_ORDER: readonly TicketGroupKey[] = ["live", "won", "notThisTime"];

export function ticketGroupOf(phase: TicketPhase): TicketGroupKey {
  switch (phase) {
    case "pre_game":
    case "in_game":
      return "live";
    case "refunded":
      return "won";
    case "not_this_time":
    case "cancelled":
      return "notThisTime";
  }
}

export interface TicketRow {
  token: string;
  /** The live ticket page (C3). */
  href: string;
  phase: TicketPhase;
  /** The ticket page's own word for the phase (`copy.ticket.phases`). */
  phaseLabel: string;
  promise: string;
  merchantName: string;
  /** "Smash burger", or "Smash burger × 2". */
  item: string;
  /** "$20.00 paid". */
  paidText: string;
  /** "Refunded $10.00" once refunded, `null` otherwise. */
  refundText: string | null;
  /** "14% chance it's free" while the game is live and a fresh chance exists. */
  chanceText: string | null;
  event: CampaignEvent;
  startsAt: string;
  demo: boolean;
}

export interface TicketGroup {
  key: TicketGroupKey;
  title: string;
  rows: TicketRow[];
}

export interface TicketsView {
  /** Only the groups that hold a ticket, in `TICKET_GROUP_ORDER`. */
  groups: TicketGroup[];
  count: number;
  /** The API's `refundedTotal`, formatted: never summed here. */
  refundedTotalText: string;
  hasRefunds: boolean;
  /** A demo ticket is in the list: the DEMO MODE banner shows (it follows `apiFetch`). */
  demo: boolean;
}

export function ticketHref(token: string): string {
  return `/t/${encodeURIComponent(token)}`;
}

export function ticketRow(ticket: Ticket): TicketRow {
  const live = ticketGroupOf(ticket.phase) === "live";
  return {
    token: ticket.token,
    href: ticketHref(ticket.token),
    phase: ticket.phase,
    phaseLabel: copy.ticket.phases[ticket.phase],
    promise: ticket.promise,
    merchantName: ticket.merchant.name,
    item: ticket.qty > 1 ? copy.checkout.lineItem(ticket.product, ticket.qty) : ticket.product,
    paidText: copy.ticket.paid(formatMoney(ticket.paid)),
    refundText:
      ticket.phase === "refunded"
        ? copy.tickets.refundedAmount(formatMoney(ticket.refundable))
        : null,
    chanceText:
      live && ticket.probabilityBps !== null
        ? copy.ticket.chanceTitle(bpsToWholePercent(ticket.probabilityBps))
        : null,
    event: ticket.event,
    startsAt: ticket.startsAt,
    demo: ticket.demo,
  };
}

function startTime(ticket: Ticket): number {
  return Date.parse(ticket.startsAt);
}

/** Live: the next game first. Won and Not this time: the latest game first, as a history. */
function compareInGroup(key: TicketGroupKey, a: Ticket, b: Ticket): number {
  const order = key === "live" ? startTime(a) - startTime(b) : startTime(b) - startTime(a);
  if (order !== 0) return order;
  return Date.parse(b.purchasedAt) - Date.parse(a.purchasedAt);
}

export function ticketsView(response: TicketsResponse): TicketsView {
  const groups: TicketGroup[] = [];
  for (const key of TICKET_GROUP_ORDER) {
    const tickets = response.tickets
      .filter((ticket) => ticketGroupOf(ticket.phase) === key)
      .sort((a, b) => compareInGroup(key, a, b));
    if (tickets.length === 0) continue;
    groups.push({ key, title: copy.tickets.groups[key], rows: tickets.map(ticketRow) });
  }
  return {
    groups,
    count: response.tickets.length,
    refundedTotalText: formatMoney(response.refundedTotal),
    hasRefunds: BigInt(response.refundedTotal) > 0n,
    demo: response.tickets.some((ticket) => ticket.demo),
  };
}
