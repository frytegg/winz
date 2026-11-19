import pino, { type Logger } from "pino";
import { describe, expect, it } from "vitest";

import { CATALOG_LEAGUES, type CatalogLeague } from "./catalog-leagues";
import { InMemoryCatalogStore } from "./catalog-store";
import { GeminiRestClient, LISTING_CAP } from "./gemini-rest-client";
import { eventsResponseSchema, type RawEvent } from "./schemas";
import { loadSportsCatalog, startCatalogSync, storeCatalog } from "./sync";
import {
  fakeFetch,
  fakeTime,
  fixtureEvents,
  fixtureJson,
  jsonResponse,
  silentLogger,
  type FakeFetch,
  type FakeResponse,
} from "./test-support";

const ARK_TEX = "NCAAF-2611212030-ARK-TEX-M";
const TEX_WINS = "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX";
const ARK_WINS = "GEMI-NCAAF-2611212030-ARK-TEX-M-ARK";
const TEX_BY_14 = "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13";
const TEX_BY_21 = "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX20";
const EVENTS_PATH = "/v1/prediction-markets/events";

interface LogLine {
  level: number;
  msg: string;
  [key: string]: unknown;
}

function recordingLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: "debug" },
    { write: (line: string) => lines.push(JSON.parse(line) as LogLine) },
  );
  return { logger, lines };
}

function clientOn(
  respond: (url: URL, call: number) => FakeResponse,
  maxAttempts = 1,
): { client: GeminiRestClient; http: FakeFetch } {
  const http = fakeFetch((url, call) => respond(new URL(url), call));
  const time = fakeTime();
  const client = new GeminiRestClient({
    baseUrl: "https://gemini.test",
    logger: silentLogger,
    fetch: http.fetch,
    now: time.now,
    sleep: time.sleep,
    maxAttempts,
  });
  return { client, http };
}

function eventsOf(fixture: "events-active-ncaaf-ark-tex" | "events-active-sports-cap"): RawEvent[] {
  return eventsResponseSchema.parse(fixtureJson(fixture)).data;
}

/** Saturday's game, as Gemini listed it on 19 Nov 2026: the game, its spread and its total. */
function arkTex(): RawEvent[] {
  return eventsOf("events-active-ncaaf-ark-tex");
}

/** The NHL game of the 17 Nov recording (Edmonton at Florida), with its markets. */
function nhlGame(): RawEvent[] {
  return fixtureEvents("events-active-sports").filter((event) => event.ticker.startsWith("NHL-"));
}

/** `count` filler events of a league: games without a moneyline, which normalize to nothing. */
function filler(league: string, count: number): RawEvent[] {
  const [template] = eventsOf("events-active-sports-cap");
  if (!template) throw new Error("cap fixture is empty");
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    ticker: `${league}-2611220000-F${index.toString().padStart(4, "0")}-X-PP`,
    events: null,
  }));
}

/** One page of `events`, as Gemini slices a listing, with `total` overridable. */
function page(events: readonly RawEvent[], url: URL, total = events.length): FakeResponse {
  const limit = Number(url.searchParams.get("limit"));
  const offset = Number(url.searchParams.get("offset"));
  return jsonResponse({
    data: events.slice(offset, offset + limit),
    pagination: { limit, offset, total },
  });
}

/**
 * A Gemini whose listing of each league is `byLeague[league]` (empty when absent); a sport's own
 * listing reports the sum of its leagues, plus `extraBySport`.
 */
function gemini(
  byLeague: Record<string, readonly RawEvent[]>,
  options: {
    totalOf?: Record<string, number>;
    fail?: (url: URL) => FakeResponse | null;
    extraBySport?: Record<string, number>;
  } = {},
): (url: URL) => FakeResponse {
  return (url) => {
    const failure = options.fail?.(url) ?? null;
    if (failure) return failure;
    if (url.pathname !== EVENTS_PATH) throw new Error(`unexpected path ${url.pathname}`);
    const league = url.searchParams.get("search");
    const sport = url.searchParams.get("sport");
    if (league === null) {
      const total =
        CATALOG_LEAGUES.filter((entry) => entry.sport === sport).reduce(
          (sum, entry) => sum + (byLeague[entry.league]?.length ?? 0),
          0,
        ) + (options.extraBySport?.[sport ?? ""] ?? 0);
      return page([], url, total);
    }
    const events = byLeague[league] ?? [];
    return page(events, url, options.totalOf?.[league] ?? events.length);
  };
}

