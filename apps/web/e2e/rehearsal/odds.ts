import type { Db } from "../../../engine/src/db";
import {
  RehearsalAbortedError,
  type DrivenOddsRecord,
  type DrivenOddsSample,
  type LagStats,
  type LiveOddsRecord,
  type OddsLagOptions,
  type OddsReaderRecord,
  type OddsRecord,
} from "./types";

/**
 * The lag of the odds a ticket shows behind the book they come from (SPEC 17, criterion 7, second
 * half: "le ticket vivant suit la cote avec moins de 2 secondes de décalage"; Q-03).
 *
 * Where the ticket reads its odds. There is no ticket page in apps/web yet; what it is built to
 * read is fixed by the data: `GET /api/t/:token` answers `probabilityBps`, the `mid_bps` of the
 * instrument's `live_instruments` row (lib/server/tickets.ts, `liveProbabilityBps` in wire.ts),
 * for the first render, and the same answer carries `instrumentSymbol`, by which the page follows
 * that row through Supabase Realtime (SPEC 7: the browser reads only the public live_* tables in
 * Realtime; the init migration grants `select` on them to `anon` under a `using (true)` policy).
 * Both are measured: the row read as the anonymous role, and the route.
 *
 * Two paths:
 * - driven (demo mode): the runner sets the book to N prices through the admin route, and after
 *   each one reads both sources every `pollMs` until the new mid is readable. Judged from the
 *   moment that call returned (the book exists at its source only once the route has committed
 *   it); the lag from the moment it was sent is reported too.
 * - live (live Gemini only): the campaign's own row is watched for a window before the book is
 *   driven; each time its observed_at changes, seen − observed_at is a sample.
 *
 * Pure parts (statistics, prices, defaults) and the measuring loops, which take their sources and
 * their clock as arguments so that they run against fakes in the unit tests.
 */

export const ODDS_LAG_DEFAULTS: OddsLagOptions = {
  samples: 10,
  sampleTimeoutMs: 10_000,
  liveWindowMs: 60_000,
  pollMs: 50,
};

/** The criterion: the ticket's odds follow the book within this (p95, every sample appearing). */
export const ODDS_LAG_LIMIT_MS = 2_000;

export const MAX_ODDS_SAMPLES = 100;
export const MAX_ODDS_WINDOW_MS = 600_000;
export const MAX_ODDS_TIMEOUT_MS = 120_000;
export const MIN_ODDS_POLL_MS = 10;
export const MAX_ODDS_POLL_MS = 1_000;

/** The sentence of the receipt on what the numbers leave out. */
export const ODDS_EXCLUDES =
  "Not included: the push from Supabase Realtime to the phone and the page's own render, which only a deployed project can measure; the route is called in process (no HTTP, no CDN).";

/** What live_instruments.observed_at is (the engine stamps a book when it receives it). */
export const ODDS_OBSERVED_AT =
  "observed_at is the engine's reception time of the Gemini message (the WebSocket frame, or the REST answer), not Gemini's own timestamp: the live lag excludes the network from Gemini and Gemini's own delay.";

export const ODDS_JUDGED_FROM =
  "The driven path is judged from the moment the runner's call that set the book returned: the book exists at its source only once the admin route has committed it, and a user watching a market sees it move from then; the lag from the moment the call was sent, which adds the route's own time, is reported beside it.";

/** Defaults filled in and every field checked, as `resolveScenario` does for the scenario. */
export function resolveOddsLag(input: Partial<OddsLagOptions> | undefined): {
  options: OddsLagOptions;
  problems: string[];
} {
  const options: OddsLagOptions = { ...ODDS_LAG_DEFAULTS, ...input };
  const problems: string[] = [];
  const whole = (value: number): boolean => Number.isInteger(value);
  if (!whole(options.samples) || options.samples < 1 || options.samples > MAX_ODDS_SAMPLES) {
    problems.push(
      `the odds samples must be a whole number from 1 to ${MAX_ODDS_SAMPLES.toString()}`,
    );
  }
  if (
    !whole(options.sampleTimeoutMs) ||
    options.sampleTimeoutMs < 1 ||
    options.sampleTimeoutMs > MAX_ODDS_TIMEOUT_MS
  ) {
    problems.push(
      `the odds sample timeout must be from 1 ms to ${(MAX_ODDS_TIMEOUT_MS / 1_000).toString()} s`,
    );
  }
  if (
    !whole(options.liveWindowMs) ||
    options.liveWindowMs < 0 ||
    options.liveWindowMs > MAX_ODDS_WINDOW_MS
  ) {
    problems.push(
      `the live odds window must be from 0 (skipped) to ${(MAX_ODDS_WINDOW_MS / 1_000).toString()} s`,
    );
  }
  if (
    !whole(options.pollMs) ||
    options.pollMs < MIN_ODDS_POLL_MS ||
    options.pollMs > MAX_ODDS_POLL_MS
  ) {
    problems.push(
      `the odds polling period must be from ${MIN_ODDS_POLL_MS.toString()} to ${MAX_ODDS_POLL_MS.toString()} ms`,
    );
  }
  return { options, problems };
}

