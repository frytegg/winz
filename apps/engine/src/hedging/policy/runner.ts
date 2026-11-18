import { BPS, CONTRACT_STEP_MICRO, ceilToContractStep, mulDivUp } from "@winz/shared";
import type { Book, Bps, MicroContracts, MicroUsdc, OrderKind } from "@winz/shared";
import type { Logger } from "pino";

import type {
  ExecutionVenue,
  OrderSide,
  PlaceOrderRequest,
  PlaceOrderResult,
  TradePrint,
  VenueClock,
  VenueEvent,
  VenueFill,
  VenueOrder,
} from "../../venues";
import { INITIAL_BREAKER_STATE, resolveBreakerParams, stepBreaker } from "./breaker";
import type { BreakerParams, BreakerReason, BreakerState } from "./breaker";
import {
  bestAskBps,
  bestBidBps,
  decide,
  placingBlockedReason,
  unhedgedExcessCurable,
} from "./decide";
import type { PolicyAction, PolicyActionReason, PolicyOrder, PolicyState } from "./decide";
import { PolicyInputError } from "./errors";
import type { PolicyEvent, PolicyEventSink } from "./events";
import { resolvePolicyParams } from "./params";
import type { PolicyParams } from "./params";

/** State handed to a runner that replaces one that stopped or crashed. */
export interface PolicyRestore {
  /** E as the exposure ledger has it. */
  exposure: MicroContracts;
  /** H as the persisted fills have it. */
  held: MicroContracts;
  /** One more than the highest sequence ever used in a client order id of this prefix. */
  nextOrderSeq: number;
  /**
   * Every order the persistence layer recorded as open or unconfirmed, with the quantity its
   * recorded fills add up to. Each is looked up at the venue: fills missed meanwhile correct H.
   * An open order of this prefix at the venue that is not listed here is unknown to the
   * persistence layer: none of its fills is in `held`, so all of them are recovered.
   */
  unsettledOrders?: readonly { clientOrderId: string; recordedFilledQty: MicroContracts }[];
  /**
   * The quantity allocated to the lots of the instrument's settled campaigns that `held` already
   * leaves out, read with `exposure`. `onExposureRead` releases only what a read has beyond it.
   * Defaults to 0.
   */
  settledAllocated?: MicroContracts;
  /** Version of the read `exposure` and `settledAllocated` come from (`ExposureRead.asOf`). */
  asOf?: bigint;
}

/**
 * One read of the exposure ledger, as the owner hands it to the runner (`onExposureRead`): E, the
 * settled allocation of the same read, and the read's version.
 */
export interface ExposureRead {
  /** E: the total exposure of every unsettled campaign of the instrument (HE-3). */
  exposure: MicroContracts;
  /**
   * Quantity allocated to the lots of the instrument's settled campaigns, read in the same
   * statement as `exposure`: contracts the venue paid out. It only ever grows.
   */
  settledAllocated: MicroContracts;
  /**
   * Where the read stands in time: a read that sees everything an earlier one saw never has a
   * lower version. Two reads with the same version saw the same data.
   */
  asOf: bigint;
}

/** What the runner did with an `ExposureRead`. */
export type ExposureReadOutcome =
  | {
      applied: true;
      /** Contracts the read's new settlements released from H (0 when it brought none). */
      released: MicroContracts;
      /** E before the read. */
      previousExposure: MicroContracts;
      /** Whether E or H changed: a cycle was requested only then. */
      changed: boolean;
    }
  | {
      applied: false;
      /**
       * `older_read`: the read is older than one the runner already has. `older_settlements`: it
       * knows fewer settlements than the runner already applied. Either way E and H are left as
       * they are: the runner's are newer.
       */
      reason: "older_read" | "older_settlements";
    };

export interface PolicyRunnerOptions {
  instrumentSymbol: string;
  /** When the event starts, epoch ms. */
  eventStartMs: number;
  venue: ExecutionVenue;
  clock: VenueClock;
  logger: Logger;
  /**
   * Prefix of every client order id, `<prefix>-<seq>`. Unique per instrument and venue account,
   * so a runner never mistakes another runner's orders for its own. Letters, digits, `_.:` only.
   */
  idPrefix: string;
  params?: Partial<PolicyParams>;
  breakerParams?: Partial<BreakerParams>;
  sink?: PolicyEventSink;
  restore?: PolicyRestore;
}

/** What the Hedge desk shows for the instrument (`hedgeInstrumentSchema`). */
export interface PolicyRunnerSnapshot {
  instrumentSymbol: string;
  exposure: MicroContracts;
  held: MicroContracts;
  /** W: what resting maker buys may still fill. */
  working: MicroContracts;
  /** (E − H) × best ask, micro-USDC, rounded up; null without a book. */
  unhedgedNotional: MicroUsdc | null;
  bidBps: Bps | null;
  askBps: Bps | null;
  bookObservedAtMs: number | null;
  stale: boolean;
  breaker: { active: boolean; reason: BreakerReason | null };
  openOrders: readonly PolicyOrder[];
  nextOrderSeq: number;
  reconcilePending: boolean;
}

export interface ReconcileOutcome {
  /** False when placing was blocked (breaker, no book, stale book): reconciliation stays pending. */
  attempted: boolean;
  exposure: MicroContracts;
  held: MicroContracts;
  /** |H − E| ≤ one 0.01 contract step. */
  withinOneStep: boolean;
}

type TrackedStatus = "pending" | "unconfirmed" | "open";

