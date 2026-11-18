import type { Logger } from "pino";

import type { Book, SaleState } from "@winz/shared";

import { abortableSleep } from "../chain/clock";
import { summarizeError } from "../chain/error-summary";
import type { Db } from "../db";
import type { BookFeedListener } from "../market-data";
import { SaleStateConfigError } from "./errors";
import {
  evaluateSaleStateWithGrace,
  failedEvaluation,
  freshMemory,
  type BreakerView,
  type SaleStateDecision,
  type SaleStateInput,
  type SaleStateMemory,
  type StartupGrace,
} from "./evaluate";
import { isManuallyPaused } from "./manual-pause";
import {
  loadCampaignSaleRows,
  writeSaleState,
  type CampaignSaleRow,
  type StoreQueryOptions,
} from "./store";

/** What the service reads from the book feed. `BookFeed` satisfies it. */
export interface SaleBookSource {
  getBook(symbol: string): Book | null;
  isStale(symbol: string): boolean;
  subscribe(listener: BookFeedListener): () => void;
}

/** The hedging breaker of an instrument, supplied by the hedging lane. */
export type BreakerStatus = (instrumentSymbol: string) => BreakerView;

/** Default breaker: never active. */
export const NEVER_TRIPPED: BreakerStatus = () => ({ active: false, reason: null });

export interface SaleStateRunnerOptions {
  db: Db;
  bookFeed: SaleBookSource;
  breakerStatus?: BreakerStatus;
  logger: Logger;
  /** Epoch milliseconds. Default `Date.now`. */
  clock?: () => number;
  /** Guarantee tolerance in ticks. Default: the pricing default (`DEFAULT_RISK_PARAMS`). */
  toleranceTicks?: number;
  /** Age after which a book is stale. Default: the pricing default (10 s). */
  staleAfterMs?: number;
  /**
   * Longest time one database statement of a pass may run or wait for a lock before Postgres
   * cancels it (the pass then fails, is logged and retried). Default 5 000.
   */
  statementTimeoutMs?: number;
  /**
   * Start-up grace, ms after the runner is created (`startSaleStates` creates it when it starts):
   * while it runs, a campaign whose instrument has not had a book from the feed yet keeps its
   * stored sale state instead of pausing for the missing book (see `evaluateSaleStateWithGrace`).
   * It ends for an instrument at its first book or when the time runs out, and never comes back
   * for that instrument. Default 10 000, the age at which a book is stale anyway; 0 turns it off.
   */
  startupGraceMs?: number;
}

/** Default `startupGraceMs`: the age at which a book is stale anyway (SPEC MD-2). */
export const DEFAULT_STARTUP_GRACE_MS = 10_000;

export interface SaleStatePassResult {
  /** Campaigns evaluated. */
  evaluated: number;
  /** Sale state changes written to `campaigns`. */
  transitions: number;
  /** Rows written (campaigns and live_campaigns), each counted once. */
  rowsWritten: number;
  /**
   * Campaigns that could not be evaluated or written in this pass. A campaign whose evaluation
   * failed is still written, kept from selling (see `failedEvaluation`).
   */
  failures: number;
}

/** What `evaluateRow` hands back to the pass. */
interface RowOutcome {
  /** Errors met while deciding (a source that threw, a pricing input error); empty when none. */
  errors: unknown[];
}

/** Calls the logger without letting a failing logger stop the service. */
function safeLog(write: () => void): void {
  try {
    write();
  } catch {
    // A failing logger must not stop the sale states.
  }
}

/**
 * One evaluation pass at a time: reads the campaigns, decides their sale state with
 * `evaluateSaleState`, and writes only what changed. Holds the hysteresis memory of every
 * campaign it saw (in memory only: a restart forgets it, so a paused campaign waits the full
 * delay again). The service (`startSaleStates`) drives it; tests drive it by hand.
 */
