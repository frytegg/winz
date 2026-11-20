import {
  API_ROUTES,
  MOCK_SCENARIO_HEADER,
  apiErrorSchema,
  campaignDetailSchema,
  campaignsResponseSchema,
  eventsResponseSchema,
  publicCampaignSchema,
  ticketSchema,
  ticketsResponseSchema,
  type CampaignEvent,
} from "@winz/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getPublicCampaign } from "@/app/api/c/[slug]/route";
import { GET as getCampaign } from "@/app/api/campaigns/[id]/route";
import { GET as getCampaigns, POST as postCampaigns } from "@/app/api/campaigns/route";
import { GET as getEvents } from "@/app/api/events/route";
import { GET as getTicket } from "@/app/api/t/[token]/route";
import { GET as getTickets } from "@/app/api/tickets/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import type { Db } from "./db";
import { setServerDepsForTesting } from "./deps";
import {
  FakeIdentity,
  cryptoWordsIn,
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  insertTicket,
  minutesFrom,
  randomWallet,
  serverDepsFor,
} from "./testing/fixtures";

/**
 * The fields the front asked for before the shapes freeze (F-05), through the real Next.js
 * handlers on a real Postgres: the game's teams on everything that shows a campaign, the team a
 * promo is about and its result in words, each team's chance on the events list, and when a
 * campaign was created and went live. The data is a hockey game unlike every example of
 * packages/shared, so a value that came from a constant would show.
 */

const now = new Date("2026-11-20T18:00:00.000Z");
const startsAt = minutesFrom(now, 240);
const salesClose = minutesFrom(now, 235);
const TICKER = "NHL-2611202200-TOR-BOS";
const MERCHANT = { authorization: "Bearer joe-token" };
const FAN = { authorization: "Bearer fan-token" };
const fanWallet = randomWallet();

const GAME: CampaignEvent = {
  sport: "hockey",
  league: "NHL",
  home: { name: "Boston Bruins", abbreviation: "BOS", logoUrl: "https://cdn.example.com/bos.png" },
  away: { name: "Toronto Maple Leafs", abbreviation: "TOR", logoUrl: null },
};

let database: TestDatabase;
let db: Db;
const identity = new FakeIdentity();
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const created: Record<string, Date> = {};
const wentLive: Record<string, Date | null> = {};

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "GET", headers });
}

function params(values: Record<string, string> = {}): {
  params: Promise<Record<string, string>>;
} {
  return { params: Promise.resolve(values) };
}

