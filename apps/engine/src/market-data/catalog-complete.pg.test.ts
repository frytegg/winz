import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../testing/postgres";

import { GeminiRestClient } from "./gemini-rest-client";
import { PgCatalogStore } from "./pg-catalog-store";
import { normalizeCatalog } from "./normalize";
import { eventsResponseSchema, type RawEvent } from "./schemas";
import { loadSportsCatalog, storeCatalog } from "./sync";
import {
  fakeFetch,
  fakeTime,
  fixtureEvents,
  fixtureJson,
  jsonResponse,
  silentLogger,
} from "./test-support";

const SEED_SQL = fileURLToPath(new URL("../../../../supabase/seed.sql", import.meta.url));
const ARK_TEX = "NCAAF-2611212030-ARK-TEX-M";
/** The four instruments of the seed's demo game (supabase/seed.sql). */
const SEEDED = [
  "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13",
  "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
  "GEMI-NCAAF-2611212030-ARK-TEX-M-ARK",
  "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX20",
];
const MERCHANT = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-21T23:30:00.000Z");

function events(fixture: "events-active-ncaaf-ark-tex" | "events-active-sports-cap"): RawEvent[] {
  return eventsResponseSchema.parse(fixtureJson(fixture)).data;
}

function filler(count: number): RawEvent[] {
  const [template] = events("events-active-sports-cap");
  if (!template) throw new Error("cap fixture is empty");
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    ticker: `NCAAF-2611220000-F${index.toString().padStart(4, "0")}-X-PP`,
    events: null,
  }));
}

/** The NHL game of the 17 Nov recording (Edmonton at Florida), with its markets. */
function nhlGame(): RawEvent[] {
  return fixtureEvents("events-active-sports").filter((event) => event.ticker.startsWith("NHL-"));
}

/**
 * A Gemini whose NCAAF listing is `ncaaf` (reporting `total`), whose other leagues are
 * `others[league]`, empty when absent.
 */
function clientWith(
  ncaaf: readonly RawEvent[],
  total = ncaaf.length,
  others: Record<string, readonly RawEvent[]> = {},
): GeminiRestClient {
  const http = fakeFetch((raw) => {
    const url = new URL(raw);
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    const search = url.searchParams.get("search");
    const listing = search === "NCAAF" ? ncaaf : (others[search ?? ""] ?? []);
    return jsonResponse({
      data: listing.slice(offset, offset + limit),
      pagination: { limit, offset, total: search === "NCAAF" ? total : listing.length },
    });
  });
  const time = fakeTime();
  return new GeminiRestClient({
    baseUrl: "https://gemini.test",
    logger: silentLogger,
    fetch: http.fetch,
    now: time.now,
    sleep: time.sleep,
    maxAttempts: 1,
  });
}

