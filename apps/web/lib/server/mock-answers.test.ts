import { bestAsk, costPerContractBps, midBps } from "@winz/pricing";
import {
  API_ROUTES,
  BPS,
  MOCK_SCENARIO_HEADER,
  apiExamples,
  mulDivUp,
  type CampaignPreviewResponse,
  type Ticket,
} from "@winz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postPreview } from "@/app/api/campaigns/preview/route";
import { GET as getEvents } from "@/app/api/events/route";
import { GET as getMe } from "@/app/api/me/route";
import { GET as getTicket } from "@/app/api/t/[token]/route";

import {
  MOCK_BOOKS,
  OTHER_GAMES_AHEAD_DAYS,
  eventsAt,
  exampleTickets,
  mockAnswer,
  mockBook,
  previewAt,
} from "./mock-answers";

/**
 * The answers of the simulated API that follow the request or the clock (mock-answers.ts), and the
 * other half of the story: GET /api/me answers the fan in the fan's scenarios.
 */

const NOW = new Date("2026-11-20T23:00:00.000Z");

function ticketAnswer(token: string, scenario = "default"): ReturnType<typeof mockAnswer> {
  return mockAnswer(
    "ticketByToken",
    { scenario, params: { token }, body: undefined, now: NOW },
    API_ROUTES.ticketByToken.examples[scenario as "default"],
  );
}

describe("GET /api/t/:token in the simulated mode", () => {
  it("answers the ticket of its token, as the list shows it", () => {
    const several = apiExamples.ticketsExamples.severalTickets.tickets;
    expect(several.length).toBeGreaterThan(1);
    for (const ticket of several) {
      expect(ticketAnswer(ticket.token), ticket.token).toEqual({ kind: "json", body: ticket });
    }
    // The first card of « My tickets »: two burgers, $24 paid, not the single one of the default.
    const two = several[0];
    expect(two?.qty).toBe(2);
    expect(ticketAnswer(two?.token ?? "")).toMatchObject({
      body: { qty: 2, paid: "24000000", product: "Smash burger" },
    });
    expect(ticketAnswer(two?.token ?? "")).not.toEqual({
      kind: "json",
      body: apiExamples.ticketExamples.preGame,
    });
  });

  it("answers every ticket of every list under its own token", () => {
    const listed: Ticket[] = [
      ...apiExamples.ticketsExample.tickets,
      ...Object.values(apiExamples.ticketsExamples).flatMap((list) => list.tickets),
    ];
    const tickets = exampleTickets();
    for (const ticket of listed) {
      expect(tickets.get(ticket.token), ticket.token).toEqual(ticket);
    }
    // The single-ticket examples (one per phase) share the running example's token: it answers
    // the ticket before the game, and a scenario asks for another phase.
    expect(tickets.get("tkt_example_joes_texas")).toEqual(apiExamples.ticketExamples.preGame);
  });

  it("answers 404 to a token no example has, as the real route does", () => {
    expect(ticketAnswer("tkt_unknown")).toEqual({
      kind: "error",
      status: 404,
      code: "not_found",
      message: "Ticket not found",
    });
  });

  it("keeps answering the example of a scenario that is asked for", () => {
    expect(ticketAnswer("tkt_example_joes_texas_two", "inGame")).toEqual({
      kind: "json",
      body: apiExamples.ticketExamples.inGame,
    });
  });

  describe("through the route", () => {
    beforeEach(() => vi.stubEnv("APP_API_MOCK", "true"));
    afterEach(() => vi.unstubAllEnvs());

    it("serves the ticket of the token in the path", async () => {
      const token = "tkt_example_joes_texas_live";
      const response = await getTicket(new Request(`http://winz.test/api/t/${token}`), {
        params: Promise.resolve({ token }),
      });
      expect(response.status).toBe(200);
      const ticket = (await response.json()) as Ticket;
      expect(ticket.token).toBe(token);
      expect(ticket.phase).toBe("in_game");
    });

    it("answers 404 with the error envelope to an unknown token", async () => {
      const response = await getTicket(new Request("http://winz.test/api/t/tkt_nope"), {
        params: Promise.resolve({ token: "tkt_nope" }),
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "not_found", message: "Ticket not found" },
      });
    });
  });
});

describe("GET /api/events in the simulated mode", () => {
  const running = apiExamples.eventsExample.events[0];

  it("keeps the running example's game, which every promo of the examples shares", () => {
    expect(eventsAt(NOW).events[0]).toEqual(running);
  });

  it("never lists another game in the past, whatever the day", () => {
    for (const iso of [
      "2026-11-20T23:00:00.000Z",
      "2026-11-21T05:59:00.000Z",
      "2027-03-01T12:00:00.000Z",
    ]) {
      const now = new Date(iso);
      for (const event of eventsAt(now).events.slice(1)) {
        expect(Date.parse(event.salesCloseAt), `${event.title} at ${iso}`).toBeGreaterThan(
          now.getTime() + (OTHER_GAMES_AHEAD_DAYS - 1) * 86_400_000,
        );
        expect(Date.parse(event.startsAt) - Date.parse(event.salesCloseAt)).toBe(5 * 60_000);
      }
    }
  });

  it("is what the example says, except those dates", () => {
    const served = eventsAt(NOW);
    expect(served.events.map((event) => event.ticker)).toEqual(
      apiExamples.eventsExample.events.map((event) => event.ticker),
    );
    expect(served.events[1]?.templates).toEqual(apiExamples.eventsExample.events[1]?.templates);
    // The example itself still holds a past date: the mock is what moves it.
    expect(Date.parse(apiExamples.eventsExample.events[1]?.startsAt ?? "")).toBeLessThan(
      NOW.getTime(),
    );
  });

  describe("through the route", () => {
    beforeEach(() => vi.stubEnv("APP_API_MOCK", "true"));
    afterEach(() => vi.unstubAllEnvs());

    it("serves no game whose sales have closed", async () => {
      const before = Date.now();
      const response = await getEvents(new Request("http://winz.test/api/events"), {
        params: Promise.resolve({}),
      });
      const { events } = (await response.json()) as { events: { salesCloseAt: string }[] };
      for (const event of events.slice(1)) {
        expect(Date.parse(event.salesCloseAt)).toBeGreaterThan(before);
      }
    });
  });
});

