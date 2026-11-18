import { publicCampaignSchema, ticketSchema, ticketsResponseSchema } from "@winz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { ApiRouteError } from "./route";
import {
  cryptoWordsIn,
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertLive,
  insertMerchant,
  insertTicket,
  minutesFrom,
  randomWallet,
} from "./testing/fixtures";
import { myTickets, publicCampaign, ticketByToken, ticketPhase } from "./tickets";

const now = new Date("2026-11-20T18:00:00.000Z");
const FUTURE_START = minutesFrom(now, 120);
const PAST_START = minutesFrom(now, -30);

let database: TestDatabase;
const fan = randomWallet();
const tokens: Record<string, string> = {};

async function rejection(promise: Promise<unknown>): Promise<ApiRouteError> {
  const error = await promise.then(
    () => new Error("expected a refusal"),
    (caught: unknown) => caught,
  );
  if (error instanceof ApiRouteError) return error;
  throw error;
}

beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;
  const { merchantId } = await insertMerchant(db, { email: "joe@example.com" });

  // One game per phase, each with its own instrument and campaign.
  const cases = [
    { name: "preGame", startsAt: FUTURE_START, outcome: null, refunded: false },
    { name: "inGame", startsAt: PAST_START, outcome: null, refunded: false },
    { name: "refunded", startsAt: PAST_START, outcome: "yes", refunded: true },
    { name: "notThisTime", startsAt: PAST_START, outcome: "no", refunded: false },
    { name: "cancelled", startsAt: PAST_START, outcome: "void", refunded: false },
  ] as const;
  for (const [index, entry] of cases.entries()) {
    const ticker = `EV-${entry.name}`;
    const symbol = `SYM-${entry.name}`;
    await insertEvent(db, { ticker, title: "Arkansas vs Texas", startsAt: entry.startsAt });
    await insertInstrument(db, { symbol, eventTicker: ticker, label: "Texas wins by 14+" });
    await insertLive(db, {
      symbol,
      bidBps: 1300,
      askBps: 1500,
      observedAt: new Date(now.getTime() - 1_000),
    });
    const campaignId = await insertCampaign(db, {
      merchantId,
      instrument: symbol,
      eventTicker: ticker,
      salesClose: minutesFrom(entry.startsAt, -5),
      slug: `joes-${entry.name.toLowerCase()}`,
      onchainId: BigInt(index + 1),
      status:
        entry.outcome === null
          ? "live"
          : entry.outcome === "void"
            ? "void"
            : `settled_${entry.outcome}`,
      saleState: entry.outcome === null ? "open" : "closed",
      outcome: entry.outcome,
    });
    const ticket = await insertTicket(db, {
      campaignId,
      buyer: fan,
      status: entry.refunded ? "refunded" : "issued",
      purchasedAt: new Date(now.getTime() - (10 - index) * 60_000),
      refundedAt: entry.refunded ? new Date(now.getTime() - 60_000) : null,
    });
    tokens[entry.name] = ticket.token;
  }
  // Someone else's ticket: never in the fan's list.
  const [other] = await db<{ id: string }[]>`select id from campaigns limit 1`;
  await insertTicket(db, { campaignId: other?.id ?? "", buyer: randomWallet() });
});
afterAll(async () => {
  await database.drop();
});

describe("ticketPhase", () => {
  const base = { ticketStatus: "issued", outcome: null, startsAt: FUTURE_START, now } as const;

  it("follows SPEC 5.4, first match wins", () => {
    expect(ticketPhase(base)).toBe("pre_game");
    expect(ticketPhase({ ...base, startsAt: PAST_START })).toBe("in_game");
    expect(ticketPhase({ ...base, startsAt: now })).toBe("in_game");
    expect(ticketPhase({ ...base, outcome: "no" })).toBe("not_this_time");
    expect(ticketPhase({ ...base, outcome: "void" })).toBe("cancelled");
    expect(ticketPhase({ ...base, outcome: "yes", ticketStatus: "refunded" })).toBe("refunded");
    // A YES whose refund is still on its way stays "game on".
    expect(ticketPhase({ ...base, startsAt: PAST_START, outcome: "yes" })).toBe("in_game");
  });
});

