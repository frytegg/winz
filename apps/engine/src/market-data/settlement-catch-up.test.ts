import pino, { type Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryCatalogStore } from "./catalog-store";
import { GeminiRestClient } from "./gemini-rest-client";
import type { NormalizedInstrument } from "./normalize";
import { rawEventSchema, type RawEvent } from "./schemas";
import { SETTLED_OVERLAP_MS, readAwaitedResults, startCatalogSync, syncSettlements } from "./sync";
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

const INTERVAL_MS = 60_000;
const START = Date.parse("2026-11-21T23:00:00.000Z");
const SETTLED_PATH = "/v1/prediction-markets/events/recently-settled";
const EVENT_PATH = "/v1/prediction-markets/events/";
const NBA_GAME = "NBA-2611190300-UTA-LAL-M";

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

/** Templates from the list recorded on 19 Nov 2026: a settled game and a settled combo. */
function templates(): { game: RawEvent; combo: RawEvent } {
  const recorded = fixtureEvents("events-recently-settled-19nov");
  const game = recorded.find((event) => event.ticker === "NHL-2611190300-COL-UTA-M");
  const combo = recorded.find((event) => event.ticker.startsWith("CMB-"));
  if (!game || !combo) throw new Error("fixture lacks a game or a combo");
  return { game, combo };
}

/** A settled game `ticker` (…-M) whose home side (`HOME`) won, resolved at `at`. */
function settledGame(ticker: string, at: number): RawEvent {
  const { game } = templates();
  return {
    ...game,
    ticker,
    resolvedAt: new Date(at).toISOString(),
    contracts: [
      { ...game.contracts[0]!, instrumentSymbol: `GEMI-${ticker}-AWAY`, resolutionSide: "no" },
      { ...game.contracts[1]!, instrumentSymbol: `GEMI-${ticker}-HOME`, resolutionSide: "yes" },
    ],
  };
}

function settledCombo(index: number, at: number): RawEvent {
  const { combo } = templates();
  const ticker = `CMB-261121-${index.toString(16).padStart(16, "0").toUpperCase()}`;
  return {
    ...combo,
    ticker,
    resolvedAt: new Date(at).toISOString(),
    contracts: combo.contracts.map((contract) => ({
      ...contract,
      instrumentSymbol: `GEMI-${ticker}-CMB`,
    })),
  };
}

function moneylines(ticker: string): NormalizedInstrument[] {
  return ["HOME", "AWAY"].map((side) => ({
    symbol: `GEMI-${ticker}-${side}`,
    eventTicker: ticker,
    type: "moneyline" as const,
    strike: null,
    label: `${side} wins`,
    side: null,
    bestBidBps: null,
    bestAskBps: null,
  }));
}

/** Gemini: an empty catalogue, a settled list (newest first) and each event's own page. */
class FakeGemini {
  /** Newest first, as Gemini sorts it. */
  settled: RawEvent[] = [];
  readonly pages = new Map<string, unknown>();
  down = false;
  readonly http: FakeFetch;
  readonly client: GeminiRestClient;

  constructor() {
    this.http = fakeFetch((raw) => this.respond(new URL(raw)));
    const time = fakeTime();
    this.client = new GeminiRestClient({
      baseUrl: "https://gemini.test",
      logger: silentLogger,
      fetch: this.http.fetch,
      now: time.now,
      sleep: time.sleep,
      maxAttempts: 1,
    });
  }

  /** Adds results, newest first among themselves, ahead of everything already listed. */
  settle(...events: RawEvent[]): void {
    this.settled = [...events, ...this.settled].sort(
      (a, b) => Date.parse(b.resolvedAt ?? "") - Date.parse(a.resolvedAt ?? ""),
    );
  }

  /** Offsets of the settled-list requests, in order. */
  settledOffsets(): number[] {
    return this.http.urls
      .map((url) => new URL(url))
      .filter((url) => url.pathname === SETTLED_PATH)
      .map((url) => Number(url.searchParams.get("offset")));
  }

  directReads(): string[] {
    return this.http.urls
      .map((url) => new URL(url).pathname)
      .filter((path) => path.startsWith(EVENT_PATH) && path !== SETTLED_PATH)
      .map((path) => decodeURIComponent(path.slice(EVENT_PATH.length)));
  }