async function body(response: Response): Promise<unknown> {
  expect(response.status).toBe(200);
  return response.json() as Promise<unknown>;
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, {
    ticker: TICKER,
    title: "Toronto vs Boston",
    sport: GAME.sport,
    league: GAME.league,
    home: GAME.home,
    away: GAME.away,
    startsAt,
  });
  const fresh = new Date(now.getTime() - 20_000);
  const instruments = [
    {
      symbol: "TOR-ML",
      label: "Toronto wins",
      type: "moneyline",
      side: "away",
      bid: 4000,
      ask: 4200,
    },
    {
      symbol: "BOS-ML",
      label: "Boston wins",
      type: "moneyline",
      side: "home",
      bid: 5600,
      ask: 5900,
    },
    { symbol: "DRAW", label: "Draw", type: "moneyline", side: "tie", bid: 2000, ask: 2200 },
    {
      symbol: "BOS-S2",
      label: "Boston wins by 2+",
      type: "spread",
      side: "home",
      bid: 3000,
      ask: 3200,
    },
    { symbol: "TOTAL", label: "Over 5.5 goals", type: "total", side: null, bid: 4800, ask: 5200 },
  ] as const;
  for (const instrument of instruments) {
    await insertInstrument(db, {
      symbol: instrument.symbol,
      eventTicker: TICKER,
      label: instrument.label,
      type: instrument.type,
      side: instrument.side,
      bidBps: instrument.bid,
      askBps: instrument.ask,
      syncedAt: fresh,
    });
  }

  const { merchantId } = await insertMerchant(db, {
    email: "joe@example.com",
    privyId: "did:privy:joe",
  });
  identity.addUser("joe-token", "did:privy:joe", {
    email: "joe@example.com",
    walletAddress: randomWallet(),
  });
  identity.addUser("fan-token", "did:privy:fan", {
    email: "fan@example.com",
    walletAddress: fanWallet,
  });

  // One campaign per kind of condition and outcome, created and gone live at distinct times.
  const campaigns = [
    { key: "away", symbol: "TOR-ML", label: "Toronto wins", status: "live", outcome: null },
    {
      key: "total",
      symbol: "TOTAL",
      label: "Over 5.5 goals",
      status: "settled_yes",
      outcome: "yes",
    },
    { key: "draw", symbol: "DRAW", label: "Draw", status: "settled_no", outcome: "no" },
    { key: "void", symbol: "BOS-S2", label: "Boston wins by 2+", status: "void", outcome: "void" },
    {
      key: "spread",
      symbol: "BOS-S2",
      label: "Boston wins by 2+",
      status: "settled_no",
      outcome: "no",
    },
  ] as const;
  for (const [index, campaign] of campaigns.entries()) {
    created[campaign.key] = new Date(now.getTime() - (10 - index) * 3_600_000);
    wentLive[campaign.key] = new Date(now.getTime() - (10 - index) * 3_600_000 + 95_000);
    ids[campaign.key] = await insertCampaign(db, {
      merchantId,
      instrument: campaign.symbol,
      eventTicker: TICKER,
      salesClose,
      slug: `joes-${campaign.key}`,
      onchainId: BigInt(index + 1),
      conditionLabel: campaign.label,
      promise: `100% back if ${campaign.label}`,
      status: campaign.status,
      saleState: campaign.outcome === null ? "open" : "closed",
      outcome: campaign.outcome,
      createdAt: created[campaign.key],
      liveAt: wentLive[campaign.key],
    });
    const ticket = await insertTicket(db, {
      campaignId: ids[campaign.key] ?? "",
      buyer: fanWallet,
      status: campaign.outcome === "yes" ? "refunded" : "issued",
      purchasedAt: new Date(now.getTime() - (10 - index) * 60_000),
      refundedAt: campaign.outcome === "yes" ? new Date(now.getTime() - 30_000) : null,
    });
    tokens[campaign.key] = ticket.token;
  }
  // A campaign still waiting for its budget: created, never live.
  created.funding = new Date(now.getTime() - 20 * 60_000);
  wentLive.funding = null;
  ids.funding = await insertCampaign(db, {
    merchantId,
    instrument: "BOS-ML",
    eventTicker: TICKER,
    salesClose,
    conditionLabel: "Boston wins",
    promise: "100% back if Boston wins",
    status: "funding",
    saleState: "closed",
    budgetPi: "pi_budget_unpaid",
    createdAt: created.funding,
  });

  setServerDepsForTesting(serverDepsFor(db, identity, now));
});

afterAll(async () => {
  setServerDepsForTesting(undefined);
  await database.drop();
});

/** subjectName and resultLabel expected for each campaign. */
const WORDS: Record<string, { subjectName: string | null; resultLabel: string | null }> = {
  away: { subjectName: "Toronto", resultLabel: null },
  total: { subjectName: null, resultLabel: "The game went over 5.5 goals" },
  draw: { subjectName: null, resultLabel: "The game did not end in a draw" },
  void: { subjectName: "Boston", resultLabel: null },
  spread: { subjectName: "Boston", resultLabel: "Boston did not win by 2+" },
};

describe("GET /api/campaigns", () => {
  it("carries the game, the creation and the go-live times of each campaign, from the rows", async () => {
    const response = campaignsResponseSchema.parse(
      await body(await getCampaigns(get("/api/campaigns", MERCHANT), params())),
    );
    expect(response.campaigns).toHaveLength(6);
    for (const campaign of response.campaigns) {
      const key = Object.keys(ids).find((name) => ids[name] === campaign.id) ?? "";
      expect(campaign.event).toEqual(GAME);
      expect(campaign.createdAt).toBe(created[key]?.toISOString());
      expect(campaign.liveAt).toBe(wentLive[key]?.toISOString() ?? null);
    }
    // Newest first: the unpaid one, created last, leads; it is not expired by the back end.
    expect(response.campaigns[0]).toMatchObject({
      id: ids.funding,
      status: "funding",
      liveAt: null,
    });
  });
});