describe("GET /api/t/:token", () => {
  it.each([
    ["preGame", "pre_game", 1400],
    ["inGame", "in_game", 1400],
    ["refunded", "refunded", null],
    ["notThisTime", "not_this_time", null],
    ["cancelled", "cancelled", null],
  ] as const)("derives the %s phase", async (name, phase, probabilityBps) => {
    const ticket = await ticketByToken(database.db, tokens[name] ?? "", now);
    expect(ticketSchema.parse(ticket)).toEqual(ticket);
    expect(ticket.phase).toBe(phase);
    expect(ticket.probabilityBps).toBe(probabilityBps);
    // The result in words follows the campaign's outcome: none before it, none on a void game.
    const results: Record<string, string | null> = {
      preGame: null,
      inGame: null,
      refunded: "Texas won by 14+",
      notThisTime: "Texas did not win by 14+",
      cancelled: null,
    };
    expect(ticket.resultLabel).toBe(results[name]);
    expect(ticket.subjectName).toBe("Texas");
    expect(cryptoWordsIn(ticket)).toEqual([]);
  });

  it("answers the full ticket", async () => {
    const ticket = await ticketByToken(database.db, tokens.refunded ?? "", now);
    expect(ticket).toEqual({
      token: tokens.refunded,
      campaignSlug: "joes-refunded",
      merchant: { name: "Joe's Pizza", logoUrl: null },
      product: "Large pizza",
      qty: 1,
      paid: "20000000",
      refundable: "20000000",
      promise: "100% back if Texas wins by 14+",
      conditionLabel: "Texas wins by 14+",
      subjectName: "Texas",
      resultLabel: "Texas won by 14+",
      eventTitle: "Arkansas vs Texas",
      event: {
        sport: "football",
        league: "NCAAF",
        home: { name: "Texas Longhorns", abbreviation: "TEX", logoUrl: null },
        away: { name: "Arkansas Razorbacks", abbreviation: "ARK", logoUrl: null },
      },
      phase: "refunded",
      probabilityBps: null,
      startsAt: PAST_START.toISOString(),
      purchasedAt: new Date(now.getTime() - 8 * 60_000).toISOString(),
      refundedAt: new Date(now.getTime() - 60_000).toISOString(),
      instrumentSymbol: "SYM-refunded",
      demo: false,
    });
  });

  it("hides a stale live quote", async () => {
    await database.db`update live_instruments set stale = true where symbol = 'SYM-preGame'`;
    try {
      const ticket = await ticketByToken(database.db, tokens.preGame ?? "", now);
      expect(ticket.probabilityBps).toBeNull();
    } finally {
      await database.db`update live_instruments set stale = false where symbol = 'SYM-preGame'`;
    }
    const late = await ticketByToken(database.db, tokens.preGame ?? "", minutesFrom(now, 1));
    expect(late.probabilityBps).toBeNull();
  });

  it("answers 404 for an unknown token", async () => {
    const error = await rejection(ticketByToken(database.db, "tkt_unknown_0123456789", now));
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });
});

