/**
 * The hedging engine as one running service (tasks H-10 and H-08; SPEC HE-2 to HE-6, 9.3 to 9.7):
 * the book feed, the exposure ledger, one policy runner per instrument, the execution venue, the
 * persistence of orders and fills with their allocation, the hedge charges, the reconciliation at
 * sales close and the public Hedge desk.
 */
import type { Logger } from "pino";
import type { Address } from "viem";

import { CONTRACT_STEP_MICRO, type Book, type ExecutionVenueName } from "@winz/shared";

import { abortableSleep } from "../../chain/clock";
import type { Db } from "../../db";
import type { BookFeedEvent } from "../../market-data/book-feed";
import {
  PaperVenue,
  createVenue,
  type ExecutionVenue,
  type GeminiVenueWiring,
  type PaperVenueConfig,
  type VenueClock,
} from "../../venues";
import { allocateHeldInventory } from "../allocation";
import {
  PolicyRunner,
  type BreakerParams,
  type BreakerReason,
  type ExposureReadOutcome,
} from "../policy";
import { HedgeCharger, type ChargeTxSender } from "./charger";
import { HedgeDeskWriter, type DeskInstrumentInfo } from "./desk";
import {
  HedgeFinalizeError,
  HedgeNotReconciledError,
  HedgingConfigError,
  HedgingStoppedError,
} from "./errors";
import { orderIdPrefix } from "./ids";
import { loadRiskParams, policyParamsOf } from "./params";
import { PgPolicySink, type FillRecorded } from "./sink";
import {
  cancelVanishedOrders,
  closedCampaignsOf,
  getHedgeInstrument,
  listHedgeInstruments,
  loadRestoreState,
  needsRunner,
  releaseSettledHeld,
  remainingLots,
  resetPosition,
  salesOver,
  writeDerivedHeld,
  writeWorking,
  type HedgeInstrumentRow,
} from "./store";

/** The part of the book feed the service uses. `BookFeed` satisfies it. */
export interface HedgeBookSource {
  subscribe(listener: (event: BookFeedEvent) => void): () => void;
  getBook(symbol: string): Book | null;
}

/** What the sale-state evaluator reads: sales of the instrument stop while the breaker is active. */
export interface BreakerStatus {
  active: boolean;
  reason: BreakerReason | null;
}

/** A campaign to finalize. The settlement lane's `SettlementCampaign` satisfies it. */
export interface FinalizeCampaign {
  /** `campaigns.id`. */
  id: string;
  /** `campaigns.onchain_id`. */
  onchainId: bigint;
  /** `campaigns.instrument`. */
  instrument: string;
}

/**
 * Implemented for the settlement lane: reconciles the campaign's instrument and gets every ticket
 * of the campaign charged on-chain, waiting for those transactions. Safe to call repeatedly.
 */
export interface HedgeFinalizer {
  finalize(campaign: FinalizeCampaign): Promise<void>;
}

export interface HedgingServiceOptions {
  db: Db;
  bookFeed: HedgeBookSource;
  txSender: ChargeTxSender;
  venueName: ExecutionVenueName;
  escrowAddress: Address;
  logger: Logger;
  /** Aborting it stops every loop and runner; work in flight finishes first. */
  signal: AbortSignal;
  /** Defaults to the system clock. The runners, the venue and the sales-close checks use it. */
  clock?: VenueClock;
  /** How often `positions.exposure` and the instruments are read. Default 1 000. */
  exposureIntervalMs?: number;
  /** How often every runner gets `onTick` and the desk is refreshed. Default 1 000. */
  tickIntervalMs?: number;
  /** How often the covered lots are charged, besides after each allocation. Default 2 000. */
  chargeIntervalMs?: number;
  /** Least time between two writes of one instrument's `live_hedge_desk` row. Default 1 000. */
  deskMinIntervalMs?: number;
  /** Longest wait for one reconciliation (the sales-close pass's or `finalize`'s). Default 30 000. */
  reconcileTimeoutMs?: number;
  /**
   * Longest a `finalize` call runs, from its start: the reconciliation it waits for or runs and
   * the wait for the campaign's charges share this one deadline. Default 120 000.
   */
  finalizeTimeoutMs?: number;
  /** Overrides of the circuit breaker's defaults (HE-5). */
  breakerParams?: Partial<BreakerParams>;
  /** Overrides of the paper venue's defaults. */
  paperVenueConfig?: Partial<PaperVenueConfig>;
  /**
   * The sandbox client and the order links of the real Gemini venue: required when `venueName`
   * is "gemini-sandbox", unused otherwise.
   */
  geminiVenue?: GeminiVenueWiring;
  /** Testing seams. Never set in production. */
  testHooks?: HedgingTestHooks;
}