describe("GeminiRestClient.readActiveListing", () => {
  it("reads a listing with overlapping pages, each event once, and calls it complete", async () => {
    const events = filler("NCAAF", 250);
    const { client, http } = clientOn((url) => page(events, url));
    const listing = await client.readActiveListing({
      category: "Sports",
      sport: "american_football",
      search: "NCAAF",
    });

    expect(listing).toMatchObject({
      total: 250,
      requests: 3,
      complete: true,
      incompleteReason: null,
    });
    expect(listing.events.map((event) => event.ticker)).toEqual(
      events.map((event) => event.ticker),
    );
    expect(http.urls.map((url) => new URL(url).searchParams.get("offset"))).toEqual([
      "0",
      "90",
      "180",
    ]);
    expect(new URL(http.urls[0] ?? "").searchParams.toString()).toBe(
      "limit=100&offset=0&status=active&category=Sports&sport=american_football&search=NCAAF",
    );
  });

  it("is not complete when the listing reports the cap: the real 1003 of 19 Nov 2026", async () => {
    const [capPage] = [
      fixtureJson("events-active-sports-cap") as { pagination: { total: number } },
    ];
    expect(capPage.pagination.total).toBe(1003);
    const events = filler("NCAAF", 1003);
    const { client } = clientOn((url) => page(events, url));
    const listing = await client.readActiveListing({ search: "NCAAF" });

    expect(listing.complete).toBe(false);
    expect(listing.total).toBe(1003);
    expect(listing.incompleteReason).toContain("cap");
    // Still read to the end of what Gemini serves: every game it serves is kept.
    expect(listing.events).toHaveLength(1003);
    expect(listing.requests).toBe(12);
  });

  it("positive control: one event under the cap is complete", async () => {
    const events = filler("NCAAF", LISTING_CAP - 1);
    const { client } = clientOn((url) => page(events, url, LISTING_CAP - 1));
    const listing = await client.readActiveListing({ search: "NCAAF", pageSize: 500 });
    expect(listing.complete).toBe(true);
    expect(listing.events).toHaveLength(LISTING_CAP - 1);
  });

  it("detects events that slid between two pages by more than the overlap", async () => {
    const events = filler("NCAAF", 250);
    let shifted = events;
    const { client } = clientOn((url, call) => {
      // Between the first and the second request, the first 20 events end and leave the listing.
      if (call === 1) shifted = events.slice(20);
      return page(shifted, url);
    });
    const listing = await client.readActiveListing({ search: "NCAAF" });
    expect(listing.complete).toBe(false);
    expect(listing.incompleteReason).toContain("does not overlap");
  });

  it("absorbs a slide smaller than the overlap: still complete, nothing missed", async () => {
    const events = filler("NCAAF", 250);
    let shifted = events;
    const { client } = clientOn((url, call) => {
      if (call === 1) shifted = events.slice(3);
      return page(shifted, url);
    });
    const listing = await client.readActiveListing({ search: "NCAAF" });
    expect(listing.complete).toBe(true);
    const read = new Set(listing.events.map((event) => event.ticker));
    expect(events.slice(3).every((event) => read.has(event.ticker))).toBe(true);
  });

  it("is not complete on an empty page before the total, nor at maxPages", async () => {
    const events = filler("NCAAF", 250);
    const short = clientOn((url) =>
      Number(url.searchParams.get("offset")) > 0 ? page([], url, 250) : page(events, url),
    );
    const cut = await short.client.readActiveListing({ search: "NCAAF" });
    expect(cut).toMatchObject({ complete: false, total: 250 });
    expect(cut.incompleteReason).toContain("empty page");

    const long = clientOn((url) => page(events, url));
    const bounded = await long.client.readActiveListing({ search: "NCAAF", maxPages: 2 });
    expect(bounded.complete).toBe(false);
    expect(bounded.incompleteReason).toContain("2 pages");
  });

  it("throws when a page fails, after the client's retries", async () => {
    const events = filler("NCAAF", 250);
    const { client } = clientOn((url) =>
      Number(url.searchParams.get("offset")) > 0
        ? { status: 503, body: "down" }
        : page(events, url),
    );
    await expect(client.readActiveListing({ search: "NCAAF" })).rejects.toMatchObject({
      name: "GeminiHttpError",
      status: 503,
    });
  });
});