export class SaleStateRunner {
  private readonly db: Db;
  private readonly bookFeed: SaleBookSource;
  private readonly breakerStatus: BreakerStatus;
  private readonly logger: Logger;
  private readonly clock: () => number;
  private readonly toleranceTicks: number | undefined;
  private readonly staleAfterMs: number | undefined;
  private readonly storeOptions: StoreQueryOptions;
  private readonly memory = new Map<string, SaleStateMemory>();
  /** Last error logged per campaign, so a campaign failing every second is logged once. */
  private readonly lastError = new Map<string, string>();
  private tracked = new Set<string>();
  private readonly startupGraceMs: number;
  private readonly startedAtMs: number;
  /** Instruments whose grace is over for good: a book came, or the time ran out. */
  private readonly graceOver = new Set<string>();
  /** Instruments that had at least one evaluation under the grace (for the end-of-grace log). */
  private readonly graced = new Set<string>();

  constructor(options: SaleStateRunnerOptions) {
    this.db = options.db;
    this.bookFeed = options.bookFeed;
    this.breakerStatus = options.breakerStatus ?? NEVER_TRIPPED;
    this.logger = options.logger;
    this.clock = options.clock ?? Date.now;
    this.toleranceTicks = options.toleranceTicks;
    this.staleAfterMs = options.staleAfterMs;
    this.storeOptions =
      options.statementTimeoutMs === undefined
        ? {}
        : { statementTimeoutMs: options.statementTimeoutMs };
    const graceMs = options.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;
    if (!Number.isFinite(graceMs) || graceMs < 0) {
      throw new SaleStateConfigError("SaleStateRunner: startupGraceMs must be a number >= 0");
    }
    this.startupGraceMs = graceMs;
    this.startedAtMs = this.clock();
  }

  /**
   * The feed delivered a book for `symbol`: its start-up grace is over for good, even if the
   * book is later dropped or turns stale. `startSaleStates` calls it on every book event.
   */
  noteBook(symbol: string): void {
    this.graceOver.add(symbol);
  }

  /** Whether the start-up grace still holds for `symbol` at `nowMs` (for inspection). */
  inStartupGrace(symbol: string, nowMs: number): boolean {
    return (
      this.startupGraceMs > 0 &&
      !this.graceOver.has(symbol) &&
      nowMs - this.startedAtMs < this.startupGraceMs
    );
  }

  /**
   * The grace of `row`'s instrument at this evaluation, or null when it does not apply. A book
   * held by the feed ends it; so does the end of the grace time, logged once per instrument that
   * was under the grace (its campaigns are then evaluated as usual, and pause for the missing
   * book).
   */
  private startupGrace(
    row: CampaignSaleRow,
    book: Book | null,
    nowMs: number,
  ): StartupGrace | null {
    const symbol = row.instrument;
    if (this.startupGraceMs === 0 || this.graceOver.has(symbol)) return null;
    if (book !== null) {
      this.graceOver.add(symbol);
      return null;
    }
    if (nowMs - this.startedAtMs >= this.startupGraceMs) {
      this.graceOver.add(symbol);
      if (this.graced.has(symbol)) {
        safeLog(() =>
          this.logger.info(
            { instrument: symbol, startupGraceMs: this.startupGraceMs },
            "start-up grace over without a book: the instrument's campaigns are evaluated as usual",
          ),
        );
      }
      return null;
    }
    this.graced.add(symbol);
    return { storedState: row.storedState };
  }

  /** Instruments of the campaigns seen in the last full pass. */
  isTracked(symbol: string): boolean {
    return this.tracked.has(symbol);
  }

  /** The hysteresis memory of a campaign, for inspection. */
  memoryOf(campaignId: string): SaleStateMemory | null {
    return this.memory.get(campaignId) ?? null;
  }

