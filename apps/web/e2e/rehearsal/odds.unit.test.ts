import { describe, expect, it } from "vitest";

import { CliError, parseCli } from "./cli";
import { ODDS_INVARIANT, oddsFollowTheBook } from "./invariants";
import {
  ODDS_LAG_DEFAULTS,
  OddsRangeError,
  drivenNotMeasured,
  drivenOddsBooks,
  lagStats,
  liveNotMeasured,
  measureDriven,
  measureLive,
  oddsRecordOf,
  resolveOddsLag,
  type OddsClock,
  type OddsSource,
} from "./odds";
import { oddsMarkdown, receiptJson, receiptMarkdown } from "./receipt";
import {
  RehearsalAbortedError,
  type DrivenOddsRecord,
  type LiveOddsRecord,
  type OddsReaderRecord,
  type OddsRecord,
  type RehearsalReceipt,
} from "./types";

/** The pure parts of the ticket's odds lag (Q-03, criterion 7) and its loops against fakes. */

const NO_JITTER: OddsClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise<void>((resolveSleep) => {
      setTimeout(resolveSleep, Math.max(0, ms));
    }),
  random: () => 0,
};

function reader(
  source: string,
  lags: readonly number[],
  failed = 0,
  fromSent: readonly number[] | null = null,
): OddsReaderRecord {
  return {
    source,
    lag: lagStats(lags),
    lagFromSent: fromSent === null ? null : lagStats(fromSent),
    failed,
    readErrors: 0,
    lastError: null,
    longestReadMs: 3,
  };
}

function driven(readers: OddsReaderRecord[]): DrivenOddsRecord {
  return { measured: true, note: null, instrument: "GEMI-X", readers, samples: [] };
}

function live(lags: readonly number[]): LiveOddsRecord {
  return {
    measured: true,
    note: null,
    instrument: "GEMI-X",
    windowMs: 60_000,
    readers: [reader("live_instruments read as anon", lags)],
    lagsMs: [...lags],
  };
}

function record(parts: { driven: DrivenOddsRecord; live: LiveOddsRecord }): OddsRecord {
  return oddsRecordOf({
    options: ODDS_LAG_DEFAULTS,
    writeThrottleMs: 500,
    demoRefreshMs: 1_000,
    rowAccess: "read as the anonymous role",
    ...parts,
  });
}

const NOT_LIVE = liveNotMeasured("the run used the simulated Gemini", "GEMI-X", 60_000);
const FAST = [120, 340, 560, 610, 700, 820, 900, 950, 1_010, 1_100];

describe("statistics of the lags", () => {
  it("counts, min, median, p95 by nearest rank, max; nulls when empty", () => {
    expect(lagStats([])).toEqual({
      count: 0,
      minMs: null,
      medianMs: null,
      p95Ms: null,
      maxMs: null,
    });
    expect(lagStats([7])).toEqual({ count: 1, minMs: 7, medianMs: 7, p95Ms: 7, maxMs: 7 });
    // Ten samples: the 95th percentile by nearest rank is the 10th, the largest.
    expect(lagStats([...FAST].reverse())).toEqual({
      count: 10,
      minMs: 120,
      medianMs: 760,
      p95Ms: 1_100,
      maxMs: 1_100,
    });
    // Twenty samples: the 19th.
    const twenty = Array.from({ length: 20 }, (_, index) => (index + 1) * 10);
    expect(lagStats(twenty)).toMatchObject({ p95Ms: 190, maxMs: 200, medianMs: 105 });
  });
});