describe("loadSportsCatalog, one listing per league", () => {
  it("lists every league with its sport and a reason, each league once", () => {
    const leagues = CATALOG_LEAGUES.map((entry) => entry.league);
    expect(new Set(leagues).size).toBe(leagues.length);
    expect(leagues).toContain("NCAAF");
    for (const entry of CATALOG_LEAGUES) {
      expect(entry.sport).toMatch(/^[a-z_]+$/);
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it("finds Saturday's game with a two-sided book in the NCAAF listing, which a cut Sports listing missed", async () => {
    const { client, http } = clientOn(gemini({ NCAAF: [...filler("NCAAF", 120), ...arkTex()] }));
    const catalog = await loadSportsCatalog(client, silentLogger);

    const game = catalog.events.find((event) => event.ticker === ARK_TEX);
    expect(game).toMatchObject({
      title: "Arkansas vs Texas",
      league: "NCAAF",
      startsAt: new Date("2026-11-21T20:30:00.000Z"),
    });
    const bySymbol = new Map(catalog.instruments.map((item) => [item.symbol, item]));
    expect(bySymbol.get(TEX_WINS)).toMatchObject({ bestBidBps: 9100n, bestAskBps: 9200n });
    expect(bySymbol.get(ARK_WINS)).toMatchObject({ bestBidBps: 800n, bestAskBps: 900n });
    expect(bySymbol.get(TEX_BY_14)?.label).toBe("Texas wins by 14+");
    expect(bySymbol.get(TEX_BY_21)?.label).toBe("Texas wins by 21+");
    expect(catalog.completeLeagues).toEqual(CATALOG_LEAGUES.map((entry) => entry.league));

    const sports = new Set(CATALOG_LEAGUES.map((entry) => entry.sport)).size;
    // NCAAF: 123 events → 2 pages of 100 with an overlap of 10; every other league one page.
    expect(catalog.requests).toBe(CATALOG_LEAGUES.length + 1 + sports);
    expect(http.urls).toHaveLength(catalog.requests);
    const searched = http.urls.map((url) => new URL(url).searchParams.get("search"));
    for (const entry of CATALOG_LEAGUES) expect(searched).toContain(entry.league);
  });

  it("logs a league at the cap as an ERROR naming it, and leaves it out of the complete leagues", async () => {
    const { logger, lines } = recordingLogger();
    const { client } = clientOn(
      gemini({ NCAAF: filler("NCAAF", 1003), NHL: nhlGame() }, { totalOf: { NCAAF: 1003 } }),
    );
    const catalog = await loadSportsCatalog(client, logger);

    expect(catalog.completeLeagues).not.toContain("NCAAF");
    expect(catalog.completeLeagues).toContain("NHL");
    expect(catalog.leagues.find((read) => read.league === "NCAAF")).toMatchObject({
      complete: false,
      total: 1003,
    });
    const errors = lines.filter((line) => line.level === 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ league: "NCAAF", total: 1003, cap: LISTING_CAP });
    expect(errors[0]?.msg).toContain("at the cap");
  });

  it("positive control: no error line when every league is under the cap", async () => {
    const { logger, lines } = recordingLogger();
    const { client } = clientOn(gemini({ NCAAF: filler("NCAAF", 999) }));
    const catalog = await loadSportsCatalog(client, logger);
    expect(catalog.completeLeagues).toContain("NCAAF");
    expect(lines.filter((line) => line.level >= 40)).toEqual([]);
  });

  it("keeps a league whose page fails mid-way out of the complete leagues, logs it, and keeps what was read", async () => {
    const { logger, lines } = recordingLogger();
    const { client } = clientOn(
      gemini(
        { NCAAF: [...arkTex(), ...filler("NCAAF", 200)], NHL: nhlGame() },
        {
          fail: (url) =>
            url.searchParams.get("search") === "NCAAF" && url.searchParams.get("offset") !== "0"
              ? { status: 500, body: "internal error" }
              : null,
        },
      ),
    );
    const catalog = await loadSportsCatalog(client, logger);

    expect(catalog.completeLeagues).not.toContain("NCAAF");
    expect(catalog.completeLeagues).toContain("NHL");
    const errors = lines.filter((line) => line.level === 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ league: "NCAAF" });
    expect(errors[0]?.msg).toContain("failed");
  });

  it("throws when not one league could be read (Gemini down), so the run is logged as failed", async () => {
    const { client } = clientOn(() => {
      throw new Error("connect ECONNREFUSED");
    });
    await expect(loadSportsCatalog(client, silentLogger)).rejects.toMatchObject({
      name: "GeminiNetworkError",
    });
  });

  it("warns when a sport lists events outside the catalogue's leagues", async () => {
    const { logger, lines } = recordingLogger();
    const { client } = clientOn(
      gemini({ NBA: filler("NBA", 4) }, { extraBySport: { basketball: 7 } }),
    );
    await loadSportsCatalog(client, logger);
    const warnings = lines.filter((line) => line.level === 40);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      sport: "basketball",
      sportTotal: 11,
      leaguesTotal: 4,
      outside: 7,
    });
  });

  it("reads only the leagues it is given", async () => {
    const leagues: CatalogLeague[] = [
      { league: "NCAAF", sport: "american_football", reason: "test" },
    ];
    const { client, http } = clientOn(gemini({ NCAAF: arkTex() }));
    const catalog = await loadSportsCatalog(client, silentLogger, { leagues });
    expect(catalog.completeLeagues).toEqual(["NCAAF"]);
    // One page, one coverage request.
    expect(http.urls).toHaveLength(2);
  });
});