interface TrackedOrder {
  clientOrderId: string;
  side: OrderSide;
  kind: OrderKind;
  limitPriceBps: Bps;
  qty: MicroContracts;
  /** Filled quantity as the latest order snapshot reports it. */
  snapshotFilledQty: MicroContracts;
  /** Filled quantity as the fills received add up to. */
  fillsQty: MicroContracts;
  placedAtMs: number;
  askAtPlacementBps: Bps | null;
  status: TrackedStatus;
  reason: PolicyActionReason | "adopted";
}

const OPEN_STATUSES = new Set(["working", "partially_filled"]);
const ID_PREFIX_PATTERN = /^[A-Za-z0-9_.:]+$/;

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function remainingOf(order: TrackedOrder): MicroContracts {
  const filled = maxBig(order.snapshotFilledQty, order.fillsQty);
  return order.qty > filled ? order.qty - filled : 0n;
}

/**
 * Runs the execution policy of one instrument against an `ExecutionVenue` (SPEC 9.3, HE-2, HE-3,
 * HE-5, HE-6). It owns no database: it is fed books, trades, exposure changes and clock ticks,
 * and reports through a `PolicyEventSink` what the persistence layer needs.
 *
 * - Serialised: inputs update the state at once and request a cycle; one cycle runs at a time,
 *   and inputs arriving during a cycle are coalesced into the next one (close sales become one
 *   order, HE-3). Each cycle calls `decide` exactly once, on one consistent snapshot.
 * - Deterministic ids `<idPrefix>-<seq>`, persisted ahead of the placement (`order_intent`). A
 *   placement whose call threw stays counted as open ("unconfirmed") and is looked up by id on
 *   the next cycles, so it is never placed twice.
 * - H and W are tracked from the venue's fills and order updates, fills de-duplicated by id.
 * - Never throws for a market or venue reason: rejections and failures are logged, reported and
 *   fed to the circuit breaker.
 */
export class PolicyRunner {
  readonly instrumentSymbol: string;
  private readonly eventStartMs: number;
  private readonly venue: ExecutionVenue;
  private readonly clock: VenueClock;
  private readonly logger: Logger;
  private readonly idPrefix: string;
  private readonly params: Readonly<PolicyParams>;
  private readonly breakerParams: Readonly<BreakerParams>;
  private readonly sink: PolicyEventSink | null;
  private readonly restoreInput: PolicyRestore | null;
  private readonly startedAtMs: number;

  private exposure: MicroContracts;
  private held: MicroContracts;
  /** Version of the newest `ExposureRead` applied (or of the restore); null before any. */
  private readAsOf: bigint | null;
  /** Settled allocation that H already leaves out (`ExposureRead.settledAllocated`). */
  private settledAllocated: MicroContracts;
  private nextOrderSeq: number;
  private book: Book | null = null;
  private breaker: BreakerState = INITIAL_BREAKER_STATE;
  private readonly orders = new Map<string, TrackedOrder>();
  private readonly closedIds = new Set<string>();
  private readonly seenFillIds = new Set<string>();
  /**
   * Per order, how much of its filled quantity H already counts: the recorded fills at a restore,
   * then every fill and recovery applied. A fill only adds what lies beyond it, so a fill that a
   * restore snapshot already recovered is never counted twice.
   */
  private readonly countedFillQty = new Map<string, MicroContracts>();
  /** Quantity of every order of ours the runner has seen: places a fill within its order. */
  private readonly orderQty = new Map<string, MicroContracts>();
  /** Venue events received while restoring: applied once the restore has read the venue. */
  private bufferedEvents: VenueEvent[] = [];
  private venueOutcomes: ("success" | "failure")[] = [];
  private outbox: PolicyEvent[] = [];
  private restored = false;
  private reconcileRequested = false;
  private lastReconcile: ReconcileOutcome | null = null;
  private unsubscribe: (() => void) | null = null;
  private loop: Promise<void> | null = null;
  private rerun = false;
  /**
   * Orders the runner is placing or cancelling right now. Venue events about them are applied but
   * request no new cycle: the call's own result is handled by the cycle that made it. Without
   * this, a venue that rejects every placement (or a taker that fills nothing) would make each
   * cycle request the next one, forever.
   */
  private readonly inFlightIds = new Set<string>();

  constructor(options: PolicyRunnerOptions) {
    if (options.instrumentSymbol.length === 0) {
      throw new PolicyInputError("instrumentSymbol must not be empty");
    }
    if (!ID_PREFIX_PATTERN.test(options.idPrefix)) {
      throw new PolicyInputError(
        `idPrefix must match ${ID_PREFIX_PATTERN.source}, got "${options.idPrefix}"`,
      );
    }
    if (!Number.isFinite(options.eventStartMs)) {
      throw new PolicyInputError("eventStartMs must be a finite number");
    }
    const restore = options.restore ?? null;
    if (restore !== null) {
      if (restore.exposure < 0n || restore.held < 0n || (restore.settledAllocated ?? 0n) < 0n) {
        throw new PolicyInputError(
          "restore: exposure, held and settledAllocated must not be negative",
        );
      }
      if (!Number.isSafeInteger(restore.nextOrderSeq) || restore.nextOrderSeq < 1) {
        throw new PolicyInputError("restore: nextOrderSeq must be an integer >= 1");
      }
    }
    this.instrumentSymbol = options.instrumentSymbol;
    this.eventStartMs = options.eventStartMs;
    this.venue = options.venue;
    this.clock = options.clock;
    this.logger = options.logger.child({
      module: "hedging.policy",
      instrumentSymbol: options.instrumentSymbol,
    });
    this.idPrefix = options.idPrefix;
    this.params = resolvePolicyParams(options.params);
    this.breakerParams = resolveBreakerParams(options.breakerParams);
    this.sink = options.sink ?? null;
    this.restoreInput = restore;
    this.exposure = restore?.exposure ?? 0n;
    this.held = restore?.held ?? 0n;
    this.settledAllocated = restore?.settledAllocated ?? 0n;
    this.readAsOf = restore?.asOf ?? null;
    this.nextOrderSeq = restore?.nextOrderSeq ?? 1;
    this.startedAtMs = this.nowMs();
  }