describe("the seed's demo game against the first catalogue sync (Postgres)", () => {
  let database: TestDatabase;
  let store: PgCatalogStore;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });
  beforeEach(async () => {
    await database.db`truncate table events, users cascade`;
    await database.db.unsafe(readFileSync(SEED_SQL, "utf8"));
    store = new PgCatalogStore(database.db);
  });

  async function seeded(): Promise<
    { symbol: string; active: boolean; best_ask_bps: number | null }[]
  > {
    return database.db<{ symbol: string; active: boolean; best_ask_bps: number | null }[]>`
      select symbol, active, best_ask_bps from instruments
      where symbol in ${database.db(SEEDED)} order by symbol
    `;
  }

  async function syncWith(client: GeminiRestClient): Promise<number> {
    const catalog = await loadSportsCatalog(client, silentLogger);
    return (await storeCatalog(catalog, store)).delisted;
  }

  it("keeps the four seeded instruments active and quotes the moneylines once NCAAF is read whole", async () => {
    expect((await seeded()).every((row) => row.active)).toBe(true);
    await syncWith(clientWith([...filler(150), ...events("events-active-ncaaf-ark-tex")]));

    const rows = await seeded();
    expect(rows.map((row) => row.symbol).sort()).toEqual([...SEEDED].sort());
    expect(rows.every((row) => row.active)).toBe(true);
    const asks = new Map(rows.map((row) => [row.symbol, row.best_ask_bps]));
    expect(asks.get("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX")).toBe(9200);
    expect(asks.get("GEMI-NCAAF-2611212030-ARK-TEX-M-ARK")).toBe(900);
  });

  it("keeps them active when the NCAAF listing is cut at the cap without the game (what deactivated them before)", async () => {
    // A stale NHL instrument, which the complete NHL read below no longer lists.
    const [nhl] = normalizeCatalog(nhlGame()).events;
    if (!nhl) throw new Error("the NHL fixture has no game");
    const stale = normalizeCatalog(nhlGame()).instruments.filter(
      (instrument) => instrument.eventTicker === nhl.ticker,
    )[0];
    if (!stale) throw new Error("the NHL fixture has no instrument");
    await store.upsertEvents([nhl]);
    await store.upsertInstruments([{ ...stale, symbol: `${stale.symbol}-GONE` }]);

    // NCAAF cut at the cap (none of its games deactivated), NHL read whole with real instruments:
    // the catalogue is not empty, so `markDelisted` runs, for every league but NCAAF.
    const catalog = await loadSportsCatalog(
      clientWith(filler(1003), 1003, { NHL: nhlGame() }),
      silentLogger,
    );
    expect(catalog.completeLeagues).not.toContain("NCAAF");
    expect(catalog.completeLeagues).toContain("NHL");
    expect(catalog.instruments.length).toBeGreaterThan(0);
    const delisted = (await storeCatalog(catalog, store)).delisted;

    // It ran: the stale NHL instrument is deactivated, and only it.
    expect(delisted).toBe(1);
    const [gone] = await database.db<{ active: boolean }[]>`
      select active from instruments where symbol = ${`${stale.symbol}-GONE`}
    `;
    expect(gone?.active).toBe(false);
    const rows = await seeded();
    expect(rows).toHaveLength(SEEDED.length);
    expect(rows.every((row) => row.active)).toBe(true);
  });

  it("deactivates them when a complete NCAAF read no longer lists the game (positive control)", async () => {
    // Another NCAAF game keeps the catalogue from being empty.
    const other = events("events-active-ncaaf-ark-tex").map((event) => ({
      ...event,
      ticker: event.ticker.replace("ARK-TEX", "BAY-TCU"),
      gameId: "other-game",
      events: null,
      contracts: event.contracts.map((contract) => ({
        ...contract,
        instrumentSymbol: contract.instrumentSymbol.replace("ARK-TEX", "BAY-TCU"),
      })),
    }));
    const delisted = await syncWith(clientWith([...filler(20), ...other]));
    expect(delisted).toBe(SEEDED.length);
    expect((await seeded()).every((row) => !row.active)).toBe(true);
  });
});

