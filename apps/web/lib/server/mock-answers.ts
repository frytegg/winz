import { limits } from "@winz/pricing";
import {
  apiExamples,
  parseContracts,
  type ApiRouteName,
  type Book,
  type CampaignPreviewRequest,
  type CampaignPreviewResponse,
  type EventsResponse,
  type Ticket,
} from "@winz/shared";

import { toPreviewResponse } from "./preview";

/**
 * The few answers of the simulated API (`APP_API_MOCK=true`) that depend on the request or on the
 * clock instead of being one fixed example. Everything else answers its example as it is.
 *
 * - `GET /api/t/:token` answers the ticket of that token among the tickets of the examples (the
 *   list « My tickets » shows), so the ticket opened from the list is the one on its card.
 * - `GET /api/events` dates the games other than the running example's from the clock, so the list
 *   of M3 never offers a game that has already started.
 * - `POST /api/campaigns/preview` computes M6's figures with the server's own pricing function
 *   (`limits()` of `@winz/pricing`, as `lib/server/preview.ts` does) on a simulated order book, so
 *   they follow the price, the margins and the budget the merchant sets.
 *
 * An explicit scenario (the `x-mock-scenario` header) keeps choosing the example, as before:
 * `?scenario=inGame` on a ticket still answers a ticket during the game, whatever its token.
 */

/** What a mock answer may read from the request. */
export interface MockRequest {
  /** The scenario asked for, `default` when the request names none. */
  scenario: string;
  params: Record<string, string>;
  /** The parsed body, when the route has one. */
  body: unknown;
  now: Date;
}

/** A mock answer: a JSON body, or the standard error envelope with its status. */
export type MockAnswer =
  | { kind: "json"; body: unknown }
  | { kind: "error"; status: number; code: "not_found"; message: string };

// ---------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------

/**
 * Every ticket the examples hold, by token: the single tickets of `GET /api/t/:token` and the
 * tickets of every list of `GET /api/tickets`. Each ticket of a list has its own token; the
 * single-ticket examples (one per phase) share the running example's, which answers the first of
 * them, the ticket before the game (`mock-answers.test.ts`).
 */
export function exampleTickets(): Map<string, Ticket> {
  const all: Ticket[] = [
    ...Object.values(apiExamples.ticketExamples),
    ...apiExamples.ticketsExample.tickets,
    ...Object.values(apiExamples.ticketsExamples).flatMap((list) => list.tickets),
    apiExamples.demoFlagExamples.ticket,
  ];
  const byToken = new Map<string, Ticket>();
  for (const ticket of all) {
    if (!byToken.has(ticket.token)) byToken.set(ticket.token, ticket);
  }
  return byToken;
}

