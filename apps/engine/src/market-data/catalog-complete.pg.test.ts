import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../testing/postgres";

import { GeminiRestClient } from "./gemini-rest-client";
import { PgCatalogStore } from "./pg-catalog-store";
import { eventsResponseSchema, type RawEvent } from "./schemas";
import { loadSportsCatalog, storeCatalog } from "./sync";
import { fakeFetch, fakeTime, fixtureJson, jsonResponse, silentLogger } from "./test-support";

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

/** A Gemini whose NCAAF listing is `ncaaf` (reporting `total`), every other league empty. */
function clientWith(ncaaf: readonly RawEvent[], total = ncaaf.length): GeminiRestClient {
  const http = fakeFetch((raw) => {
    const url = new URL(raw);
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    const search = url.searchParams.get("search");
    const listing = search === "NCAAF" ? ncaaf : [];
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
    const delisted = await syncWith(clientWith(filler(1003), 1003));
    expect(delisted).toBe(0);
    expect((await seeded()).every((row) => row.active)).toBe(true);
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