describe("GET /api/tickets", () => {
  it("lists the fan's tickets, newest first, with the total refunded", async () => {
    const response = await myTickets(database.db, fan.toUpperCase().replace("0X", "0x"), now);
    expect(ticketsResponseSchema.parse(response)).toEqual(response);
    expect(response.tickets.map((ticket) => ticket.phase)).toEqual([
      "cancelled",
      "not_this_time",
      "refunded",
      "in_game",
      "pre_game",
    ]);
    expect(response.refundedTotal).toBe("20000000");
    expect(cryptoWordsIn(response)).toEqual([]);
  });

  it("leaves out a ticket whose campaign has no slug instead of failing the whole list", async () => {
    const db = database.db;
    const [campaign] = await db<
      { merchant_id: string; instrument: string; event_ticker: string }[]
    >`
      select merchant_id, instrument, event_ticker from campaigns where slug = 'joes-pregame'
    `;
    if (!campaign) throw new Error("fixture campaign missing");
    const orphan = await insertCampaign(db, {
      merchantId: campaign.merchant_id,
      instrument: campaign.instrument,
      eventTicker: campaign.event_ticker,
      salesClose: minutesFrom(FUTURE_START, -5),
      slug: null,
    });
    const ticket = await insertTicket(db, { campaignId: orphan, buyer: fan });
    try {
      const response = await myTickets(db, fan, now);
      expect(ticketsResponseSchema.parse(response)).toEqual(response);
      expect(response.tickets).toHaveLength(5);
      expect(response.tickets.map((entry) => entry.token)).not.toContain(ticket.token);
    } finally {
      await db`delete from tickets where id = ${ticket.id}`;
      await db`delete from campaigns where id = ${orphan}`;
    }
  });

  it("is empty for someone without purchases or without a wallet yet", async () => {
    expect(await myTickets(database.db, randomWallet(), now)).toEqual({
      tickets: [],
      refundedTotal: "0",
    });
    expect(await myTickets(database.db, null, now)).toEqual({ tickets: [], refundedTotal: "0" });
  });
});

describe("GET /api/c/:slug", () => {
  it("answers the public page of a live campaign", async () => {
    const page = await publicCampaign(database.db, "joes-pregame", now);
    expect(publicCampaignSchema.parse(page)).toEqual(page);
    expect(page).toEqual({
      slug: "joes-pregame",
      merchant: { name: "Joe's Pizza", logoUrl: null, category: "pizza" },
      product: "Large pizza",
      unitPrice: "20000000",
      refundBps: 10_000,
      promise: "100% back if Texas wins by 14+",
      conditionLabel: "Texas wins by 14+",
      subjectName: "Texas",
      resultLabel: null,
      eventTitle: "Arkansas vs Texas",
      event: {
        sport: "football",
        league: "NCAAF",
        home: { name: "Texas Longhorns", abbreviation: "TEX", logoUrl: null },
        away: { name: "Arkansas Razorbacks", abbreviation: "ARK", logoUrl: null },
      },
      probabilityBps: 1400,
      saleState: "open",
      startsAt: FUTURE_START.toISOString(),
      salesCloseAt: minutesFrom(FUTURE_START, -5).toISOString(),
      outcome: null,
      instrumentSymbol: "SYM-preGame",
      demo: false,
    });
    expect(cryptoWordsIn(page)).toEqual([]);
  });

  it("shows a settled campaign closed and without odds", async () => {
    const page = await publicCampaign(database.db, "joes-notthistime", now);
    expect(page).toMatchObject({
      saleState: "closed",
      outcome: "no",
      probabilityBps: null,
      resultLabel: "Texas did not win by 14+",
    });
    expect(cryptoWordsIn(page)).toEqual([]);
  });

  it.each(["draft", "funding"] as const)(
    "answers 404 for a %s campaign that already has a slug",
    async (status) => {
      const db = database.db;
      const [campaign] = await db<
        { merchant_id: string; instrument: string; event_ticker: string }[]
      >`
        select merchant_id, instrument, event_ticker from campaigns where slug = 'joes-pregame'
      `;
      if (!campaign) throw new Error("fixture campaign missing");
      const slug = `joes-${status}`;
      const id = await insertCampaign(db, {
        merchantId: campaign.merchant_id,
        instrument: campaign.instrument,
        eventTicker: campaign.event_ticker,
        salesClose: minutesFrom(FUTURE_START, -5),
        slug,
        status,
        saleState: "closed",
      });
      try {
        const error = await rejection(publicCampaign(db, slug, now));
        expect(error.status).toBe(404);
        // Once live, the same page is public.
        await db`update campaigns set status = 'live', sale_state = 'open' where id = ${id}`;
        expect((await publicCampaign(db, slug, now)).slug).toBe(slug);
      } finally {
        await db`delete from campaigns where id = ${id}`;
      }
    },
  );

  it("answers 404 for an unknown slug", async () => {
    const error = await rejection(publicCampaign(database.db, "nobody-here", now));
    expect(error.status).toBe(404);
  });
});
