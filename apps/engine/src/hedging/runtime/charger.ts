/**
 * Sends the hedge charges (`chargeHedge`, SPEC 9.5) through the transaction outbox, as the oracle.
 *
 * Two sources of lots: the covered lots `pendingCharges` returns (the normal path, after each
 * allocation and on an interval), and, at sales close, every remaining lot of the closed campaigns
 * whatever its coverage (`chargeRemaining`, HE-6). Both are serialised behind one lock, so two
 * passes never submit the same ticket in two different batches.
 *
 * A ticket is never submitted twice while a transaction holds it: `pendingCharges` and
 * `remainingLots` leave out every ticket a `chargeHedge` of the outbox still holds (queued, sent,
 * or mined and not projected yet), and the projection marks lots charged when `HedgeCharged`
 * arrives. Nothing here writes `lots.charged`.
 *
 * A batch that reverts, or fails before it is sent, must not poison the others. What the outbox
 * already records decides, so the rule survives a restart:
 * - a ticket that was in a failed batch of several tickets is from then on charged alone;
 * - a ticket charged alone that failed with an error that will not pass (its campaign is settled,
 *   its budget released, it was already charged, the amount is above its guarantee, it does not
 *   exist) is no longer offered;
 * - a ticket charged alone that failed for another reason (the node was unreachable) is retried
 *   after a backoff that doubles with each failure, up to `maxBackoffMs`.
 *
 * What a final charge (sales close) leaves to the platform above a lot's guarantee is written into
 * the transaction's payload (`guaranteeLosses`) and added to `engine_pnl.guarantee_losses` once,
 * when that transaction is mined (`recordMinedLosses`), never when it is queued: a charge that
 * fails and is queued again under a new key books its loss only once, through the attempt that
 * succeeded. The transaction is marked (`hedgeLossesRecorded`) in the same database transaction as
 * the loss, so a crash or two concurrent passes cannot book it twice.
 */
import { createHash } from "node:crypto";

import type { Logger } from "pino";
import type { Address } from "viem";

import type { EnqueueResult, TxRequest } from "../../chain";
import type { Db } from "../../db";
import {
  CHARGE_HEDGE_TX_KIND,
  MAX_CHARGE_BATCH,
  chargeHedgeTxRequest,
  pendingCharges,
  type ChargeBatch,
} from "../allocation";
import { remainingLots, type RemainingLot } from "./store";

/** The part of the transaction sender the charger uses. `TxSender` satisfies it. */
export interface ChargeTxSender {
  enqueue(request: TxRequest): Promise<EnqueueResult>;
}

/**
 * Revert reasons after which a ticket charged alone is never offered again: nothing can make
 * `chargeHedge` accept it later (see `WinzEscrow.chargeHedge`).
 */
export const TERMINAL_CHARGE_ERRORS = [
  "AlreadySettled",
  "AlreadyReleased",
  "HedgeAlreadyCharged",
  "HedgeAboveGuarantee",
  "TicketNotFound",
] as const;

/**
 * Of those, the refusals after which the ticket's reservation is no longer held: its campaign is
 * settled or released, or it was charged already. `HedgeAboveGuarantee` and `TicketNotFound` leave
 * the reservation in place, so a campaign holding such a ticket cannot settle: they are defects.
 */
export const RESOLVED_CHARGE_ERRORS: readonly string[] = [
  "AlreadySettled",
  "AlreadyReleased",
  "HedgeAlreadyCharged",
];

/** Payload key of the losses a final charge leaves to the platform. */
export const GUARANTEE_LOSSES_KEY = "guaranteeLosses";
/** Payload key set once those losses are in `engine_pnl`. */
export const LOSSES_RECORDED_KEY = "hedgeLossesRecorded";

