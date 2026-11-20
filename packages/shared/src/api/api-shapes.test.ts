import { describe, expect, it } from "vitest";

import { API_ROUTES } from "./routes";
import {
  campaignDetailSchema,
  campaignSummarySchema,
  createCampaignRequestSchema,
  eventSummarySchema,
  publicCampaignSchema,
  ticketSchema,
  type CampaignEvent,
  type CreateCampaignRequest,
} from "./schemas";

/**
 * The additions asked by the front before the shapes freeze (F-05): `requestId` on the creation,
 * the game's teams, the team a promo is about and its result in words, each team's chance, and
 * when a campaign was created and went live. Every example of every scenario carries them, with
 * values coherent with the rest of the example (the Arkansas-Texas game, the Pitt game).
 */

const TERMS = {
  instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13",
  product: "Large pizza",
  unitPrice: "20000000",
  refundBps: 10_000,
  usualMarginBps: 6500,
  minMarginBps: 4500,
  budget: "1000000000",
};

describe("createCampaignRequestSchema.requestId", () => {
  it("is required: a body without it is refused, naming the field", () => {
    const result = createCampaignRequestSchema.safeParse({ ...TERMS });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["requestId"]);
    // @ts-expect-error A typed body without `requestId` does not compile: every client sends it.
    const body: CreateCampaignRequest = { ...TERMS };
    expect(createCampaignRequestSchema.safeParse(body).success).toBe(false);
  });

  it("accepts a uuid and refuses anything else", () => {
    const requestId = "6f1d1c3e-9b7a-4c55-8f3e-2a1b0c9d8e7f";
    expect(createCampaignRequestSchema.parse({ ...TERMS, requestId }).requestId).toBe(requestId);
    for (const bad of ["tap-1", "", 42, null]) {
      expect(createCampaignRequestSchema.safeParse({ ...TERMS, requestId: bad }).success).toBe(
        false,
      );
    }
  });

  it("answers the same campaign and payment to a repeat, before and after it went live", () => {
    const { default: first, repeated, repeatedLive } = API_ROUTES.createCampaign.examples;
    expect(repeated).toEqual(first);
    expect(repeatedLive).toEqual({ ...first, status: "live" });
  });
});

/** Every example of a route as [scenario, example] pairs. */
function examplesOf(examples: Record<string, unknown>): [string, unknown][] {
  return Object.entries(examples);
}

/** The game's two short names ("Arkansas", "Texas") must both appear in the event's title. */
function expectGameOfTitle(event: CampaignEvent, eventTitle: string): void {
  for (const team of [event.home, event.away]) {
    const shortName = team.name.split(" ")[0] ?? "";
    expect(eventTitle).toContain(shortName);
  }
}

/** subjectName is in the label; resultLabel is about the same team, in the past tense. */
function expectWords(words: {
  conditionLabel: string;
  subjectName: string | null;
  resultLabel: string | null;
  settled: "yes" | "no" | null;
}): void {
  if (words.subjectName !== null) expect(words.conditionLabel).toContain(words.subjectName);
  if (words.settled === null) {
    expect(words.resultLabel).toBeNull();
    return;
  }
  expect(words.resultLabel).not.toBeNull();
  if (words.subjectName !== null)
    expect(words.resultLabel?.startsWith(words.subjectName)).toBe(true);
  expect(words.resultLabel?.includes("did not")).toBe(words.settled === "no");
}

describe("every scenario carries the additions", () => {
  it.each(examplesOf(API_ROUTES.campaigns.examples))("GET /api/campaigns %s", (_name, example) => {
    const { campaigns } = API_ROUTES.campaigns.response.parse(example);
    expect(campaigns.length).toBeGreaterThan(0);
    for (const campaign of campaigns) {
      expect(campaignSummarySchema.parse(campaign)).toEqual(campaign);
      expectGameOfTitle(campaign.event, campaign.eventTitle);
      const notLive = campaign.status === "draft" || campaign.status === "funding";
      expect(campaign.liveAt === null).toBe(notLive);
      if (campaign.liveAt !== null) {
        expect(Date.parse(campaign.liveAt)).toBeGreaterThan(Date.parse(campaign.createdAt));
      }
      expect(Date.parse(campaign.createdAt)).toBeLessThan(Date.parse(campaign.salesCloseAt));
    }
  });

  it("GET /api/campaigns withFunding shows an unpaid promo the back end keeps", () => {
    const { campaigns } = API_ROUTES.campaigns.response.parse(
      API_ROUTES.campaigns.examples.withFunding,
    );
    expect(campaigns.find((campaign) => campaign.status === "funding")).toMatchObject({
      liveAt: null,
      sales: 0,
    });
  });

  it.each(examplesOf(API_ROUTES.campaignDetail.examples))(
    "GET /api/campaigns/:id %s",
    (_name, example) => {
      const detail = campaignDetailSchema.parse(example);
      expectGameOfTitle(detail.event, detail.eventTitle);
      expect(detail.liveAt).not.toBeNull();
      expectWords({
        ...detail,
        settled: detail.outcome === "yes" || detail.outcome === "no" ? detail.outcome : null,
      });
    },
  );

  it.each(examplesOf(API_ROUTES.publicCampaign.examples))(
    "GET /api/c/:slug %s",
    (_name, example) => {
      const page = publicCampaignSchema.parse(example);
      expectGameOfTitle(page.event, page.eventTitle);
      expectWords({
        ...page,
        settled: page.outcome === "yes" || page.outcome === "no" ? page.outcome : null,
      });
    },
  );

  const ticketExamples: [string, unknown][] = [
    ...examplesOf(API_ROUTES.ticketByToken.examples),
    ...API_ROUTES.tickets.response
      .parse(API_ROUTES.tickets.examples.default)
      .tickets.map((ticket, index): [string, unknown] => [`tickets[${index}]`, ticket]),
  ];
  it.each(ticketExamples)("ticket %s", (_name, example) => {
    const ticket = ticketSchema.parse(example);
    expectGameOfTitle(ticket.event, ticket.eventTitle);
    const settled =
      ticket.phase === "refunded" ? "yes" : ticket.phase === "not_this_time" ? "no" : null;
    expectWords({ ...ticket, settled });
  });

  it.each(examplesOf(API_ROUTES.events.examples))("GET /api/events %s", (_name, example) => {
    const { events } = API_ROUTES.events.response.parse(example);
    for (const event of events) {
      expect(eventSummarySchema.parse(event)).toEqual(event);
      for (const side of ["home", "away"] as const) {
        const team = event[side];
        // The chance is the mid of that team's moneyline: its template's probability, or null
        // when the game lists no moneyline on that team.
        const moneyline = event.templates.find(
          (template) => template.type === "moneyline" && template.team === side,
        );
        expect(team.winProbabilityBps).toBe(moneyline?.probabilityBps ?? null);
      }
      for (const template of event.templates) {
        expect(template.team === null).toBe(template.subjectName === null);
        if (template.team !== null && template.subjectName !== null) {
          expect(event[template.team].name.startsWith(template.subjectName)).toBe(true);
          expect(template.conditionLabel.startsWith(template.subjectName)).toBe(true);
          expect(template.headline).toContain(template.subjectName.slice(0, 4));
        }
      }
    }
  });
});