  /**
   * Evaluates every candidate campaign, or only those on `instruments`. Throws only when the
   * campaigns cannot be read at all; a campaign that fails is logged and counted in `failures`.
   */
  async runPass(instruments?: readonly string[]): Promise<SaleStatePassResult> {
    const full = instruments === undefined;
    const { rows, errors } = await loadCampaignSaleRows(this.db, instruments, this.storeOptions);
    const result: SaleStatePassResult = {
      evaluated: 0,
      transitions: 0,
      rowsWritten: 0,
      failures: errors.length,
    };
    for (const error of errors) {
      this.logFailure(error.campaignId, error, "campaign row is malformed");
    }

    if (full) {
      const seen = new Set(rows.map((row) => row.id));
      for (const id of this.memory.keys()) if (!seen.has(id)) this.memory.delete(id);
      for (const id of this.lastError.keys()) if (!seen.has(id)) this.lastError.delete(id);
      this.tracked = new Set(rows.map((row) => row.instrument));
    }

    for (const row of rows) {
      try {
        const outcome = await this.evaluateRow(row, result);
        const [firstError] = outcome.errors;
        if (firstError !== undefined) {
          result.failures += 1;
          this.logFailure(
            row.id,
            firstError,
            "sale state evaluation failed, campaign kept from selling",
          );
          continue;
        }
        result.evaluated += 1;
        if (this.lastError.delete(row.id)) {
          safeLog(() =>
            this.logger.info({ campaignId: row.id }, "sale state evaluation recovered"),
          );
        }
      } catch (error: unknown) {
        result.failures += 1;
        // Forget the timings: the campaign starts over from its stored state and waits the full
        // delay again (the safe side), keeping the one-tick margin a price refusal required.
        const before = this.memory.get(row.id);
        this.memory.set(row.id, freshMemory(row.storedState, before?.priceRefused ?? false));
        this.logFailure(row.id, error, "sale state evaluation failed");
      }
    }
    return result;
  }

  /**
   * Decides one campaign. The breaker and the book feed are other lanes' code: when one of them
   * throws, the campaign is decided as if it could not sell (breaker active, no book, book stale)
   * and the error is returned; when the evaluation itself throws, `failedEvaluation` keeps it from
   * selling. Never throws.
   */
  private decide(
    row: CampaignSaleRow,
    nowMs: number,
  ): { decision: SaleStateDecision; errors: unknown[] } {
    const errors: unknown[] = [];
    const attempt = <T>(read: () => T, fallback: T): T => {
      try {
        return read();
      } catch (error: unknown) {
        errors.push(error);
        return fallback;
      }
    };
    // A campaign the runner has not seen yet starts from what is stored: a stored automatic
    // pause then waits the full delay (with the one-tick margin for a price pause), a stored
    // open, closed or manual state opens at once.
    const previous = this.memory.get(row.id) ?? freshMemory(row.storedState);
    const breaker = attempt(() => this.breakerStatus(row.instrument), {
      active: true,
      reason: "breaker status unavailable",
    });
    const sourceErrors = errors.length;
    const book = attempt(() => this.bookFeed.getBook(row.instrument), null);
    const bookFlaggedStale = attempt(() => this.bookFeed.isStale(row.instrument), true);
    // A book source that throws is decided as today, without the grace: it fails closed.
    const grace = errors.length === sourceErrors ? this.startupGrace(row, book, nowMs) : null;
    const input: SaleStateInput = {
      terms: row.terms,
      status: row.status,
      outcome: row.outcome,
      hasOnchainId: row.hasOnchainId,
      closeRequested: row.closeRequested,
      nowMs,
      salesCloseMs: row.salesCloseMs,
      manualPause: isManuallyPaused({
        status: row.status,
        pauseJobInFlight: row.pauseJobInFlight,
        pauseEventUnprojected: row.pauseEventUnprojected,
        latestPauseJob: row.latestPauseJob,
        lastOnChainPauseAtMs: row.lastOnChainPauseAtMs,
      }),
      breaker,
      book,
      bookFlaggedStale,
      pending: row.pending,
      availableBudget: row.availableBudget,
      ...(this.toleranceTicks === undefined ? {} : { toleranceTicks: this.toleranceTicks }),
      ...(this.staleAfterMs === undefined ? {} : { staleAfterMs: this.staleAfterMs }),
      previous,
    };
    try {
      return { decision: evaluateSaleStateWithGrace(input, grace), errors };
    } catch (error: unknown) {
      errors.push(error);
      const summary = summarizeError(error);
      return { decision: failedEvaluation(input, `${summary.type}: ${summary.message}`), errors };
    }
  }