export interface HedgeChargerOptions {
  db: Db;
  txSender: ChargeTxSender;
  escrowAddress: Address;
  logger: Logger;
  /** The service clock: the emergency window of `pendingCharges` is judged at this time. */
  now: () => Date;
  /** Most lots read per pass. Default 500. */
  limit?: number;
  /** Tickets per batch, at most 50. Default 50. */
  batchSize?: number;
  /** First retry delay of a ticket whose lone charge failed for a passing reason. Default 2 000. */
  baseBackoffMs?: number;
  /** Longest such delay. Default 60 000. */
  maxBackoffMs?: number;
}

/** One lot ready to be charged, with what its charge adds to the platform's losses. */
interface ChargeLot {
  lot: ChargeBatch["lots"][number];
  /** Recorded in `engine_pnl.guarantee_losses` once its transaction is mined (final charges). */
  guaranteeLoss: bigint;
  eventTicker: string | null;
}

/** What the outbox says about the tickets of failed `chargeHedge` transactions. */
interface FailureState {
  /** Tickets that were in a failed batch of several: charged alone from now on. */
  isolate: Set<string>;
  /** Tickets whose lone charge failed for good. Value: the revert reason. */
  blocked: Map<string, string>;
  /** Tickets whose lone charge failed for a passing reason and whose backoff is not over. */
  waiting: Set<string>;
  /** Failed transactions holding each ticket (any batch size): part of the idempotency key. */
  failures: Map<string, number>;
}

export interface ChargePassResult {
  /** Transactions newly queued. */
  queued: number;
  /** Tickets in them. */
  tickets: number;
}

function key(ticketOnchainId: bigint): string {
  return ticketOnchainId.toString();
}

export class HedgeCharger {
  private readonly db: Db;
  private readonly txSender: ChargeTxSender;
  private readonly escrow: Address;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly limit: number;
  private readonly batchSize: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private lock: Promise<unknown> = Promise.resolve();
  private readonly reportedBlocked = new Set<string>();

  constructor(options: HedgeChargerOptions) {
    this.db = options.db;
    this.txSender = options.txSender;
    this.escrow = options.escrowAddress;
    this.logger = options.logger.child({ component: "hedging.charger" });
    this.now = options.now;
    this.limit = options.limit ?? 500;
    this.batchSize = Math.min(options.batchSize ?? MAX_CHARGE_BATCH, MAX_CHARGE_BATCH);
    this.baseBackoffMs = options.baseBackoffMs ?? 2_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
  }

  /** Charges the covered lots of every campaign (`pendingCharges`). */
  async chargeCovered(): Promise<ChargePassResult> {
    return this.exclusive(async () => {
      const batches = await pendingCharges(this.db, {
        limit: this.limit,
        batchSize: this.batchSize,
        at: this.now(),
      });
      if (batches.length === 0) return { queued: 0, tickets: 0 };
      const failures = await this.failureState(batches.flatMap((batch) => batch.lots));
      let result: ChargePassResult = { queued: 0, tickets: 0 };
      for (const batch of batches) {
        const lots = batch.lots.map((lot): ChargeLot => ({
          lot,
          guaranteeLoss: 0n,
          eventTicker: null,
        }));
        const blocked = lots.some((item) => this.isBlockedOrWaiting(item, failures));
        const isolated = lots.some((item) => failures.isolate.has(key(item.lot.ticketOnchainId)));
        if (!blocked && !isolated) {
          result = add(result, await this.enqueue(batch, lots));
          continue;
        }
        result = add(result, await this.submit(lots, failures, batch.isolated));
      }
      return result;
    });
  }