/** Testing seams of the service: points where a test can hold the service still. */
export interface HedgingTestHooks {
  /**
   * Awaited at the start of every reconciliation (the sales-close pass's and `finalize`'s), while
   * it holds the instrument's reconciliation slot and before it tells the runner anything.
   */
  beforeReconcile?: (instrument: string) => Promise<void>;
}

interface Entry {
  info: DeskInstrumentInfo;
  /**
   * Owns E, H and the settled allocation H leaves out, with the version of the read they come
   * from: every read of the exposure ledger reaches it through `handRead`, and it ignores one older
   * than what it has (`PolicyRunner.onExposureRead`).
   */
  runner: PolicyRunner;
  /** Contracts the runner released for settlements, not yet taken out of `positions.held`. */
  heldToRelease: bigint;
  /** E at which a reconciliation (sales close or `finalize`) last completed; null before. */
  reconciledAtExposure: bigint | null;
  /**
   * The reconciliation in progress, if any: the sales-close pass or one started by `finalize`.
   * Both go through this one slot (`claimReconcile`), so a runner never reconciles twice at once.
   */
  reconciling: Promise<void> | null;
}

const SYSTEM_CLOCK: VenueClock = { now: () => new Date() };
const RECONCILE_POLL_MS = 100;
const CHARGE_POLL_MS = 200;
/** A warning is logged every this many rounds of a `finalize` still waiting for its charges. */
const FINALIZE_WARN_ROUNDS = 10;

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new HedgingConfigError(`startHedging: ${name} must be a positive number`);
  }
  return value;
}

function withinOneStep(held: bigint, exposure: bigint): boolean {
  const gap = held - exposure;
  return (gap < 0n ? -gap : gap) <= CONTRACT_STEP_MICRO;
}

/**
 * One instance per engine. See `startHedging` for the lifecycle; the methods below are what the
 * loops call, and what the finalizer and the sale-state evaluator use.
 */
export class HedgingService implements HedgeFinalizer {
  private readonly db: Db;
  private readonly bookFeed: HedgeBookSource;
  private readonly logger: Logger;
  private readonly signal: AbortSignal;
  private readonly clock: VenueClock;
  private readonly venue: ExecutionVenue;
  private readonly sink: PgPolicySink;
  private readonly charger: HedgeCharger;
  private readonly desk: HedgeDeskWriter;
  private readonly breakerParams: Partial<BreakerParams> | undefined;
  private readonly exposureIntervalMs: number;
  private readonly tickIntervalMs: number;
  private readonly chargeIntervalMs: number;
  private readonly deskMinIntervalMs: number;
  private readonly lastDeskWriteMs = new Map<string, number>();
  private readonly reconcileTimeoutMs: number;
  private readonly finalizeTimeoutMs: number;
  private readonly testHooks: HedgingTestHooks;
  private readonly entries = new Map<string, Entry>();
  private readonly creating = new Map<string, Promise<Entry>>();
  /** Promises started from listeners and loops without being awaited there: awaited at stop. */
  private readonly inFlight = new Set<Promise<unknown>>();
  private chargeWake: AbortController | null = null;
  private chargeRequested = false;
  private ready = false;
  private stopped = false;

  constructor(options: HedgingServiceOptions) {
    this.db = options.db;
    this.bookFeed = options.bookFeed;
    this.logger = options.logger.child({ module: "hedging" });
    this.signal = options.signal;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.breakerParams = options.breakerParams;
    this.testHooks = options.testHooks ?? {};
    this.exposureIntervalMs = positive(options.exposureIntervalMs ?? 1_000, "exposureIntervalMs");
    this.tickIntervalMs = positive(options.tickIntervalMs ?? 1_000, "tickIntervalMs");
    this.chargeIntervalMs = positive(options.chargeIntervalMs ?? 2_000, "chargeIntervalMs");
    this.deskMinIntervalMs = positive(options.deskMinIntervalMs ?? 1_000, "deskMinIntervalMs");
    this.reconcileTimeoutMs = positive(options.reconcileTimeoutMs ?? 30_000, "reconcileTimeoutMs");
    this.finalizeTimeoutMs = positive(options.finalizeTimeoutMs ?? 120_000, "finalizeTimeoutMs");
    this.venue = createVenue(options.venueName, {
      clock: this.clock,
      logger: this.logger.child({ component: "venue" }),
      config: options.paperVenueConfig,
      ...(options.geminiVenue === undefined ? {} : { gemini: options.geminiVenue }),
    });
    this.sink = new PgPolicySink({
      db: this.db,
      venue: this.venue.name,
      logger: this.logger,
      onFillRecorded: (event) => {
        this.onFillRecorded(event);
      },
    });
    this.charger = new HedgeCharger({
      db: this.db,
      txSender: options.txSender,
      escrowAddress: options.escrowAddress,
      logger: this.logger,
      now: () => this.clock.now(),
    });
    this.desk = new HedgeDeskWriter(this.db, this.logger);
  }