describe("GET /api/campaigns/:id", () => {
  it.each(Object.keys(WORDS))("names the team and the result of the %s campaign", async (key) => {
    const detail = campaignDetailSchema.parse(
      await body(
        await getCampaign(
          get(`/api/campaigns/${ids[key]}`, MERCHANT),
          params({ id: ids[key] ?? "" }),
        ),
      ),
    );
    expect(detail).toMatchObject({
      ...WORDS[key],
      event: GAME,
      createdAt: created[key]?.toISOString(),
      liveAt: wentLive[key]?.toISOString(),
    });
  });
});

describe("GET /api/c/:slug", () => {
  it.each(Object.keys(WORDS))("shows the teams, the subject and the result (%s)", async (key) => {
    const page = publicCampaignSchema.parse(
      await body(
        await getPublicCampaign(get(`/api/c/joes-${key}`), params({ slug: `joes-${key}` })),
      ),
    );
    expect(page).toMatchObject({ ...WORDS[key], event: GAME });
    expect(cryptoWordsIn(page)).toEqual([]);
  });
});

describe("GET /api/t/:token and GET /api/tickets", () => {
  it.each(Object.keys(WORDS))(
    "the ticket shows the teams, the subject and the result (%s)",
    async (key) => {
      const ticket = ticketSchema.parse(
        await body(
          await getTicket(get(`/api/t/${tokens[key]}`), params({ token: tokens[key] ?? "" })),
        ),
      );
      expect(ticket).toMatchObject({ ...WORDS[key], event: GAME });
      expect(cryptoWordsIn(ticket)).toEqual([]);
    },
  );

  it("lists the fan's tickets with the same fields", async () => {
    const response = ticketsResponseSchema.parse(
      await body(await getTickets(get("/api/tickets", FAN), params())),
    );
    expect(response.tickets).toHaveLength(5);
    for (const ticket of response.tickets) {
      const key = Object.keys(tokens).find((name) => tokens[name] === ticket.token) ?? "";
      expect(ticket).toMatchObject({ ...WORDS[key], event: GAME });
    }
  });
});

describe("GET /api/events", () => {
  it("gives each team's chance from its own moneyline, and each template its team", async () => {
    const response = eventsResponseSchema.parse(
      await body(await getEvents(get("/api/events", MERCHANT), params())),
    );
    const [game] = response.events;
    expect(game).toMatchObject({
      // (5600 + 5900) / 2 and (4000 + 4200) / 2: two books, 98.5 % together, not 100 %.
      home: { ...GAME.home, winProbabilityBps: 5750 },
      away: { ...GAME.away, winProbabilityBps: 4100 },
    });
    const bySymbol = new Map(
      (game?.templates ?? []).map((template) => [template.instrumentSymbol, template]),
    );
    expect(
      Object.fromEntries([...bySymbol].map(([symbol, t]) => [symbol, [t.subjectName, t.team]])),
    ).toEqual(
      Object.fromEntries(
        (
          [
            ["TOR-ML", ["Toronto", "away"]],
            ["BOS-ML", ["Boston", "home"]],
            ["DRAW", [null, null]],
            ["BOS-S2", ["Boston", "home"]],
            ["TOTAL", [null, null]],
          ] as const
        ).filter(([symbol]) => bySymbol.has(symbol)),
      ),
    );
    // At least one template of each kind of answer is offered.
    expect(bySymbol.size).toBeGreaterThanOrEqual(3);
  });

  it("has no chance for a team without a fresh two-sided quote", async () => {
    await db`update instruments set best_bid_bps = null where symbol = 'TOR-ML'`;
    await db`update instruments set synced_at = ${minutesFrom(now, -10)} where symbol = 'BOS-ML'`;
    try {
      const response = eventsResponseSchema.parse(
        await body(await getEvents(get("/api/events", MERCHANT), params())),
      );
      expect(response.events[0]?.home.winProbabilityBps).toBeNull();
      expect(response.events[0]?.away.winProbabilityBps).toBeNull();
    } finally {
      await db`update instruments set best_bid_bps = 4000 where symbol = 'TOR-ML'`;
      await db`
        update instruments set synced_at = ${new Date(now.getTime() - 20_000)}
        where symbol = 'BOS-ML'
      `;
    }
  });
});