  private respond(url: URL): FakeResponse {
    if (this.down) throw new Error("connect ECONNREFUSED");
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (url.pathname === SETTLED_PATH) {
      return jsonResponse({
        data: this.settled.slice(offset, offset + limit),
        pagination: { limit, offset, total: this.settled.length },
      });
    }
    if (url.pathname.startsWith(EVENT_PATH)) {
      const page = this.pages.get(decodeURIComponent(url.pathname.slice(EVENT_PATH.length)));
      return page === undefined
        ? { status: 404, body: '{"error":"NotFound"}' }
        : jsonResponse(page);
    }
    // The catalogue: empty listings (this file is about results).
    return jsonResponse({ data: [], pagination: { limit, offset, total: 0 } });
  }
}

/** The settled NBA game of 19 Nov 2026 as its own page serves it, its status overridable. */
function nbaPage(overrides: Partial<RawEvent> = {}): RawEvent {
  return { ...rawEventSchema.parse(fixtureJson("event-settled-nba-uta-lal")), ...overrides };
}

describe("syncSettlements: the settled list, read back to a time", () => {
  it("reads past one page to the games settled in the same minute as fifty combos", async () => {
    const gemini = new FakeGemini();
    const store = new InMemoryCatalogStore();
    const games = [
      "NCAAF-2611212030-ARK-TEX-M",
      "NCAAF-2611212030-BAY-TCU-M",
      "NCAAF-2611212030-OSU-MICH-M",
    ];
    for (const game of games) await store.upsertInstruments(moneylines(game));
    const minute = START + 60_000;
    gemini.settle(
      ...games.map((game, index) => settledGame(game, minute + index * 1_000)),
      ...Array.from({ length: 60 }, (_, index) =>
        settledCombo(index, minute + 10_000 + index * 100),
      ),
    );

    // The old read (one page of 50) does not reach them: the negative control.
    const onePage = await syncSettlements(gemini.client, store, silentLogger, { maxPages: 1 });
    expect(onePage).toMatchObject({ newlySettled: 0, complete: false, pages: 1 });

    const result = await syncSettlements(gemini.client, store, silentLogger, { sinceMs: START });
    expect(result).toMatchObject({ newlySettled: 6, complete: true, pages: 2, conflicts: 0 });
    for (const game of games) {
      expect(store.getInstrument(`GEMI-${game}-HOME`)?.outcome).toBe("yes");
      expect(store.getInstrument(`GEMI-${game}-AWAY`)?.outcome).toBe("no");
    }
  });

  it("stops at the first page that reaches back before `sinceMs`", async () => {
    const gemini = new FakeGemini();
    gemini.settle(
      ...Array.from({ length: 200 }, (_, index) => settledCombo(index, START - index * 60_000)),
    );
    const result = await syncSettlements(gemini.client, new InMemoryCatalogStore(), silentLogger, {
      sinceMs: START - 70 * 60_000,
    });
    // Page 1 reaches back 49 minutes, page 2 99 minutes: it stops there.
    expect(result).toMatchObject({ pages: 2, complete: true });
    expect(gemini.settledOffsets()).toEqual([0, 50]);
  });

  it("stops at its bound and says so: not complete, a warning", async () => {
    const gemini = new FakeGemini();
    gemini.settle(...Array.from({ length: 300 }, (_, index) => settledCombo(index, START - index)));
    const { logger, lines } = recordingLogger();
    const result = await syncSettlements(gemini.client, new InMemoryCatalogStore(), logger, {
      sinceMs: START - 10 * 60_000,
      maxPages: 3,
    });
    expect(result).toMatchObject({ pages: 3, complete: false });
    expect(lines.filter((line) => line.level === 40).map((line) => line.msg)).toEqual([
      expect.stringContaining("stopped at its bound"),
    ]);
  });

  it("records what it read before a page failed, then throws: nothing invented", async () => {
    const gemini = new FakeGemini();
    const store = new InMemoryCatalogStore();
    await store.upsertInstruments(moneylines("NHL-2611212030-AAA-BBB-M"));
    gemini.settle(
      settledGame("NHL-2611212030-AAA-BBB-M", START),
      ...Array.from({ length: 80 }, (_, index) => settledCombo(index, START - 1_000 - index)),
    );
    let calls = 0;
    const flaky = fakeFetch((raw) => {
      calls += 1;
      if (calls > 1) throw new Error("socket hang up");
      const url = new URL(raw);
      return jsonResponse({
        data: gemini.settled.slice(0, 50),
        pagination: { limit: 50, offset: Number(url.searchParams.get("offset")), total: 81 },
      });
    });
    const client = new GeminiRestClient({
      baseUrl: "https://gemini.test",
      logger: silentLogger,
      fetch: flaky.fetch,
      maxAttempts: 1,
    });
    await expect(syncSettlements(client, store, silentLogger)).rejects.toMatchObject({
      name: "GeminiNetworkError",
    });
    expect(store.getInstrument("GEMI-NHL-2611212030-AAA-BBB-M-HOME")?.outcome).toBe("yes");
  });
});