  /** Runs the service until the signal aborts. Never rejects. */
  async run(): Promise<void> {
    const unsubscribe = this.bookFeed.subscribe((event) => {
      this.onBookFeedEvent(event);
    });
    try {
      this.logger.info(
        { venue: this.venue.name, label: this.venue.describe().label },
        "hedging started",
      );
      await this.loop("startup", 1_000, async () => {
        if (!this.ready) await this.prepare();
        return this.ready ? "done" : "again";
      });
      await Promise.all([
        this.loop("exposure", this.exposureIntervalMs, async () => {
          await this.syncInstruments();
          return "again";
        }),
        this.loop("tick", this.tickIntervalMs, async () => {
          await this.tick();
          return "again";
        }),
        this.chargeLoop(),
      ]);
    } finally {
      unsubscribe();
      await this.shutdown();
    }
  }

  /** The breaker of an instrument's runner; inactive when the instrument has none. */
  breakerStatus(instrumentSymbol: string): BreakerStatus {
    const entry = this.entries.get(instrumentSymbol);
    if (entry === undefined) return { active: false, reason: null };
    const breaker = entry.runner.getBreaker();
    return { active: breaker.active, reason: breaker.reason };
  }

  // -------------------------------------------------------------------------------------------
  // Loops
  // -------------------------------------------------------------------------------------------

  /** Runs `step` every `intervalMs` until the signal aborts (or it says "done"). Never rejects. */
  private async loop(
    name: string,
    intervalMs: number,
    step: () => Promise<"again" | "done">,
  ): Promise<void> {
    let failures = 0;
    while (!this.signal.aborted) {
      let delayMs = intervalMs;
      try {
        if ((await step()) === "done") return;
        failures = 0;
      } catch (error: unknown) {
        failures += 1;
        delayMs = Math.min(intervalMs * 2 ** Math.min(failures, 5), 30_000);
        this.safeLog(
          "error",
          { loop: name, err: describeError(error), failures },
          "hedging loop step failed",
        );
      }
      await abortableSleep(delayMs, this.signal);
    }
  }

  /** Charges on an interval, and at once when an allocation covered a lot. */
  private async chargeLoop(): Promise<void> {
    while (!this.signal.aborted) {
      this.chargeRequested = false;
      try {
        await this.charger.chargeCovered();
      } catch (error: unknown) {
        this.safeLog(
          "error",
          { loop: "charge", err: describeError(error) },
          "hedge charge pass failed",
        );
      }
      try {
        await this.charger.recordMinedLosses();
      } catch (error: unknown) {
        this.safeLog(
          "error",
          { loop: "charge", err: describeError(error) },
          "guarantee losses of mined charges not booked: retried at the next pass",
        );
      }
      if (this.chargeRequested || this.signal.aborted) continue;
      const wake = new AbortController();
      const onAbort = (): void => wake.abort();
      this.signal.addEventListener("abort", onAbort, { once: true });
      this.chargeWake = wake;
      try {
        await abortableSleep(this.chargeIntervalMs, wake.signal);
      } finally {
        this.chargeWake = null;
        this.signal.removeEventListener("abort", onAbort);
      }
    }
  }

  private requestCharge(): void {
    this.chargeRequested = true;
    this.chargeWake?.abort();
  }

  private safeLog(
    level: "error" | "warn" | "info",
    fields: Record<string, unknown>,
    message: string,
  ): void {
    try {
      this.logger[level](fields, message);
    } catch {
      // A failing logger must not stop a loop.
    }
  }

  /** Tracks a promise started without being awaited: logged on failure, awaited at stop. */
  private track(promise: Promise<unknown>, what: string, instrument?: string): void {
    const tracked = promise.catch((error: unknown) => {
      this.safeLog("error", { err: describeError(error), instrument }, `${what} failed`);
    });
    this.inFlight.add(tracked);
    void tracked.finally(() => this.inFlight.delete(tracked));
  }

  /**
   * Startup, once: a venue that keeps nothing across a restart (the paper venue) no longer has
   * the orders the previous process left resting, so they are marked cancelled.
   */
  private async prepare(): Promise<void> {
    if (this.venue.name === "paper") {
      const vanished = await cancelVanishedOrders(this.db, this.venue.name);
      if (vanished.length > 0) {
        this.logger.warn(
          {
            venue: this.venue.name,
            orders: vanished.map((order) => order.clientOrderId),
            instruments: [...new Set(vanished.map((order) => order.instrument))],
          },
          "orders left open by the previous process marked cancelled: the paper venue keeps its orders in memory only, so they no longer exist and can never fill",
        );
      }
    }
    this.ready = true;
  }

