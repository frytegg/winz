import type { Outcome } from "@winz/shared";
import pino, { type Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogCache } from "./catalog-cache";
import { CATALOG_LEAGUES } from "./catalog-leagues";
import { InMemoryCatalogStore, type AwaitedEvent, type CatalogStore } from "./catalog-store";
import { GeminiRestClient } from "./gemini-rest-client";
import type { NormalizedEvent, NormalizedInstrument } from "./normalize";
import { loadSportsCatalog, startCatalogSync } from "./sync";
import { fakeFetch, fakeTime, fixtureText, silentLogger, type FakeFetch } from "./test-support";

const INTERVAL_MS = 60_000;

/** Requests of one catalogue load: one page per league (the fixture is short), one per sport. */
const CATALOGUE_REQUESTS =
  CATALOG_LEAGUES.length + new Set(CATALOG_LEAGUES.map((league) => league.sport)).size;

function geminiOn(respond: (url: string) => string = defaultBody): {
  client: GeminiRestClient;
  http: FakeFetch;
} {
  const http = fakeFetch((url) => ({ status: 200, body: respond(url) }));
  // The client's own clock and sleeps are fake and instant: only the service uses the timers.
  const time = fakeTime();
  const client = new GeminiRestClient({
    baseUrl: "https://gemini.test",
    logger: silentLogger,
    fetch: http.fetch,
    now: time.now,
    sleep: time.sleep,
    maxAttempts: 1,
  });
  return { client, http };
}

function defaultBody(url: string): string {
  return fixtureText(
    url.includes("recently-settled") ? "events-recently-settled" : "events-active-sports",
  );
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** An in-memory store that counts its calls and can hold or fail `upsertEvents`. */
class ScriptedStore implements CatalogStore {
  readonly inner = new InMemoryCatalogStore();
  upsertEventsCalls = 0;
  markSettledCalls = 0;
  inFlight = 0;
  maxInFlight = 0;
  /** When set, `upsertEvents` waits for it. */
  gate: Deferred | null = null;
  /** `upsertEvents` rejects while this is positive. */
  failures = 0;

  async upsertEvents(events: readonly NormalizedEvent[]): Promise<void> {
    this.upsertEventsCalls += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate.promise;
      if (this.failures > 0) {
        this.failures -= 1;
        throw new Error("database is down");
      }
      await this.inner.upsertEvents(events);
    } finally {
      this.inFlight -= 1;
    }
  }

  upsertInstruments(instruments: readonly NormalizedInstrument[]): Promise<void> {
    return this.inner.upsertInstruments(instruments);
  }

  markDelisted(listedSymbols: readonly string[], leagues: readonly string[]): Promise<number> {
    return this.inner.markDelisted(listedSymbols, leagues);
  }

  listAwaitedEvents(now: Date): Promise<AwaitedEvent[]> {
    return this.inner.listAwaitedEvents(now);
  }

  markSettled(outcomes: ReadonlyMap<string, Outcome>, settledAt: Date): Promise<number> {
    this.markSettledCalls += 1;
    return this.inner.markSettled(outcomes, settledAt);
  }
}

interface LogLine {
  level: number;
  msg: string;
  err?: { message: string };
}

function recordingLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: "debug" },
    { write: (line: string) => lines.push(JSON.parse(line) as LogLine) },
  );
  return { logger, lines };
}

