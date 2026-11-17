import { eventsResponseSchema } from "@winz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  CATALOGUE_STALE_AFTER_MS,
  NOMINAL_LEVEL_QTY,
  MAX_EVENTS,
  belowMinimumProbability,
  catalogueBook,
  containsPattern,
  eventTemplates,
  listEvents,
  templateHeadline,
  type CatalogueInstrumentRow,
} from "./events";
import { insertEvent, insertInstrument, minutesFrom } from "./testing/fixtures";

const now = new Date("2026-11-20T18:00:00.000Z");

function instrumentRow(overrides: Partial<CatalogueInstrumentRow>): CatalogueInstrumentRow {
  return {
    symbol: "SYM",
    event_ticker: "EV",
    label: "Texas wins",
    type: "moneyline",
    best_bid_bps: 1100,
    best_ask_bps: 1200,
    synced_at: new Date(now.getTime() - 30_000),
    ...overrides,
  };
}

describe("templateHeadline", () => {
  it("says Free, Half back, or the percentage", () => {
    expect(templateHeadline(10_000n, "Texas wins by 14+")).toBe("Free if Texas wins by 14+");
    expect(templateHeadline(5000, "Texas wins")).toBe("Half back if Texas wins");
    expect(templateHeadline(2500n, "Texas wins")).toBe("25% back if Texas wins");
    expect(templateHeadline(1250n, "Texas wins")).toBe("12.5% back if Texas wins");
    expect(templateHeadline(1205n, "Texas wins")).toBe("12.05% back if Texas wins");
  });
});

describe("containsPattern", () => {
  it("escapes the ILIKE wildcards of the input", () => {
    expect(containsPattern("tex")).toBe("%tex%");
    expect(containsPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});

describe("catalogueBook", () => {
  it("builds a one-level book with a nominal quantity, observed at the last sync", () => {
    const row = instrumentRow({});
    expect(catalogueBook(row)).toEqual({
      instrumentSymbol: "SYM",
      bids: [{ priceBps: 1100n, qty: NOMINAL_LEVEL_QTY }],
      asks: [{ priceBps: 1200n, qty: NOMINAL_LEVEL_QTY }],
      observedAtMs: row.synced_at?.getTime(),
    });
  });

  it("leaves an empty side empty, and has no book before the first sync", () => {
    expect(catalogueBook(instrumentRow({ best_bid_bps: null }))?.bids).toEqual([]);
    expect(catalogueBook(instrumentRow({ synced_at: null }))).toBeNull();
  });
});

describe("eventTemplates", () => {
  it("prices a two-sided quote and disables a one-sided or stale one", () => {
    const templates = eventTemplates(
      [
        instrumentRow({ symbol: "A", label: "Texas wins by 14+", type: "spread" }),
        instrumentRow({ symbol: "B", label: "Arkansas wins", best_bid_bps: null }),
        instrumentRow({
          symbol: "C",
          label: "Over 55.5",
          type: "total",
          synced_at: new Date(now.getTime() - CATALOGUE_STALE_AFTER_MS - 1),
        }),
      ],
      now,
    );
    const bySymbol = new Map(templates.map((template) => [template.instrumentSymbol, template]));
    expect(bySymbol.get("A")).toMatchObject({
      available: true,
      conditionLabel: "Texas wins by 14+",
      headline: "Free if Texas wins by 14+",
      refundBps: 10_000,
      probabilityBps: 1150,
      // 1200 + taker fee 0.07 × 0.12 × 0.88 = 73.92, rounded up: 1274.
      costBps: 1274,
      unavailableReason: null,
    });
    expect(bySymbol.get("B")).toMatchObject({
      available: false,
      unavailableReason: "no_book",
      probabilityBps: null,
      costBps: null,
    });
    expect(bySymbol.get("C")).toMatchObject({ available: false, unavailableReason: "stale_book" });
  });
});

describe("conditions under 5 %", () => {
  it("are detected from the two-sided catalogue mid, rounded down like the pricing library", () => {
    expect(belowMinimumProbability(instrumentRow({ best_bid_bps: 300, best_ask_bps: 400 }))).toBe(
      true,
    );
    // (450 + 549) / 2 = 499.5, rounded down: 499.
    expect(belowMinimumProbability(instrumentRow({ best_bid_bps: 450, best_ask_bps: 549 }))).toBe(
      true,
    );
    expect(belowMinimumProbability(instrumentRow({ best_bid_bps: 450, best_ask_bps: 550 }))).toBe(
      false,
    );
    // Unknown probability: kept, shown disabled.
    expect(belowMinimumProbability(instrumentRow({ best_bid_bps: null, best_ask_bps: 300 }))).toBe(
      false,
    );
  });

  it("are never offered, even when a card is free for them", () => {
    const templates = eventTemplates(
      [
        instrumentRow({ symbol: "LIKELY", label: "Texas wins", type: "moneyline" }),
        instrumentRow({
          symbol: "LONGSHOT",
          label: "Texas wins by 40+",
          type: "spread",
          best_bid_bps: 200,
          best_ask_bps: 400,
        }),
      ],
      now,
    );
    expect(templates.map((template) => template.instrumentSymbol)).not.toContain("LONGSHOT");
    // The single offered condition fills the minimum of three with its other refund rate only.
    expect(templates.map((template) => template.instrumentSymbol)).toEqual(["LIKELY", "LIKELY"]);
  });
});

describe("GET /api/events, at most 50 games", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    // 51 open games, inserted latest first so the order cannot come from insertion.
    for (let index = MAX_EVENTS; index >= 0; index -= 1) {
      await insertEvent(database.db, {
        ticker: `MANY-${String(index).padStart(2, "0")}`,
        startsAt: minutesFrom(now, 60 + index),
      });
    }
  });
  afterAll(async () => {
    await database.drop();
  });

  it("returns the 50 soonest, ordered by start", async () => {
    const response = await listEvents(database.db, {}, now);
    expect(MAX_EVENTS).toBe(50);
    expect(response.events).toHaveLength(50);
    expect(response.events.map((event) => event.ticker)).toEqual(
      Array.from({ length: 50 }, (_, index) => `MANY-${String(index).padStart(2, "0")}`),
    );
  });
});