/** Count, min, median (mean of the two middle values, rounded), p95 (nearest rank) and max. */
export function lagStats(values: readonly number[]): LagStats {
  if (values.length === 0) {
    return { count: 0, minMs: null, medianMs: null, p95Ms: null, maxMs: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
  const rank = Math.max(1, Math.ceil(0.95 * sorted.length));
  return {
    count: sorted.length,
    minMs: sorted[0] ?? null,
    medianMs: median,
    p95Ms: sorted[rank - 1] ?? null,
    maxMs: sorted[sorted.length - 1] ?? null,
  };
}

/** The range the driven book may move in while sales stay open, in asks (bps, multiples of 100). */
export interface DrivenRange {
  /** Lowest ask allowed (its bid, ask − spread, at least one tick). */
  minAskBps: number;
  /** Highest ask allowed: under the pause threshold. */
  maxAskBps: number;
  /** The ask of the book in force before the measure: the first price differs from it. */
  currentAskBps: number;
  spreadBps: number;
}

/** No price fits the range. */
export class OddsRangeError extends Error {
  constructor(range: DrivenRange) {
    super(
      `no room to move the driven book: asks from ${range.minAskBps.toString()} to ${range.maxAskBps.toString()} bps, ${range.currentAskBps.toString()} in force`,
    );
    this.name = "OddsRangeError";
  }
}

/**
 * `count` books inside `range`, one tick apart at least, none equal to the one before it (nor the
 * first to the book in force): distinct as long as the range holds `count` asks besides the one in
 * force, spread over it and taken low, high, low, high so that each move is visible. With fewer,
 * the same asks come back in that order (and the one in force when it is the only other ask).
 */
export function drivenOddsBooks(
  count: number,
  range: DrivenRange,
): { bidBps: number; askBps: number; midBps: number }[] {
  const low = Math.ceil(range.minAskBps / 100) * 100;
  const high = Math.floor(range.maxAskBps / 100) * 100;
  const all: number[] = [];
  for (let ask = low; ask <= high; ask += 100) all.push(ask);
  const others = all.filter((ask) => ask !== range.currentAskBps);
  if (others.length === 0 || count < 1) throw new OddsRangeError(range);
  // Evenly spread picks when there are more asks than samples.
  let picks: number[];
  if (others.length > count) {
    picks = Array.from({ length: count }, (_, index) => {
      const at = count === 1 ? 0 : Math.round((index * (others.length - 1)) / (count - 1));
      return others[at] ?? others[0] ?? low;
    });
  } else {
    picks = others;
  }
  // The only other ask alternates with the one in force.
  if (picks.length === 1 && count > 1 && all.includes(range.currentAskBps)) {
    picks = [...picks, range.currentAskBps];
  }
  const zigzag: number[] = [];
  for (let left = 0, right = picks.length - 1; left <= right; left += 1, right -= 1) {
    zigzag.push(picks[left] ?? low);
    if (right !== left) zigzag.push(picks[right] ?? low);
  }
  const asks: number[] = [];
  let previous = range.currentAskBps;
  for (let index = 0; asks.length < count; index += 1) {
    const ask = zigzag[index % zigzag.length] ?? low;
    if (ask === previous) {
      if (zigzag.length === 1) break;
      continue;
    }
    asks.push(ask);
    previous = ask;
  }
  return asks.map((ask) => {
    const bid = ask - range.spreadBps;
    return { bidBps: bid, askBps: ask, midBps: Math.floor((bid + ask) / 2) };
  });
}

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

/** What one read of a source shows: the odds (null: none shown) and, for the row, observed_at. */
export interface OddsReading {
  valueBps: number | null;
  observedAtMs: number | null;
}

/** A place the ticket reads its odds. */
export interface OddsSource {
  name: string;
  read: () => Promise<OddsReading>;
}

interface LiveRow {
  mid_bps: number | null;
  stale: boolean;
  observed_at: Date;
}

function rowReading(row: LiveRow | undefined): OddsReading {
  if (row === undefined) return { valueBps: null, observedAtMs: null };
  return {
    valueBps: row.stale ? null : row.mid_bps,
    observedAtMs: row.observed_at.getTime(),
  };
}

function isPrivilegeRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code: unknown = Reflect.get(error, "code");
  return code === "42501";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The instrument's live_instruments row as the browser reads it: in a transaction under
 * `set local role anon` (transaction-scoped, so it is safe through Supabase's transaction pooler
 * and never leaks into the pool), so the grant and the row level security policy apply. When the
 * connection may not take the role (`SET ROLE` refused), the row is read with the runner's own
 * connection and `access` says so. A read refused to `anon` once it holds the role is not a
 * fallback: it counts as a read error, and the samples fail, as they would in the browser.
 */
export async function liveRowSource(
  db: Db,
  symbol: string,
): Promise<{ source: OddsSource; access: string }> {
  let anon = true;
  let refusal: string | null = null;
  try {
    await db.begin(async (sql) => {
      await sql`set local role anon`;
    });
  } catch (error: unknown) {
    // Only a refusal of the role is a fallback (42501, insufficient privilege); anything else (a
    // dropped connection) is thrown, for the caller's retries.
    if (!isPrivilegeRefusal(error)) throw error;
    anon = false;
    refusal = errorText(error);
  }
  if (anon) {
    return {
      access:
        "read as the anonymous role (set local role anon, in a transaction): the grant and the row level security policy the browser's Realtime subscription goes through",
      source: {
        name: "live_instruments read as anon",
        read: async () => {
          const rows = await db.begin(async (sql) => {
            await sql`set local role anon`;
            return sql<LiveRow[]>`
              select mid_bps, stale, observed_at from live_instruments where symbol = ${symbol}
            `;
          });
          return rowReading(rows[0]);
        },
      },
    };
  }
  return {
    access: `read with the runner's own connection: it may not take the anonymous role (${refusal ?? "refused"}), so the grant and policy the browser goes through are not exercised`,
    source: {
      name: "live_instruments (runner's connection)",
      read: async () => {
        const rows = await db<LiveRow[]>`
          select mid_bps, stale, observed_at from live_instruments where symbol = ${symbol}
        `;
        return rowReading(rows[0]);
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------------------------

/** The clock and the waits of the measure; the real ones by default. */
export interface OddsClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** A number in [0, 1), for the pause before each driven sample. */
  random: () => number;
}

export const SYSTEM_ODDS_CLOCK: OddsClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise<void>((resolveSleep) => {
      setTimeout(resolveSleep, Math.max(0, ms));
    }),
  random: () => Math.random(),
};

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new RehearsalAbortedError();
}

interface ReaderTally {
  readErrors: number;
  lastError: string | null;
  longestReadMs: number | null;
}

function tally(): ReaderTally {
  return { readErrors: 0, lastError: null, longestReadMs: null };
}

/** One read, timed; an error is counted and answers null. */
async function timedRead(
  source: OddsSource,
  counts: ReaderTally,
  clock: OddsClock,
  redact: (text: string) => string,
): Promise<{ reading: OddsReading | null; atMs: number }> {
  const started = clock.now();
  try {
    const reading = await source.read();
    const atMs = clock.now();
    counts.longestReadMs = Math.max(counts.longestReadMs ?? 0, atMs - started);
    return { reading, atMs };
  } catch (error: unknown) {
    const atMs = clock.now();
    counts.readErrors += 1;
    counts.lastError = redact(errorText(error));
    return { reading: null, atMs };
  }
}

/**
 * Reads `source` every `pollMs` (fixed rate from `startMs`) until it shows `expected` or
 * `deadlineMs` passes: the moment the read that showed it answered, or null.
 */
async function pollFor(
  source: OddsSource,
  expected: number,
  counts: ReaderTally,
  options: { startMs: number; deadlineMs: number; pollMs: number },
  clock: OddsClock,
  redact: (text: string) => string,
): Promise<number | null> {
  for (let tick = 0; ; tick += 1) {
    const { reading, atMs } = await timedRead(source, counts, clock, redact);
    if (reading !== null && reading.valueBps === expected && atMs <= options.deadlineMs)
      return atMs;
    if (atMs >= options.deadlineMs) return null;
    const next = options.startMs + (tick + 1) * options.pollMs;
    await clock.sleep(Math.min(next, options.deadlineMs) - clock.now());
  }
}

export interface DrivenMeasureInput {
  instrument: string;
  books: readonly { bidBps: number; askBps: number; midBps: number }[];
  /** Sets the book through the admin route (resolves once the route answered). */
  setBook: (bidBps: number, askBps: number) => Promise<void>;
  sources: readonly OddsSource[];
  pollMs: number;
  sampleTimeoutMs: number;
  /**
   * Each sample starts after a pause drawn in [0, `jitterMs`): without it every price would be set
   * just after the engine's last pass over the demo books, always at the same phase of its cycle.
   */
  jitterMs: number;
  signal?: AbortSignal;
  clock?: OddsClock;
  redact?: (text: string) => string;
  /** Called after each sample, for the progress line. */
  onSample?: (sample: DrivenOddsSample, index: number) => void;
}

/**
 * The driven path: each book set in turn, each source read until it shows the new mid. A value
 * that never shows within `sampleTimeoutMs` of the call's return is a failed sample, kept. Never
 * throws for a sample; throws what `setBook` throws, and `RehearsalAbortedError` on the signal.
 */
export async function measureDriven(input: DrivenMeasureInput): Promise<DrivenOddsRecord> {
  const clock = input.clock ?? SYSTEM_ODDS_CLOCK;
  const redact = input.redact ?? ((text: string): string => text);
  const counts = input.sources.map(() => tally());
  const fromReturn: number[][] = input.sources.map(() => []);
  const fromSent: number[][] = input.sources.map(() => []);
  const failed = input.sources.map(() => 0);
  const samples: DrivenOddsSample[] = [];
  for (const [index, book] of input.books.entries()) {
    throwIfAborted(input.signal);
    await clock.sleep(Math.floor(clock.random() * input.jitterMs));
    throwIfAborted(input.signal);
    const sentAtMs = clock.now();
    await input.setBook(book.bidBps, book.askBps);
    const returnedAtMs = clock.now();
    const deadlineMs = returnedAtMs + input.sampleTimeoutMs;
    const seen = await Promise.all(
      input.sources.map((source, at) =>
        pollFor(
          source,
          book.midBps,
          counts[at] ?? tally(),
          { startMs: returnedAtMs, deadlineMs, pollMs: input.pollMs },
          clock,
          redact,
        ),
      ),
    );
    const lagsMs = seen.map((atMs, at) => {
      if (atMs === null) {
        failed[at] = (failed[at] ?? 0) + 1;
        return null;
      }
      fromReturn[at]?.push(atMs - returnedAtMs);
      fromSent[at]?.push(atMs - sentAtMs);
      return atMs - returnedAtMs;
    });
    const sample: DrivenOddsSample = {
      bidBps: book.bidBps,
      askBps: book.askBps,
      midBps: book.midBps,
      callMs: returnedAtMs - sentAtMs,
      lagsMs,
    };
    samples.push(sample);
    input.onSample?.(sample, index);
  }
  const readers: OddsReaderRecord[] = input.sources.map((source, at) => ({
    source: source.name,
    lag: lagStats(fromReturn[at] ?? []),
    lagFromSent: lagStats(fromSent[at] ?? []),
    failed: failed[at] ?? 0,
    readErrors: counts[at]?.readErrors ?? 0,
    lastError: counts[at]?.lastError ?? null,
    longestReadMs: counts[at]?.longestReadMs ?? null,
  }));
  return {
    measured: samples.length > 0,
    note: samples.length > 0 ? null : "no price was set",
    instrument: input.instrument,
    readers,
    samples,
  };
}

export interface LiveMeasureInput {
  instrument: string;
  /** The row, read as the browser reads it; its `observedAtMs` is what is followed. */
  source: OddsSource;
  windowMs: number;
  pollMs: number;
  signal?: AbortSignal;
  clock?: OddsClock;
  redact?: (text: string) => string;
}

/**
 * The live path: the row read every `pollMs` for `windowMs`; each time its observed_at moves
 * forward, seen − observed_at is a sample (the first read only sets where it starts: when that
 * book arrived is not known). No update in the window: not measured, said so, never a pass.
 */
export async function measureLive(input: LiveMeasureInput): Promise<LiveOddsRecord> {
  const clock = input.clock ?? SYSTEM_ODDS_CLOCK;
  const redact = input.redact ?? ((text: string): string => text);
  const counts = tally();
  const lagsMs: number[] = [];
  const startMs = clock.now();
  const endMs = startMs + input.windowMs;
  let last: number | null = null;
  let started = false;
  for (let tick = 0; ; tick += 1) {
    throwIfAborted(input.signal);
    const { reading, atMs } = await timedRead(input.source, counts, clock, redact);
    if (reading !== null) {
      const observed = reading.observedAtMs;
      if (!started) {
        started = true;
        last = observed;
      } else if (observed !== null && (last === null || observed > last)) {
        lagsMs.push(atMs - observed);
        last = observed;
      }
    }
    if (atMs >= endMs) break;
    const next = startMs + (tick + 1) * input.pollMs;
    await clock.sleep(Math.min(next, endMs) - clock.now());
  }
  const seconds = (input.windowMs / 1_000).toString();
  return {
    measured: lagsMs.length > 0,
    note:
      lagsMs.length > 0
        ? null
        : `no update observed: the row's observed_at did not move in ${seconds} s${counts.lastError === null ? "" : ` (last read error: ${counts.lastError})`}`,
    instrument: input.instrument,
    windowMs: input.windowMs,
    readers: [
      {
        source: input.source.name,
        lag: lagStats(lagsMs),
        lagFromSent: null,
        failed: 0,
        readErrors: counts.readErrors,
        lastError: counts.lastError,
        longestReadMs: counts.longestReadMs,
      },
    ],
    lagsMs,
  };
}

/** A driven path that was not measured, and why. */
export function drivenNotMeasured(note: string, instrument: string | null): DrivenOddsRecord {
  return { measured: false, note, instrument, readers: [], samples: [] };
}

/** A live path that was not measured, and why. */
export function liveNotMeasured(
  note: string,
  instrument: string | null,
  windowMs: number,
): LiveOddsRecord {
  return { measured: false, note, instrument, windowMs, readers: [], lagsMs: [] };
}

/** The bound of the measurement error, from the polling period and the longest read seen. */
export function measurementError(pollMs: number, records: readonly OddsReaderRecord[]): string {
  const longest = records.reduce<number | null>(
    (max, record) =>
      record.longestReadMs === null ? max : Math.max(max ?? 0, record.longestReadMs),
    null,
  );
  return `Each lag is the moment a read showed the new value: it overstates the true lag by at most one polling period (${pollMs.toString()} ms) plus one read (longest read ${longest === null ? "–" : `${longest.toString()} ms`}), and never understates it.`;
}

/** The whole record, once both paths are known. */
export function oddsRecordOf(parts: {
  options: OddsLagOptions;
  writeThrottleMs: number | null;
  demoRefreshMs: number | null;
  rowAccess: string | null;
  driven: DrivenOddsRecord;
  live: LiveOddsRecord;
}): OddsRecord {
  return {
    writeThrottleMs: parts.writeThrottleMs,
    demoRefreshMs: parts.demoRefreshMs,
    pollMs: parts.options.pollMs,
    sampleTimeoutMs: parts.options.sampleTimeoutMs,
    rowAccess: parts.rowAccess ?? "not read",
    judgedFrom: ODDS_JUDGED_FROM,
    observedAt: ODDS_OBSERVED_AT,
    measurementError: measurementError(parts.options.pollMs, [
      ...parts.driven.readers,
      ...parts.live.readers,
    ]),
    excludes: ODDS_EXCLUDES,
    driven: parts.driven,
    live: parts.live,
  };
}