/** Lets every pending promise settle without moving the clock. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("startCatalogSync", () => {
  let controller: AbortController;

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
  });
  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("runs at once, then once per interval: catalogue first, settlements after", async () => {
    const { client, http } = geminiOn();
    const store = new ScriptedStore();
    startCatalogSync({ client, store, logger: silentLogger, signal: controller.signal });

    await flush();
    expect(store.upsertEventsCalls).toBe(1);
    expect(store.markSettledCalls).toBe(1);
    expect(store.inner.listEvents()).toHaveLength(3);
    expect(store.inner.listInstruments()).toHaveLength(73);
    expect(http.urls.map((url) => new URL(url).pathname)).toEqual([
      ...Array.from({ length: CATALOGUE_REQUESTS }, () => "/v1/prediction-markets/events"),
      "/v1/prediction-markets/events/recently-settled",
    ]);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(store.upsertEventsCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.upsertEventsCalls).toBe(2);
    expect(store.markSettledCalls).toBe(2);

    await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);
    expect(store.upsertEventsCalls).toBe(5);
    expect(store.markSettledCalls).toBe(5);
  });

  it("honours a custom interval", async () => {
    const { client } = geminiOn();
    const store = new ScriptedStore();
    startCatalogSync({
      client,
      store,
      logger: silentLogger,
      intervalMs: 5_000,
      signal: controller.signal,
    });

    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.upsertEventsCalls).toBe(3);
  });

  it("never overlaps two runs: a slow run delays the next one instead", async () => {
    const { client } = geminiOn();
    const store = new ScriptedStore();
    store.gate = deferred();
    const { logger, lines } = recordingLogger();
    startCatalogSync({ client, store, logger, signal: controller.signal });

    // The first run is stuck in the database for five intervals.
    await vi.advanceTimersByTimeAsync(5 * INTERVAL_MS);
    expect(store.upsertEventsCalls).toBe(1);
    expect(store.inFlight).toBe(1);

    // It ends: the next run is overdue and starts at once, alone.
    const first = store.gate;
    store.gate = null;
    first.resolve();
    await flush();
    expect(store.upsertEventsCalls).toBe(2);
    expect(store.maxInFlight).toBe(1);
    expect(lines.map((line) => line.msg)).toContain(
      "catalogue sync run took longer than its interval",
    );

    // Back on schedule afterwards.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(store.upsertEventsCalls).toBe(3);
    expect(store.maxInFlight).toBe(1);
  });

  it("starts the next run one interval after the start of the previous one, not after its end", async () => {
    const { client } = geminiOn();
    const store = new ScriptedStore();
    store.gate = deferred();
    startCatalogSync({ client, store, logger: silentLogger, signal: controller.signal });

    await vi.advanceTimersByTimeAsync(20_000);
    const first = store.gate;
    store.gate = null;
    first.resolve();
    await flush();
    expect(store.upsertEventsCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(39_999);
    expect(store.upsertEventsCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.upsertEventsCalls).toBe(2);
  });

  it("logs a failed catalogue step, still runs the settlement step, and recovers at the next run", async () => {
    const { client } = geminiOn();
    const store = new ScriptedStore();
    store.failures = 1;
    const { logger, lines } = recordingLogger();
    startCatalogSync({ client, store, logger, signal: controller.signal });

    await flush();
    const errors = lines.filter((line) => line.level === 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      msg: "catalogue sync failed, next run retries",
      err: { message: "database is down" },
    });
    expect(store.markSettledCalls).toBe(1);
    expect(store.inner.listEvents()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(store.upsertEventsCalls).toBe(2);
    expect(store.inner.listEvents()).toHaveLength(3);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
  });

  it("survives Gemini being down for both steps, run after run", async () => {
    let down = true;
    const { client } = geminiOn((url) => {
      if (down) throw new Error("connect ECONNREFUSED");
      return defaultBody(url);
    });
    const store = new ScriptedStore();
    const { logger, lines } = recordingLogger();
    startCatalogSync({ client, store, logger, signal: controller.signal });

    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(lines.filter((line) => line.level === 50).map((line) => line.msg)).toEqual([
      "catalogue sync failed, next run retries",
      "settlement sync failed, next run retries",
      "catalogue sync failed, next run retries",
      "settlement sync failed, next run retries",
    ]);
    expect(store.upsertEventsCalls).toBe(0);

    down = false;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(store.inner.listEvents()).toHaveLength(3);
    expect(store.markSettledCalls).toBe(1);
  });

  it("stops on abort: no further run, `stopped` resolves", async () => {
    const { client, http } = geminiOn();
    const store = new ScriptedStore();
    const service = startCatalogSync({
      client,
      store,
      logger: silentLogger,
      signal: controller.signal,
    });
    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(store.upsertEventsCalls).toBe(2);

    controller.abort();
    await service.stopped;
    const requests = http.urls.length;
    await vi.advanceTimersByTimeAsync(10 * INTERVAL_MS);
    expect(store.upsertEventsCalls).toBe(2);
    expect(http.urls).toHaveLength(requests);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets the run in flight finish after an abort, skips its settlement step, then stops", async () => {
    const { client } = geminiOn();
    const store = new ScriptedStore();
    store.gate = deferred();
    const service = startCatalogSync({
      client,
      store,
      logger: silentLogger,
      signal: controller.signal,
    });
    let stopped = false;
    void service.stopped.then(() => {
      stopped = true;
    });

    await flush();
    controller.abort();
    await flush();
    expect(stopped).toBe(false);

    store.gate.resolve();
    await service.stopped;
    expect(store.inner.listEvents()).toHaveLength(3);
    expect(store.markSettledCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * INTERVAL_MS);
    expect(store.upsertEventsCalls).toBe(1);
  });

  it("does nothing with a signal that is already aborted", async () => {
    const { client, http } = geminiOn();
    const store = new ScriptedStore();
    controller.abort();
    const service = startCatalogSync({
      client,
      store,
      logger: silentLogger,
      signal: controller.signal,
    });

    await service.stopped;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(http.urls).toHaveLength(0);
    expect(store.upsertEventsCalls).toBe(0);
  });

  it("reads the catalogue through the shared cache when one is given", async () => {
    const { client, http } = geminiOn();
    const store = new ScriptedStore();
    const cache = new CatalogCache({ load: () => loadSportsCatalog(client, silentLogger) });
    // Another reader of the cache, just before the service starts.
    await cache.get();
    startCatalogSync({ client, store, logger: silentLogger, signal: controller.signal, cache });

    await flush();
    expect(store.inner.listEvents()).toHaveLength(3);
    const catalogueRequests = http.urls.filter((url) => !url.includes("recently-settled"));
    expect(catalogueRequests).toHaveLength(CATALOGUE_REQUESTS);
  });

  it("rejects an interval that is not a positive number", () => {
    const { client } = geminiOn();
    const store = new ScriptedStore();
    for (const intervalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        startCatalogSync({
          client,
          store,
          logger: silentLogger,
          intervalMs,
          signal: controller.signal,
        }),
      ).toThrow(RangeError);
    }
  });
});
