import { instrumentId } from "@winz/shared";
import type { Outcome } from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../testing/postgres";

import { SettlementConflictError } from "./errors";
import { GeminiRestClient } from "./gemini-rest-client";
import type { NormalizedEvent, NormalizedInstrument } from "./normalize";
import { PgCatalogStore } from "./pg-catalog-store";
import { eventsResponseSchema, type RawEvent } from "./schemas";
import { loadSportsCatalog, startCatalogSync, storeCatalog, syncSettlements } from "./sync";
import {
  fakeFetch,
  fakeTime,
  fixtureJson,
  fixtureText,
  silentLogger,
  type FixtureName,
} from "./test-support";

const ARK_TEX = "NCAAF-2611212030-ARK-TEX-M";
const TEX_WINS = "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX";
const ARK_WINS = "GEMI-NCAAF-2611212030-ARK-TEX-M-ARK";
const TEX_BY_14 = "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13";
const VAN_UTA = "NHL-2611170230-VAN-UTA-M";
const TXSO_UCSD = "NCAAM-2611170300-TXSO-UCSD-M";

const FIRST_SYNC = Date.parse("2026-11-17T12:00:00.000Z");
const SECOND_SYNC = Date.parse("2026-11-17T12:01:00.000Z");
const SETTLED_AT = new Date("2026-11-17T05:23:00.000Z");

interface EventRow {
  ticker: string;
  title: string;
  sport: string;
  league: string;
  home_name: string;
  home_abbreviation: string;
  home_logo_url: string | null;
  away_name: string;
  away_abbreviation: string;
  starts_at: Date;
  sales_close_at: Date;
  status: string;
  gemini_status: string | null;
  result: string | null;
  synced_at: Date | null;
  created_at: Date;
}

interface InstrumentRow {
  symbol: string;
  event_ticker: string;
  label: string;
  type: string;
  strike: string | null;
  onchain_id: string;
  side: string | null;
  outcome: string | null;
  settled_at: Date | null;
  best_bid_bps: number | null;
  best_ask_bps: number | null;
  active: boolean;
  synced_at: Date | null;
  created_at: Date;
}

/** The recorded active page, as a fresh mutable copy. */
function activePage(): { data: RawEvent[]; pagination: unknown } {
  return eventsResponseSchema.parse(fixtureJson("events-active-sports"));
}

function findContract(events: RawEvent[], symbol: string): RawEvent["contracts"][number] {
  for (const event of events) {
    for (const market of [event, ...(event.events ?? [])]) {
      const contract = market.contracts.find((item) => item.instrumentSymbol === symbol);
      if (contract) return contract;
    }
  }
  throw new Error(`fixture has no contract ${symbol}`);
}

/** A client whose every request is answered with `body()`, read again at each request. */
function clientOn(body: () => string): GeminiRestClient {
  const http = fakeFetch(() => ({ status: 200, body: body() }));
  const time = fakeTime();
  return new GeminiRestClient({
    baseUrl: "https://gemini.test",
    logger: silentLogger,
    fetch: http.fetch,
    now: time.now,
    sleep: time.sleep,
  });
}

function game(ticker: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const [league = "NHL", , away = "AAA", home = "BBB"] = ticker.split("-");
  return {
    ticker,
    title: `${away} vs ${home}`,
    sport: "hockey",
    league,
    startsAt: new Date("2026-11-17T02:30:00.000Z"),
    salesCloseAt: new Date("2026-11-17T02:25:00.000Z"),
    home: { name: home, abbreviation: home },
    away: { name: away, abbreviation: away },
    status: "active",
    ...overrides,
  };
}

function moneyline(eventTicker: string, team: string): NormalizedInstrument {
  return {
    symbol: `GEMI-${eventTicker}-${team}`,
    eventTicker,
    type: "moneyline",
    strike: null,
    label: `${team} wins`,
    side: null,
    bestBidBps: null,
    bestAskBps: null,
  };
}