  /**
   * Subscribes to the venue and runs the first cycle, which adopts the venue's open orders of this
   * prefix (and settles `restore.unsettledOrders`) before anything is decided. Venue events that
   * arrive while that restore reads the venue are held and applied once it has.
   *
   * Nothing is decided or placed before `start`: `onBook`, `onExposure`, `onTrade` and `onTick`
   * only record their input until then, since an order placed before the runner listens to the
   * venue could fill unseen. The owner should hand the latest book (`onBook`) before starting: a
   * decision without a book cancels every resting maker, adopted ones included, since no order
   * may rest on a market the runner cannot see.
   */
  async start(): Promise<void> {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.venue.onEvent((event) => {
      this.onVenueEvent(event);
    });
    await this.schedule();
  }

  /** True between `start` and `stop`: only then are cycles run. */
  isStarted(): boolean {
    return this.unsubscribe !== null;
  }

  /** Unsubscribes from the venue once the cycle in progress has finished. */
  async stop(): Promise<void> {
    if (this.loop !== null) await this.loop;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.flushOutbox();
  }

  /** A new book of the instrument. An older book than the one held is ignored. */
  async onBook(book: Book): Promise<void> {
    if (book.instrumentSymbol !== this.instrumentSymbol) {
      throw new PolicyInputError(
        `runner of ${this.instrumentSymbol} received a book of ${book.instrumentSymbol}`,
      );
    }
    if (this.book === null || book.observedAtMs >= this.book.observedAtMs) this.book = book;
    await this.requestCycle();
  }

  /** A public trade. The venue fills makers from it; the runner re-evaluates afterwards. */
  async onTrade(trade: TradePrint): Promise<void> {
    if (trade.instrumentSymbol !== this.instrumentSymbol) {
      throw new PolicyInputError(
        `runner of ${this.instrumentSymbol} received a trade of ${trade.instrumentSymbol}`,
      );
    }
    await this.requestCycle();
  }

  /**
   * E changed: the total exposure of every campaign of the instrument (HE-3). Unversioned, so not
   * guarded: an owner that reads E from the exposure ledger, beside other readers, hands it with
   * its version through `onExposureRead` instead.
   */
  async onExposure(exposure: MicroContracts): Promise<void> {
    if (typeof exposure !== "bigint" || exposure < 0n) {
      throw new PolicyInputError(`exposure must be a bigint >= 0, got ${String(exposure)}`);
    }
    this.exposure = exposure;
    await this.requestCycle();
  }

  /**
   * Campaigns of the instrument settled: the venue paid out the `releasedQty` contracts that were
   * allocated to their lots, so H stops counting them (never below zero), and E becomes
   * `exposure` (their lots left it in the same projection). Both change in one step, before any
   * cycle sees either: a cycle never sees E lowered with H not (a reconciliation would sell the
   * difference), nor H lowered with E not (it would buy it). Nothing is placed, sold or cancelled
   * for it, and orders are left as they are: an order resting at that instant keeps adding each
   * of its fills to H exactly once.
   */
  async onSettled(releasedQty: MicroContracts, exposure: MicroContracts): Promise<void> {
    if (typeof releasedQty !== "bigint" || releasedQty < 0n) {
      throw new PolicyInputError(
        `released quantity must be a bigint >= 0, got ${String(releasedQty)}`,
      );
    }
    if (typeof exposure !== "bigint" || exposure < 0n) {
      throw new PolicyInputError(`exposure must be a bigint >= 0, got ${String(exposure)}`);
    }
    this.settledAllocated += releasedQty;
    this.release(releasedQty, exposure);
    await this.requestCycle();
  }

  /**
   * A read of the exposure ledger (`ExposureRead`): the guard every owner goes through. A read
   * older than one the runner already has (a lower `asOf`), or one that knows fewer settlements
   * than the runner already applied, is ignored: handing it on would set an E older than the
   * runner's, and a cycle would buy back what a settlement just released (or sell what a sale just
   * added). Otherwise E becomes the read's, and the contracts its new settlements released leave H
   * in the same step (`onSettled`), before any cycle sees either.
   *
   * Synchronous: the decision and the state change are made before it returns, so an owner that
   * reads the outcome knows what the runner has. A cycle is requested (not awaited) when E or H
   * changed; `stop` waits for it.
   */
  onExposureRead(read: ExposureRead): ExposureReadOutcome {
    if (typeof read.exposure !== "bigint" || read.exposure < 0n) {
      throw new PolicyInputError(`exposure must be a bigint >= 0, got ${String(read.exposure)}`);
    }
    if (typeof read.settledAllocated !== "bigint" || read.settledAllocated < 0n) {
      throw new PolicyInputError(
        `settled allocation must be a bigint >= 0, got ${String(read.settledAllocated)}`,
      );
    }
    if (typeof read.asOf !== "bigint") {
      throw new PolicyInputError(`read version must be a bigint, got ${String(read.asOf)}`);
    }
    const stale: "older_read" | "older_settlements" | null =
      this.readAsOf !== null && read.asOf < this.readAsOf
        ? "older_read"
        : read.settledAllocated < this.settledAllocated
          ? "older_settlements"
          : null;
    if (stale !== null) {
      this.logger.info(
        {
          reason: stale,
          readAsOf: read.asOf.toString(),
          runnerAsOf: this.readAsOf?.toString() ?? null,
          readExposure: read.exposure.toString(),
          exposure: this.exposure.toString(),
          readSettledAllocated: read.settledAllocated.toString(),
          settledAllocated: this.settledAllocated.toString(),
        },
        "exposure read older than what the runner has: ignored",
      );
      return { applied: false, reason: stale };
    }
    const previousExposure = this.exposure;
    const previousHeld = this.held;
    const released = read.settledAllocated - this.settledAllocated;
    this.readAsOf = read.asOf;
    this.settledAllocated = read.settledAllocated;
    if (released > 0n) this.release(released, read.exposure);
    else this.exposure = read.exposure;
    const changed = this.exposure !== previousExposure || this.held !== previousHeld;
    if (changed) {
      this.requestCycle().catch((error: unknown) => {
        this.logger.error({ err: error }, "policy cycle after an exposure read failed");
      });
    }
    return { applied: true, released, previousExposure, changed };
  }