  private async shutdown(): Promise<void> {
    this.stopped = true;
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
    await Promise.allSettled([...this.creating.values()]);
    for (const [symbol, entry] of this.entries) {
      try {
        if (entry.reconciling !== null) await entry.reconciling;
        await entry.runner.stop();
      } catch (error: unknown) {
        this.safeLog(
          "error",
          { instrument: symbol, err: describeError(error) },
          "runner did not stop cleanly",
        );
      }
    }
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
    try {
      await this.venue.close?.();
    } catch (error: unknown) {
      this.safeLog("error", { err: describeError(error) }, "venue did not stop cleanly");
    }
    try {
      await this.sink.retryPending({ force: true });
    } catch (error: unknown) {
      this.safeLog(
        "error",
        { err: describeError(error) },
        "last write of pending policy events failed",
      );
    }
    const pending = this.sink.pendingCount();
    this.safeLog(
      pending > 0 ? "error" : "info",
      { pendingEvents: pending },
      pending > 0
        ? "hedging stopped with policy events not written: the next start rebuilds from the database"
        : "hedging stopped",
    );
  }

  // -------------------------------------------------------------------------------------------
  // Books and trades
  // -------------------------------------------------------------------------------------------

  /** Every book and trade goes to the venue first (it fills resting makers), then to the runner. */
  private onBookFeedEvent(event: BookFeedEvent): void {
    if (this.stopped) return;
    try {
      if (event.kind === "book") {
        this.feedVenueBook(event.book);
        const entry = this.entries.get(event.book.instrumentSymbol);
        if (entry !== undefined) {
          this.track(entry.runner.onBook(event.book), "runner book", event.book.instrumentSymbol);
        }
        return;
      }
      if (this.venue instanceof PaperVenue) this.venue.onTrade(event.trade);
      const entry = this.entries.get(event.trade.instrumentSymbol);
      if (entry !== undefined) {
        this.track(entry.runner.onTrade(event.trade), "runner trade", event.trade.instrumentSymbol);
      }
    } catch (error: unknown) {
      this.safeLog(
        "error",
        { err: describeError(error), kind: event.kind },
        "book feed event could not be applied",
      );
    }
  }

  private feedVenueBook(book: Book): void {
    if (this.venue instanceof PaperVenue) this.venue.onBook(book);
  }

  // -------------------------------------------------------------------------------------------
  // Instruments and runners
  // -------------------------------------------------------------------------------------------

  /**
   * Reads the instruments and the exposure; starts, feeds and retires runners. Settled campaigns'
   * contracts leave H within this pass: through the live runner (`handRead`), or, for an
   * instrument left without a runner, straight in `positions.held` (`writeDerivedHeld`).
   */
  async syncInstruments(): Promise<void> {
    if (!this.ready || this.stopped) return;
    const rows = await listHedgeInstruments(this.db);
    const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
    const needed = new Set<string>();
    for (const row of rows) {
      if (!needsRunner(row)) continue;
      needed.add(row.symbol);
      try {
        await this.syncInstrument(row);
      } catch (error: unknown) {
        this.safeLog(
          "error",
          { instrument: row.symbol, err: describeError(error) },
          "instrument could not be synchronised: retried at the next pass",
        );
      }
    }
    for (const [symbol, entry] of this.entries) {
      if (needed.has(symbol)) continue;
      try {
        if (entry.reconciling !== null || entry.runner.snapshot().openOrders.length > 0) {
          // Kept for its orders: it still stops counting what settled.
          const row = bySymbol.get(symbol);
          if (row !== undefined) await this.followSettlements(entry, row);
          continue;
        }
        await this.retire(symbol, entry);
      } catch (error: unknown) {
        this.safeLog(
          "error",
          { instrument: symbol, err: describeError(error) },
          "runner could not be retired",
        );
      }
    }
    for (const row of rows) {
      // Every campaign settled and no runner: nothing is traded, and `positions.held` (the desk's
      // totals, the next start) follows the recorded fills, settled allocations left out.
      if (needsRunner(row) || row.unsettledCampaigns > 0) continue;
      if (this.entries.has(row.symbol) || this.creating.has(row.symbol)) continue;
      if (row.held === row.derivedHeld || this.sink.pendingCount(row.symbol) > 0) continue;
      try {
        if (await writeDerivedHeld(this.db, row.symbol)) {
          this.logger.info(
            {
              instrument: row.symbol,
              heldBefore: row.held.toString(),
              held: row.derivedHeld.toString(),
              settledAllocated: row.settledAllocated.toString(),
            },
            "every campaign of the instrument settled: their contracts are no longer held",
          );
        }
      } catch (error: unknown) {
        this.safeLog(
          "error",
          { instrument: row.symbol, err: describeError(error) },
          "held position of a settled instrument not written: retried at the next pass",
        );
      }
    }
  }

