import { apiExamples, TICKET_PHASES, type Ticket, type TicketsResponse } from "@winz/shared";
import { describe, expect, it } from "vitest";

import { copy } from "@/lib/copy";

import { ticketGroupOf, ticketHref, ticketRow, ticketsView } from "./tickets-view";

const base: Ticket = apiExamples.ticketExamples.preGame;

function ticket(overrides: Partial<Ticket>): Ticket {
  return { ...base, ...overrides };
}

describe("ticketGroupOf", () => {
  it("puts every phase of the schema in one of SPEC C4's three groups", () => {
    const groups = Object.fromEntries(TICKET_PHASES.map((phase) => [phase, ticketGroupOf(phase)]));
    expect(groups).toEqual({
      pre_game: "live",
      in_game: "live",
      refunded: "won",
      not_this_time: "notThisTime",
      cancelled: "notThisTime",
    });
  });
});

describe("ticketRow", () => {
  it("words the ticket as its own page does, and opens it", () => {
    const row = ticketRow(base);
    expect(row.href).toBe("/t/tkt_example_joes_texas");
    expect(row.phaseLabel).toBe(copy.ticket.phases.pre_game);
    expect(row.item).toBe("Smash burger");
    expect(row.paidText).toBe("$12.00 paid");
    expect(row.refundText).toBeNull();
    expect(row.chanceText).toBe(copy.ticket.chanceTitle(14));
  });

  it("gives the label of each phase, a cancelled game included", () => {
    for (const phase of TICKET_PHASES) {
      expect(ticketRow(ticket({ phase })).phaseLabel).toBe(copy.ticket.phases[phase]);
    }
    expect(ticketRow(ticket({ phase: "cancelled" })).phaseLabel).toBe("Cancelled");
  });

  it("shows the refund in exact cents, and no chance once the game is over", () => {
    const row = ticketRow(
      ticket({ phase: "refunded", refundable: "10000001", probabilityBps: 1400 }),
    );
    expect(row.refundText).toBe("Refunded $10.00");
    expect(ticketRow(ticket({ phase: "refunded", refundable: "12345678" })).refundText).toBe(
      "Refunded $12.34",
    );
    expect(row.chanceText).toBeNull();
    expect(ticketRow(ticket({ phase: "not_this_time" })).refundText).toBeNull();
  });

  it("says the quantity, and no chance when there is no fresh one", () => {
    expect(ticketRow(ticket({ qty: 3 })).item).toBe("Smash burger × 3");
    expect(ticketRow(ticket({ phase: "in_game", probabilityBps: null })).chanceText).toBeNull();
  });

  it("escapes a token in the link", () => {
    expect(ticketHref("a/b c")).toBe("/t/a%2Fb%20c");
  });
});

describe("ticketsView", () => {
  it("is empty for a person with no ticket", () => {
    const view = ticketsView(apiExamples.ticketsExamples.noTickets);
    expect(view).toEqual({
      groups: [],
      count: 0,
      refundedTotalText: "$0.00",
      hasRefunds: false,
      demo: false,
    });
  });

  it("groups one ticket of each phase as Live, Won, Not this time, in that order", () => {
    const view = ticketsView(apiExamples.ticketsExamples.severalTickets);
    expect(view.count).toBe(5);
    expect(view.groups.map((group) => [group.title, group.rows.map((row) => row.phase)])).toEqual([
      ["Live", ["pre_game", "in_game"]],
      ["Won", ["refunded"]],
      ["Not this time", ["not_this_time", "cancelled"]],
    ]);
  });

  it("orders Live by the next game first, and the past by the latest game first", () => {
    const response: TicketsResponse = {
      tickets: [
        ticket({ token: "late", startsAt: "2026-11-30T20:00:00.000Z" }),
        ticket({ token: "soon", startsAt: "2026-11-21T20:00:00.000Z" }),
        ticket({ token: "old", phase: "not_this_time", startsAt: "2026-11-01T20:00:00.000Z" }),
        ticket({ token: "recent", phase: "cancelled", startsAt: "2026-11-15T20:00:00.000Z" }),
      ],
      refundedTotal: "0",
    };
    const view = ticketsView(response);
    expect(view.groups.map((group) => group.rows.map((row) => row.token))).toEqual([
      ["soon", "late"],
      ["recent", "old"],
    ]);
  });

  it("shows the API's refunded total as sent, never a sum of its own", () => {
    const response: TicketsResponse = {
      tickets: [ticket({ phase: "refunded", refundable: "20000000" })],
      refundedTotal: "12345678",
    };
    const view = ticketsView(response);
    expect(view.refundedTotalText).toBe("$12.34");
    expect(view.hasRefunds).toBe(true);
    expect(ticketsView(apiExamples.ticketsExamples.severalTickets).refundedTotalText).toBe("$6.00");
  });

  it("says when a demo ticket is in the list", () => {
    expect(ticketsView(apiExamples.ticketsExamples.demoTicket).demo).toBe(true);
    expect(ticketsView(apiExamples.ticketsExample).demo).toBe(false);
  });
});
