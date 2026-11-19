import pino, { type Logger } from "pino";
import { describe, expect, it } from "vitest";

import { CATALOG_LEAGUES, type CatalogLeague } from "./catalog-leagues";
import { InMemoryCatalogStore } from "./catalog-store";
import { SyncAbortedError } from "./errors";
import { GeminiRestClient, LISTING_CAP, type FetchLike } from "./gemini-rest-client";
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

  describe("an empty page proves the end only as the first page", () => {
    it("the verifier's probe: 20 of the first 90 of 105 end before the second request, total 85: not complete", async () => {
      const events = filler("NCAAF", 105);
      let listed = events;
      const { client, http } = clientOn((url, call) => {
        // Between the two requests, 20 of the 90 events read before the next offset end.
        if (call === 1) listed = [...events.slice(0, 30), ...events.slice(50)];
        return page(listed, url);
      });
      const listing = await client.readActiveListing({ search: "NCAAF" });

      expect(http.urls.map((url) => new URL(url).searchParams.get("offset"))).toEqual(["0", "90"]);
      expect(listing.total).toBe(85);
      expect(listing.complete).toBe(false);
      expect(listing.incompleteReason).toContain("empty page at offset 90");
      // What made `complete: true` wrong: the last five slid into positions already read.
      const read = new Set(listing.events.map((event) => event.ticker));
      expect(events.slice(100).filter((event) => !read.has(event.ticker))).toHaveLength(5);
    });

    it("a listing that shrinks by less than the overlap is still complete, nothing missed", async () => {
      const events = filler("NCAAF", 105);
      let listed = events;
      const { client } = clientOn((url, call) => {
        if (call === 1) listed = [...events.slice(0, 40), ...events.slice(45)];
        return page(listed, url);
      });
      const listing = await client.readActiveListing({ search: "NCAAF" });

      expect(listing).toMatchObject({ complete: true, total: 100, requests: 2 });
      const read = new Set(listing.events.map((event) => event.ticker));
      expect(listed.every((event) => read.has(event.ticker))).toBe(true);
    });

    it("a listing that ends on a page boundary is complete, without an empty request", async () => {
      for (const [count, offsets] of [
        [100, ["0"]],
        [190, ["0", "90"]],
        [280, ["0", "90", "180"]],
      ] as const) {
        const events = filler("NCAAF", count);
        const { client, http } = clientOn((url) => page(events, url));
        const listing = await client.readActiveListing({ search: "NCAAF" });
        expect(listing).toMatchObject({ complete: true, total: count, incompleteReason: null });
        expect(listing.events).toHaveLength(count);
        expect(http.urls.map((url) => new URL(url).searchParams.get("offset"))).toEqual(offsets);
      }
    });

    it("an empty league is complete in one request", async () => {
      const { client } = clientOn((url) => page([], url));
      expect(await client.readActiveListing({ search: "MLB" })).toEqual({
        events: [],
        total: 0,
        requests: 1,
        complete: true,
        incompleteReason: null,
      });
    });
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

  it("keeps a league whose page fails mid-way out of the complete leagues, logs it, and leaves its stored games as they are: neither updated nor deactivated", async () => {
    const store = new InMemoryCatalogStore();
    const first = clientOn(gemini({ NCAAF: arkTex(), NHL: nhlGame() }));
    await storeCatalog(await loadSportsCatalog(first.client, silentLogger), store);
    const before = store.listInstruments(ARK_TEX);
    expect(before.length).toBeGreaterThan(0);
    expect(store.getInstrument(TEX_WINS)).toMatchObject({ active: true, bestBidBps: 9100n });

    // The first page, which succeeds, lists the game renamed and requoted; the second fails.
    const changed = arkTex().map((event) => ({
      ...event,
      title: event.ticker === ARK_TEX ? "Arkansas vs Texas, requoted" : event.title,
      contracts: event.contracts.map((contract) => ({
        ...contract,
        prices: contract.prices ? { ...contract.prices, bestBid: "0.5" } : contract.prices,
      })),
    }));
    const { logger, lines } = recordingLogger();
    const { client } = clientOn(
      gemini(
        { NCAAF: [...changed, ...filler("NCAAF", 200)], NHL: nhlGame() },
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
    // Nothing of the failed league is in the catalogue, not even its first page.
    expect(catalog.events.filter((event) => event.league === "NCAAF")).toEqual([]);
    expect(catalog.instruments.filter((item) => item.eventTicker === ARK_TEX)).toEqual([]);
    const errors = lines.filter((line) => line.level === 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ league: "NCAAF" });
    expect(errors[0]?.msg).toContain("failed");

    const result = await storeCatalog(catalog, store);
    expect(result.delisted).toBe(0);
    expect(store.getEvent(ARK_TEX)?.title).toBe("Arkansas vs Texas");
    expect(store.listInstruments(ARK_TEX)).toEqual(before);
    expect(store.getInstrument(TEX_WINS)).toMatchObject({ active: true, bestBidBps: 9100n });
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

describe("a stop during a download", () => {
  /**
   * A Gemini whose NCAAF page at offset 90 sends its headers, then never finishes its body until
   * the request's signal aborts, as a 7 MB page on a slow link. `onDownload` runs when it starts.
   */
  function slowDownload(onDownload: () => void): { fetch: FetchLike; urls: string[] } {
    const respond = gemini({ NCAAF: [...arkTex(), ...filler("NCAAF", 400)] });
    const urls: string[] = [];
    const fetch: FetchLike = (raw, init) => {
      urls.push(raw);
      const url = new URL(raw);
      if (url.searchParams.get("search") !== "NCAAF" || url.searchParams.get("offset") !== "90") {
        const answer = respond(url);
        return Promise.resolve({
          status: answer.status,
          headers: { get: () => null },
          text: () => Promise.resolve(answer.body),
        });
      }
      onDownload();
      return Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () =>
          new Promise<string>((_resolve, reject) => {
            const abort = (): void => {
              reject(
                init.signal.reason instanceof Error ? init.signal.reason : new Error("aborted"),
              );
            };
            if (init.signal.aborted) abort();
            else init.signal.addEventListener("abort", abort, { once: true });
          }),
      });
    };
    return { fetch, urls };
  }

  it("ends the run at once: the download is aborted, not retried, and no ERROR or WARN line", async () => {
    const controller = new AbortController();
    const http = slowDownload(() => {
      setTimeout(() => {
        controller.abort();
      }, 20);
    });
    const { logger, lines } = recordingLogger();
    // The client's defaults: four attempts, the listing timeout (30 s), the real limiter.
    const client = new GeminiRestClient({
      baseUrl: "https://gemini.test",
      logger,
      fetch: http.fetch,
    });
    const store = new InMemoryCatalogStore();
    const startedAt = performance.now();
    const service = startCatalogSync({ client, store, logger, signal: controller.signal });
    await service.stopped;
    const elapsedMs = performance.now() - startedAt;

    // Bound: the stop comes 20 ms into the download; the run is over well within a second,
    // where waiting for the request would have taken its 30 s timeout.
    expect(elapsedMs).toBeLessThan(1_000);
    expect(http.urls.map((url) => new URL(url).searchParams.get("offset"))).toEqual(["0", "90"]);
    expect(store.listEvents()).toEqual([]);
    expect(lines.filter((line) => line.level >= 40)).toEqual([]);
    expect(lines.map((line) => line.msg)).toContain(
      "catalogue sync stopped part-way by the stop: nothing written",
    );
  });

  it("ends the run quietly when the stop comes during the per-sport coverage check", async () => {
    const controller = new AbortController();
    const respond = gemini({ NCAAF: arkTex() });
    const urls: string[] = [];
    const fetch: FetchLike = (raw, init) => {
      urls.push(raw);
      const url = new URL(raw);
      const answer = respond(url);
      // Every league is read; the sport's own one-event listing is held until the stop.
      const coverage = url.searchParams.get("search") === null;
      if (coverage) {
        setTimeout(() => {
          controller.abort();
        }, 20);
      }
      return Promise.resolve({
        status: answer.status,
        headers: { get: () => null },
        text: () =>
          coverage
            ? new Promise<string>((_resolve, reject) => {
                init.signal.addEventListener(
                  "abort",
                  () => {
                    reject(
                      init.signal.reason instanceof Error
                        ? init.signal.reason
                        : new Error("aborted"),
                    );
                  },
                  { once: true },
                );
              })
            : Promise.resolve(answer.body),
      });
    };
    const { logger, lines } = recordingLogger();
    const client = new GeminiRestClient({ baseUrl: "https://gemini.test", logger, fetch });
    const store = new InMemoryCatalogStore();
    const startedAt = performance.now();
    const service = startCatalogSync({ client, store, logger, signal: controller.signal });
    await service.stopped;

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    // Every league was read, then one coverage request, aborted: nothing after it.
    const coverageRequests = urls.filter((url) => new URL(url).searchParams.get("search") === null);
    expect(coverageRequests).toHaveLength(1);
    expect(urls.at(-1)).toBe(coverageRequests[0]);
    // Not a failure: no WARN or ERROR line. And a stopped run writes nothing.
    expect(lines.filter((line) => line.level >= 40)).toEqual([]);
    expect(lines.map((line) => line.msg)).toContain(
      "catalogue sync stopped part-way by the stop: nothing written",
    );
    expect(store.listEvents()).toEqual([]);
  });

  it("readActiveListing throws SyncAbortedError, after one request for the page", async () => {
    const controller = new AbortController();
    const http = slowDownload(() => {
      queueMicrotask(() => {
        controller.abort();
      });
    });
    const { logger, lines } = recordingLogger();
    const client = new GeminiRestClient({
      baseUrl: "https://gemini.test",
      logger,
      fetch: http.fetch,
    });
    await expect(
      client.readActiveListing({ search: "NCAAF", signal: controller.signal }),
    ).rejects.toBeInstanceOf(SyncAbortedError);
    expect(http.urls).toHaveLength(2);
    expect(lines).toEqual([]);
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