function ticketByToken(request: MockRequest, example: unknown): MockAnswer {
  if (request.scenario !== "default") return { kind: "json", body: example };
  const ticket = exampleTickets().get(request.params.token ?? "");
  if (ticket === undefined) {
    // As the real route answers a token it does not know (lib/server/tickets.ts).
    return { kind: "error", status: 404, code: "not_found", message: "Ticket not found" };
  }
  return { kind: "json", body: ticket };
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** How far ahead of the clock the other games of the list start. */
export const OTHER_GAMES_AHEAD_DAYS = 4;
/** Sales close this long before a game starts, as in the examples. */
const SALES_CLOSE_BEFORE_MS = 5 * 60_000;

/**
 * `GET /api/events` at `now`: the running example's game (Arkansas vs Texas) keeps its date, which
 * every promo, ticket and public page of the examples shares; every other game starts
 * `OTHER_GAMES_AHEAD_DAYS` days after `now`, at midnight UTC (the evening before, in the US), so
 * none is ever in the past.
 */
export function eventsAt(now: Date): EventsResponse {
  const example = apiExamples.eventsExample;
  const runningTicker = example.events[0]?.ticker;
  const startDay = Math.floor(now.getTime() / DAY_MS) + OTHER_GAMES_AHEAD_DAYS;
  const startsAt = new Date(startDay * DAY_MS);
  return {
    events: example.events.map((event) =>
      event.ticker === runningTicker
        ? event
        : {
            ...event,
            startsAt: startsAt.toISOString(),
            salesCloseAt: new Date(startsAt.getTime() - SALES_CLOSE_BEFORE_MS).toISOString(),
          },
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

type LevelSpec = readonly [priceBps: number, contracts: string];

/** Bids highest first, asks lowest first, as `Book` wants them. */
interface BookSpec {
  bids: readonly LevelSpec[];
  asks: readonly LevelSpec[];
}

/**
 * The simulated books of the instruments of `GET /api/events`. Each one gives back the figures of
 * its template: the chance is the mid of the best bid and ask, the cost is the best ask with the
 * taker fee (`promoTemplates()`), and the running example's book is the one the Hedge desk shows
 * (bid 11 %, ask 13 %). An instrument missing here has no book (the 21+ spread, `no_book`).
 */
export const MOCK_BOOKS: Readonly<Record<string, BookSpec>> = {
  // Texas wins by 14+: mid 12 %.
  "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13": {
    bids: [
      [1100, "900"],
      [1000, "1500"],
    ],
    asks: [
      [1300, "800"],
      [1400, "1200"],
      [1500, "1500"],
      [1700, "2000"],
      [2000, "3000"],
    ],
  },
  // Texas wins: mid 91 %.
  "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX": {
    bids: [[9000, "3000"]],
    asks: [
      [9200, "2500"],
      [9400, "4000"],
    ],
  },
  // Arkansas wins: mid 9 %.
  "GEMI-NCAAF-2611212030-ARK-TEX-M-ARK": {
    bids: [[800, "1200"]],
    asks: [
      [1000, "500"],
      [1100, "900"],
      [1300, "1500"],
      [1600, "2000"],
    ],
  },
  // Pittsburgh wins: mid 46.5 %.
  "GEMI-NCAAM-2611180000-VILL-PITT-M-PITT": {
    bids: [[4600, "800"]],
    asks: [
      [4700, "700"],
      [4900, "1200"],
    ],
  },
};

/** The book of scenario `aboveThreshold`: the chance has jumped to 23 %, past any usual threshold. */
export const ABOVE_THRESHOLD_BOOK: BookSpec = {
  bids: [[2200, "900"]],
  asks: [
    [2400, "600"],
    [2600, "1500"],
  ],
};

function toBook(symbol: string, spec: BookSpec, now: Date): Book {
  const levels = (specs: readonly LevelSpec[]): Book["asks"] =>
    specs.map(([priceBps, contracts]) => ({
      priceBps: BigInt(priceBps),
      qty: parseContracts(contracts),
    }));
  return {
    instrumentSymbol: symbol,
    bids: levels(spec.bids),
    asks: levels(spec.asks),
    observedAtMs: now.getTime(),
  };
}

/** The simulated book a preview of `symbol` reads under `scenario`, or `null` for no book. */
export function mockBook(symbol: string, scenario: string, now: Date): Book | null {
  if (scenario === "noBook") return null;
  if (scenario === "aboveThreshold") return toBook(symbol, ABOVE_THRESHOLD_BOOK, now);
  const spec = MOCK_BOOKS[symbol];
  return spec === undefined ? null : toBook(symbol, spec, now);
}

/**
 * `POST /api/campaigns/preview` for `terms` under `scenario` (`default`/`open`: the instrument's
 * simulated book; `aboveThreshold`: a book past the threshold; `noBook`: none), with `limits()` and
 * `toPreviewResponse()`, the very functions of the real route. Nothing is hedged yet on the
 * instrument in the simulated mode (`pending` 0), and the whole budget is available.
 */
export function previewAt(
  terms: CampaignPreviewRequest,
  scenario: string,
  now: Date,
): CampaignPreviewResponse {
  const book = mockBook(terms.instrumentSymbol, scenario, now);
  const result = limits({
    book,
    pending: 0n,
    nowMs: now.getTime(),
    unitPrice: BigInt(terms.unitPrice),
    refundBps: BigInt(terms.refundBps),
    usualMarginBps: BigInt(terms.usualMarginBps),
    minMarginBps: BigInt(terms.minMarginBps),
    availableBudget: BigInt(terms.budget),
  });
  return toPreviewResponse(result, book === null ? null : now);
}

function preview(request: MockRequest, example: unknown): MockAnswer {
  const terms = request.body as CampaignPreviewRequest | undefined;
  // `minMarginBps` above the usual margin is refused by the real route (parsePreviewTerms); the
  // example then stands, as it did before the preview was computed.
  if (terms === undefined || terms.minMarginBps > terms.usualMarginBps) {
    return { kind: "json", body: example };
  }
  return { kind: "json", body: previewAt(terms, request.scenario, request.now) };
}

// ---------------------------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------------------------

/**
 * The answer of route `name` to `request`, given the example its scenario names. Routes without a
 * computed answer answer their example.
 */
export function mockAnswer(name: ApiRouteName, request: MockRequest, example: unknown): MockAnswer {
  switch (name) {
    case "ticketByToken":
      return ticketByToken(request, example);
    case "events":
      return { kind: "json", body: eventsAt(request.now) };
    case "campaignPreview":
      return request.scenario === "default" ||
        request.scenario === "open" ||
        request.scenario === "aboveThreshold" ||
        request.scenario === "noBook"
        ? preview(request, example)
        : { kind: "json", body: example };
    default:
      return { kind: "json", body: example };
  }
}