describe("the mock API (APP_API_MOCK) serves the additions", () => {
  beforeEach(() => {
    vi.stubEnv("APP_API_MOCK", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  type Handler = (
    request: Request,
    context: { params: Promise<Record<string, string>> },
  ) => Promise<Response>;
  const reads: [string, Handler, string, Record<string, string>, Record<string, unknown>][] = [
    ["campaigns", getCampaigns, "/api/campaigns", {}, API_ROUTES.campaigns.examples],
    [
      "campaignDetail",
      getCampaign,
      "/api/campaigns/cmp_joes_texas",
      { id: "cmp_joes_texas" },
      API_ROUTES.campaignDetail.examples,
    ],
    [
      "publicCampaign",
      getPublicCampaign,
      "/api/c/joes-texas",
      { slug: "joes-texas" },
      API_ROUTES.publicCampaign.examples,
    ],
    [
      "ticketByToken",
      getTicket,
      "/api/t/tkt_example",
      { token: "tkt_example" },
      API_ROUTES.ticketByToken.examples,
    ],
    ["tickets", getTickets, "/api/tickets", {}, API_ROUTES.tickets.examples],
    ["events", getEvents, "/api/events", {}, API_ROUTES.events.examples],
  ];
  const cases = reads.flatMap(([name, handler, path, values, examples]) =>
    Object.entries(examples).map(
      ([scenario, example]) => [name, scenario, handler, path, values, example] as const,
    ),
  );

  it.each(cases)("%s, scenario %s", async (name, scenario, handler, path, values, example) => {
    const response = await handler(get(path, { [MOCK_SCENARIO_HEADER]: scenario }), params(values));
    const served = await body(response);
    expect(served).toEqual(example);
    // Each of the additions is present in what is served (a key, possibly null).
    const text = JSON.stringify(served);
    const expected: Record<string, readonly string[]> = {
      campaigns: ['"event":', '"createdAt":', '"liveAt":'],
      campaignDetail: ['"event":', '"createdAt":', '"liveAt":', '"subjectName":', '"resultLabel":'],
      publicCampaign: ['"event":', '"subjectName":', '"resultLabel":'],
      ticketByToken: ['"event":', '"subjectName":', '"resultLabel":'],
      tickets: ['"event":', '"subjectName":', '"resultLabel":'],
      events: ['"winProbabilityBps":', '"subjectName":', '"team":'],
    };
    // The additions live on the items of a list: a scenario whose list is empty (tickets,
    // `noTickets`) has none to carry them, and is checked by the `toEqual` above only. The test
    // below makes sure a non-empty scenario of every list still carries them.
    const items = name === "tickets" ? (served as { tickets: unknown[] }).tickets : null;
    if (items !== null && items.length === 0) return;
    for (const key of expected[name] ?? []) expect(text).toContain(key);
  });

  it("checks the additions on a tickets scenario that has tickets", () => {
    const withTickets = Object.values(API_ROUTES.tickets.examples).filter(
      (example) => example.tickets.length > 0,
    );
    expect(withTickets.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(API_ROUTES.createCampaign.examples))(
    "createCampaign, scenario %s: answered with a requestId, refused 400 without one",
    async (scenario, example) => {
      const terms = {
        instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13",
        product: "Large pizza",
        unitPrice: "20000000",
        refundBps: 10_000,
        usualMarginBps: 6500,
        minMarginBps: 4500,
        budget: "1000000000",
      };
      const send = (sent: object): Promise<Response> =>
        postCampaigns(
          new Request("http://localhost/api/campaigns", {
            method: "POST",
            headers: { "content-type": "application/json", [MOCK_SCENARIO_HEADER]: scenario },
            body: JSON.stringify(sent),
          }),
          params(),
        );

      const answered = await send({ ...terms, requestId: "6f1d1c3e-9b7a-4c55-8f3e-2a1b0c9d8e7f" });
      expect(answered.status).toBe(200);
      expect(await body(answered)).toEqual(example);

      const refused = await send(terms);
      expect(refused.status).toBe(400);
      const { error } = apiErrorSchema.parse(await refused.json());
      expect(error.code).toBe("invalid_request");
      expect(error.message).toMatch(/^Invalid body\.requestId: /);
    },
  );
});
