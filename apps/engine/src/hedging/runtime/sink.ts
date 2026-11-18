/**
 * The persistence of the policy runners (`PolicyEventSink`): every order a runner places or
 * cancels goes to `orders`, every fill to `fills` together with its allocation to the lots, the
 * position it changes and the platform's result on a resale, in one database transaction.
 */
import type { Logger } from "pino";
import type { TransactionSql } from "postgres";

import type { ExecutionVenueName, MicroContracts } from "@winz/shared";

import type { Db } from "../../db";
import type { VenueOrder } from "../../venues";
import {
  AllocationInputError,
  FillConflictError,
  FillOrderMismatchError,
  recordFill,
  recordFillInput,
  type RecordFillResult,
} from "../allocation";
import type { PolicyEvent, PolicyEventSink } from "../policy";
import { PositionEventsPendingError, UnknownOrderError } from "./errors";

/** What a recorded fill changed, for the service (charges, inventory, the desk). */
export interface FillRecorded {
  instrument: string;
  result: Extract<RecordFillResult, { status: "recorded" }>;
}

export interface PgPolicySinkDeps {
  db: Db;
  venue: ExecutionVenueName;
  logger: Logger;
  /** Called after the transaction of a new fill committed. Must not throw. */
  onFillRecorded?: (event: FillRecorded) => void;
  /**
   * First delay before an instrument's queue is tried again after a failure that may pass (a lost
   * connection). It doubles with each failure in a row, up to `retryMaxMs`. Default 250.
   */
  retryBaseMs?: number;
  /** Longest such delay. Default 10 000. */
  retryMaxMs?: number;
  /** Failures in a row after which the stuck event is reported as an error. Default 5. */
  alertAfterFailures?: number;
  /** Clock of the retry delays (not of anything recorded). Defaults to `Date.now`. */
  nowMs?: () => number;
}

interface Pending {
  event: Exclude<PolicyEvent, { type: "order_intent" }>;
  attempts: number;
}

interface InstrumentQueue {
  events: Pending[];
  /** Failures in a row of the event at the head. */
  failures: number;
  /** No attempt before this time, unless forced. */
  nextAttemptAtMs: number;
}

/** Events that move the position: while one is not written, no new order may be placed. */
const POSITION_EVENTS: ReadonlySet<PolicyEvent["type"]> = new Set(["fill", "position_recovered"]);