  private async syncInstrument(row: HedgeInstrumentRow): Promise<void> {
    const entry = await this.ensureEntry(row);
    const handed = this.handRead(entry, row);
    // Older than what the runner has (a finalize read after it, or a runner restored after it):
    // nothing in it is news, and the next pass reads anew.
    if (!handed.applied) return;
    entry.info = infoOf(row);
    // A new lot: contracts already held ahead of exposure cover it without a new order.
    if (row.exposure > handed.previousExposure || handed.released > 0n) {
      await this.allocateInventory(row.symbol);
    }
    await this.flushHeldRelease(entry);
    if (
      salesOver(row, this.clock.now()) &&
      entry.reconciledAtExposure !== row.exposure &&
      entry.reconciling === null
    ) {
      // It reconciles against what the runner has when it starts: never against this read, which
      // a newer one (a finalize's, during the awaits above) may already have replaced.
      const run = this.claimReconcile(entry, () => this.reconcileAtSalesClose(entry));
      this.track(run, "sales-close reconciliation", row.symbol);
    }
  }

  /**
   * Hands one read of the exposure ledger to the runner, which applies it unless it already has a
   * newer one (`PolicyRunner.onExposureRead`): E becomes the read's, and the campaigns of the
   * instrument that settled since the runner last heard (the settled allocation the read has
   * beyond the runner's) leave H in the same step. Every caller (the exposure pass, `finalize`,
   * a runner kept for its orders) goes through here, so the guard is the runner's own and a stale
   * read can never set an older E, nor release a settlement twice. Synchronous: the outcome is what
   * the runner now has. The runner is told rather than rebuilt: a rebuild stops it, and a fill of
   * an order resting at the venue between that stop and the new runner's start would reach no
   * listener, coming back only as a recovered position, never recorded nor allocated to a lot.
   */
  private handRead(entry: Entry, row: HedgeInstrumentRow): ExposureReadOutcome {
    const outcome = entry.runner.onExposureRead({
      exposure: row.exposure,
      settledAllocated: row.settledAllocated,
      asOf: row.asOf,
    });
    if (outcome.applied && outcome.released > 0n) {
      entry.heldToRelease += outcome.released;
      this.logger.info(
        {
          instrument: row.symbol,
          released: outcome.released.toString(),
          settledAllocated: row.settledAllocated.toString(),
          exposure: row.exposure.toString(),
        },
        "campaigns settled: the contracts allocated to their lots are no longer held",
      );
    }
    return outcome;
  }

  /** Takes what `handRead` released out of `positions.held`; kept for a retry on failure. */
  private async flushHeldRelease(entry: Entry): Promise<void> {
    const qty = entry.heldToRelease;
    if (qty <= 0n) return;
    entry.heldToRelease = 0n;
    // A retired runner owns `positions.held` no more: the derived write, or the next runner's
    // restore, sets it from the recorded fills.
    if (this.entries.get(entry.info.symbol) !== entry) return;
    try {
      await releaseSettledHeld(this.db, entry.info.symbol, qty);
    } catch (error: unknown) {
      entry.heldToRelease += qty;
      throw error;
    }
  }

  /**
   * `handRead` (a read older than the runner's changes nothing), then the write of what it
   * released. The runner has the read's settlements, or newer ones, as soon as this is called.
   */
  private async followSettlements(entry: Entry, row: HedgeInstrumentRow): Promise<void> {
    this.handRead(entry, row);
    await this.flushHeldRelease(entry);
  }