describe("the prices of the driven book", () => {
  const range = { minAskBps: 300, maxAskBps: 1_900, currentAskBps: 1_200, spreadBps: 200 };

  it("are distinct, spread over the range, under the threshold, never the one in force, each different from the one before", () => {
    const books = drivenOddsBooks(10, range);
    expect(books).toHaveLength(10);
    const asks = books.map((book) => book.askBps);
    expect(new Set(asks).size).toBe(10);
    expect(asks).not.toContain(1_200);
    expect(Math.min(...asks)).toBe(300);
    expect(Math.max(...asks)).toBe(1_900);
    for (const book of books) {
      expect(book.bidBps).toBe(book.askBps - 200);
      expect(book.midBps).toBe(book.askBps - 100);
      expect(book.askBps % 100).toBe(0);
    }
    // Low, high, low, high: every move is visible.
    expect(asks.slice(0, 4)).toEqual([300, 1_900, 500, 1_700]);
  });

  it("come back in turn when the range is narrower than the samples, never twice in a row", () => {
    const books = drivenOddsBooks(5, { ...range, maxAskBps: 1_300, minAskBps: 1_000 });
    const asks = books.map((book) => book.askBps);
    expect(asks).toHaveLength(5);
    expect(asks[0]).not.toBe(1_200);
    for (let index = 1; index < asks.length; index += 1) {
      expect(asks[index]).not.toBe(asks[index - 1]);
    }
    // One other ask only: it alternates with the one in force.
    const two = drivenOddsBooks(4, { ...range, minAskBps: 1_100, maxAskBps: 1_200 });
    expect(two.map((book) => book.askBps)).toEqual([1_100, 1_200, 1_100, 1_200]);
  });

  it("refuse a range with no ask besides the one in force", () => {
    expect(() => drivenOddsBooks(3, { ...range, minAskBps: 1_200, maxAskBps: 1_200 })).toThrow(
      OddsRangeError,
    );
    expect(() => drivenOddsBooks(3, { ...range, minAskBps: 1_400, maxAskBps: 1_300 })).toThrow(
      OddsRangeError,
    );
  });
});