  /**
   * Charges every remaining lot of these campaigns (HE-6, at sales close): a covered lot its cost
   * capped at its guarantee, a lot covered in part (less than one 0.01 contract step was left
   * uncovered by the reconciliation) the cost of what covers it, capped likewise, and a lot with
   * nothing allocated zero, which only releases its reservation. What a partly covered lot costs
   * above its guarantee is added to the platform's guarantee losses.
   */
  async chargeRemaining(campaignIds: readonly string[]): Promise<ChargePassResult> {
    return this.exclusive(async () => {
      const rows = await remainingLots(this.db, campaignIds);
      if (rows.length === 0) return { queued: 0, tickets: 0 };
      const lots = rows.map((row) => chargeLotOf(row));
      const failures = await this.failureState(lots.map((item) => item.lot));
      let result: ChargePassResult = { queued: 0, tickets: 0 };
      // One campaign per batch: a campaign that settles or is released meanwhile only delays itself.
      const byCampaign = new Map<string, ChargeLot[]>();
      for (const item of lots) {
        const list = byCampaign.get(item.lot.campaignId) ?? [];
        list.push(item);
        byCampaign.set(item.lot.campaignId, list);
      }
      for (const list of byCampaign.values()) {
        result = add(result, await this.submit(list, failures, true));
      }
      return result;
    });
  }

  /**
   * Sorts lots still uncharged in the database: `refused` are tickets the escrow refused for good
   * while their reservation is still held (`HedgeAboveGuarantee`, `TicketNotFound`): nothing here
   * will ever charge them. `open` are the others that can still be charged. Tickets refused
   * because their campaign is settled or released, or because they were charged already, are in
   * neither: their reservation is no longer held.
   */
  async classify<T extends { ticketOnchainId: bigint }>(
    lots: readonly T[],
  ): Promise<{ open: T[]; refused: { lot: T; reason: string }[] }> {
    const failures = await this.failureState(lots);
    const open: T[] = [];
    const refused: { lot: T; reason: string }[] = [];
    for (const lot of lots) {
      const reason = failures.blocked.get(key(lot.ticketOnchainId));
      if (reason === undefined) open.push(lot);
      else if (!RESOLVED_CHARGE_ERRORS.includes(reason)) refused.push({ lot, reason });
    }
    return { open, refused };
  }

  /**
   * Adds to `engine_pnl.guarantee_losses` the losses carried by every mined `chargeHedge` whose
   * losses are not booked yet, and marks it, in one database transaction. Returns how many
   * transactions it booked.
   */
  async recordMinedLosses(): Promise<number> {
    return this.db.begin(async (tx) => {
      const rows = await tx<{ id: string; losses: unknown }[]>`
        select id, payload -> ${GUARANTEE_LOSSES_KEY} as losses
        from chain_txs
        where kind = ${CHARGE_HEDGE_TX_KIND} and status = 'mined'
          and payload ? ${GUARANTEE_LOSSES_KEY}
          and not payload ? ${LOSSES_RECORDED_KEY}
        order by created_at
        for update
      `;
      if (rows.length === 0) return 0;
      const byEvent = new Map<string, bigint>();
      for (const row of rows) {
        const parsed = parseLosses(row.losses);
        if (parsed.malformed > 0) {
          this.logger.error(
            { txId: row.id, malformed: parsed.malformed },
            "unreadable guarantee loss in a chargeHedge payload: not booked",
          );
        }
        for (const item of parsed.items) {
          byEvent.set(item.eventTicker, (byEvent.get(item.eventTicker) ?? 0n) + item.loss);
        }
      }
      for (const [eventTicker, loss] of byEvent) {
        if (loss <= 0n) continue;
        await tx`
          insert into engine_pnl (event_ticker, guarantee_losses)
          values (${eventTicker}, ${loss.toString()}::bigint)
          on conflict (event_ticker) do update
            set guarantee_losses = engine_pnl.guarantee_losses + excluded.guarantee_losses
        `;
      }
      const ids = rows.map((row) => row.id);
      await tx`
        update chain_txs
        set payload = payload || jsonb_build_object(${LOSSES_RECORDED_KEY}::text, true)
        where id = any(${ids}::uuid[])
      `;
      this.logger.info(
        {
          txIds: ids,
          losses: Object.fromEntries([...byEvent].map(([event, loss]) => [event, loss.toString()])),
        },
        "guarantee losses of mined final charges booked",
      );
      return rows.length;
    });
  }