  private async evaluateRow(
    row: CampaignSaleRow,
    result: SaleStatePassResult,
  ): Promise<RowOutcome> {
    const nowMs = this.clock();
    const { decision, errors } = this.decide(row, nowMs);
    const changed = decision.state !== row.storedState;
    const syncLive = row.slug !== null && row.liveState !== decision.state;
    // The status follows the escrow's salesClose only: `sales_closed` is final.
    const closeStatus =
      nowMs >= row.onchainSalesCloseMs && (row.status === "live" || row.status === "paused");

    if (!changed && !syncLive && !closeStatus) {
      this.memory.set(row.id, decision.memory);
      return { errors };
    }

    const written = await writeSaleState(
      this.db,
      {
        campaignId: row.id,
        expectedState: row.storedState,
        state: changed ? decision.state : null,
        syncLive,
        closeStatus,
      },
      this.storeOptions,
    );
    if (!written.applied) {
      // The web API changed the sale state since it was read (a manual pause, an early close):
      // its write stands, and the next pass decides again from it with no history.
      this.memory.delete(row.id);
      safeLog(() =>
        this.logger.debug(
          { campaignId: row.id, expected: row.storedState },
          "sale state changed concurrently, decision dropped",
        ),
      );
      return { errors };
    }
    this.memory.set(row.id, decision.memory);
    result.rowsWritten += written.rowsWritten;
    if (changed) {
      result.transitions += 1;
      this.logTransition(row, row.storedState, decision);
    }
    if (written.statusClosed) {
      safeLog(() =>
        this.logger.info(
          { campaignId: row.id, slug: row.slug, from: row.status, to: "sales_closed" },
          "campaign sales closed",
        ),
      );
    }
    return { errors };
  }

  private logTransition(row: CampaignSaleRow, from: SaleState, decision: SaleStateDecision): void {
    safeLog(() =>
      this.logger.info(
        {
          campaignId: row.id,
          onchainId: row.onchainId?.toString() ?? null,
          slug: row.slug,
          instrument: row.instrument,
          from,
          to: decision.state,
          reason: decision.reason,
          detail: decision.detail,
        },
        "sale state changed",
      ),
    );
  }

  private logFailure(campaignId: string, error: unknown, message: string): void {
    const summary = summarizeError(error);
    const key = `${summary.type}: ${summary.message}`;
    if (this.lastError.get(campaignId) === key) return;
    this.lastError.set(campaignId, key);
    safeLog(() => this.logger.error({ campaignId, error: summary }, message));
  }
}

export interface SaleStatesOptions extends SaleStateRunnerOptions {
  /** Aborting it stops the service; the pass in flight finishes first. */
  signal: AbortSignal;
  /** Time between two full passes. Default 1 000. */
  intervalMs?: number;
  /** Longest wait between two attempts while the campaigns cannot be read. Default 30 000. */
  retryMaxMs?: number;
  /**
   * A pass still running after this long is logged at error level: every sale state is frozen
   * until it ends (passes never overlap). The statement timeout normally ends it before; this
   * catches what that cannot, such as a connection that stopped answering. Default 10 000.
   */
  slowPassMs?: number;
}

export interface SaleStates {
  /** Resolves once the service has stopped: aborted, no pass in flight, no timer left. */
  stopped: Promise<void>;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SaleStateConfigError(`startSaleStates: ${name} must be a positive number`);
  }
  return value;
}