describe("readAwaitedResults: the direct read of a game a campaign waits on", () => {
  const UTA = `GEMI-${NBA_GAME}-UTA`;
  const LAL = `GEMI-${NBA_GAME}-LAL`;
  const UTA_BY_10 = "GEMI-NBA-2611190300-UTA-LAL-S-UTA9";
  const OVER_205 = "GEMI-NBA-2611190300-UTA-LAL-T-O205";

  async function waitingStore(): Promise<InMemoryCatalogStore> {
    const store = new InMemoryCatalogStore();
    await store.upsertInstruments([
      ...["UTA", "LAL"].map((team) => ({
        ...moneylines(NBA_GAME)[0]!,
        symbol: `GEMI-${NBA_GAME}-${team}`,
      })),
      { ...moneylines(NBA_GAME)[0]!, symbol: UTA_BY_10, type: "spread" as const, strike: "9.5" },
    ]);
    store.setAwaited([{ eventTicker: NBA_GAME, symbols: [UTA, UTA_BY_10] }]);
    return store;
  }

  it("records the result of a game the settled list never showed, spread included", async () => {
    const gemini = new FakeGemini();
    gemini.pages.set(NBA_GAME, nbaPage());
    const store = await waitingStore();

    const run = await readAwaitedResults(gemini.client, store, silentLogger);
    expect(run).toMatchObject({ awaited: 1, reads: 1, failed: 0, newlySettled: 3 });
    expect(store.getInstrument(UTA)?.outcome).toBe("yes");
    expect(store.getInstrument(LAL)?.outcome).toBe("no");
    expect(store.getInstrument(UTA_BY_10)?.outcome).toBe("yes");
    expect(store.getInstrument(OVER_205)).toBeUndefined();
    expect(gemini.directReads()).toEqual([NBA_GAME]);

    // Nothing waits any more: no further request.
    await readAwaitedResults(gemini.client, store, silentLogger);
    expect(gemini.directReads()).toEqual([NBA_GAME]);
  });

  it("applies a result once, whichever path brings it first", async () => {
    const gemini = new FakeGemini();
    gemini.pages.set(NBA_GAME, nbaPage());
    const store = await waitingStore();
    gemini.settle(nbaPage());

    const listed = await syncSettlements(gemini.client, store, silentLogger);
    expect(listed.newlySettled).toBe(3);
    const direct = await readAwaitedResults(gemini.client, store, silentLogger);
    expect(direct).toMatchObject({ awaited: 0, reads: 0, newlySettled: 0 });
    // And the other way round: the direct read first, the listing then brings nothing new.
    const again = await syncSettlements(gemini.client, store, silentLogger);
    expect(again.newlySettled).toBe(0);
  });

  it("asks nothing for a game still being played, and records nothing", async () => {
    const gemini = new FakeGemini();
    const live = nbaPage({ status: "active" });
    live.contracts = live.contracts.map((contract) => ({ ...contract, resolutionSide: null }));
    live.events = [];
    gemini.pages.set(NBA_GAME, live);
    const store = await waitingStore();
    const { logger, lines } = recordingLogger();

    const run = await readAwaitedResults(gemini.client, store, logger);
    expect(run).toMatchObject({ reads: 1, newlySettled: 0 });
    expect(store.getInstrument(UTA)?.outcome).toBeNull();
    expect(lines.filter((line) => line.level >= 40)).toEqual([]);
  });

  it("voids every instrument of a game Gemini reports invalid (its documented cancel)", async () => {
    const gemini = new FakeGemini();
    const page = nbaPage({ status: "invalid" });
    page.contracts = page.contracts.map((contract) => ({ ...contract, resolutionSide: null }));
    page.events = (page.events ?? []).map((child) => ({
      ...child,
      status: "invalid",
      contracts: child.contracts.map((contract) => ({ ...contract, resolutionSide: null })),
    }));
    gemini.pages.set(NBA_GAME, page);
    const store = await waitingStore();

    await readAwaitedResults(gemini.client, store, silentLogger);
    expect(store.getInstrument(UTA)?.outcome).toBe("void");
    expect(store.getInstrument(LAL)?.outcome).toBe("void");
    expect(store.getInstrument(UTA_BY_10)?.outcome).toBe("void");
  });

  it("records nothing for a status it does not know (cancelled), and warns with the symbols", async () => {
    const gemini = new FakeGemini();
    const page = nbaPage({ status: "cancelled" });
    page.contracts = page.contracts.map((contract) => ({ ...contract, resolutionSide: null }));
    page.events = [];
    gemini.pages.set(NBA_GAME, page);
    const store = await waitingStore();
    const { logger, lines } = recordingLogger();

    const run = await readAwaitedResults(gemini.client, store, logger);
    expect(run.newlySettled).toBe(0);
    expect(store.getInstrument(UTA)?.outcome).toBeNull();
    const warnings = lines.filter((line) => line.level === 40);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      event: NBA_GAME,
      status: "cancelled",
      symbols: [UTA, UTA_BY_10],
    });
  });

  it("logs a failed read and asks the next game", async () => {
    const gemini = new FakeGemini();
    gemini.pages.set(NBA_GAME, nbaPage());
    const store = await waitingStore();
    store.setAwaited([
      { eventTicker: "NBA-2611190300-GONE-M", symbols: [UTA] },
      { eventTicker: NBA_GAME, symbols: [UTA] },
    ]);
    const { logger, lines } = recordingLogger();

    const run = await readAwaitedResults(gemini.client, store, logger);
    expect(run).toMatchObject({ reads: 2, failed: 1, newlySettled: 3 });
    expect(lines.filter((line) => line.level === 40)).toEqual([
      expect.objectContaining({ event: "NBA-2611190300-GONE-M" }),
    ]);
  });

  it("asks at most `maxReads` games a run, the least recently asked first", async () => {
    const gemini = new FakeGemini();
    const store = new InMemoryCatalogStore();
    const tickers = Array.from(
      { length: 7 },
      (_, index) => `NHL-26112${index.toString()}0300-AAA-BBB-M`,
    );
    for (const ticker of tickers) await store.upsertInstruments(moneylines(ticker));
    store.setAwaited(
      tickers.map((ticker) => ({ eventTicker: ticker, symbols: [`GEMI-${ticker}-HOME`] })),
    );
    const lastReadAt = new Map<string, number>();
    let clock = START;
    const now = (): number => clock;

    await readAwaitedResults(gemini.client, store, silentLogger, { maxReads: 5, lastReadAt, now });
    clock += INTERVAL_MS;
    await readAwaitedResults(gemini.client, store, silentLogger, { maxReads: 5, lastReadAt, now });

    expect(gemini.directReads()).toEqual([
      ...tickers.slice(0, 5),
      ...tickers.slice(5),
      ...tickers.slice(0, 3),
    ]);
  });
});