  /** Runs `work` once every earlier pass has finished. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lock.then(work, work);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private isBlockedOrWaiting(item: ChargeLot, failures: FailureState): boolean {
    const ticket = key(item.lot.ticketOnchainId);
    const reason = failures.blocked.get(ticket);
    if (reason !== undefined) {
      if (!this.reportedBlocked.has(ticket)) {
        this.reportedBlocked.add(ticket);
        this.logger.error(
          {
            ticketOnchainId: ticket,
            campaignOnchainId: item.lot.campaignOnchainId.toString(),
            reason,
          },
          "chargeHedge refused for this ticket for good: it is no longer offered",
        );
      }
      return true;
    }
    return failures.waiting.has(ticket);
  }

  /** Splits lots into batches: isolated tickets alone, the rest together, in FIFO order. */
  private async submit(
    lots: readonly ChargeLot[],
    failures: FailureState,
    isolatedBatch: boolean,
  ): Promise<ChargePassResult> {
    const shared: ChargeLot[] = [];
    let result: ChargePassResult = { queued: 0, tickets: 0 };
    for (const item of lots) {
      if (this.isBlockedOrWaiting(item, failures)) continue;
      if (failures.isolate.has(key(item.lot.ticketOnchainId))) {
        result = add(result, await this.enqueue(this.batchOf([item], failures, true), [item]));
        continue;
      }
      shared.push(item);
    }
    for (let i = 0; i < shared.length; i += this.batchSize) {
      const chunk = shared.slice(i, i + this.batchSize);
      result = add(result, await this.enqueue(this.batchOf(chunk, failures, isolatedBatch), chunk));
    }
    return result;
  }

  private batchOf(
    lots: readonly ChargeLot[],
    failures: FailureState,
    isolated: boolean,
  ): ChargeBatch {
    const hash = createHash("sha256");
    let failed = 0;
    for (const { lot } of lots) {
      hash.update(`${lot.ticketOnchainId.toString()}:${lot.amount.toString()};`);
      failed += failures.failures.get(key(lot.ticketOnchainId)) ?? 0;
    }
    return {
      isolated,
      ticketIds: lots.map(({ lot }) => lot.ticketOnchainId),
      amounts: lots.map(({ lot }) => lot.amount),
      lots: lots.map(({ lot }) => lot),
      // Derived from the batch's tickets and amounts, and from how many failed transactions held
      // them: the same batch rebuilt after a crash is queued once, and a batch rebuilt after a
      // failure is queued anew.
      idempotencyKey: `${CHARGE_HEDGE_TX_KIND}:rt:${hash.digest("hex")}:${failed.toString()}`,
    };
  }

  private async enqueue(batch: ChargeBatch, lots: readonly ChargeLot[]): Promise<ChargePassResult> {
    if (batch.ticketIds.length === 0) return { queued: 0, tickets: 0 };
    const base = chargeHedgeTxRequest(batch, this.escrow);
    const losses = lots
      .filter((item) => item.guaranteeLoss > 0n && item.eventTicker !== null)
      .map((item) => ({
        ticketId: item.lot.ticketOnchainId.toString(),
        eventTicker: item.eventTicker ?? "",
        loss: item.guaranteeLoss.toString(),
      }));
    // Booked when this transaction is mined (`recordMinedLosses`), never here.
    const request: TxRequest =
      losses.length === 0
        ? base
        : { ...base, payload: { ...base.payload, [GUARANTEE_LOSSES_KEY]: losses } };
    const { id, created } = await this.txSender.enqueue(request);
    if (!created) return { queued: 0, tickets: 0 };
    this.logger.info(
      {
        txId: id,
        idempotencyKey: batch.idempotencyKey,
        tickets: batch.ticketIds.map(String),
        amounts: batch.amounts.map(String),
      },
      "chargeHedge queued",
    );
    return { queued: 1, tickets: batch.ticketIds.length };
  }