  /**
   * Runs `work` as the instrument's reconciliation: `entry.reconciling` is set until it ends, so
   * the sales-close pass and `finalize` never reconcile one runner at the same time. The caller
   * must have seen `entry.reconciling === null` without awaiting since.
   */
  private claimReconcile<T>(entry: Entry, work: () => Promise<T>): Promise<T> {
    const run = work();
    const slot: Promise<void> = run
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (entry.reconciling === slot) entry.reconciling = null;
      });
    entry.reconciling = slot;
    return run;
  }

  /** The entry of an instrument, creating and starting its runner the first time. */
  private async ensureEntry(row: HedgeInstrumentRow): Promise<Entry> {
    const existing = this.entries.get(row.symbol);
    if (existing !== undefined) return existing;
    const pending = this.creating.get(row.symbol);
    if (pending !== undefined) return pending;
    const creation = this.createEntry(row).finally(() => {
      this.creating.delete(row.symbol);
    });
    this.creating.set(row.symbol, creation);
    return creation;
  }

  /**
   * Rebuilds a runner from the database (exposure, held from the recorded fills less what settled
   * campaigns were allocated, next order sequence, orders still open), hands it the latest book,
   * and starts it.
   */
  private async createEntry(row: HedgeInstrumentRow): Promise<Entry> {
    if (this.stopped) throw new HedgingStoppedError(`starting the runner of ${row.symbol}`);
    const risk = await loadRiskParams(this.db, this.logger);
    const prefix = orderIdPrefix(row.symbol);
    const state = await loadRestoreState(this.db, row.symbol, this.venue.name, prefix);
    await resetPosition(this.db, row.symbol, state.held, this.venue.name);
    const runner = new PolicyRunner({
      instrumentSymbol: row.symbol,
      eventStartMs: row.eventStartsAt.getTime(),
      venue: this.venue,
      clock: this.clock,
      logger: this.logger,
      idPrefix: prefix,
      params: policyParamsOf(risk),
      breakerParams: this.breakerParams,
      sink: this.sink,
      restore: {
        exposure: state.exposure,
        held: state.held,
        nextOrderSeq: state.nextOrderSeq,
        // Open orders as the database has them. The paper venue lost those of a previous process
        // (marked cancelled at startup), so only orders of this process can still be listed here.
        unsettledOrders: state.openOrders,
        // The read `exposure` and `held` come from: a read older than it is ignored.
        settledAllocated: state.settledAllocated,
        asOf: state.asOf,
      },
    });
    const entry: Entry = {
      info: infoOf(row),
      runner,
      heldToRelease: 0n,
      reconciledAtExposure: null,
      reconciling: null,
    };
    const book = this.bookFeed.getBook(row.symbol);
    if (book !== null) {
      this.feedVenueBook(book);
      await runner.onBook(book);
    }
    this.entries.set(row.symbol, entry);
    await runner.start();
    this.logger.info(
      {
        instrument: row.symbol,
        idPrefix: prefix,
        exposure: state.exposure.toString(),
        held: state.held.toString(),
        settledAllocated: state.settledAllocated.toString(),
        nextOrderSeq: state.nextOrderSeq,
        openOrders: state.openOrders.length,
        params: { ...risk, uMaxMicroUsdc: risk.uMaxMicroUsdc.toString() },
      },
      "hedging runner started",
    );
    await this.allocateInventory(row.symbol);
    return entry;
  }

  private async retire(symbol: string, entry: Entry): Promise<void> {
    await entry.runner.stop();
    this.entries.delete(symbol);
    this.lastDeskWriteMs.delete(symbol);
    await this.desk.remove(symbol);
    this.logger.info({ instrument: symbol }, "hedging runner retired: nothing left to hedge");
  }

  private async allocateInventory(instrument: string): Promise<void> {
    const outcome = await allocateHeldInventory(this.db, instrument);
    if (outcome.allocations.length > 0) {
      this.logger.info(
        {
          instrument,
          allocations: outcome.allocations.length,
          coveredLots: outcome.coveredLots.length,
        },
        "inventory held ahead of exposure allocated to new lots",
      );
    }
    if (outcome.coveredLots.length > 0) this.requestCharge();
  }

  private onFillRecorded(event: FillRecorded): void {
    if (event.result.coveredLots.length > 0) this.requestCharge();
  }

  // -------------------------------------------------------------------------------------------
  // Tick: timers of the runners, retries of the sink, the desk
  // -------------------------------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (!this.ready || this.stopped) return;
    for (const [symbol, entry] of this.entries) {
      this.track(entry.runner.onTick(), "runner tick", symbol);
    }
    await this.sink.retryPending();
    for (const [symbol, entry] of this.entries) {
      try {
        const snapshot = entry.runner.snapshot();
        await writeWorking(this.db, symbol, snapshot.working);
        const nowMs = Date.now();
        if (nowMs - (this.lastDeskWriteMs.get(symbol) ?? 0) < this.deskMinIntervalMs) continue;
        // The runner may have been retired while this tick awaited (the exposure loop runs
        // beside it): a row written for it now would outlive its removal.
        if (this.entries.get(symbol) !== entry) continue;
        if (await this.desk.write(entry.info, snapshot)) {
          this.lastDeskWriteMs.set(symbol, nowMs);
          if (!this.entries.has(symbol)) await this.desk.remove(symbol);
        }
      } catch (error: unknown) {
        this.safeLog(
          "error",
          { instrument: symbol, err: describeError(error) },
          "hedge desk not written",
        );
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Sales close (HE-6) and the finalizer
  // -------------------------------------------------------------------------------------------

  /**
   * The last campaign selling on the instrument is past its sales close: reconcile once, wait for
   * it, then charge every remaining lot of the closed campaigns.
   */
  private async reconcileAtSalesClose(entry: Entry): Promise<void> {
    const symbol = entry.info.symbol;
    const reconciled = await this.reconcile(entry);
    if (!reconciled.ok) {
      this.logger.warn(
        { instrument: symbol, detail: reconciled.detail },
        "sales-close reconciliation not complete: retried at the next pass",
      );
      return;
    }
    const { exposure } = reconciled;
    entry.reconciledAtExposure = exposure;
    await this.allocateInventory(symbol);
    const campaigns = await closedCampaignsOf(this.db, symbol, this.clock.now());
    const charged = await this.charger.chargeRemaining(campaigns);
    this.logger.info(
      {
        instrument: symbol,
        exposure: exposure.toString(),
        held: entry.runner.snapshot().held.toString(),
        campaigns: campaigns.length,
        chargesQueued: charged.queued,
        ticketsCharged: charged.tickets,
      },
      "sales closed: position reconciled and remaining lots charged",
    );
  }

  /**
   * Calls the runner's `reconcile()` and waits until it is no longer pending, every fill of it is
   * written, and no order is open. `ok` once |H − E| ≤ one step, with the E reconciled against.
   * It waits `reconcileTimeoutMs` at most, and never past `notAfter` (epoch ms) when one is given:
   * the deadline of the `finalize` it runs for.
   *
   * It hands the runner no exposure: E is the runner's own, from the newest read any caller handed
   * it (`handRead`). An exposure passed in here would have been read before the reconciliation
   * slot was free, and a pass may have applied a newer one (a settlement) meanwhile.
   */
  private async reconcile(
    entry: Entry,
    notAfter?: number,
  ): Promise<{ ok: true; exposure: bigint } | { ok: false; detail: string }> {
    const { runner } = entry;
    const symbol = entry.info.symbol;
    await this.testHooks.beforeReconcile?.(symbol);
    await runner.reconcile();
    const own = Date.now() + this.reconcileTimeoutMs;
    const deadline = notAfter === undefined ? own : Math.min(own, notAfter);
    for (;;) {
      const snapshot = runner.snapshot();
      const settled =
        !snapshot.reconcilePending &&
        snapshot.openOrders.length === 0 &&
        this.sink.pendingCount(symbol) === 0;
      if (settled && withinOneStep(snapshot.held, snapshot.exposure)) {
        return { ok: true, exposure: snapshot.exposure };
      }
      if (this.signal.aborted) throw new HedgingStoppedError(`reconciling ${symbol}`);
      if (Date.now() >= deadline) {
        return {
          ok: false,
          detail:
            `held ${snapshot.held.toString()}, exposure ${snapshot.exposure.toString()}, ` +
            `pending ${String(snapshot.reconcilePending)}, open orders ${snapshot.openOrders.length.toString()}, ` +
            `breaker ${snapshot.breaker.reason ?? "off"}, stale ${String(snapshot.stale)}`,
        };
      }
      await abortableSleep(RECONCILE_POLL_MS, this.signal);
    }
  }

  /**
   * `HedgeFinalizer.finalize` (settlement lane): makes sure the instrument is reconciled, charges
   * every remaining lot of the campaign on-chain and waits for those transactions. Idempotent: on
   * a campaign already finalized it finds nothing to charge and returns.
   *
   * One deadline, `finalizeTimeoutMs` from the call: the reconciliation and the wait for the
   * charges share it, so a call never runs much longer than that (one database round or poll
   * past it at most), however long the reconciliation took.
   *
   * Throws `HedgeNotReconciledError` when the position cannot be brought within one step (no book,
   * stale book, breaker) by the deadline, `HedgeFinalizeError` when charges are not final by it,
   * and `HedgingStoppedError` once the service stops. All are retryable.
   */
  async finalize(campaign: FinalizeCampaign): Promise<void> {
    if (this.stopped || this.signal.aborted) throw new HedgingStoppedError("finalizing");
    if (!this.ready) throw new HedgeFinalizeError(campaign.id, "the service is still starting");
    const deadline = Date.now() + this.finalizeTimeoutMs;
    await this.reconcileForFinalize(campaign, deadline);
    await this.allocateInventory(campaign.instrument);

    for (let round = 1; ; round += 1) {
      await this.charger.chargeRemaining([campaign.id]);
      await this.waitForCharges(campaign, deadline);
      await this.charger.recordMinedLosses();
      const { open, refused } = await this.charger.classify(
        await remainingLots(this.db, [campaign.id]),
      );
      if (refused.length > 0) {
        // The escrow refused these for good while their reservation is still held: settle
        // would revert (hedgeReserved is not zero). A defect upstream: never reported as done.
        throw new HedgeFinalizeError(
          campaign.id,
          `the escrow refused ${refused
            .map((item) => `ticket ${item.lot.ticketOnchainId.toString()} (${item.reason})`)
            .join(", ")} for good: their reservations are still held`,
        );
      }
      if (open.length === 0) {
        this.logger.info(
          { campaignId: campaign.id, campaignOnchainId: campaign.onchainId.toString() },
          "campaign hedges finalized: every ticket charged",
        );
        return;
      }
      if (Date.now() >= deadline) {
        throw new HedgeFinalizeError(
          campaign.id,
          `${open.length.toString()} ticket(s) still uncharged after ${round.toString()} round(s)`,
        );
      }
      if (round % FINALIZE_WARN_ROUNDS === 1) {
        this.logger.warn(
          { campaignId: campaign.id, round, left: open.length },
          "campaign hedges not all charged yet: charging again",
        );
      }
      await abortableSleep(CHARGE_POLL_MS, this.signal);
      if (this.signal.aborted) throw new HedgingStoppedError("finalizing");
    }
  }

  /**
   * The reconciliation part of `finalize`. One reconciliation at a time per runner: while one is
   * running (the sales-close pass's, or another finalize's), it waits for it, then reads the
   * instrument AGAIN. Whatever it reconciles against is read after its last wait: a settlement of
   * another campaign applied meanwhile is never undone by an exposure read before it, and the
   * runner ignores the read if it already has a newer one. Campaigns settled since the last pass
   * leave H with their lots' exposure before the reconciliation compares the two: never a sale of
   * contracts the venue paid out. The reconciliation then runs against the runner's own E, the
   * newest any caller handed it. Every wait in it ends at `deadline` (epoch ms), the deadline of
   * the `finalize` call.
   */
  private async reconcileForFinalize(campaign: FinalizeCampaign, deadline: number): Promise<void> {
    for (;;) {
      if (this.stopped || this.signal.aborted) throw new HedgingStoppedError("finalizing");
      const row = await getHedgeInstrument(this.db, campaign.instrument);
      if (row === null) return;
      const entry = needsRunner(row) ? await this.ensureEntry(row) : this.entries.get(row.symbol);
      if (entry === undefined) return;
      if (entry.reconciling !== null) {
        if (!(await this.waitUntil(entry.reconciling, deadline))) {
          throw new HedgeNotReconciledError(
            campaign.instrument,
            "another reconciliation of the instrument kept running until the finalizer's deadline",
          );
        }
        continue;
      }
      // The settlement guard: campaigns settled since the runner last heard leave H with their
      // lots' exposure, before the reconciliation compares the two.
      await this.followSettlements(entry, row);
      // A reconciliation started during that write: wait for it, and read again.
      if (entry.reconciling !== null) continue;
      // Every campaign settled and only orders left: nothing to reconcile, only to follow.
      if (!needsRunner(row)) return;
      if (entry.reconciledAtExposure === entry.runner.snapshot().exposure) return;
      if (Date.now() >= deadline) {
        throw new HedgeNotReconciledError(
          campaign.instrument,
          "the finalizer's deadline passed before its reconciliation could start",
        );
      }
      const reconciled = await this.claimReconcile(entry, async () => {
        const outcome = await this.reconcile(entry, deadline);
        if (outcome.ok) entry.reconciledAtExposure = outcome.exposure;
        return outcome;
      });
      if (!reconciled.ok) throw new HedgeNotReconciledError(campaign.instrument, reconciled.detail);
      return;
    }
  }

  /**
   * Waits for `work` until `deadline` (epoch ms): true once it settled, false when the deadline
   * came first (`work` goes on; only the wait ends). Throws `HedgingStoppedError` on a stop.
   */
  private async waitUntil(work: Promise<void>, deadline: number): Promise<boolean> {
    const timer = new AbortController();
    const onAbort = (): void => timer.abort();
    this.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const settled = await Promise.race([
        work.then(
          () => true,
          () => true,
        ),
        abortableSleep(deadline - Date.now(), timer.signal).then(() => false),
      ]);
      if (!settled && this.signal.aborted) throw new HedgingStoppedError("finalizing");
      return settled;
    } finally {
      timer.abort();
      this.signal.removeEventListener("abort", onAbort);
    }
  }

  /** Waits until no `chargeHedge` holding a ticket of the campaign is queued or sent. */
  private async waitForCharges(campaign: FinalizeCampaign, deadline: number): Promise<void> {
    for (;;) {
      const [row] = await this.db<{ n: bigint }[]>`
        select count(*)::bigint as n from chain_txs x
        where x.kind = 'chargeHedge' and x.status in ('queued', 'sent')
          and x.payload -> 'ticketIds' ?| array(
            select t.onchain_id::text from tickets t
            where t.campaign_id = ${campaign.id} and t.onchain_id is not null
          )
      `;
      if ((row?.n ?? 0n) === 0n) return;
      if (this.signal.aborted) throw new HedgingStoppedError("waiting for hedge charges");
      if (Date.now() >= deadline) {
        throw new HedgeFinalizeError(
          campaign.id,
          `${(row?.n ?? 0n).toString()} chargeHedge transaction(s) still pending`,
        );
      }
      await abortableSleep(CHARGE_POLL_MS, this.signal);
    }
  }
}

function infoOf(row: HedgeInstrumentRow): DeskInstrumentInfo {
  return {
    symbol: row.symbol,
    label: row.label,
    eventTitle: row.eventTitle,
    eventStartsAt: row.eventStartsAt,
  };
}