describe("GET /api/events", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    const db = database.db;
    await insertEvent(db, {
      ticker: "FB-LATE",
      title: "Arkansas vs Texas",
      sport: "football",
      startsAt: minutesFrom(now, 48 * 60),
      home: {
        name: "Texas Longhorns",
        abbreviation: "TEX",
        logoUrl: "https://cdn.example.com/tex.png",
      },
      away: { name: "Arkansas Razorbacks", abbreviation: "ARK", logoUrl: "not a url" },
    });
    await insertEvent(db, {
      ticker: "BB-SOON",
      title: "Villanova vs Pittsburgh",
      sport: "basketball",
      league: "NCAAM",
      status: "upcoming",
      startsAt: minutesFrom(now, 120),
      home: { name: "Pittsburgh Panthers", abbreviation: "PITT" },
      away: { name: "Villanova Wildcats", abbreviation: "VILL" },
    });
    // Sales close in five minutes from now minus one: closed already.
    await insertEvent(db, {
      ticker: "FB-CLOSED",
      title: "Baylor vs Rice",
      startsAt: minutesFrom(now, 4),
    });
    await insertEvent(db, {
      ticker: "FB-SETTLED",
      title: "Oregon vs Utah",
      status: "settled",
      startsAt: minutesFrom(now, 600),
    });

    await insertInstrument(db, {
      symbol: "FB-LATE-TEX13",
      eventTicker: "FB-LATE",
      label: "Texas wins by 14+",
      type: "spread",
      bidBps: 1100,
      askBps: 1200,
      syncedAt: new Date(now.getTime() - 20_000),
    });
    await insertInstrument(db, {
      symbol: "FB-LATE-ARK",
      eventTicker: "FB-LATE",
      label: "Arkansas wins",
      type: "moneyline",
      bidBps: null,
      askBps: 1000,
      syncedAt: new Date(now.getTime() - 20_000),
    });
    await insertInstrument(db, {
      symbol: "FB-LATE-DELISTED",
      eventTicker: "FB-LATE",
      label: "Texas wins by 21+",
      bidBps: 500,
      askBps: 600,
      active: false,
    });
    await insertInstrument(db, {
      symbol: "BB-SOON-PITT",
      eventTicker: "BB-SOON",
      label: "Pittsburgh wins",
      type: "moneyline",
      bidBps: 4600,
      askBps: 4700,
      syncedAt: new Date(now.getTime() - 20_000),
    });
  });
  afterAll(async () => {
    await database.drop();
  });

  it("lists upcoming games whose sales are open, soonest first, valid against the schema", async () => {
    const response = await listEvents(database.db, {}, now);
    expect(eventsResponseSchema.parse(response)).toEqual(response);
    expect(response.events.map((event) => event.ticker)).toEqual(["BB-SOON", "FB-LATE"]);

    const football = response.events[1];
    expect(football).toMatchObject({
      title: "Arkansas vs Texas",
      sport: "football",
      league: "NCAAF",
      startsAt: minutesFrom(now, 48 * 60).toISOString(),
      salesCloseAt: minutesFrom(now, 48 * 60 - 5).toISOString(),
      home: {
        name: "Texas Longhorns",
        abbreviation: "TEX",
        logoUrl: "https://cdn.example.com/tex.png",
      },
      away: { name: "Arkansas Razorbacks", abbreviation: "ARK", logoUrl: null },
    });
  });

  it("builds the templates, leaving delisted contracts out", async () => {
    const response = await listEvents(database.db, { sport: "football" }, now);
    const templates = response.events[0]?.templates ?? [];
    expect(templates.map((template) => template.instrumentSymbol).sort()).toEqual([
      "FB-LATE-ARK",
      "FB-LATE-TEX13",
      // With one quoted condition the half-refund variant fills the minimum of three cards.
      "FB-LATE-TEX13",
    ]);
    const unavailable = templates.find((template) => template.instrumentSymbol === "FB-LATE-ARK");
    expect(unavailable).toMatchObject({
      available: false,
      unavailableReason: "no_book",
      headline: "Free if Arkansas wins",
    });
    const full = templates.find(
      (template) => template.instrumentSymbol === "FB-LATE-TEX13" && template.refundBps === 10_000,
    );
    expect(full).toMatchObject({ available: true, costBps: 1274, probabilityBps: 1150 });
    const half = templates.find(
      (template) => template.instrumentSymbol === "FB-LATE-TEX13" && template.refundBps === 5000,
    );
    expect(half).toMatchObject({ headline: "Half back if Texas wins by 14+", costBps: 637 });
  });

  it("filters by sport", async () => {
    const response = await listEvents(database.db, { sport: "basketball" }, now);
    expect(response.events.map((event) => event.ticker)).toEqual(["BB-SOON"]);
    expect((await listEvents(database.db, { sport: "hockey" }, now)).events).toEqual([]);
  });

  it("searches the title, the league and the team names, ignoring case", async () => {
    const byTeam = await listEvents(database.db, { search: "longhorns" }, now);
    expect(byTeam.events.map((event) => event.ticker)).toEqual(["FB-LATE"]);
    const byAbbreviation = await listEvents(database.db, { search: "PITT" }, now);
    expect(byAbbreviation.events.map((event) => event.ticker)).toEqual(["BB-SOON"]);
    const byLeague = await listEvents(database.db, { search: "ncaam" }, now);
    expect(byLeague.events.map((event) => event.ticker)).toEqual(["BB-SOON"]);
    const combined = await listEvents(database.db, { sport: "basketball", search: "texas" }, now);
    expect(combined.events).toEqual([]);
    const wildcard = await listEvents(database.db, { search: "%" }, now);
    expect(wildcard.events).toEqual([]);
  });

  it("excludes games whose sales are closed and settled games", async () => {
    const response = await listEvents(database.db, { search: "vs" }, now);
    const tickers = response.events.map((event) => event.ticker);
    expect(tickers).not.toContain("FB-CLOSED");
    expect(tickers).not.toContain("FB-SETTLED");
  });
});