/** Errors that a retry cannot fix: the event is dropped and logged. */
function isPermanent(error: unknown): boolean {
  return (
    error instanceof FillConflictError ||
    error instanceof FillOrderMismatchError ||
    error instanceof AllocationInputError
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

const TERMINAL_ORDER_STATUSES = ["filled", "cancelled", "rejected"] as const;

/**
 * `PolicyEventSink` on Postgres, shared by every runner of the service.
 *
 * - `order_intent` is written before the venue sees the id (`orders`, status `working`, the client
 *   order id as `venue_order_id`) and is the only event whose failure is reported to the runner:
 *   the runner then does not place the order.
 * - Every other event is applied in order, per instrument. One that fails for a reason that may
 *   pass (the database is unreachable) stays queued, with the events after it, and is retried at
 *   the next event or `retryPending` call after a backoff that doubles up to `retryMaxMs`, for as
 *   long as it takes: a fill is never dropped for an outage, however long, and fills keep their
 *   recording order (the FIFO of the inventory). Only an error a retry cannot fix (a conflicting
 *   fill, an invalid input) drops an event, with an error log. One instrument's queue never holds
 *   another's.
 * - While a fill (or a recovered position) of an instrument has failed to be written, every new
 *   `order_intent` of that instrument is refused (`PositionEventsPendingError`), so its runner
 *   places nothing: the database would not know what it holds, and a restart in that state would
 *   rebuild a position without that fill.
 * - A fill goes through the allocation store's `recordFill` in a transaction that also moves
 *   `positions.held` by the quantity the runner counted and adds a resale's result to
 *   `engine_pnl.resale_result` (and, for a buy that replaced an over-sale, minus that buy's cost
 *   of the replaced contracts: the rest of the over-sale's cost basis). `recordFill` is
 *   idempotent on (order, venue fill id): a fill recorded twice changes nothing, and nothing else
 *   is written the second time.
 */
export class PgPolicySink implements PolicyEventSink {
  private readonly db: Db;
  private readonly venue: ExecutionVenueName;
  private readonly logger: Logger;
  private readonly onFillRecorded: ((event: FillRecorded) => void) | null;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly alertAfterFailures: number;
  private readonly nowMs: () => number;
  private readonly queues = new Map<string, InstrumentQueue>();
  private readonly draining = new Map<string, Promise<void>>();

  constructor(deps: PgPolicySinkDeps) {
    this.db = deps.db;
    this.venue = deps.venue;
    this.logger = deps.logger.child({ component: "hedging.sink" });
    this.onFillRecorded = deps.onFillRecorded ?? null;
    this.retryBaseMs = deps.retryBaseMs ?? 250;
    this.retryMaxMs = deps.retryMaxMs ?? 10_000;
    this.alertAfterFailures = deps.alertAfterFailures ?? 5;
    this.nowMs = deps.nowMs ?? Date.now;
  }

  async record(event: PolicyEvent): Promise<void> {
    if (event.type === "order_intent") {
      const stuck = this.stuckPositionEvents(event.instrumentSymbol);
      if (stuck > 0) {
        throw new PositionEventsPendingError(event.instrumentSymbol, stuck);
      }
      await this.db`
        insert into orders (instrument, side, kind, price_bps, qty, filled_qty, status, venue,
                            venue_order_id)
        values (${event.instrumentSymbol}, ${event.request.side}, ${event.request.kind},
                ${Number(event.request.limitPriceBps)}, ${event.request.qty.toString()}::bigint, 0,
                'working', ${this.venue}, ${event.request.clientOrderId})
        on conflict (venue, venue_order_id) where venue_order_id is not null do nothing
      `;
      return;
    }
    const queue = this.queues.get(event.instrumentSymbol) ?? {
      events: [],
      failures: 0,
      nextAttemptAtMs: 0,
    };
    this.queues.set(event.instrumentSymbol, queue);
    queue.events.push({ event, attempts: 0 });
    await this.drain(event.instrumentSymbol, false);
  }

  /** Events still waiting to be written, of one instrument or of all. */
  pendingCount(instrument?: string): number {
    if (instrument !== undefined) return this.queues.get(instrument)?.events.length ?? 0;
    let count = 0;
    for (const queue of this.queues.values()) count += queue.events.length;
    return count;
  }

  /**
   * Fills and recovered positions of an instrument that failed to be written at least once and
   * are still queued. While it is not zero, the instrument's runner may place no order.
   */
  stuckPositionEvents(instrument: string): number {
    const queue = this.queues.get(instrument);
    if (queue === undefined) return 0;
    return queue.events.filter(
      (pending) => pending.attempts > 0 && POSITION_EVENTS.has(pending.event.type),
    ).length;
  }

  /**
   * Retries every queued event whose backoff is over; with `force`, every queued event now (the
   * last attempt at a stop). Never throws.
   */
  async retryPending(options: { force?: boolean } = {}): Promise<void> {
    const force = options.force ?? false;
    await Promise.all([...this.queues.keys()].map((instrument) => this.drain(instrument, force)));
  }

  /** Applies the queue of one instrument in order, one drain at a time. Never throws. */
  private drain(instrument: string, force: boolean): Promise<void> {
    const running = this.draining.get(instrument);
    if (running !== undefined) {
      // A drain is running: it picks up what was just queued. Chain one more pass after it, so
      // the caller resolves only once its own event was attempted (or is waiting on a backoff).
      const next = running.then(() => this.drain(instrument, force));
      return next;
    }
    const run = this.drainOnce(instrument, force).finally(() => {
      this.draining.delete(instrument);
    });
    this.draining.set(instrument, run);
    return run;
  }

  private async drainOnce(instrument: string, force: boolean): Promise<void> {
    const queue = this.queues.get(instrument);
    if (queue === undefined) return;
    if (!force && this.nowMs() < queue.nextAttemptAtMs) return;
    while (queue.events.length > 0) {
      const pending = queue.events[0];
      if (pending === undefined) break;
      try {
        await this.apply(pending.event);
        queue.events.shift();
        if (queue.failures > 0) {
          this.logger.info(
            { instrument, eventType: pending.event.type, attempts: pending.attempts + 1 },
            "policy event written after earlier failures",
          );
        }
        queue.failures = 0;
        queue.nextAttemptAtMs = 0;
      } catch (error: unknown) {
        pending.attempts += 1;
        const fields = {
          err: describeError(error),
          eventType: pending.event.type,
          instrument,
          attempts: pending.attempts,
          queued: queue.events.length,
        };
        if (isPermanent(error)) {
          queue.events.shift();
          queue.failures = 0;
          queue.nextAttemptAtMs = 0;
          this.logger.error(fields, "policy event dropped: a retry cannot write it");
          continue;
        }
        queue.failures += 1;
        const delayMs = Math.min(
          this.retryBaseMs * 2 ** Math.min(queue.failures - 1, 30),
          this.retryMaxMs,
        );
        queue.nextAttemptAtMs = this.nowMs() + delayMs;
        const alert =
          queue.failures === this.alertAfterFailures ||
          (queue.failures > this.alertAfterFailures && queue.failures % 50 === 0);
        if (alert) {
          this.logger.error(
            {
              ...fields,
              retryInMs: delayMs,
              ordersBlocked: this.stuckPositionEvents(instrument) > 0,
            },
            "policy event still not written: retried until it is; no order is placed on this instrument while a fill is unwritten",
          );
        } else {
          this.logger.warn(
            { ...fields, retryInMs: delayMs },
            "policy event not written: retried with the events after it",
          );
        }
        return;
      }
    }
    if (queue.events.length === 0) this.queues.delete(instrument);
  }

  private async apply(event: Exclude<PolicyEvent, { type: "order_intent" }>): Promise<void> {
    switch (event.type) {
      case "order_placed":
      case "order_updated":
      case "order_cancelled":
        await this.writeOrder(event.order);
        return;
      case "order_rejected":
        await this.setStatus(event.clientOrderId, "rejected");
        return;
      case "order_abandoned":
        // The venue never knew the id: the order never existed.
        await this.setStatus(event.clientOrderId, "cancelled");
        return;
      case "order_unconfirmed":
        // The row stays `working`: the runner looks the order up on its next cycles.
        return;
      case "fill":
        await this.writeFill(event);
        return;
      case "position_recovered":
        await this.writeRecovery(event);
        return;
      case "breaker_tripped":
      case "breaker_reset":
        // The desk shows the breaker from the runner's snapshot; the runner logs the transition.
        return;
    }
  }

  private async writeOrder(order: VenueOrder): Promise<void> {
    const rows = await this.db<{ id: string }[]>`
      update orders
      set status = case when status = any(${[...TERMINAL_ORDER_STATUSES]}::text[]) then status
                        else ${order.status} end,
          filled_qty = greatest(filled_qty, least(${order.filledQty.toString()}::bigint, qty))
      where venue = ${this.venue} and venue_order_id = ${order.clientOrderId}
      returning id
    `;
    if (rows.length === 0) throw new UnknownOrderError(order.clientOrderId, this.venue);
  }

  private async setStatus(clientOrderId: string, status: "rejected" | "cancelled"): Promise<void> {
    const rows = await this.db<{ id: string }[]>`
      update orders
      set status = case when status = any(${[...TERMINAL_ORDER_STATUSES]}::text[]) then status
                        else ${status} end
      where venue = ${this.venue} and venue_order_id = ${clientOrderId}
      returning id
    `;
    if (rows.length === 0) throw new UnknownOrderError(clientOrderId, this.venue);
  }

  private async orderRow(
    tx: TransactionSql,
    clientOrderId: string,
  ): Promise<{ id: string; instrument: string; eventTicker: string }> {
    const [row] = await tx<{ id: string; instrument: string; event_ticker: string }[]>`
      select o.id, o.instrument, i.event_ticker
      from orders o join instruments i on i.symbol = o.instrument
      where o.venue = ${this.venue} and o.venue_order_id = ${clientOrderId}
    `;
    if (row === undefined) throw new UnknownOrderError(clientOrderId, this.venue);
    return { id: row.id, instrument: row.instrument, eventTicker: row.event_ticker };
  }

  private async moveHeld(
    tx: TransactionSql,
    instrument: string,
    delta: MicroContracts,
  ): Promise<void> {
    if (delta === 0n) return;
    await tx`
      insert into positions (instrument, held, venue)
      values (${instrument}, greatest(0, ${delta.toString()}::bigint), ${this.venue})
      on conflict (instrument) do update
        set held = greatest(0, positions.held + ${delta.toString()}::bigint)
    `;
  }

  private async writeFill(event: Extract<PolicyEvent, { type: "fill" }>): Promise<void> {
    const { fill } = event;
    let recorded: FillRecorded | null = null;
    await this.db.begin(async (tx) => {
      const order = await this.orderRow(tx, fill.clientOrderId);
      const result = await recordFill(tx, recordFillInput(order.id, fill), {
        logger: this.logger,
      });
      if (result.status === "duplicate") return;
      await this.moveHeld(
        tx,
        order.instrument,
        fill.side === "buy" ? event.countedQty : -event.countedQty,
      );
      // The order's fill count and status move with the fill, in its transaction: a crash before
      // the venue's own order update must not leave a fully filled order open, which the next
      // start would then mark cancelled (see `cancelVanishedOrders`).
      await tx`
        update orders o
        set filled_qty = greatest(o.filled_qty, least(o.qty, recorded.total)),
            status = case
              when o.status = any(${[...TERMINAL_ORDER_STATUSES]}::text[]) then o.status
              when recorded.total >= o.qty then 'filled'
              when recorded.total > 0 then 'partially_filled'
              else o.status
            end
        from (
          select coalesce(sum(f.qty), 0)::bigint as total from fills f where f.order_id = ${order.id}
        ) recorded
        where o.id = ${order.id}
      `;
      // A resale's result, or the cost of a buy that replaced an over-sale (the rest of that
      // over-sale's cost basis): together, what the resales really brought in.
      const resaleResult = (result.sale?.result ?? 0n) - (result.replacedShort?.cost ?? 0n);
      if (resaleResult !== 0n) {
        await tx`
          insert into engine_pnl (event_ticker, resale_result)
          values (${order.eventTicker}, ${resaleResult.toString()}::bigint)
          on conflict (event_ticker) do update
            set resale_result = engine_pnl.resale_result + excluded.resale_result
        `;
      }
      recorded = { instrument: order.instrument, result };
    });
    const done = recorded as FillRecorded | null;
    if (done === null) {
      this.logger.debug({ fillId: fill.fillId }, "fill already recorded: nothing written");
      return;
    }
    this.logger.info(
      {
        instrument: done.instrument,
        fillId: fill.fillId,
        clientOrderId: fill.clientOrderId,
        side: fill.side,
        kind: fill.kind,
        priceBps: fill.priceBps.toString(),
        qty: fill.qty.toString(),
        coveredLots: done.result.coveredLots.length,
        resaleResult: done.result.sale?.result.toString() ?? null,
        replacedShortQty: done.result.replacedShort?.qty.toString() ?? null,
        replacedShortCost: done.result.replacedShort?.cost.toString() ?? null,
      },
      "fill recorded and allocated",
    );
    try {
      this.onFillRecorded?.(done);
    } catch (error: unknown) {
      this.logger.error({ err: describeError(error) }, "fill listener failed");
    }
  }

  /**
   * Fills the runner found at a restore without their details (a venue that kept its orders while
   * the process was down). The position follows; the fills themselves cannot be recorded or
   * allocated without their prices.
   */
  private async writeRecovery(
    event: Extract<PolicyEvent, { type: "position_recovered" }>,
  ): Promise<void> {
    await this.db.begin(async (tx) => {
      const order = await this.orderRow(tx, event.order.clientOrderId);
      await this.moveHeld(
        tx,
        order.instrument,
        event.order.side === "buy" ? event.qty : -event.qty,
      );
    });
    await this.writeOrder(event.order);
    this.logger.error(
      {
        instrument: event.instrumentSymbol,
        clientOrderId: event.order.clientOrderId,
        qty: event.qty.toString(),
      },
      "fills missed while the engine was down: the position is corrected, but these contracts are not allocated to any lot until their fills are recorded",
    );
  }
}