/**
 * H-02: the sale state of every campaign (SPEC CA-4, CA-5, 4.5). Every `intervalMs` (1 s by
 * default), and on every book of an instrument a campaign uses, it evaluates the campaigns that
 * are live or paused on-chain or whose sale state is not `closed`, and writes
 * `campaigns.sale_state` and `live_campaigns.sale_state` only when they change. When a campaign's
 * sales close passes it also moves its status to `sales_closed`. Passes never overlap: book
 * updates that arrive during a pass are merged into the next one.
 *
 * For `startupGraceMs` after it starts, a campaign whose instrument has had no book yet keeps its
 * stored sale state rather than pausing for the missing book, so that a restart does not pause
 * every promo for the ten seconds of the resume delay. That is safe for money because the
 * purchase job prices every sale again on the book of its instant and refuses it on a missing or
 * stale book (`jobs/handlers/purchase.ts`).
 *
 * Never throws out of its loop; stops on abort with no timer left.
 */
export function startSaleStates(options: SaleStatesOptions): SaleStates {
  const { signal, logger } = options;
  const intervalMs = positive(options.intervalMs ?? 1_000, "intervalMs");
  const retryMaxMs = positive(options.retryMaxMs ?? 30_000, "retryMaxMs");
  const slowPassMs = positive(options.slowPassMs ?? 10_000, "slowPassMs");
  const runner = new SaleStateRunner(options);

  let pendingFull = false;
  const pendingInstruments = new Set<string>();
  let draining: Promise<void> | null = null;
  let failures = 0;

  const runOne = async (instruments?: readonly string[]): Promise<void> => {
    const startedAt = Date.now();
    const watchdog = setTimeout(() => {
      safeLog(() =>
        logger.error(
          { elapsedMs: Date.now() - startedAt, instruments: instruments ?? null },
          "sale state pass is overrunning: every sale state is frozen until it ends",
        ),
      );
    }, slowPassMs);
    try {
      await runner.runPass(instruments);
      if (failures > 0) {
        safeLog(() => logger.info({ failures }, "sale states recovered"));
      }
      failures = 0;
    } catch (error: unknown) {
      failures += 1;
      safeLog(() =>
        logger.error({ error: summarizeError(error), failures }, "sale state pass failed"),
      );
    } finally {
      clearTimeout(watchdog);
    }
  };

  // Clears `draining` in the same step as the last check of the queue, so a request can never
  // land between the end of the loop and the reset and be left waiting.
  const drain = async (): Promise<void> => {
    try {
      while (!signal.aborted && (pendingFull || pendingInstruments.size > 0)) {
        const instruments = pendingFull ? undefined : [...pendingInstruments].sort();
        pendingFull = false;
        pendingInstruments.clear();
        await runOne(instruments);
      }
    } finally {
      draining = null;
    }
  };

  const request = (instrument?: string): Promise<void> => {
    if (signal.aborted) return draining ?? Promise.resolve();
    if (instrument === undefined) pendingFull = true;
    else pendingInstruments.add(instrument);
    draining ??= drain();
    return draining;
  };

  const unsubscribe = options.bookFeed.subscribe((event) => {
    if (signal.aborted || event.kind !== "book") return;
    const symbol = event.book.instrumentSymbol;
    // Before the tracked check: a book that lands before the first pass still ends the grace.
    runner.noteBook(symbol);
    if (!runner.isTracked(symbol)) return;
    // Errors are handled inside the pass; this promise never rejects.
    void request(symbol);
  });

  const loop = async (): Promise<void> => {
    while (!signal.aborted) {
      await request();
      const delayMs =
        failures === 0
          ? intervalMs
          : Math.min(intervalMs * 2 ** Math.min(failures, 16), retryMaxMs);
      await abortableSleep(delayMs, signal);
    }
  };

  const stopped = loop()
    .then(async () => {
      unsubscribe();
      await (draining ?? Promise.resolve());
    })
    .catch((error: unknown) => {
      unsubscribe();
      safeLog(() => logger.error({ error: summarizeError(error) }, "sale states stopped on error"));
    })
    .finally(() => {
      safeLog(() => logger.info("sale states stopped"));
    });

  return { stopped };
}