describe("startCatalogSync stops between two requests", () => {
  it("ends a catalogue load part-way on abort, writes nothing, and asks nothing more", async () => {
    const controller = new AbortController();
    const respond = gemini({ NCAAF: [...arkTex(), ...filler("NCAAF", 400)] });
    const { client, http } = clientOn((url, call) => {
      // The stop arrives while the third request is in flight.
      if (call === 2) controller.abort();
      return respond(url);
    });
    const store = new InMemoryCatalogStore();
    const { logger, lines } = recordingLogger();
    const service = startCatalogSync({ client, store, logger, signal: controller.signal });
    await service.stopped;

    expect(http.urls).toHaveLength(3);
    expect(store.listEvents()).toEqual([]);
    expect(lines.map((line) => line.msg)).toContain(
      "catalogue sync stopped part-way by the stop: nothing written",
    );
    expect(lines.filter((line) => line.level >= 50)).toEqual([]);
  });
});

describe("storeCatalog: a game is deactivated only by a complete read of its own league", () => {
  async function seeded(): Promise<InMemoryCatalogStore> {
    const store = new InMemoryCatalogStore();
    const { client } = clientOn(gemini({ NCAAF: arkTex() }));
    await storeCatalog(await loadSportsCatalog(client, silentLogger), store);
    expect(store.getInstrument(TEX_WINS)?.active).toBe(true);
    return store;
  }

  it("deactivates the game once a complete NCAAF read no longer lists it", async () => {
    const store = await seeded();
    const { client } = clientOn(gemini({ NCAAF: filler("NCAAF", 30), NHL: nhlGame() }));
    const result = await storeCatalog(await loadSportsCatalog(client, silentLogger), store);
    // Every instrument of the game: its moneylines, spreads and totals.
    expect(result.delisted).toBe(store.listInstruments(ARK_TEX).length);
    expect(store.getInstrument(TEX_WINS)?.active).toBe(false);
    expect(store.getInstrument(TEX_BY_14)?.active).toBe(false);
  });

  it("keeps it when the NCAAF listing is at the cap without it", async () => {
    const store = await seeded();
    const { client } = clientOn(
      gemini({ NCAAF: filler("NCAAF", 1003), NHL: nhlGame() }, { totalOf: { NCAAF: 1003 } }),
    );
    const result = await storeCatalog(await loadSportsCatalog(client, silentLogger), store);
    expect(result.delisted).toBe(0);
    expect(store.getInstrument(TEX_WINS)?.active).toBe(true);
  });

  it("keeps it when the NCAAF listing failed part-way", async () => {
    const store = await seeded();
    const { client } = clientOn(
      gemini(
        { NCAAF: filler("NCAAF", 300), NHL: nhlGame() },
        {
          fail: (url) =>
            url.searchParams.get("search") === "NCAAF" && url.searchParams.get("offset") === "180"
              ? { status: 502, body: "bad gateway" }
              : null,
        },
      ),
    );
    const result = await storeCatalog(await loadSportsCatalog(client, silentLogger), store);
    expect(result.delisted).toBe(0);
    expect(store.getInstrument(TEX_WINS)?.active).toBe(true);
  });

  it("keeps it when only another league was read completely", async () => {
    const store = await seeded();
    const leagues: CatalogLeague[] = [{ league: "NHL", sport: "hockey", reason: "test" }];
    const { client } = clientOn(gemini({ NHL: nhlGame() }));
    const catalog = await loadSportsCatalog(client, silentLogger, { leagues });
    expect(catalog.completeLeagues).toEqual(["NHL"]);
    expect(catalog.instruments.length).toBeGreaterThan(0);
    await storeCatalog(catalog, store);
    expect(store.getInstrument(TEX_WINS)?.active).toBe(true);
  });
});