  /** The version and the settled allocation of the newest exposure read the runner applied. */
  exposureReadState(): { asOf: bigint | null; settledAllocated: MicroContracts } {
    return { asOf: this.readAsOf, settledAllocated: this.settledAllocated };
  }

  /** H stops counting `releasedQty` (never below zero) and E becomes `exposure`, in one step. */
  private release(releasedQty: MicroContracts, exposure: MicroContracts): void {
    const before = this.held;
    this.held = before > releasedQty ? before - releasedQty : 0n;
    this.exposure = exposure;
    if (releasedQty > before) {
      this.logger.error(
        { held: before.toString(), released: releasedQty.toString() },
        "settled contracts exceed the position: clamped to zero",
      );
    }
    this.logger.info(
      {
        released: releasedQty.toString(),
        held: this.held.toString(),
        exposure: exposure.toString(),
      },
      "settled campaigns' contracts no longer held",
    );
  }

  /** Clock tick: TTLs, staleness and the breaker's timers advance. */
  async onTick(): Promise<void> {
    await this.requestCycle();
  }

  /**
   * Sales-close reconciliation (HE-6): cancels every maker, buys the shortfall and sells any
   * surplus above one step, taker. Stays pending while placing is blocked, and while |H − E| is
   * still above one step after an attempt (thin book, failed placement): the following cycles
   * reconcile again. Before `start` it is only recorded (`attempted: false`).
   */
  async reconcile(): Promise<ReconcileOutcome> {
    this.reconcileRequested = true;
    this.lastReconcile = null;
    await this.requestCycle();
    return (
      this.lastReconcile ?? {
        attempted: false,
        exposure: this.exposure,
        held: this.held,
        withinOneStep: this.withinOneStep(),
      }
    );
  }

  isBreakerActive(): boolean {
    return this.breaker.active;
  }

  getBreaker(): Readonly<BreakerState> {
    return this.breaker;
  }