describe("PgCatalogStore.markDelisted only touches the leagues it is given", () => {
  let database: TestDatabase;
  let store: PgCatalogStore;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });
  beforeEach(async () => {
    await database.db`truncate table events, users cascade`;
    await database.db.unsafe(readFileSync(SEED_SQL, "utf8"));
    store = new PgCatalogStore(database.db);
    // An NHL game beside the seed's NCAAF one.
    const catalog = normalizeCatalog(nhlGame());
    await store.upsertEvents(catalog.events);
    await store.upsertInstruments(catalog.instruments);
  });

  async function activeByLeague(): Promise<Record<string, { active: number; inactive: number }>> {
    const rows = await database.db<{ league: string; active: boolean; n: number }[]>`
      select e.league, i.active, count(*)::int as n
      from instruments i join events e on e.ticker = i.event_ticker
      group by e.league, i.active
    `;
    const result: Record<string, { active: number; inactive: number }> = {};
    for (const row of rows) {
      const entry = (result[row.league] ??= { active: 0, inactive: 0 });
      if (row.active) entry.active += row.n;
      else entry.inactive += row.n;
    }
    return result;
  }

  it("a complete league other than the seeded one: the seeded rows are untouched", async () => {
    const nhl = (await activeByLeague()).NHL?.active ?? 0;
    expect(nhl).toBeGreaterThan(0);
    expect(await store.markDelisted([], ["NHL"])).toBe(nhl);
    expect(await activeByLeague()).toEqual({
      NCAAF: { active: SEEDED.length, inactive: 0 },
      NHL: { active: 0, inactive: nhl },
    });
  });

  it("the seeded league: the seeded rows are deactivated, the other league's kept", async () => {
    const nhl = (await activeByLeague()).NHL?.active ?? 0;
    expect(await store.markDelisted([], ["NCAAF"])).toBe(SEEDED.length);
    expect(await activeByLeague()).toEqual({
      NCAAF: { active: 0, inactive: SEEDED.length },
      NHL: { active: nhl, inactive: 0 },
    });
  });

  it("the seeded league, one of its rows listed: only the others are deactivated", async () => {
    const listed = "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX";
    expect(await store.markDelisted([listed], ["NCAAF"])).toBe(SEEDED.length - 1);
    const [kept] = await database.db<{ active: boolean }[]>`
      select active from instruments where symbol = ${listed}
    `;
    expect(kept?.active).toBe(true);
  });
});

describe("PgCatalogStore.listAwaitedEvents", () => {
  let database: TestDatabase;
  let store: PgCatalogStore;
  let campaignCount = 0;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });
  beforeEach(async () => {
    await database.db`truncate table events, users cascade`;
    await database.db.unsafe(readFileSync(SEED_SQL, "utf8"));
    store = new PgCatalogStore(database.db);
  });

  async function campaign(
    instrument: string,
    fields: { status?: string; onchain?: boolean; salesClose?: string } = {},
  ): Promise<void> {
    campaignCount += 1;
    await database.db`
      insert into campaigns (
        onchain_id, merchant_id, instrument, event_ticker, product, condition_label, promise,
        unit_price, refund_bps, usual_margin_bps, min_margin_bps, pause_threshold_bps, budget,
        sales_close, status
      ) values (
        ${fields.onchain === false ? null : campaignCount}, ${MERCHANT}, ${instrument}, ${ARK_TEX},
        'Large pizza', 'cond', 'promise', 20000000, 10000, 6500, 4700, 1800, 500000000,
        ${fields.salesClose ?? "2026-11-21T20:25:00Z"}, ${fields.status ?? "live"}
      )
    `;
  }

  it("lists the game of an on-chain campaign past its sales close whose instrument has no outcome", async () => {
    await campaign("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX");
    await campaign("GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13", { status: "sales_closed" });
    await campaign("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX", { status: "paused" });

    expect(await store.listAwaitedEvents(NOW)).toEqual([
      {
        eventTicker: ARK_TEX,
        symbols: ["GEMI-NCAAF-2611212030-ARK-TEX-M-TEX", "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13"],
      },
    ]);
  });

  it("leaves out campaigns before their sales close, off-chain, settled, with a result or a forced one", async () => {
    await campaign("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX", { salesClose: "2026-11-22T00:00:00Z" });
    await campaign("GEMI-NCAAF-2611212030-ARK-TEX-M-ARK", { onchain: false });
    await campaign("GEMI-NCAAF-2611212030-ARK-TEX-S-TEX20", { status: "settled_no" });
    await campaign("GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13");
    expect(await store.listAwaitedEvents(NOW)).toHaveLength(1);

    await database.db`
      insert into demo_overrides (instrument, forced_result)
      values ('GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', 'yes')
    `;
    expect(await store.listAwaitedEvents(NOW)).toEqual([]);

    await database.db`delete from demo_overrides`;
    await store.markSettled(new Map([["GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13", "no"]]), NOW);
    expect(await store.listAwaitedEvents(NOW)).toEqual([]);
  });
});