describe("POST /api/campaigns/preview in the simulated mode", () => {
  const terms = apiExamples.campaignPreviewRequestExample;
  /** The examples' `bookAsOf`, as the simulated book is observed at the time of the request. */
  const BOOK_AT = new Date("2026-11-17T15:00:00.000Z");

  it.each(["open", "aboveThreshold", "noBook"] as const)(
    "computes the example of scenario %s from the request example",
    (scenario) => {
      expect(previewAt(terms, scenario, BOOK_AT)).toEqual(
        apiExamples.campaignPreviewExamples[scenario],
      );
    },
  );

  it("follows the price, the minimum margin and the budget, as the real preview does", () => {
    const base = previewAt(terms, "default", NOW);
    const dearer = previewAt({ ...terms, unitPrice: "20000000" }, "default", NOW);
    expect(dearer.costPerSale).not.toBe(base.costPerSale);
    expect(dearer.marginKeptPerSale).not.toBe(base.marginKeptPerSale);
    expect(dearer.capacity.sales).toBeLessThan(base.capacity.sales);

    const stricter = previewAt({ ...terms, minMarginBps: 5500 }, "default", NOW);
    expect(stricter.maxCostBps).toBe(1000);
    expect(stricter.pauseThresholdBps).toBeLessThan(base.pauseThresholdBps);
    expect(stricter.saleState).toBe("paused_price");

    const smaller = previewAt({ ...terms, budget: "300000000" }, "default", NOW);
    expect(smaller.capacity).toMatchObject({ limitedBy: "budget" });
    expect(smaller.capacity.sales).toBeLessThan(base.capacity.sales);
  });

  it("dates the book of the answer at the request", () => {
    expect(previewAt(terms, "default", NOW).bookAsOf).toBe(NOW.toISOString());
    expect(previewAt(terms, "noBook", NOW).bookAsOf).toBeNull();
  });

  it("gives every template of the events example its own figures back", () => {
    for (const event of apiExamples.eventsExample.events) {
      for (const template of event.templates) {
        const book = mockBook(template.instrumentSymbol, "default", NOW);
        if (!template.available) {
          expect(book, template.id).toBeNull();
          continue;
        }
        expect(book, template.id).not.toBeNull();
        if (book === null) continue;
        expect(Number(midBps(book)), `${template.id} chance`).toBe(template.probabilityBps);
        const ask = bestAsk(book);
        expect(ask).not.toBeNull();
        const cost = mulDivUp(
          BigInt(template.refundBps),
          costPerContractBps(ask?.priceBps ?? 0n),
          BPS,
        );
        expect(Number(cost), `${template.id} cost`).toBe(template.costBps);
      }
    }
    expect(Object.keys(MOCK_BOOKS).length).toBe(4);
  });

  describe("through the route", () => {
    beforeEach(() => vi.stubEnv("APP_API_MOCK", "true"));
    afterEach(() => vi.unstubAllEnvs());

    async function ask(
      body: Record<string, unknown>,
      scenario?: string,
    ): Promise<CampaignPreviewResponse> {
      const response = await postPreview(
        new Request("http://winz.test/api/campaigns/preview", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(scenario === undefined ? {} : { [MOCK_SCENARIO_HEADER]: scenario }),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({}) },
      );
      expect(response.status).toBe(200);
      return (await response.json()) as CampaignPreviewResponse;
    }

    it("answers figures that change with the margin the merchant sets", async () => {
      const at45 = await ask({ ...terms });
      const at52 = await ask({ ...terms, minMarginBps: 5200 });
      expect(at45.maxCostBps).toBe(2000);
      expect(at52.maxCostBps).toBe(1300);
      expect(at52.pauseThresholdBps).not.toBe(at45.pauseThresholdBps);
      const { bookAsOf: _at, ...figures } = at45;
      const { bookAsOf: _example, ...expected } = apiExamples.campaignPreviewExamples.open;
      expect(figures).toEqual(expected);
    });

    it("answers a price past the threshold under aboveThreshold", async () => {
      expect(await ask({ ...terms }, "aboveThreshold")).toMatchObject({
        saleState: "paused_price",
        capacity: { sales: 0 },
      });
    });
  });
});

describe("GET /api/me in the simulated mode", () => {
  beforeEach(() => vi.stubEnv("APP_API_MOCK", "true"));
  afterEach(() => vi.unstubAllEnvs());

  async function me(scenario: string): Promise<unknown> {
    const response = await getMe(
      new Request("http://winz.test/api/me", { headers: { [MOCK_SCENARIO_HEADER]: scenario } }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
    return response.json();
  }

  it("answers the fan, not the merchant, in every scenario of « My tickets »", async () => {
    const fanScenarios = [
      ...Object.keys(API_ROUTES.tickets.examples).filter((name) => name !== "default"),
      "ticketsUnavailable",
    ];
    expect(fanScenarios).toContain("severalTickets");
    for (const scenario of fanScenarios) {
      expect(await me(scenario), scenario).toEqual(apiExamples.meExamples.fan);
    }
  });

  it("still answers the merchant by default", async () => {
    expect(await me("default")).toEqual(apiExamples.meExamples.merchant);
  });
});