describe("PgCatalogStore", () => {
  let database: TestDatabase;
  let clock: number;
  let store: PgCatalogStore;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });
  beforeEach(async () => {
    await database.db`truncate table events cascade`;
    clock = FIRST_SYNC;
    store = new PgCatalogStore(database.db, { now: () => clock });
  });

  async function syncFrom(body: () => string): Promise<{
    events: number;
    instruments: number;
    delisted: number;
  }> {
    const catalog = await loadSportsCatalog(clientOn(body), silentLogger);
    return storeCatalog(catalog, store);
  }

  async function eventRow(ticker: string): Promise<EventRow> {
    const [row] = await database.db<EventRow[]>`select * from events where ticker = ${ticker}`;
    if (!row) throw new Error(`no event ${ticker}`);
    return row;
  }

  async function instrumentRow(symbol: string): Promise<InstrumentRow> {
    const [row] = await database.db<InstrumentRow[]>`
      select * from instruments where symbol = ${symbol}
    `;
    if (!row) throw new Error(`no instrument ${symbol}`);
    return row;
  }

  async function counts(): Promise<{ events: bigint; instruments: bigint }> {
    const [row] = await database.db<{ events: bigint; instruments: bigint }[]>`
      select (select count(*) from events) as events,
             (select count(*) from instruments) as instruments
    `;
    if (!row) throw new Error("no count row");
    return row;
  }

  /** Two settled games of the recorded settled page, stored as they were while trading. */
  async function seedSettledGames(): Promise<void> {
    await store.upsertEvents([game(VAN_UTA), game(TXSO_UCSD)]);
    await store.upsertInstruments([
      moneyline(VAN_UTA, "VAN"),
      moneyline(VAN_UTA, "UTA"),
      moneyline(TXSO_UCSD, "TXSO"),
      moneyline(TXSO_UCSD, "UCSD"),
    ]);
  }

  describe("catalogue sync", () => {
    it("inserts the recorded catalogue: events, instruments, on-chain id, side, quotes", async () => {
      const result = await syncFrom(() => fixtureText("events-active-sports"));

      expect(result).toEqual({ events: 3, instruments: 73, delisted: 0 });
      expect(await counts()).toEqual({ events: 3n, instruments: 73n });

      expect(await eventRow(ARK_TEX)).toMatchObject({
        title: "Arkansas vs Texas",
        sport: "football",
        league: "NCAAF",
        home_name: "Texas Longhorns",
        home_abbreviation: "TEX",
        away_name: "Arkansas Razorbacks",
        away_abbreviation: "ARK",
        starts_at: new Date("2026-11-21T20:30:00.000Z"),
        sales_close_at: new Date("2026-11-21T20:25:00.000Z"),
        status: "active",
        gemini_status: "active",
        result: null,
        synced_at: new Date(FIRST_SYNC),
      });
      expect(await instrumentRow(TEX_WINS)).toMatchObject({
        event_ticker: ARK_TEX,
        label: "Texas wins",
        type: "moneyline",
        strike: null,
        onchain_id: instrumentId(TEX_WINS),
        side: "home",
        outcome: null,
        settled_at: null,
        best_bid_bps: 9000,
        best_ask_bps: 9200,
        active: true,
        synced_at: new Date(FIRST_SYNC),
      });
      expect(await instrumentRow(TEX_BY_14)).toMatchObject({
        label: "Texas wins by 14+",
        type: "spread",
        strike: "13.50",
        onchain_id: instrumentId(TEX_BY_14),
        side: "home",
        best_bid_bps: null,
        best_ask_bps: null,
      });
      expect(await instrumentRow("GEMI-NCAAF-2611212030-ARK-TEX-T-O67")).toMatchObject({
        type: "total",
        strike: "67.50",
        side: null,
      });
    });

    it("stores the same on-chain ids as the seed of the schema", async () => {
      await syncFrom(() => fixtureText("events-active-sports"));
      // Values of supabase/seed.sql, computed there with viem.
      expect((await instrumentRow(TEX_BY_14)).onchain_id).toBe(
        "0xac378e3ba3c010c5eb22fed87c7c22fd34cca53559eb89ccde81398c266f884c",
      );
      expect((await instrumentRow(TEX_WINS)).onchain_id).toBe(
        "0x8678dbb9a92e72e47ca9fdd2f06501129215ca70e19ea506c3abc845fb70b16f",
      );
    });

    it("updates on a second sync without creating duplicates", async () => {
      await syncFrom(() => fixtureText("events-active-sports"));
      const before = await instrumentRow(TEX_WINS);
      const eventBefore = await eventRow(ARK_TEX);

      clock = SECOND_SYNC;
      const page = activePage();
      const texas = page.data.find((event) => event.ticker === ARK_TEX);
      if (!texas) throw new Error("fixture has no Arkansas vs Texas game");
      texas.title = "Arkansas at Texas";
      const result = await syncFrom(() => JSON.stringify(page));

      expect(result).toEqual({ events: 3, instruments: 73, delisted: 0 });
      expect(await counts()).toEqual({ events: 3n, instruments: 73n });
      const eventAfter = await eventRow(ARK_TEX);
      expect(eventAfter.title).toBe("Arkansas at Texas");
      expect(eventAfter.synced_at).toEqual(new Date(SECOND_SYNC));
      expect(eventAfter.created_at).toEqual(eventBefore.created_at);
      const after = await instrumentRow(TEX_WINS);
      expect(after.synced_at).toEqual(new Date(SECOND_SYNC));
      expect(after.created_at).toEqual(before.created_at);
      expect(after.onchain_id).toBe(before.onchain_id);
    });

    it("updates best bid and ask when the quote changed, and clears a side that emptied", async () => {
      await syncFrom(() => fixtureText("events-active-sports"));

      const page = activePage();
      findContract(page.data, TEX_WINS).prices = { bestBid: "0.85", bestAsk: "0.87" };
      findContract(page.data, ARK_WINS).prices = { bestAsk: "0.15" };
      findContract(page.data, TEX_BY_14).prices = { bestBid: "0.11", bestAsk: "0.13" };
      await syncFrom(() => JSON.stringify(page));

      expect(await instrumentRow(TEX_WINS)).toMatchObject({
        best_bid_bps: 8500,
        best_ask_bps: 8700,
      });
      expect(await instrumentRow(ARK_WINS)).toMatchObject({
        best_bid_bps: null,
        best_ask_bps: 1500,
      });
      expect(await instrumentRow(TEX_BY_14)).toMatchObject({
        best_bid_bps: 1100,
        best_ask_bps: 1300,
      });
    });

    it("keeps an instrument that a later sync no longer lists, marked inactive", async () => {
      await syncFrom(() => fixtureText("events-active-sports"));

      // Once removed from the payload, once listed but no longer trading.
      const page = activePage();
      for (const event of page.data) {
        for (const market of [event, ...(event.events ?? [])]) {
          market.contracts = market.contracts.filter(
            (contract) => contract.instrumentSymbol !== TEX_BY_14,
          );
        }
      }
      findContract(page.data, ARK_WINS).status = "closed";
      clock = SECOND_SYNC;
      const result = await syncFrom(() => JSON.stringify(page));

      expect(result).toEqual({ events: 3, instruments: 71, delisted: 2 });
      expect(await counts()).toEqual({ events: 3n, instruments: 73n });
      expect(await instrumentRow(TEX_BY_14)).toMatchObject({
        active: false,
        label: "Texas wins by 14+",
        synced_at: new Date(FIRST_SYNC),
      });
      expect((await instrumentRow(ARK_WINS)).active).toBe(false);
      expect((await instrumentRow(TEX_WINS)).active).toBe(true);

      // Listed again: active again.
      const back = await syncFrom(() => fixtureText("events-active-sports"));
      expect(back.delisted).toBe(0);
      expect((await instrumentRow(TEX_BY_14)).active).toBe(true);
      expect((await instrumentRow(ARK_WINS)).active).toBe(true);
    });

    it("keeps an event that a later sync no longer lists", async () => {
      await syncFrom(() => fixtureText("events-active-sports"));
      const page = activePage();
      page.data = page.data.filter((event) => !event.ticker.startsWith("NHL-"));
      const result = await syncFrom(() => JSON.stringify(page));

      expect(result.events).toBe(2);
      expect(result.delisted).toBe(15);
      expect(await counts()).toEqual({ events: 3n, instruments: 73n });
      expect((await eventRow("NHL-2611180000-EDM-FLA-M")).status).toBe("active");
    });

    it("delists nothing on an empty catalogue", async () => {
      await syncFrom(() => fixtureText("events-active-sports"));
      const result = await syncFrom(() =>
        JSON.stringify({ data: [], pagination: { limit: 50, offset: 0, total: 0 } }),
      );

      expect(result).toEqual({ events: 0, instruments: 0, delisted: 0 });
      const [row] = await database.db<{ active: bigint }[]>`
        select count(*) filter (where active) as active from instruments
      `;
      expect(row?.active).toBe(73n);
    });

    it("writes thousands of instruments in one call", async () => {
      await store.upsertEvents([game(VAN_UTA)]);
      const many = Array.from({ length: 2_500 }, (_, index) => ({
        ...moneyline(VAN_UTA, `X${index.toString()}`),
        bestBidBps: BigInt(index),
        bestAskBps: BigInt(index + 1),
      }));
      await store.upsertInstruments(many);
      await store.upsertInstruments(many);

      expect((await counts()).instruments).toBe(2_500n);
      expect(await instrumentRow(`GEMI-${VAN_UTA}-X2499`)).toMatchObject({
        best_bid_bps: 2499,
        best_ask_bps: 2500,
      });
    });

    it("takes the last of two rows with the same key in one call", async () => {
      await store.upsertEvents([game(VAN_UTA), game(VAN_UTA, { title: "second" })]);
      await store.upsertInstruments([
        moneyline(VAN_UTA, "VAN"),
        { ...moneyline(VAN_UTA, "VAN"), label: "second" },
      ]);

      expect(await counts()).toEqual({ events: 1n, instruments: 1n });
      expect((await eventRow(VAN_UTA)).title).toBe("second");
      expect((await instrumentRow(`GEMI-${VAN_UTA}-VAN`)).label).toBe("second");
    });

    it("does not forget a side when a later payload omits it", async () => {
      await store.upsertEvents([game(VAN_UTA)]);
      await store.upsertInstruments([{ ...moneyline(VAN_UTA, "VAN"), side: "away" }]);
      await store.upsertInstruments([moneyline(VAN_UTA, "VAN")]);
      expect((await instrumentRow(`GEMI-${VAN_UTA}-VAN`)).side).toBe("away");
    });

    it("leaves the logos of an event alone", async () => {
      await store.upsertEvents([game(VAN_UTA)]);
      await database.db`update events set home_logo_url = 'https://cdn.test/uta.png'`;
      await store.upsertEvents([game(VAN_UTA, { title: "refreshed" })]);
      expect(await eventRow(VAN_UTA)).toMatchObject({
        title: "refreshed",
        home_logo_url: "https://cdn.test/uta.png",
      });
    });

    it("maps Gemini's event status and keeps the raw string", async () => {
      const statuses = [
        ["approved", "upcoming"],
        ["active", "active"],
        ["closed", "closed"],
        ["settled", "settled"],
        ["invalid", "void"],
        ["something_new", "closed"],
      ] as const;
      await store.upsertEvents(
        statuses.map(([gemini], index) =>
          game(`NHL-261117023${index.toString()}-AAA-BBB-M`, { status: gemini }),
        ),
      );

      const rows = await database.db<{ status: string; gemini_status: string }[]>`
        select status, gemini_status from events order by ticker
      `;
      expect(rows.map((row) => [row.gemini_status, row.status])).toEqual(statuses);
    });

    it("rejects an instrument whose event is not stored, and writes nothing", async () => {
      await store.upsertEvents([game(VAN_UTA)]);
      await expect(
        store.upsertInstruments([moneyline(VAN_UTA, "VAN"), moneyline(TXSO_UCSD, "UCSD")]),
      ).rejects.toMatchObject({ code: "23503" });
      expect((await counts()).instruments).toBe(0n);
    });

    it("accepts an empty batch", async () => {
      await store.upsertEvents([]);
      await store.upsertInstruments([]);
      expect(await store.markDelisted([])).toBe(0);
      expect(await counts()).toEqual({ events: 0n, instruments: 0n });
    });
  });

  describe("markSettled", () => {
    const VAN = `GEMI-${VAN_UTA}-VAN`;
    const UTA = `GEMI-${VAN_UTA}-UTA`;
    const TXSO = `GEMI-${TXSO_UCSD}-TXSO`;
    const UCSD = `GEMI-${TXSO_UCSD}-UCSD`;

    it("records the outcomes and closes the event once all its instruments are resolved", async () => {
      await seedSettledGames();

      const first = await store.markSettled(new Map<string, Outcome>([[VAN, "yes"]]), SETTLED_AT);
      expect(first).toBe(1);
      expect(await instrumentRow(VAN)).toMatchObject({
        outcome: "yes",
        settled_at: SETTLED_AT,
        active: false,
      });
      expect(await instrumentRow(UTA)).toMatchObject({
        outcome: null,
        settled_at: null,
        active: true,
      });
      // One of two instruments resolved: the event is not settled yet.
      expect((await eventRow(VAN_UTA)).status).toBe("active");

      const second = await store.markSettled(new Map<string, Outcome>([[UTA, "no"]]), SETTLED_AT);
      expect(second).toBe(1);
      expect((await eventRow(VAN_UTA)).status).toBe("settled");
      expect((await eventRow(TXSO_UCSD)).status).toBe("active");
    });

    it("is idempotent: a replay settles nothing and keeps the first settled_at", async () => {
      await seedSettledGames();
      const outcomes = new Map<string, Outcome>([
        [VAN, "yes"],
        [UTA, "no"],
      ]);

      expect(await store.markSettled(outcomes, SETTLED_AT)).toBe(2);
      expect(await store.markSettled(outcomes, new Date("2026-11-18T00:00:00.000Z"))).toBe(0);
      expect(await instrumentRow(VAN)).toMatchObject({ outcome: "yes", settled_at: SETTLED_AT });
      expect(await instrumentRow(UTA)).toMatchObject({ outcome: "no", settled_at: SETTLED_AT });
      expect((await eventRow(VAN_UTA)).status).toBe("settled");
    });

    it("refuses a conflicting outcome and applies nothing of the batch", async () => {
      await seedSettledGames();
      await store.markSettled(new Map<string, Outcome>([[VAN, "yes"]]), SETTLED_AT);

      const conflicting = new Map<string, Outcome>([
        [UTA, "yes"],
        [TXSO, "no"],
        [UCSD, "yes"],
        [VAN, "no"],
      ]);
      const attempt = store.markSettled(conflicting, new Date("2026-11-18T00:00:00.000Z"));
      await expect(attempt).rejects.toBeInstanceOf(SettlementConflictError);
      await expect(attempt).rejects.toMatchObject({
        instrumentSymbol: VAN,
        recorded: "yes",
        received: "no",
      });

      expect(await instrumentRow(VAN)).toMatchObject({ outcome: "yes", settled_at: SETTLED_AT });
      for (const symbol of [UTA, TXSO, UCSD]) {
        expect(await instrumentRow(symbol)).toMatchObject({
          outcome: null,
          settled_at: null,
          active: true,
        });
      }
      expect((await eventRow(VAN_UTA)).status).toBe("active");
      expect((await eventRow(TXSO_UCSD)).status).toBe("active");
    });

    it("ignores symbols it does not know", async () => {
      await seedSettledGames();
      const outcomes = new Map<string, Outcome>([
        ["GEMI-NOT-IN-THE-CATALOGUE", "void"],
        [VAN, "yes"],
      ]);

      expect(await store.markSettled(outcomes, SETTLED_AT)).toBe(1);
      expect(
        await store.markSettled(
          new Map<string, Outcome>([["GEMI-NOT-IN-THE-CATALOGUE", "yes"]]),
          SETTLED_AT,
        ),
      ).toBe(0);
      expect(await store.markSettled(new Map(), SETTLED_AT)).toBe(0);
      expect((await counts()).instruments).toBe(4n);
    });

    it("marks the event void when every instrument is void", async () => {
      await seedSettledGames();
      const outcomes = new Map<string, Outcome>([
        [TXSO, "void"],
        [UCSD, "void"],
      ]);

      expect(await store.markSettled(outcomes, SETTLED_AT)).toBe(2);
      expect((await eventRow(TXSO_UCSD)).status).toBe("void");
      expect((await eventRow(VAN_UTA)).status).toBe("active");
    });

    it("marks the event settled, not void, when only some instruments are void", async () => {
      await seedSettledGames();
      const outcomes = new Map<string, Outcome>([
        [VAN, "yes"],
        [UTA, "void"],
      ]);
      await store.markSettled(outcomes, SETTLED_AT);
      expect((await eventRow(VAN_UTA)).status).toBe("settled");
    });

    it("counts delisted instruments too: an event with an unresolved one stays open", async () => {
      await seedSettledGames();
      await store.markDelisted([VAN, TXSO, UCSD]);
      await store.markSettled(new Map<string, Outcome>([[VAN, "yes"]]), SETTLED_AT);
      expect((await instrumentRow(UTA)).active).toBe(false);
      expect((await eventRow(VAN_UTA)).status).toBe("active");
    });

    it("keeps the outcome, and the settled status of the event, across a later catalogue upsert", async () => {
      await seedSettledGames();
      await store.markSettled(
        new Map<string, Outcome>([
          [VAN, "yes"],
          [UTA, "no"],
        ]),
        SETTLED_AT,
      );

      await store.upsertEvents([game(VAN_UTA, { status: "active" })]);
      await store.upsertInstruments([moneyline(VAN_UTA, "VAN")]);

      expect(await eventRow(VAN_UTA)).toMatchObject({ status: "settled", gemini_status: "active" });
      expect(await instrumentRow(VAN)).toMatchObject({ outcome: "yes", settled_at: SETTLED_AT });
    });

    it("settles the same batch once when two runs race", async () => {
      await seedSettledGames();
      const outcomes = new Map<string, Outcome>([
        [VAN, "yes"],
        [UTA, "no"],
        [TXSO, "no"],
        [UCSD, "yes"],
      ]);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => store.markSettled(outcomes, SETTLED_AT)),
      );
      expect(results.reduce((sum, value) => sum + value, 0)).toBe(4);
      expect((await eventRow(VAN_UTA)).status).toBe("settled");
      expect((await eventRow(TXSO_UCSD)).status).toBe("settled");
    });
  });

  describe("settlement sync against the recorded settled pages", () => {
    async function settleFrom(fixture: FixtureName): Promise<number> {
      return syncSettlements(
        clientOn(() => fixtureText(fixture)),
        store,
        silentLogger,
        {
          now: () => SETTLED_AT.getTime(),
        },
      );
    }

    it("settles the two stored games and ignores the events it does not store", async () => {
      await seedSettledGames();

      expect(await settleFrom("events-recently-settled")).toBe(4);
      expect(await instrumentRow(`GEMI-${VAN_UTA}-VAN`)).toMatchObject({
        outcome: "yes",
        settled_at: SETTLED_AT,
      });
      expect((await instrumentRow(`GEMI-${VAN_UTA}-UTA`)).outcome).toBe("no");
      expect((await instrumentRow(`GEMI-${TXSO_UCSD}-UCSD`)).outcome).toBe("yes");
      expect((await eventRow(VAN_UTA)).status).toBe("settled");
      expect((await eventRow(TXSO_UCSD)).status).toBe("settled");
      expect(await counts()).toEqual({ events: 2n, instruments: 4n });

      expect(await settleFrom("events-recently-settled")).toBe(0);
    });

    it("voids the instruments and the event Gemini reports invalid", async () => {
      await seedSettledGames();

      expect(await settleFrom("events-recently-settled.invalid-hand-edited")).toBe(4);
      expect((await instrumentRow(`GEMI-${TXSO_UCSD}-TXSO`)).outcome).toBe("void");
      expect((await instrumentRow(`GEMI-${TXSO_UCSD}-UCSD`)).outcome).toBe("void");
      expect((await eventRow(TXSO_UCSD)).status).toBe("void");
      expect((await eventRow(VAN_UTA)).status).toBe("settled");
    });

    it("refuses a page that contradicts a recorded outcome, and applies nothing", async () => {
      await seedSettledGames();
      await settleFrom("events-recently-settled");

      await expect(
        settleFrom("events-recently-settled.invalid-hand-edited"),
      ).rejects.toBeInstanceOf(SettlementConflictError);
      expect((await instrumentRow(`GEMI-${TXSO_UCSD}-UCSD`)).outcome).toBe("yes");
      expect((await eventRow(TXSO_UCSD)).status).toBe("settled");
    });
  });

  describe("startCatalogSync on Postgres", () => {
    it("syncs the catalogue and the settlements, then stops on abort", async () => {
      await seedSettledGames();
      const http = fakeFetch((url) => ({
        status: 200,
        body: fixtureText(
          url.includes("recently-settled") ? "events-recently-settled" : "events-active-sports",
        ),
      }));
      const client = new GeminiRestClient({
        baseUrl: "https://gemini.test",
        logger: silentLogger,
        fetch: http.fetch,
      });
      const controller = new AbortController();
      const service = startCatalogSync({
        client,
        store: new PgCatalogStore(database.db),
        logger: silentLogger,
        intervalMs: 25,
        signal: controller.signal,
      });

      const deadline = Date.now() + 10_000;
      for (;;) {
        const [row] = await database.db<{ settled: bigint }[]>`
          select count(*) as settled from events where status = 'settled'
        `;
        if (row?.settled === 2n) break;
        if (Date.now() > deadline) throw new Error("the service did not sync within 10 s");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      controller.abort();
      await service.stopped;

      // 3 recorded games + the 2 seeded ones; 73 recorded instruments + the 4 seeded ones.
      expect(await counts()).toEqual({ events: 5n, instruments: 77n });
      const requests = http.urls.length;
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(http.urls).toHaveLength(requests);
    });
  });
});