describe("the driven measure, against fakes", () => {
  it("times each price on each source from the call's return, and keeps a value that never appears as a failed sample", async () => {
    let shown = 1_100;
    let setAt = 0;
    const late: OddsSource = {
      name: "row",
      read: () =>
        Promise.resolve({
          valueBps: Date.now() - setAt >= 60 ? shown : null,
          observedAtMs: null,
        }),
    };
    const never: OddsSource = {
      name: "ticket",
      read: () => Promise.resolve({ valueBps: 1_100, observedAtMs: null }),
    };
    const books = drivenOddsBooks(3, {
      minAskBps: 300,
      maxAskBps: 1_900,
      currentAskBps: 1_200,
      spreadBps: 200,
    });
    const lines: number[] = [];
    const result = await measureDriven({
      instrument: "GEMI-X",
      books,
      setBook: async (bidBps, askBps) => {
        await new Promise<void>((resolveCall) => {
          setTimeout(resolveCall, 20);
        });
        shown = Math.floor((bidBps + askBps) / 2);
        setAt = Date.now();
      },
      sources: [late, never],
      pollMs: 10,
      sampleTimeoutMs: 250,
      jitterMs: 1_000,
      clock: NO_JITTER,
      onSample: (_sample, index) => lines.push(index),
    });
    expect(lines).toEqual([0, 1, 2]);
    expect(result.measured).toBe(true);
    expect(result.samples.map((sample) => sample.midBps)).toEqual(books.map((book) => book.midBps));
    const [row, ticket] = result.readers;
    expect(row?.failed).toBe(0);
    expect(row?.lag.count).toBe(3);
    // Readable 60 ms after the call returned, seen within one poll and one read of it (with room
    // for timers that run late on a loaded machine).
    expect(row?.lag.minMs).toBeGreaterThanOrEqual(60);
    expect(row?.lag.maxMs).toBeLessThan(60 + 10 + 200);
    // From the moment the call was sent: each sample adds its call's time.
    const calls = result.samples.map((sample) => sample.callMs);
    expect(Math.min(...calls)).toBeGreaterThanOrEqual(15);
    expect(row?.lagFromSent?.minMs).toBeGreaterThanOrEqual(
      (row?.lag.minMs ?? 0) + Math.min(...calls),
    );
    for (const sample of result.samples) {
      expect(sample.lagsMs[1]).toBeNull();
    }
    // Never readable: three failed samples, none dropped, no lag.
    expect(ticket?.failed).toBe(3);
    expect(ticket?.lag.count).toBe(0);
    const verdict = oddsFollowTheBook(record({ driven: result, live: NOT_LIVE }));
    expect(verdict.passed).toBe(false);
    expect(verdict.details).toContain("ticket: 0/3 samples appeared (3 failed)");
  });

  it("counts a read that errors, reads again, and stops on the signal", async () => {
    let calls = 0;
    const flaky: OddsSource = {
      name: "row",
      read: () => {
        calls += 1;
        if (calls <= 2) return Promise.reject(new Error("connection reset"));
        return Promise.resolve({ valueBps: 250, observedAtMs: null });
      },
    };
    const result = await measureDriven({
      instrument: "GEMI-X",
      books: [{ bidBps: 200, askBps: 300, midBps: 250 }],
      setBook: () => Promise.resolve(),
      sources: [flaky],
      pollMs: 10,
      sampleTimeoutMs: 500,
      jitterMs: 0,
      clock: NO_JITTER,
    });
    expect(result.readers[0]).toMatchObject({
      failed: 0,
      readErrors: 2,
      lastError: "connection reset",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      measureDriven({
        instrument: "GEMI-X",
        books: [{ bidBps: 200, askBps: 300, midBps: 250 }],
        setBook: () => Promise.resolve(),
        sources: [flaky],
        pollMs: 10,
        sampleTimeoutMs: 500,
        jitterMs: 0,
        signal: controller.signal,
        clock: NO_JITTER,
      }),
    ).rejects.toThrow(RehearsalAbortedError);
  });
});

describe("the live measure, against a fake row", () => {
  it("records seen − observed_at each time observed_at moves, never the first read", async () => {
    let observedAtMs = Date.now() - 5_000;
    const timer = setInterval(() => {
      observedAtMs = Date.now();
    }, 60);
    try {
      const result = await measureLive({
        instrument: "GEMI-X",
        source: {
          name: "row",
          read: () => Promise.resolve({ valueBps: 4_100, observedAtMs }),
        },
        windowMs: 400,
        pollMs: 10,
        clock: NO_JITTER,
      });
      expect(result.measured).toBe(true);
      expect(result.lagsMs.length).toBeGreaterThanOrEqual(3);
      // The stale first value (5 s old) is never a sample.
      for (const lag of result.lagsMs) {
        expect(lag).toBeGreaterThanOrEqual(0);
        // At most one update period (60 ms) old, timers running late apart.
        expect(lag).toBeLessThan(200);
      }
      expect(result.readers[0]?.lag.count).toBe(result.lagsMs.length);
    } finally {
      clearInterval(timer);
    }
  });

  it("says no update observed when observed_at never moves, which is not a pass", async () => {
    const result = await measureLive({
      instrument: "GEMI-X",
      source: { name: "row", read: () => Promise.resolve({ valueBps: 4_100, observedAtMs: 1 }) },
      windowMs: 100,
      pollMs: 10,
      clock: NO_JITTER,
    });
    expect(result.measured).toBe(false);
    expect(result.note).toMatch(/^no update observed/);
    const verdict = oddsFollowTheBook(
      record({ driven: drivenNotMeasured("window only", "GEMI-X"), live: result }),
    );
    expect(verdict).toMatchObject({ passed: false, measured: false });
    expect(verdict.details).toContain("live feed: not measured (no update observed");
  });
});

describe("the twelfth invariant: the ticket's odds follow the book within 2 s", () => {
  it("passes when every sample of each measured path appeared and each p95 is under 2 000 ms; a path not measured is said so", () => {
    const result = oddsFollowTheBook(
      record({
        driven: driven([
          reader("live_instruments read as anon", FAST),
          reader("GET /api/t/:token", FAST),
        ]),
        live: NOT_LIVE,
      }),
    );
    expect(result).toMatchObject({ name: ODDS_INVARIANT, passed: true, measured: true });
    expect(result.details).toContain(
      "driven book: live_instruments read as anon: 10/10 samples appeared (0 failed), median 760 ms, p95 1100 ms, max 1100 ms",
    );
    expect(result.details).toContain("live feed: not measured (the run used the simulated Gemini)");
    // Both paths measured and under the limit.
    expect(
      oddsFollowTheBook(
        record({ driven: driven([reader("row", FAST)]), live: live([40, 90, 300]) }),
      ).passed,
    ).toBe(true);
  });

  it("fails on one failed sample, whatever the p95", () => {
    const result = oddsFollowTheBook(
      record({ driven: driven([reader("row", FAST, 1), reader("ticket", FAST)]), live: NOT_LIVE }),
    );
    expect(result).toMatchObject({ passed: false, measured: true });
    expect(result.details).toContain("row: 10/11 samples appeared (1 failed)");
  });

  it("fails on a p95 of 2 000 ms or more on any source, on either path", () => {
    const slow = [...FAST.slice(0, 9), 2_000];
    expect(
      oddsFollowTheBook(
        record({ driven: driven([reader("row", FAST), reader("ticket", slow)]), live: NOT_LIVE }),
      ).passed,
    ).toBe(false);
    expect(
      oddsFollowTheBook(
        record({ driven: driven([reader("row", [...FAST.slice(0, 9), 1_999])]), live: NOT_LIVE }),
      ).passed,
    ).toBe(true);
    // The live path measured and slow fails the run even though the driven path holds.
    expect(
      oddsFollowTheBook(record({ driven: driven([reader("row", FAST)]), live: live([100, 2_500]) }))
        .passed,
    ).toBe(false);
    // A measured path whose every sample failed has no p95: failed.
    expect(
      oddsFollowTheBook(record({ driven: driven([reader("row", [], 10)]), live: NOT_LIVE })).passed,
    ).toBe(false);
  });

  it("is NOT MEASURED, never passed, when no path was measured or the run measured nothing", () => {
    const none = oddsFollowTheBook(
      record({
        driven: drivenNotMeasured("the run stopped before the driven measure", null),
        live: NOT_LIVE,
      }),
    );
    expect(none).toMatchObject({ passed: false, measured: false });
    expect(none.details).toMatch(/^not measured\. driven book: not measured \(the run stopped/);
    expect(oddsFollowTheBook(null)).toMatchObject({ passed: false, measured: false });
  });
});

describe('the receipt\'s section "Ticket odds"', () => {
  const odds = record({
    driven: {
      ...driven([
        reader(
          "live_instruments read as anon",
          FAST,
          0,
          FAST.map((lag) => lag + 9),
        ),
        reader("GET /api/t/:token", FAST),
      ]),
      samples: [{ bidBps: 100, askBps: 300, midBps: 200, callMs: 9, lagsMs: [120, 130] }],
    },
    live: NOT_LIVE,
  });

  it("gives per path and source the samples, the failures, min, median, p95 and max, the settings, and what is left out", () => {
    const text = oddsMarkdown(odds).join("\n");
    expect(text).toContain("## Ticket odds");
    expect(text).toContain(
      "| driven | live_instruments read as anon | call returned | 10 | 0 | 120 ms | 760 ms | 1100 ms | 1100 ms |",
    );
    expect(text).toContain(
      "| driven | live_instruments read as anon | call sent | 10 | 0 | 129 ms |",
    );
    expect(text).toContain("at most once per 500 ms per instrument (`writeThrottleMs`)");
    expect(text).toContain("demo books are read every 1000 ms");
    expect(text).toContain("read every 50 ms");
    expect(text).toContain("Live feed: not measured (the run used the simulated Gemini).");
    expect(text).toContain("the push from Supabase Realtime to the phone");
    expect(text).toContain("excludes the network from Gemini");
    expect(text).toContain("polling period (50 ms) plus one read (longest read 3 ms)");
    expect(oddsMarkdown(null).join("\n")).toContain("Not measured");
  });

  it("is an optional field: a receipt without it has no section, one with it has the section and the JSON field", () => {
    const base = {
      version: 2,
      runId: "0123456789ab",
      status: "failed",
      failure: null,
      startedAt: "2026-11-18T20:30:12.345Z",
      finishedAt: "2026-11-18T20:31:12.345Z",
      chain: {
        chainId: 31_337,
        name: "local",
        local: true,
        rpcHost: "localhost",
        explorer: null,
        moneyMode: null,
        token: null,
      },
      escrow: {
        address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        deployBlock: 1n,
        runStartBlock: null,
        engineStartBlock: null,
      },
      roles: {
        relayer: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        oracle: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        treasury: null,
        merchant: null,
        buyers: [],
      },
      gemini: "simulated",
      engine: { started: true, stopped: true },
      game: null,
      instrument: null,
      campaign: null,
      scenario: null,
      driven: null,
      pauseProbe: null,
      estimate: null,
      steps: [],
      transactions: [],
      purchases: [],
      timings: {
        callToTicket: { count: 0, minMs: null, medianMs: null, maxMs: null },
        callToDashboard: { count: 0, minMs: null, medianMs: null, maxMs: null },
        refunds: null,
      },
      hedging: null,
      invariants: [{ ...oddsFollowTheBook(null) }],
      balances: { before: [], afterSettlement: [], afterSweep: [] },
      netCostWei: null,
      gasWei: 0n,
      sweep: [],
      leftBehind: [],
      unread: [],
      rpc: null,
      recovery: null,
      stranded: false,
    } as unknown as RehearsalReceipt;
    const older = receiptMarkdown(base);
    expect(older).not.toContain("## Ticket odds");
    expect(older).toContain(`- NOT MEASURED: ${ODDS_INVARIANT}.`);
    const withOdds: RehearsalReceipt = { ...base, odds };
    expect(receiptMarkdown(withOdds)).toContain("## Ticket odds");
    const json = JSON.parse(receiptJson(withOdds)) as { version: number; odds: OddsRecord };
    expect(json.version).toBe(2);
    expect(json.odds.driven.readers[0]?.lag.p95Ms).toBe(1_100);
    expect(json.odds.pollMs).toBe(50);
  });
});

describe("the odds flags", () => {
  const env = {
    ARC_RELAYER_PRIVATE_KEY: `0x${"a".repeat(64)}`,
    ARC_ORACLE_PRIVATE_KEY: `0x${"b".repeat(64)}`,
    APP_DEMO_WALLET_SEED: `0x${"c".repeat(64)}`,
    ARC_RPC_URL: "https://rpc.testnet.arc.io",
    DB_URL: "postgres://localhost/winz",
  };

  it("default to 10 prices, 10 s, a 60 s live window and 50 ms polls, and are read in seconds", () => {
    expect(resolveOddsLag(undefined)).toEqual({
      options: { samples: 10, sampleTimeoutMs: 10_000, liveWindowMs: 60_000, pollMs: 50 },
      problems: [],
    });
    expect(parseCli([], env).options.oddsLag).toBeUndefined();
    expect(
      parseCli(
        [
          "--odds-samples",
          "20",
          "--odds-timeout",
          "2.5",
          "--odds-window",
          "0",
          "--odds-poll-ms",
          "25",
        ],
        env,
      ).options.oddsLag,
    ).toEqual({ samples: 20, sampleTimeoutMs: 2_500, liveWindowMs: 0, pollMs: 25 });
  });

  it("refuse what cannot be measured, and any of them with --recover", () => {
    let problems: readonly string[] = [];
    try {
      parseCli(
        [
          "--odds-samples",
          "0",
          "--odds-timeout",
          "x",
          "--odds-window",
          "601",
          "--odds-poll-ms",
          "5",
        ],
        env,
      );
    } catch (error: unknown) {
      if (error instanceof CliError) problems = error.problems;
    }
    const text = problems.join("\n");
    expect(text).toContain("odds samples must be a whole number from 1 to 100");
    expect(text).toContain("--odds-timeout must be a number of seconds");
    expect(text).toContain("polling period must be from 10 to 1000 ms");
    expect(text).toContain("live odds window must be from 0 (skipped) to 600 s");
    expect(() => parseCli(["--odds-window=-1"], env)).toThrow(/--odds-window must be a number/);
    expect(() => parseCli(["--recover", "/tmp/receipt.json", "--odds-samples", "3"], env)).toThrow(
      /a recovery measures no odds/,
    );
    expect(resolveOddsLag({ liveWindowMs: 601_000 }).problems).toHaveLength(1);
  });
});