describe("startCatalogSync: results are never missed", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  it("catches up after ten minutes without a leader: the next leader reads back over the gap", async () => {
    const gemini = new FakeGemini();
    const store = new InMemoryCatalogStore();
    const game = "NCAAF-2611212030-ARK-TEX-M";
    await store.upsertInstruments(moneylines(game));
    gemini.settle(
      ...Array.from({ length: 30 }, (_, index) => settledCombo(index, START - 3_600_000 - index)),
    );

    const first = new AbortController();
    const leaderA = startCatalogSync({
      client: gemini.client,
      store,
      logger: silentLogger,
      signal: first.signal,
    });
    await flush();
    first.abort();
    await leaderA.stopped;

    // Ten minutes without a leader: the game ends, then 120 combos settle after it.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    gemini.settle(settledGame(game, Date.now()));
    await vi.advanceTimersByTimeAsync(60_000);
    gemini.settle(
      ...Array.from({ length: 120 }, (_, index) => settledCombo(1_000 + index, Date.now() + index)),
    );
    await vi.advanceTimersByTimeAsync(7 * 60_000);
    expect(store.getInstrument(`GEMI-${game}-HOME`)?.outcome).toBeNull();

    const second = new AbortController();
    const leaderB = startCatalogSync({
      client: gemini.client,
      store,
      logger: silentLogger,
      signal: second.signal,
    });
    await flush();
    second.abort();
    await leaderB.stopped;

    expect(store.getInstrument(`GEMI-${game}-HOME`)?.outcome).toBe("yes");
    // The game sat at position 121 of 151: page 3 of 50.
    expect(gemini.settledOffsets().slice(-4)).toEqual([0, 50, 100, 150]);
  });

  it("keeps reading back to its last complete run while Gemini is down, then catches up", async () => {
    const gemini = new FakeGemini();
    const store = new InMemoryCatalogStore();
    const game = "NBA-2611212030-AAA-BBB-M";
    await store.upsertInstruments(moneylines(game));
    store.setAwaited([{ eventTicker: game, symbols: [`GEMI-${game}-HOME`] }]);
    const { logger, lines } = recordingLogger();
    const controller = new AbortController();
    startCatalogSync({ client: gemini.client, store, logger, signal: controller.signal });
    await flush();
    // Gemini has no page for the game yet: the direct read of the first run gets a 404.
    expect(gemini.directReads()).toEqual([game]);

    gemini.down = true;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    gemini.settle(settledGame(game, Date.now()));
    gemini.settle(
      ...Array.from({ length: 70 }, (_, index) => settledCombo(index, Date.now() + 1_000 + index)),
    );
    await vi.advanceTimersByTimeAsync(4 * INTERVAL_MS);
    expect(store.getInstrument(`GEMI-${game}-HOME`)?.outcome).toBeNull();
    const errors = lines.filter((line) => line.level === 50).map((line) => line.msg);
    expect(errors).toContain("settlement sync failed, next run retries");
    // No direct read is attempted while the settled list cannot be read: nothing invented.
    expect(gemini.directReads()).toEqual([game]);
    const before = gemini.settledOffsets().length;

    gemini.down = false;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(store.getInstrument(`GEMI-${game}-HOME`)?.outcome).toBe("yes");
    // It read back over the outage: the game sat behind 70 newer results, on page 2.
    expect(gemini.settledOffsets().slice(before)).toEqual([0, 50]);
    // Settled by the list: nothing waits any more, no direct read.
    expect(gemini.directReads()).toEqual([game]);
    controller.abort();
  });

  it("reads one page a minute once caught up, back to the last run minus the overlap", async () => {
    const gemini = new FakeGemini();
    const store = new InMemoryCatalogStore();
    gemini.settle(
      ...Array.from({ length: 120 }, (_, index) =>
        settledCombo(index, START - SETTLED_OVERLAP_MS - 60_000 - index * 60_000),
      ),
    );
    const controller = new AbortController();
    startCatalogSync({
      client: gemini.client,
      store,
      logger: silentLogger,
      signal: controller.signal,
    });
    await flush();
    // First run of a service: the whole list.
    expect(gemini.settledOffsets()).toEqual([0, 50, 100]);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    // Its first page already reaches back before the last run's start minus the overlap.
    expect(gemini.settledOffsets()).toEqual([0, 50, 100, 0]);
    controller.abort();
  });

  it("asks a waiting game directly every run until its result is in", async () => {
    const gemini = new FakeGemini();
    const store = new InMemoryCatalogStore();
    const UTA = `GEMI-${NBA_GAME}-UTA`;
    await store.upsertInstruments([{ ...moneylines(NBA_GAME)[0]!, symbol: UTA }]);
    store.setAwaited([{ eventTicker: NBA_GAME, symbols: [UTA] }]);
    const live = nbaPage({ status: "active", events: [] });
    live.contracts = live.contracts.map((contract) => ({ ...contract, resolutionSide: null }));
    gemini.pages.set(NBA_GAME, live);
    const controller = new AbortController();
    startCatalogSync({
      client: gemini.client,
      store,
      logger: silentLogger,
      signal: controller.signal,
    });
    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(gemini.directReads()).toEqual([NBA_GAME, NBA_GAME]);

    gemini.pages.set(NBA_GAME, nbaPage());
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(store.getInstrument(UTA)?.outcome).toBe("yes");
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(gemini.directReads()).toHaveLength(3);
    controller.abort();
  });
});