  snapshot(): PolicyRunnerSnapshot {
    const nowMs = this.nowMs();
    const openOrders = this.policyOrders();
    return {
      instrumentSymbol: this.instrumentSymbol,
      exposure: this.exposure,
      held: this.held,
      working: openOrders
        .filter((order) => order.kind === "maker" && order.side === "buy")
        .reduce((total, order) => total + order.remainingQty, 0n),
      unhedgedNotional: this.unhedgedNotional(),
      bidBps: bestBidBps(this.book),
      askBps: bestAskBps(this.book),
      bookObservedAtMs: this.book?.observedAtMs ?? null,
      stale: this.book === null || nowMs - this.book.observedAtMs > this.params.staleAfterMs,
      breaker: { active: this.breaker.active, reason: this.breaker.reason },
      openOrders,
      nextOrderSeq: this.nextOrderSeq,
      reconcilePending: this.reconcileRequested,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Serialisation
  // -------------------------------------------------------------------------------------------

  /** A cycle when started; before `start` (or after `stop`) the input is only recorded. */
  private async requestCycle(): Promise<void> {
    if (!this.isStarted()) return;
    await this.schedule();
  }

  /** Requests a cycle; resolves once a cycle that started after this request has finished. */
  private schedule(): Promise<void> {
    if (this.loop === null) {
      this.loop = this.drain();
    } else {
      this.rerun = true;
    }
    return this.loop;
  }

  private async drain(): Promise<void> {
    // Yield once, so `this.loop` is assigned before any venue call can re-enter `schedule`.
    await Promise.resolve();
    try {
      for (;;) {
        this.rerun = false;
        try {
          await this.cycle();
        } catch (error: unknown) {
          // A cycle never throws for a market or venue reason; this is a bug. Keep the loop alive.
          this.logger.error({ err: error }, "policy cycle failed unexpectedly");
        }
        if (!this.rerun) break;
      }
    } finally {
      this.loop = null;
    }
  }

  private async cycle(): Promise<void> {
    if (!this.restored) {
      await this.restoreFromVenue();
      if (!this.restored) {
        this.advanceBreaker();
        await this.flushOutbox();
        return;
      }
    }
    await this.resolveUnconfirmed();
    if (this.breaker.active && this.breaker.causes.includes("venue_down")) {
      await this.probeVenue();
    }
    this.advanceBreaker();

    const nowMs = this.nowMs();
    const state = this.policyState(nowMs);
    const blocked = placingBlockedReason(state) !== null;
    const actions = decide(state);
    await this.execute(actions);
    if (state.reconcile && !blocked) {
      const withinOneStep = this.withinOneStep();
      // A shortfall the book could not fill (or a placement that failed) keeps reconciliation
      // pending: the next cycles reconcile again, taker only, until |H − E| is within one step.
      this.reconcileRequested = !withinOneStep;
      this.lastReconcile = {
        attempted: true,
        exposure: this.exposure,
        held: this.held,
        withinOneStep,
      };
      this.logger.info(
        {
          exposure: this.exposure.toString(),
          held: this.held.toString(),
          withinOneStep: this.lastReconcile.withinOneStep,
        },
        "sales-close reconciliation ran",
      );
    }
    this.advanceBreaker();
    await this.flushOutbox();
  }

  // -------------------------------------------------------------------------------------------
  // Restore, lookups and probes
  // -------------------------------------------------------------------------------------------

  private async restoreFromVenue(): Promise<void> {
    let open: readonly VenueOrder[];
    try {
      open = await this.venue.listOpenOrders(this.instrumentSymbol);
      this.venueOutcomes.push("success");
    } catch (error: unknown) {
      this.venueOutcomes.push("failure");
      this.logger.warn(
        { err: describeError(error) },
        "could not list the venue's open orders: nothing is decided until it answers",
      );
      return;
    }
    const adopted = open.filter(
      (order) =>
        this.isOurs(order.clientOrderId) && order.instrumentSymbol === this.instrumentSymbol,
    );
    // Every venue read first, then the changes: a failed lookup leaves nothing half-applied.
    const lookups: {
      recordedFilledQty: MicroContracts;
      clientOrderId: string;
      order: VenueOrder | null;
    }[] = [];
    const unsettledOrders = this.restoreInput?.unsettledOrders ?? [];
    for (const unsettled of unsettledOrders) {
      try {
        const order = await this.venue.getOrder(unsettled.clientOrderId);
        this.venueOutcomes.push("success");
        lookups.push({ ...unsettled, order });
      } catch (error: unknown) {
        this.venueOutcomes.push("failure");
        this.logger.warn(
          { err: describeError(error), clientOrderId: unsettled.clientOrderId },
          "could not look up an unsettled order: restore retried on the next cycle",
        );
        return;
      }
    }

    // What H already counts of each order: its recorded fills, or nothing for an order the
    // persistence layer does not know.
    const recorded = new Map(unsettledOrders.map((u) => [u.clientOrderId, u.recordedFilledQty]));
    for (const order of adopted) {
      this.orderQty.set(order.clientOrderId, order.qty);
      this.countedFillQty.set(order.clientOrderId, recorded.get(order.clientOrderId) ?? 0n);
      this.orders.set(order.clientOrderId, {
        clientOrderId: order.clientOrderId,
        side: order.side,
        kind: order.kind,
        limitPriceBps: order.limitPriceBps,
        qty: order.qty,
        snapshotFilledQty: order.filledQty,
        fillsQty: 0n,
        placedAtMs: order.createdAtMs,
        askAtPlacementBps: null,
        status: "open",
        reason: "adopted",
      });
      this.bumpSeq(order.clientOrderId);
      this.logger.info({ clientOrderId: order.clientOrderId }, "adopted an open order");
    }
    /** The latest snapshot of each order read: a lookup came after the listing. */
    const snapshots = new Map<string, VenueOrder>(
      adopted.map((order) => [order.clientOrderId, order]),
    );
    for (const { clientOrderId, recordedFilledQty, order } of lookups) {
      this.bumpSeq(clientOrderId);
      if (order === null) {
        this.closedIds.add(clientOrderId);
        this.emit({
          type: "order_abandoned",
          atMs: this.nowMs(),
          instrumentSymbol: this.instrumentSymbol,
          clientOrderId,
        });
        continue;
      }
      this.orderQty.set(clientOrderId, order.qty);
      if (!this.countedFillQty.has(clientOrderId)) {
        this.countedFillQty.set(clientOrderId, recordedFilledQty);
      }
      snapshots.set(clientOrderId, order);
    }
    this.restored = true;

    // Fills that arrived while the venue was read are real fills, with their prices: applied
    // first. A snapshot read after them already includes them; only the rest was missed.
    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const event of buffered) this.applyVenueEvent(event);
    for (const order of snapshots.values()) {
      this.recoverMissedFills(order);
      this.applyOrder(order);
    }
  }

  /** At a restore: what the venue shows filled beyond what H counts was filled unseen. */
  private recoverMissedFills(order: VenueOrder): void {
    const counted = this.countedFillQty.get(order.clientOrderId) ?? 0n;
    const missed = order.filledQty - counted;
    if (missed <= 0n) return;
    this.countedFillQty.set(order.clientOrderId, order.filledQty);
    this.held += order.side === "buy" ? missed : -missed;
    if (this.held < 0n) this.held = 0n;
    this.emit({
      type: "position_recovered",
      atMs: this.nowMs(),
      instrumentSymbol: this.instrumentSymbol,
      order,
      qty: missed,
    });
  }

  /** Placements whose call threw: the venue is asked whether they exist. */
  private async resolveUnconfirmed(): Promise<void> {
    for (const tracked of [...this.orders.values()]) {
      if (tracked.status !== "unconfirmed") continue;
      let order: VenueOrder | null;
      try {
        order = await this.venue.getOrder(tracked.clientOrderId);
        this.venueOutcomes.push("success");
      } catch (error: unknown) {
        this.venueOutcomes.push("failure");
        this.logger.warn(
          { err: describeError(error), clientOrderId: tracked.clientOrderId },
          "could not look up an unconfirmed order: it stays counted as open",
        );
        continue;
      }
      if (order === null) {
        this.orders.delete(tracked.clientOrderId);
        this.closedIds.add(tracked.clientOrderId);
        this.emit({
          type: "order_abandoned",
          atMs: this.nowMs(),
          instrumentSymbol: this.instrumentSymbol,
          clientOrderId: tracked.clientOrderId,
        });
      } else {
        this.applyOrder(order);
      }
    }
  }

  /** While the venue is considered down, a read-only call tells when it answers again. */
  private async probeVenue(): Promise<void> {
    try {
      await this.venue.listOpenOrders(this.instrumentSymbol);
      this.venueOutcomes.push("success");
    } catch (error: unknown) {
      this.venueOutcomes.push("failure");
      this.logger.debug({ err: describeError(error) }, "venue probe failed");
    }
  }

  // -------------------------------------------------------------------------------------------
  // Executing a decision
  // -------------------------------------------------------------------------------------------

  private async execute(actions: readonly PolicyAction[]): Promise<void> {
    /** What each cancel left to replace: the remainder, or null when nothing is to be replaced. */
    const cancelled = new Map<string, MicroContracts | null>();
    for (const action of actions) {
      if (action.type !== "cancel") continue;
      cancelled.set(action.clientOrderId, await this.cancel(action.clientOrderId, action.reason));
    }
    for (const action of actions) {
      if (action.type === "cancel") continue;
      if (!this.placingAllowed()) {
        this.logger.warn(
          { action: action.type, reason: action.reason },
          "placement skipped: the venue failed during this cycle",
        );
        return;
      }
      let qty = action.qty;
      if (action.type === "place_taker_buy" && action.replacesClientOrderId !== null) {
        const left = cancelled.get(action.replacesClientOrderId) ?? null;
        if (left === null) continue;
        qty = minBig(qty, left);
      }
      if (action.type === "place_taker_sell") {
        qty = minBig(qty, this.maxSellQty());
      } else {
        qty = minBig(qty, this.maxBuyQty());
      }
      if (qty <= 0n) continue;
      await this.place(action, qty);
    }
  }

  /**
   * Largest buy that keeps every buy commitment (H + takers in flight + resting makers) within
   * E rounded up to the step: the guard against fills that landed while this cycle ran.
   */
  private maxBuyQty(): MicroContracts {
    let committed = this.held;
    for (const order of this.orders.values()) {
      const remaining = remainingOf(order);
      committed += order.side === "buy" ? remaining : order.kind === "taker" ? -remaining : 0n;
    }
    const cap = ceilToContractStep(this.exposure) - committed;
    return cap > 0n ? (cap / CONTRACT_STEP_MICRO) * CONTRACT_STEP_MICRO : 0n;
  }

  /** Largest sell that leaves H at or above E. */
  private maxSellQty(): MicroContracts {
    let position = this.held;
    for (const order of this.orders.values()) {
      if (order.kind !== "taker") continue;
      const remaining = remainingOf(order);
      position += order.side === "buy" ? remaining : -remaining;
    }
    const surplus = position - this.exposure;
    return surplus > 0n ? (surplus / CONTRACT_STEP_MICRO) * CONTRACT_STEP_MICRO : 0n;
  }

  private async cancel(
    clientOrderId: string,
    reason: PolicyActionReason,
  ): Promise<MicroContracts | null> {
    const tracked = this.orders.get(clientOrderId);
    if (tracked === undefined) return null;
    this.inFlightIds.add(clientOrderId);
    try {
      const result = await this.venue.cancelOrder(clientOrderId);
      this.venueOutcomes.push("success");
      if (result.cancelled) {
        this.applyOrder(result.order);
        this.emit({
          type: "order_cancelled",
          atMs: this.nowMs(),
          instrumentSymbol: this.instrumentSymbol,
          order: result.order,
          reason,
        });
        this.logger.info(
          {
            clientOrderId,
            reason,
            filledQty: result.order.filledQty.toString(),
            alreadyCancelled: result.alreadyCancelled,
          },
          "order cancelled",
        );
        const left = result.order.qty - result.order.filledQty;
        return left > 0n ? left : null;
      }
      if (result.order !== null) this.applyOrder(result.order);
      else {
        this.orders.delete(clientOrderId);
        this.closedIds.add(clientOrderId);
      }
      this.logger.info({ clientOrderId, outcome: result.reason }, "cancel found nothing to cancel");
      return null;
    } catch (error: unknown) {
      this.venueOutcomes.push("failure");
      this.logger.warn(
        { err: describeError(error), clientOrderId, reason },
        "cancel failed: retried on the next cycle",
      );
      return null;
    } finally {
      this.inFlightIds.delete(clientOrderId);
    }
  }

  private async place(
    action: Exclude<PolicyAction, { type: "cancel" }>,
    qty: MicroContracts,
  ): Promise<void> {
    const side: OrderSide = action.type === "place_taker_sell" ? "sell" : "buy";
    const kind: OrderKind = action.type === "place_maker_buy" ? "maker" : "taker";
    const clientOrderId = `${this.idPrefix}-${this.nextOrderSeq.toString()}`;
    this.nextOrderSeq += 1;
    const request: PlaceOrderRequest = {
      clientOrderId,
      instrumentSymbol: this.instrumentSymbol,
      side,
      kind,
      limitPriceBps: action.limitPriceBps,
      qty,
    };
    const nowMs = this.nowMs();
    this.orderQty.set(clientOrderId, qty);
    this.countedFillQty.set(clientOrderId, 0n);
    this.orders.set(clientOrderId, {
      clientOrderId,
      side,
      kind,
      limitPriceBps: action.limitPriceBps,
      qty,
      snapshotFilledQty: 0n,
      fillsQty: 0n,
      placedAtMs: nowMs,
      askAtPlacementBps: action.type === "place_maker_buy" ? action.askAtPlacementBps : null,
      status: "pending",
      reason: action.reason,
    });

    // Write-ahead: the id is persisted before the venue can know it.
    await this.flushOutbox();
    if (this.sink !== null) {
      try {
        await this.sink.record({
          type: "order_intent",
          atMs: nowMs,
          instrumentSymbol: this.instrumentSymbol,
          request,
          reason: action.reason,
        });
      } catch (error: unknown) {
        this.orders.delete(clientOrderId);
        this.closedIds.add(clientOrderId);
        this.logger.error(
          { err: describeError(error), clientOrderId },
          "could not persist the order intent: the order is not placed",
        );
        return;
      }
    }

    let result: PlaceOrderResult;
    this.inFlightIds.add(clientOrderId);
    try {
      result = await this.venue.placeOrder(request);
      this.venueOutcomes.push("success");
    } catch (error: unknown) {
      this.venueOutcomes.push("failure");
      const tracked = this.orders.get(clientOrderId);
      if (tracked !== undefined && tracked.status === "pending") tracked.status = "unconfirmed";
      this.emit({
        type: "order_unconfirmed",
        atMs: this.nowMs(),
        instrumentSymbol: this.instrumentSymbol,
        clientOrderId,
        error: describeError(error),
      });
      this.logger.warn(
        { err: describeError(error), clientOrderId },
        "placement failed: the order stays counted as open until the venue is asked about it",
      );
      return;
    } finally {
      this.inFlightIds.delete(clientOrderId);
    }

    if (result.accepted) {
      for (const fill of result.fills) this.applyFill(fill);
      this.applyOrder(result.order);
      this.emit({
        type: "order_placed",
        atMs: this.nowMs(),
        instrumentSymbol: this.instrumentSymbol,
        order: result.order,
        reason: action.reason,
      });
      this.logger.info(
        {
          clientOrderId,
          side,
          kind,
          limitPriceBps: action.limitPriceBps.toString(),
          qty: qty.toString(),
          filledQty: result.order.filledQty.toString(),
          reason: action.reason,
        },
        "order placed",
      );
      return;
    }

    this.orders.delete(clientOrderId);
    this.closedIds.add(clientOrderId);
    this.emit({
      type: "order_rejected",
      atMs: this.nowMs(),
      instrumentSymbol: this.instrumentSymbol,
      clientOrderId,
      rejectReason: result.reason,
      message: result.message,
    });
    const marketReason =
      result.reason === "would_cross" ||
      result.reason === "stale_book" ||
      result.reason === "no_book";
    const fields = { clientOrderId, rejectReason: result.reason, message: result.message };
    if (marketReason) this.logger.warn(fields, "order rejected by the venue");
    else this.logger.error(fields, "order rejected as invalid: a policy bug");
  }

  // -------------------------------------------------------------------------------------------
  // Venue events
  // -------------------------------------------------------------------------------------------

  private onVenueEvent(event: VenueEvent): void {
    const subject = event.type === "fill" ? event.fill : event.order;
    if (subject.instrumentSymbol !== this.instrumentSymbol || !this.isOurs(subject.clientOrderId)) {
      return;
    }
    if (!this.restored) {
      // The restore is reading the venue: applied once it has, against what it read.
      this.bufferedEvents.push(event);
      return;
    }
    this.applyVenueEvent(event);
    if (this.unsubscribe !== null && !this.inFlightIds.has(subject.clientOrderId)) {
      // The cycle requested here re-evaluates once the venue's change is applied.
      this.schedule().catch((error: unknown) => {
        this.logger.error({ err: error }, "policy cycle after a venue event failed");
      });
    }
  }

  private applyVenueEvent(event: VenueEvent): void {
    try {
      if (event.type === "fill") this.applyFill(event.fill);
      else this.applyOrder(event.order, true);
    } catch (error: unknown) {
      this.logger.error({ err: error }, "policy runner failed to apply a venue event");
    }
  }

  /**
   * Applies a fill once (by id), and only for what H does not count yet: the fill covers its
   * order's filled quantity from `qty − orderRemainingQty` to that plus its own quantity, and a
   * restore may already have recovered part or all of it from a snapshot.
   */
  private applyFill(fill: VenueFill): void {
    if (fill.instrumentSymbol !== this.instrumentSymbol || !this.isOurs(fill.clientOrderId)) return;
    if (this.seenFillIds.has(fill.fillId)) return;
    this.seenFillIds.add(fill.fillId);
    const orderQty = this.orderQty.get(fill.clientOrderId);
    const counted = this.countedFillQty.get(fill.clientOrderId) ?? 0n;
    let countedQty = fill.qty;
    let filledThrough: MicroContracts | null = null;
    if (orderQty !== undefined) {
      filledThrough = orderQty - fill.bookRef.orderRemainingQty + fill.qty;
      const beyond = filledThrough - counted;
      countedQty = beyond <= 0n ? 0n : minBig(beyond, fill.qty);
    }
    this.countedFillQty.set(fill.clientOrderId, counted + countedQty);
    this.held += fill.side === "buy" ? countedQty : -countedQty;
    if (this.held < 0n) {
      this.logger.error({ held: this.held.toString() }, "position went negative: clamped to zero");
      this.held = 0n;
    }
    const tracked = this.orders.get(fill.clientOrderId);
    if (tracked !== undefined) {
      tracked.fillsQty =
        filledThrough === null
          ? tracked.fillsQty + fill.qty
          : maxBig(tracked.fillsQty, filledThrough);
    }
    if (countedQty < fill.qty) {
      this.logger.info(
        { fillId: fill.fillId, qty: fill.qty.toString(), countedQty: countedQty.toString() },
        "fill already counted in part by a restore",
      );
    }
    this.emit({
      type: "fill",
      atMs: this.nowMs(),
      instrumentSymbol: this.instrumentSymbol,
      fill,
      countedQty,
    });
  }

  private applyOrder(order: VenueOrder, fromEvent = false): void {
    if (order.instrumentSymbol !== this.instrumentSymbol || !this.isOurs(order.clientOrderId)) {
      return;
    }
    if (fromEvent) {
      this.emit({
        type: "order_updated",
        atMs: this.nowMs(),
        instrumentSymbol: this.instrumentSymbol,
        order,
      });
    }
    if (!this.orderQty.has(order.clientOrderId)) this.orderQty.set(order.clientOrderId, order.qty);
    if (this.closedIds.has(order.clientOrderId)) return;
    const tracked = this.orders.get(order.clientOrderId);
    if (!OPEN_STATUSES.has(order.status)) {
      this.orders.delete(order.clientOrderId);
      this.closedIds.add(order.clientOrderId);
      return;
    }
    if (tracked === undefined) {
      // An order of ours the runner did not know (a placement that landed after being given up).
      this.orders.set(order.clientOrderId, {
        clientOrderId: order.clientOrderId,
        side: order.side,
        kind: order.kind,
        limitPriceBps: order.limitPriceBps,
        qty: order.qty,
        snapshotFilledQty: order.filledQty,
        fillsQty: 0n,
        placedAtMs: order.createdAtMs,
        askAtPlacementBps: null,
        status: "open",
        reason: "adopted",
      });
      return;
    }
    tracked.status = "open";
    tracked.snapshotFilledQty = maxBig(tracked.snapshotFilledQty, order.filledQty);
    if (tracked.kind === "maker" && tracked.placedAtMs > order.createdAtMs) {
      tracked.placedAtMs = order.createdAtMs;
    }
  }

  // -------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------

  private policyOrders(): PolicyOrder[] {
    return [...this.orders.values()].map((order) => ({
      clientOrderId: order.clientOrderId,
      side: order.side,
      kind: order.kind,
      limitPriceBps: order.limitPriceBps,
      remainingQty: remainingOf(order),
      placedAtMs: order.placedAtMs,
      askAtPlacementBps: order.askAtPlacementBps,
    }));
  }

  private policyState(nowMs: number): PolicyState {
    return {
      nowMs,
      eventStartMs: this.eventStartMs,
      exposure: this.exposure,
      held: this.held,
      openOrders: this.policyOrders(),
      book: this.book,
      params: this.params,
      breakerActive: this.breaker.active,
      reconcile: this.reconcileRequested,
    };
  }

  /** (E − H) × price, rounded up. Priced at the best ask, or at $1 when there is no ask. */
  private unhedgedNotional(): MicroUsdc | null {
    if (this.book === null) return null;
    const unhedged = this.exposure - this.held;
    if (unhedged <= 0n) return 0n;
    return mulDivUp(unhedged, bestAskBps(this.book) ?? BPS, BPS);
  }

  private advanceBreaker(): void {
    const nowMs = this.nowMs();
    const outcomes = this.venueOutcomes;
    this.venueOutcomes = [];
    const { state, transition } = stepBreaker(
      this.breaker,
      {
        nowMs,
        venueOutcomes: outcomes,
        bookAgeMs: nowMs - (this.book?.observedAtMs ?? this.startedAtMs),
        unhedgedNotional: this.unhedgedNotional(),
        uMaxMicroUsdc: this.params.uMaxMicroUsdc,
        unhedgedCurable: unhedgedExcessCurable(this.book, this.exposure - this.held, this.params),
      },
      this.breakerParams,
    );
    this.breaker = state;
    if (transition === "tripped" && state.reason !== null) {
      this.logger.warn({ reason: state.reason, causes: state.causes }, "circuit breaker tripped");
      this.emit({
        type: "breaker_tripped",
        atMs: nowMs,
        instrumentSymbol: this.instrumentSymbol,
        reason: state.reason,
        causes: state.causes,
      });
    } else if (transition === "reset") {
      this.logger.info("circuit breaker reset");
      this.emit({ type: "breaker_reset", atMs: nowMs, instrumentSymbol: this.instrumentSymbol });
    }
  }

  /** False once the venue has failed often enough, during this cycle, to trip the breaker. */
  private placingAllowed(): boolean {
    if (this.breaker.active) return false;
    let failures = this.breaker.consecutiveVenueFailures;
    for (const outcome of this.venueOutcomes) failures = outcome === "failure" ? failures + 1 : 0;
    return failures < this.breakerParams.maxConsecutiveVenueFailures;
  }

  private withinOneStep(): boolean {
    const gap = this.held - this.exposure;
    return (gap < 0n ? -gap : gap) <= CONTRACT_STEP_MICRO;
  }

  private isOurs(clientOrderId: string): boolean {
    return clientOrderId.startsWith(`${this.idPrefix}-`);
  }

  private bumpSeq(clientOrderId: string): void {
    if (!this.isOurs(clientOrderId)) return;
    const seq = Number(clientOrderId.slice(this.idPrefix.length + 1));
    if (Number.isSafeInteger(seq) && seq >= this.nextOrderSeq) this.nextOrderSeq = seq + 1;
  }

  private emit(event: PolicyEvent): void {
    this.outbox.push(event);
  }

  private async flushOutbox(): Promise<void> {
    const events = this.outbox;
    this.outbox = [];
    if (this.sink === null) return;
    for (const event of events) {
      try {
        await this.sink.record(event);
      } catch (error: unknown) {
        this.logger.error(
          { err: describeError(error), eventType: event.type },
          "policy event sink failed: the event is lost to persistence",
        );
      }
    }
  }

  private nowMs(): number {
    return this.clock.now().getTime();
  }
}