  /** Reads the failed `chargeHedge` transactions that hold any of these tickets. */
  private async failureState(lots: readonly { ticketOnchainId: bigint }[]): Promise<FailureState> {
    const state: FailureState = {
      isolate: new Set(),
      blocked: new Map(),
      waiting: new Set(),
      failures: new Map(),
    };
    if (lots.length === 0) return state;
    const tickets = [...new Set(lots.map((lot) => key(lot.ticketOnchainId)))];
    // `waiting`: the latest failure of a lone ticket, while its backoff (base × 2^(failures − 1),
    // capped) is not over. Judged on the database clock, which wrote the failure times.
    const rows = await this.db<
      { ticket_ids: unknown; last_error: string | null; waiting: boolean }[]
    >`
      with failed as (
        select x.payload -> 'ticketIds' as ticket_ids, x.last_error,
               coalesce(x.mined_at, x.sent_at, x.created_at) as failed_at
        from chain_txs x
        where x.kind = ${CHARGE_HEDGE_TX_KIND}
          and x.status in ('reverted', 'failed')
          and x.payload -> 'ticketIds' ?| ${tickets}::text[]
      )
      select f.ticket_ids, f.last_error,
             (jsonb_array_length(f.ticket_ids) = 1
              and f.failed_at = (select max(g.failed_at) from failed g where g.ticket_ids = f.ticket_ids)
              and now() < f.failed_at + make_interval(secs => least(
                ${this.maxBackoffMs / 1000}::double precision,
                ${this.baseBackoffMs / 1000}::double precision
                  * power(2, (select count(*) from failed g where g.ticket_ids = f.ticket_ids) - 1)
              ))) as waiting
      from failed f
    `;
    for (const row of rows) {
      const ids = Array.isArray(row.ticket_ids)
        ? row.ticket_ids.filter((id): id is string => typeof id === "string")
        : [];
      for (const id of ids) state.failures.set(id, (state.failures.get(id) ?? 0) + 1);
      const only = ids.length === 1 ? ids[0] : undefined;
      if (only === undefined) {
        for (const id of ids) state.isolate.add(id);
        continue;
      }
      const reason = row.last_error ?? "";
      const terminal = TERMINAL_CHARGE_ERRORS.find((name) => reason === name);
      if (terminal !== undefined) state.blocked.set(only, terminal);
      else if (row.waiting) state.waiting.add(only);
    }
    return state;
  }
}

/** The `guaranteeLosses` of a payload, and how many of its items could not be read. */
function parseLosses(value: unknown): {
  items: { eventTicker: string; loss: bigint }[];
  malformed: number;
} {
  if (!Array.isArray(value)) return { items: [], malformed: 1 };
  const items: { eventTicker: string; loss: bigint }[] = [];
  let malformed = 0;
  for (const item of value as unknown[]) {
    const record =
      typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const eventTicker = record["eventTicker"];
    const loss = record["loss"];
    if (typeof eventTicker !== "string" || typeof loss !== "string" || !/^[0-9]+$/.test(loss)) {
      malformed += 1;
      continue;
    }
    items.push({ eventTicker, loss: BigInt(loss) });
  }
  return { items, malformed };
}

function add(a: ChargePassResult, b: ChargePassResult): ChargePassResult {
  return { queued: a.queued + b.queued, tickets: a.tickets + b.tickets };
}

function chargeLotOf(row: RemainingLot): ChargeLot {
  const amount = row.cost < row.maxHedgeCost ? row.cost : row.maxHedgeCost;
  // A covered lot's loss was recorded when it was covered (allocation store); a lot covered in
  // part was never "covered", so its loss is recorded here, when its charge is queued.
  const partial = row.filledQty < row.qty;
  return {
    lot: {
      lotId: row.lotId,
      ticketId: row.ticketId,
      ticketOnchainId: row.ticketOnchainId,
      campaignId: row.campaignId,
      campaignOnchainId: row.campaignOnchainId,
      amount,
      maxHedgeCost: row.maxHedgeCost,
    },
    guaranteeLoss: partial ? row.cost - amount : 0n,
    eventTicker: row.eventTicker,
  };
}
