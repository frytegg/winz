import { describe, expect, it } from "vitest";

import { CatalogCache } from "./catalog-cache";
import { CATALOG_LEAGUES } from "./catalog-leagues";
import { InMemoryCatalogStore, mapEventStatus } from "./catalog-store";
import { SettlementConflictError } from "./errors";
import { GeminiRestClient } from "./gemini-rest-client";
import { normalizeCatalog, type NormalizedCatalog } from "./normalize";
import { parseSettlements } from "./settlement";
import { loadSportsCatalog, syncCatalog, syncSettlements } from "./sync";
import {
  fakeFetch,
  fakeTime,
  fixtureEvents,
  fixtureText,
  silentLogger,
  type FakeFetch,
} from "./test-support";

const SETTLED_AT = new Date("2026-11-17T05:23:00.000Z");

function emptyCatalog(): NormalizedCatalog {
  return { events: [], instruments: [], skipped: [] };
}

describe("CatalogCache", () => {
  it("serves the same catalogue for 60 seconds, then reloads", async () => {
    const time = fakeTime(0);
    let loads = 0;
    const cache = new CatalogCache({
      load: () => {
        loads += 1;
        return Promise.resolve(emptyCatalog());
      },
      now: time.now,
    });

    const first = await cache.get();
    time.advance(59_999);
    expect(await cache.get()).toBe(first);
    expect(loads).toBe(1);

    time.advance(1);
    expect(await cache.get()).not.toBe(first);
    expect(loads).toBe(2);
  });

  it("shares one load between concurrent callers", async () => {
    let loads = 0;
    let release: (catalog: NormalizedCatalog) => void = () => undefined;
    const cache = new CatalogCache({
      load: () => {
        loads += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      now: () => 0,
    });

    const pending = [cache.get(), cache.get(), cache.get()];
    release(emptyCatalog());
    const results = await Promise.all(pending);

    expect(loads).toBe(1);
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });

  it("does not cache a failed load", async () => {
    let loads = 0;
    const cache = new CatalogCache({
      load: () => {
        loads += 1;
        return loads === 1
          ? Promise.reject(new Error("gemini is down"))
          : Promise.resolve(emptyCatalog());
      },
      now: () => 0,
    });

    await expect(cache.get()).rejects.toThrow("gemini is down");
    await expect(cache.get()).resolves.toEqual(emptyCatalog());
    expect(loads).toBe(2);
  });

  it("reloads after invalidate()", async () => {
    let loads = 0;
    const cache = new CatalogCache({
      load: () => {
        loads += 1;
        return Promise.resolve(emptyCatalog());
      },
      now: () => 0,
    });
    await cache.get();
    cache.invalidate();
    await cache.get();
    expect(loads).toBe(2);
  });
});

describe("InMemoryCatalogStore", () => {
  const catalog = normalizeCatalog(fixtureEvents("events-active-sports"));

  it("upserts events and instruments by key", async () => {
    const store = new InMemoryCatalogStore();
    await store.upsertEvents(catalog.events);
    await store.upsertInstruments(catalog.instruments);
    await store.upsertEvents(catalog.events);
    await store.upsertInstruments(catalog.instruments);

    expect(store.listEvents()).toHaveLength(3);
    expect(store.listInstruments()).toHaveLength(catalog.instruments.length);
    expect(store.listInstruments("NHL-2611180000-EDM-FLA-M")).toHaveLength(2 + 4 + 9);
    expect(store.getEvent("NCAAF-2611212030-ARK-TEX-M")?.title).toBe("Arkansas vs Texas");
    expect(store.getInstrument("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX")).toMatchObject({
      label: "Texas wins",
      outcome: null,
      settledAt: null,
    });
  });

  it("marks known instruments settled once, ignores unknown symbols", async () => {
    const store = new InMemoryCatalogStore();
    await store.upsertInstruments(catalog.instruments);
    const outcomes = new Map([
      ["GEMI-NCAAF-2611212030-ARK-TEX-M-TEX", "yes"],
      ["GEMI-NCAAF-2611212030-ARK-TEX-M-ARK", "no"],
      ["GEMI-NOT-IN-THE-CATALOGUE", "void"],
    ] as const);

    expect(await store.markSettled(outcomes, SETTLED_AT)).toBe(2);
    expect(await store.markSettled(outcomes, new Date("2026-11-18T00:00:00.000Z"))).toBe(0);
    expect(store.getInstrument("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX")).toMatchObject({
      outcome: "yes",
      settledAt: SETTLED_AT,
      active: false,
    });
    expect(store.getInstrument("GEMI-NOT-IN-THE-CATALOGUE")).toBeUndefined();
  });

  it("marks what a later catalogue no longer lists inactive, and active again when it is back", async () => {
    const store = new InMemoryCatalogStore();
    await store.upsertInstruments(catalog.instruments);
    const listed = catalog.instruments
      .map((instrument) => instrument.symbol)
      .filter((symbol) => symbol !== "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX");

    expect(await store.markDelisted(listed, ["NCAAF"])).toBe(1);
    expect(await store.markDelisted(listed, ["NCAAF"])).toBe(0);
    expect(store.listInstruments()).toHaveLength(catalog.instruments.length);
    expect(store.getInstrument("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX")?.active).toBe(false);
    expect(store.getInstrument("GEMI-NCAAF-2611212030-ARK-TEX-M-ARK")?.active).toBe(true);

    await store.upsertInstruments(catalog.instruments);
    expect(store.getInstrument("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX")?.active).toBe(true);
  });

  it("maps Gemini's event status to the stored one", () => {
    expect(
      ["approved", "active", "closed", "settled", "invalid", "something_new"].map(mapEventStatus),
    ).toEqual(["upcoming", "active", "closed", "settled", "void", "closed"]);
  });

  it("keeps the outcome when the instrument is upserted again", async () => {
    const store = new InMemoryCatalogStore();
    await store.upsertInstruments(catalog.instruments);
    await store.markSettled(new Map([["GEMI-NCAAF-2611212030-ARK-TEX-M-TEX", "yes"]]), SETTLED_AT);
    await store.upsertInstruments(catalog.instruments);
    expect(store.getInstrument("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX")?.outcome).toBe("yes");
  });

  it("refuses to overwrite an outcome with a different one, and applies nothing", async () => {
    const store = new InMemoryCatalogStore();
    await store.upsertInstruments(catalog.instruments);
    await store.markSettled(new Map([["GEMI-NCAAF-2611212030-ARK-TEX-M-TEX", "yes"]]), SETTLED_AT);

    const conflicting = new Map([
      ["GEMI-NCAAF-2611212030-ARK-TEX-M-ARK", "yes"],
      ["GEMI-NCAAF-2611212030-ARK-TEX-M-TEX", "no"],
    ] as const);
    await expect(store.markSettled(conflicting, SETTLED_AT)).rejects.toBeInstanceOf(
      SettlementConflictError,
    );
    expect(store.getInstrument("GEMI-NCAAF-2611212030-ARK-TEX-M-ARK")?.outcome).toBeNull();
    expect(store.getInstrument("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX")?.outcome).toBe("yes");
  });
});

describe("sync", () => {
  function clientOn(respond: (url: string) => string): {
    client: GeminiRestClient;
    http: FakeFetch;
  } {
    const http = fakeFetch((url) => ({ status: 200, body: respond(url) }));
    const time = fakeTime();
    const client = new GeminiRestClient({
      baseUrl: "https://gemini.test",
      logger: silentLogger,
      fetch: http.fetch,
      now: time.now,
      sleep: time.sleep,
    });
    return { client, http };
  }

  it("loads the sports catalogue once per TTL and writes it to the store", async () => {
    const { client, http } = clientOn(() => fixtureText("events-active-sports"));
    const time = fakeTime(0);
    const cache = new CatalogCache({
      load: () => loadSportsCatalog(client, silentLogger),
      now: time.now,
    });
    const store = new InMemoryCatalogStore();

    // One page per league (the fixture is short) and one coverage request per sport.
    const perLoad =
      CATALOG_LEAGUES.length + new Set(CATALOG_LEAGUES.map((league) => league.sport)).size;
    expect(await syncCatalog(cache, store)).toEqual({ events: 3, instruments: 73, delisted: 0 });
    expect(await syncCatalog(cache, store)).toEqual({ events: 3, instruments: 73, delisted: 0 });
    expect(http.urls).toHaveLength(perLoad);

    time.advance(60_000);
    await syncCatalog(cache, store);
    expect(http.urls).toHaveLength(2 * perLoad);
    expect(store.listEvents()).toHaveLength(3);
    expect(store.listInstruments()).toHaveLength(73);
  });

  it("records the outcomes of the recently settled sports events", async () => {
    const { client, http } = clientOn(() => fixtureText("events-recently-settled"));
    const store = new InMemoryCatalogStore();
    // The store only settles instruments it knows: seed the two sides of the settled NHL game.
    await store.upsertInstruments(
      ["VAN", "UTA"].map((team) => ({
        symbol: `GEMI-NHL-2611170230-VAN-UTA-M-${team}`,
        eventTicker: "NHL-2611170230-VAN-UTA-M",
        type: "moneyline" as const,
        strike: null,
        label: `${team} wins`,
        side: null,
        bestBidBps: null,
        bestAskBps: null,
      })),
    );

    const settled = await syncSettlements(client, store, silentLogger, {
      now: () => SETTLED_AT.getTime(),
    });

    expect(settled.newlySettled).toBe(2);
    expect(settled).toMatchObject({ pages: 1, complete: true, conflicts: 0, events: 4 });
    expect(http.urls).toEqual([
      "https://gemini.test/v1/prediction-markets/events/recently-settled?limit=50&offset=0&category=Sports",
    ]);
    expect(store.getInstrument("GEMI-NHL-2611170230-VAN-UTA-M-VAN")).toMatchObject({
      outcome: "yes",
      settledAt: SETTLED_AT,
    });
    expect(store.getInstrument("GEMI-NHL-2611170230-VAN-UTA-M-UTA")?.outcome).toBe("no");
    expect(parseSettlements(fixtureEvents("events-recently-settled")).size).toBe(6);
  });
});
