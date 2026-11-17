/**
 * Persistence of the cost allocation (SPEC 9.5, HE-4, EC-5) on Postgres.
 *
 * Every operation runs in ONE transaction, serialised per instrument by a transaction-scoped
 * advisory lock, and also locks the open lots it reads (`for update`). A fill is therefore never
 * stored without its allocation, and two fills of the same instrument recorded at the same time
 * never allocate the same lot quantity twice.
 *
 * Where the unallocated remainder lives: nowhere new. The inventory held ahead of exposure is
 * rebuilt, inside the transaction, from what the schema already records (`rebuildInventory` in
 * core.ts): every buy fill of the instrument in recording order (`fills.created_at`, which this
 * module writes strictly increasing per instrument under the lock), minus its `lot_fills`, minus
 * the quantity of every sell fill of the instrument, taken from the front. Lots and sales both
 * take from the front of that queue, so the rebuilt suffix is exact in quantity, and its cost is
 * each fill's cost minus what its takes cost: nothing is created or lost. A sale beyond what was
 * held unallocated (an over-sale on the venue) is still recorded; the excess is derived the same
 * way (`InventoryState.shortQty`) and the next buy fills replace it before covering any lot.
 *
 * Not stored, for want of a column (a schema change): the platform's result on a resale (proceeds
 * minus cost basis, signed) and the cost of replacing an over-sale. `recordFill` returns them.
 *
 * Charges are not marked here: the chain projection sets `lots.charged` when `HedgeCharged`
 * arrives. `pendingCharges` leaves out every ticket that a `chargeHedge` transaction of the outbox
 * (`chain_txs`) still queued, sent, or mined but not projected yet holds, so a lot is never
 * submitted twice while its transaction is pending.
 */
import { createHash } from "node:crypto";

import type { Logger } from "pino";
import type postgres from "postgres";
import type { Sql, TransactionSql } from "postgres";
import { encodeFunctionData, type Address, type Hex } from "viem";

import { winzEscrowAbi } from "@winz/shared";
import type { Bps, MicroContracts, MicroUsdc, OrderKind } from "@winz/shared";

import type { TxRequest } from "../../chain/types";
import type { FillBookRef, OrderSide, VenueFill } from "../../venues/types";
import {
  allocateInventory,
  chargeForLot,
  fillCost,
  inventoryPiece,
  inventoryTotals,
  makerSaving,
  rebuildInventory,
  sellFromInventory,
  type AllocationLot,
  type InventoryPiece,
  type LotAllocation,
  type RebuiltInventory,
} from "./core";
import {
  AllocationInputError,
  AllocationStateError,
  FillConflictError,
  FillOrderMismatchError,
} from "./errors";

/** A client, or a transaction already open (the operation then runs in a savepoint of it). */
export type AllocationSql = Sql | TransactionSql;

/** `chain_txs.kind` of a `chargeHedge` transaction. Its payload holds `ticketIds` and `amounts`. */
export const CHARGE_HEDGE_TX_KIND = "chargeHedge";

/** Statuses of `chain_txs` in which a `chargeHedge` still holds its tickets. */
const HOLDING_TX_STATUSES = ["queued", "sent", "mined"] as const;
/** Statuses of `chain_txs` in which a `chargeHedge` changed nothing on-chain. */
const FAILED_TX_STATUSES = ["reverted", "failed"] as const;

/** `campaigns.status` values of a settled campaign: the escrow refuses to charge their tickets. */
const SETTLED_CAMPAIGN_STATUSES = ["settled_yes", "settled_no", "void", "closed"] as const;

/**
 * `WinzEscrow.EMERGENCY_DELAY`, in seconds: from `salesClose` plus this, a campaign that was never
 * settled can have its budget released by anyone, after which `chargeHedge` reverts for it.
 */
export const EMERGENCY_DELAY_SECONDS = 7 * 24 * 60 * 60;

/** Most tickets one `chargeHedge` call carries. */
export const MAX_CHARGE_BATCH = 50;

/** A fill as the venue reported it, attached to the `orders` row it executes. */
export interface RecordFillInput {
  /** `orders.id` of the order this fill executes. */
  orderId: string;
  /** The venue's id of the fill: the idempotency key, per order. */
  venueFillId: string;
  priceBps: Bps;
  qty: MicroContracts;
  /** Micro-USDC. */
  fee: MicroUsdc;
  /** When the venue executed it. */
  at: Date;
  /** The book or print it was executed against; null when the venue gives none. */
  bookRef: FillBookRef | null;
}

export interface RecordFillHooks {
  /** Testing seam: runs inside the transaction, right after the fill row is inserted. */
  afterFillInsert?: (tx: TransactionSql) => Promise<void>;
  /** Where an over-sale (a sell fill beyond the unallocated inventory) is reported. */
  logger?: Logger;
}

/** A lot that an operation completed, with what it owes. */
export interface CoveredLot {
  lotId: string;
  ticketId: string;
  campaignId: string;
  eventTicker: string;
  cost: MicroUsdc;
  maxHedgeCost: MicroUsdc;
  /** min(cost, maxHedgeCost): what `chargeHedge` will debit. */
  amount: MicroUsdc;
  /** max(0, cost − maxHedgeCost): added to `engine_pnl.guarantee_losses`. */
  guaranteeLoss: MicroUsdc;
}

export interface InventoryState {
  /** Held ahead of exposure, not allocated to any lot. */
  qty: MicroContracts;
  /** What `qty` cost, micro-USDC. */
  cost: MicroUsdc;
  /**
   * Contracts sold on the venue beyond what was held unallocated (see `RebuiltInventory`): the
   * next buy fills replace them before they cover any lot. 0 in a sound state.
   */
  shortQty: MicroContracts;
}

function inventoryState(
  pieces: readonly InventoryPiece[],
  shortQty: MicroContracts,
): InventoryState {
  return { ...inventoryTotals(pieces), shortQty };
}

export interface AllocationOutcome {
  allocations: LotAllocation[];
  coveredLots: CoveredLot[];
  /** Inventory held ahead of exposure once the operation is done. */
  inventory: InventoryState;
}

export type RecordFillResult =
  | {
      status: "duplicate";
      /** `fills.id` of the row recorded the first time. */
      fillId: string;
    }
  | (AllocationOutcome & {
      status: "recorded";
      fillId: string;
      instrument: string;
      side: OrderSide;
      /** Cost of the fill: ceil(price × qty / 10 000) + fee for a buy. */
      cost: MicroUsdc;
      /** Added to `engine_pnl.maker_savings` (0 for a sell). */
      makerSaving: MicroUsdc;
      /**
       * For a sell only: what the resale brought in, what the sold contracts had cost, and how many
       * were sold beyond the unallocated inventory (`shortQty`, whose cost basis is not in
       * `costBasis`: the buys that replace them carry it).
       */
      sale: {
        proceeds: bigint;
        costBasis: MicroUsdc;
        result: bigint;
        shortQty: MicroContracts;
      } | null;
    });

/** One `chargeHedge` call: parallel arrays, at most `MAX_CHARGE_BATCH` tickets. */
export interface ChargeBatch {
  /**
   * True for a batch of tickets of ONE campaign that entered the escrow's emergency window: its
   * budget may be released at any moment, which makes `chargeHedge` revert, so its tickets never
   * share a batch with other campaigns' (a revert then only delays that campaign).
   */
  isolated: boolean;
  /** On-chain ticket ids, in lot order. */
  ticketIds: bigint[];
  /** Micro-USDC, `amounts[i]` for `ticketIds[i]`, each at most that ticket's `maxHedgeCost`. */
  amounts: bigint[];
  lots: {
    lotId: string;
    ticketId: string;
    ticketOnchainId: bigint;
    campaignId: string;
    campaignOnchainId: bigint;
    amount: MicroUsdc;
    maxHedgeCost: MicroUsdc;
  }[];
  /**
   * Idempotency key for the outbox: the same batch built twice (two workers, a retry after a
   * crash) gets the same key, so it is queued once; a batch rebuilt after a `chargeHedge` holding
   * one of its tickets reverted or failed gets a new one.
   */
  idempotencyKey: string;
}

interface OrderRow {
  id: string;
  instrument: string;
  side: string;
  kind: string;
  qty: bigint;
  event_ticker: string;
}

interface LotRow {
  id: string;
  seq: bigint;
  campaign_id: string;
  ticket_id: string;
  event_ticker: string;
  qty: bigint;
  filled_qty: bigint;
  cost: bigint;
  max_hedge_cost: bigint;
}

async function inTransaction<T>(
  sql: AllocationSql,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  let result: { value: T } | null = null;
  const run = async (tx: TransactionSql): Promise<void> => {
    result = { value: await fn(tx) };
  };
  if ("savepoint" in sql) await sql.savepoint(run);
  else await sql.begin(run);
  if (result === null) throw new AllocationStateError("the transaction ended without a result");
  return (result as { value: T }).value;
}

type JSONValue = postgres.JSONValue;

/** A value as JSON, bigints as decimal strings (how the schema stores wide integers in jsonb). */
function toJson(value: unknown): JSONValue {
  if (typeof value === "bigint") return value.toString();
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item: unknown) => toJson(item));
  if (typeof value === "object") {
    const out: Record<string, JSONValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = toJson(item);
    }
    return out;
  }
  throw new AllocationInputError(`cannot store a ${typeof value} as JSON`);
}

function isOrderSide(value: string): value is OrderSide {
  return value === "buy" || value === "sell";
}

function isOrderKind(value: string): value is OrderKind {
  return value === "maker" || value === "taker";
}

/** Serialises every allocation of one instrument, until the transaction ends. */
async function lockInstrument(tx: TransactionSql, instrument: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`winz:hedge-allocation:${instrument}`}, 0))`;
}

/** The inventory of an instrument, rebuilt from the recorded fills (see the module comment). */
async function loadInventory(
  tx: TransactionSql,
  instrument: string,
  excludeFillId: string | null,
): Promise<RebuiltInventory> {
  const fills = await tx<
    {
      id: string;
      price_bps: number;
      qty: bigint;
      fee: bigint;
      allocated_qty: bigint;
      allocated_cost: bigint;
    }[]
  >`
    select f.id, f.price_bps, f.qty, f.fee,
           coalesce(sum(lf.qty), 0)::bigint as allocated_qty,
           coalesce(sum(lf.cost), 0)::bigint as allocated_cost
    from fills f
    join orders o on o.id = f.order_id
    left join lot_fills lf on lf.fill_id = f.id
    where o.instrument = ${instrument} and o.side = 'buy'
    group by f.id
    having f.qty > coalesce(sum(lf.qty), 0)
    order by f.created_at, f.id
  `;
  const [sold] = await tx<{ qty: bigint }[]>`
    select coalesce(sum(f.qty), 0)::bigint as qty
    from fills f
    join orders o on o.id = f.order_id
    where o.instrument = ${instrument} and o.side = 'sell'
      and (${excludeFillId}::uuid is null or f.id <> ${excludeFillId}::uuid)
  `;
  return rebuildInventory(
    instrument,
    fills.map((fill) => ({
      fillId: fill.id,
      fillQty: fill.qty,
      fillCost: fillCost(BigInt(fill.price_bps), fill.qty, fill.fee),
      allocatedQty: fill.allocated_qty,
      allocatedCost: fill.allocated_cost,
    })),
    sold?.qty ?? 0n,
  );
}

/**
 * The lots of an instrument that can still receive contracts, in FIFO order, locked: not fully
 * covered, not charged (a charged lot never receives more cost), of a campaign not settled.
 */
async function lockOpenLots(tx: TransactionSql, instrument: string): Promise<LotRow[]> {
  return tx<LotRow[]>`
    select l.id, l.seq, l.campaign_id, l.ticket_id, c.event_ticker,
           l.qty, l.filled_qty, l.cost, l.max_hedge_cost
    from lots l
    join campaigns c on c.id = l.campaign_id
    where l.instrument = ${instrument}
      and l.filled_qty < l.qty
      and not l.charged
      and c.status <> all(${[...SETTLED_CAMPAIGN_STATUSES]}::text[])
    order by l.seq
    for update of l
  `;
}

async function addToEnginePnl(
  tx: TransactionSql,
  eventTicker: string,
  amounts: { makerSavings: bigint; guaranteeLosses: bigint },
): Promise<void> {
  if (amounts.makerSavings === 0n && amounts.guaranteeLosses === 0n) return;
  await tx`
    insert into engine_pnl (event_ticker, maker_savings, guarantee_losses)
    values (${eventTicker}, ${amounts.makerSavings.toString()}::bigint, ${amounts.guaranteeLosses.toString()}::bigint)
    on conflict (event_ticker) do update
      set maker_savings = engine_pnl.maker_savings + excluded.maker_savings,
          guarantee_losses = engine_pnl.guarantee_losses + excluded.guarantee_losses
  `;
}

/**
 * Covers the open lots of the instrument with `inventory`, writes `lot_fills` and the lots, and
 * adds the guarantee losses of the lots it completes to `engine_pnl`.
 */
async function allocateAndWrite(
  tx: TransactionSql,
  instrument: string,
  inventory: readonly InventoryPiece[],
  shortQty: MicroContracts,
): Promise<AllocationOutcome> {
  const rows = await lockOpenLots(tx, instrument);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const lots: AllocationLot[] = rows.map((row) => ({
    lotId: row.id,
    seq: row.seq,
    campaignId: row.campaign_id,
    qty: row.qty,
    filledQty: row.filled_qty,
    cost: row.cost,
    maxHedgeCost: row.max_hedge_cost,
  }));
  const result = allocateInventory(lots, inventory);

  for (const allocation of result.allocations) {
    await tx`
      insert into lot_fills (lot_id, fill_id, qty, cost)
      values (${allocation.lotId}, ${allocation.fillId}, ${allocation.qty.toString()}::bigint,
              ${allocation.cost.toString()}::bigint)
      on conflict (lot_id, fill_id) do update
        set qty = lot_fills.qty + excluded.qty, cost = lot_fills.cost + excluded.cost
    `;
  }
  const touched = new Set(result.allocations.map((allocation) => allocation.lotId));
  for (const lot of result.lots) {
    if (!touched.has(lot.lotId)) continue;
    await tx`
      update lots set filled_qty = ${lot.filledQty.toString()}::bigint, cost = ${lot.cost.toString()}::bigint
      where id = ${lot.lotId}
    `;
  }

  const coveredLots: CoveredLot[] = [];
  const lossesByEvent = new Map<string, bigint>();
  const covered = new Set(result.coveredLotIds);
  for (const lot of result.lots) {
    if (!covered.has(lot.lotId)) continue;
    const row = byId.get(lot.lotId);
    const charge = chargeForLot(lot);
    if (row === undefined || charge.status !== "chargeable") {
      throw new AllocationStateError(`lot ${lot.lotId} is reported covered but is not`);
    }
    coveredLots.push({
      lotId: lot.lotId,
      ticketId: row.ticket_id,
      campaignId: row.campaign_id,
      eventTicker: row.event_ticker,
      cost: lot.cost,
      maxHedgeCost: lot.maxHedgeCost,
      amount: charge.amount,
      guaranteeLoss: charge.guaranteeLoss,
    });
    lossesByEvent.set(
      row.event_ticker,
      (lossesByEvent.get(row.event_ticker) ?? 0n) + charge.guaranteeLoss,
    );
  }
  for (const [eventTicker, guaranteeLosses] of lossesByEvent) {
    await addToEnginePnl(tx, eventTicker, { makerSavings: 0n, guaranteeLosses });
  }
  return {
    allocations: result.allocations,
    coveredLots,
    inventory: inventoryState(result.inventory, shortQty),
  };
}

function validateRecordFillInput(fill: RecordFillInput): void {
  if (fill.orderId === "") throw new AllocationInputError("order id is empty");
  if (fill.venueFillId === "") throw new AllocationInputError("venue fill id is empty");
  if (fill.qty <= 0n)
    throw new AllocationInputError(`fill ${fill.venueFillId}: qty must be positive`);
  if (fill.fee < 0n)
    throw new AllocationInputError(`fill ${fill.venueFillId}: fee must not be negative`);
  if (fill.priceBps < 0n || fill.priceBps > 10_000n) {
    throw new AllocationInputError(
      `fill ${fill.venueFillId}: price must be between 0 and 10000 bps`,
    );
  }
  if (Number.isNaN(fill.at.getTime()))
    throw new AllocationInputError(`fill ${fill.venueFillId}: invalid time`);
}

/** A venue fill as `recordFill` takes it, for the `orders` row `orderId` it executes. */
export function recordFillInput(orderId: string, fill: VenueFill): RecordFillInput {
  return {
    orderId,
    venueFillId: fill.fillId,
    priceBps: fill.priceBps,
    qty: fill.qty,
    fee: fill.fee,
    at: new Date(fill.atMs),
    bookRef: fill.bookRef,
  };
}

/**
 * Records a venue fill and allocates it, in one transaction.
 *
 * Buy: the inventory already held and then this fill cover the instrument's open lots in FIFO
 * order; what is left stays as inventory for the next lots. If an earlier over-sale left a short,
 * the fill replaces it first.
 *
 * Sell: a sale is a real execution on the venue and is always recorded. It takes from the front
 * of the unallocated inventory BEFORE that inventory covers any lot created in the meantime: the
 * contracts were sold, so they cannot cover a lot that arrived after the decision to sell. What is
 * left then covers the open lots. A sale larger than the unallocated inventory is recorded too:
 * the excess is returned as `shortQty`, logged as an error, and replaced by the next buy fills;
 * lots already covered stay covered (their merchants were charged the real cost). Its proceeds
 * never reach a lot.
 *
 * Idempotent on (order, venue fill id): the same fill again changes nothing, and the same id with
 * different values throws `FillConflictError`.
 */
export async function recordFill(
  sql: AllocationSql,
  fill: RecordFillInput,
  hooks: RecordFillHooks = {},
): Promise<RecordFillResult> {
  validateRecordFillInput(fill);
  return inTransaction(sql, async (tx): Promise<RecordFillResult> => {
    const [order] = await tx<OrderRow[]>`
      select o.id, o.instrument, o.side, o.kind, o.qty, i.event_ticker
      from orders o join instruments i on i.symbol = o.instrument
      where o.id = ${fill.orderId}
    `;
    if (order === undefined)
      throw new FillOrderMismatchError(`order ${fill.orderId} does not exist`);
    if (!isOrderSide(order.side) || !isOrderKind(order.kind)) {
      throw new FillOrderMismatchError(
        `order ${fill.orderId} has side ${order.side} and kind ${order.kind}`,
      );
    }
    const side = order.side;
    const kind = order.kind;
    await lockInstrument(tx, order.instrument);

    const bookRef = fill.bookRef === null ? null : tx.json(toJson(fill.bookRef));
    // `created_at` is the queue order of the inventory: strictly increasing per instrument, and
    // written under the instrument lock, so a fill recorded later always joins the queue last.
    const inserted = await tx<{ id: string }[]>`
      insert into fills (order_id, price_bps, qty, fee, ts, book_ref, venue_fill_id, created_at)
      values (
        ${fill.orderId}, ${Number(fill.priceBps)}, ${fill.qty.toString()}::bigint,
        ${fill.fee.toString()}::bigint, ${fill.at}, ${bookRef}, ${fill.venueFillId},
        greatest(
          clock_timestamp(),
          (select max(f.created_at) + interval '1 microsecond'
           from fills f join orders o on o.id = f.order_id
           where o.instrument = ${order.instrument})
        )
      )
      on conflict (order_id, venue_fill_id) where venue_fill_id is not null do nothing
      returning id
    `;
    const row = inserted[0];
    if (row === undefined) {
      const [existing] = await tx<{ id: string; price_bps: number; qty: bigint; fee: bigint }[]>`
        select id, price_bps, qty, fee from fills
        where order_id = ${fill.orderId} and venue_fill_id = ${fill.venueFillId}
      `;
      if (existing === undefined) {
        throw new AllocationStateError(`fill ${fill.venueFillId} conflicted but cannot be found`);
      }
      if (
        BigInt(existing.price_bps) !== fill.priceBps ||
        existing.qty !== fill.qty ||
        existing.fee !== fill.fee
      ) {
        throw new FillConflictError(
          fill.venueFillId,
          `recorded as ${existing.qty.toString()} at ${existing.price_bps.toString()} bps fee ` +
            `${existing.fee.toString()}, received ${fill.qty.toString()} at ${fill.priceBps.toString()} bps ` +
            `fee ${fill.fee.toString()}`,
        );
      }
      return { status: "duplicate", fillId: existing.id };
    }

    const [filled] = await tx<{ qty: bigint }[]>`
      select coalesce(sum(qty), 0)::bigint as qty from fills where order_id = ${fill.orderId}
    `;
    if ((filled?.qty ?? 0n) > order.qty) {
      throw new FillOrderMismatchError(
        `order ${fill.orderId}: fills add up to ${(filled?.qty ?? 0n).toString()} micro-contracts, ` +
          `more than its ${order.qty.toString()}`,
      );
    }

    if (hooks.afterFillInsert !== undefined) await hooks.afterFillInsert(tx);

    if (side === "buy") {
      // The new fill was written last in the queue, so it is the last piece of the inventory.
      const inventory = await loadInventory(tx, order.instrument, null);
      const outcome = await allocateAndWrite(
        tx,
        order.instrument,
        inventory.pieces,
        inventory.shortQty,
      );
      const saving = makerSaving({
        side,
        kind,
        priceBps: fill.priceBps,
        qty: fill.qty,
        fee: fill.fee,
        bookRef: fill.bookRef,
      });
      await addToEnginePnl(tx, order.event_ticker, { makerSavings: saving, guaranteeLosses: 0n });
      return {
        status: "recorded",
        fillId: row.id,
        instrument: order.instrument,
        side,
        cost: inventoryPiece({
          fillId: row.id,
          priceBps: fill.priceBps,
          qty: fill.qty,
          fee: fill.fee,
        }).fillCost,
        makerSaving: saving,
        sale: null,
        allocations: outcome.allocations,
        coveredLots: outcome.coveredLots,
        inventory: outcome.inventory,
      };
    }

    // The sale takes from the front of what was held before it, then what is left covers the
    // open lots: the same order `loadInventory` rebuilds (sold quantity first, then lot_fills).
    const held = await loadInventory(tx, order.instrument, row.id);
    const sale = sellFromInventory(
      order.instrument,
      held.pieces,
      { fillId: row.id, priceBps: fill.priceBps, qty: fill.qty, fee: fill.fee },
      { allowShort: true },
    );
    const shortQty = held.shortQty + sale.shortQty;
    if (sale.shortQty > 0n) {
      hooks.logger?.error(
        {
          instrument: order.instrument,
          fillId: row.id,
          venueFillId: fill.venueFillId,
          soldQty: fill.qty.toString(),
          heldQty: (fill.qty - sale.shortQty).toString(),
          shortQty: shortQty.toString(),
        },
        "sell fill beyond the unallocated inventory: recorded as a short, the next buys replace it",
      );
    }
    const outcome = await allocateAndWrite(tx, order.instrument, sale.inventory, shortQty);
    return {
      status: "recorded",
      fillId: row.id,
      instrument: order.instrument,
      side,
      cost: sale.costBasis,
      makerSaving: 0n,
      sale: {
        proceeds: sale.proceeds,
        costBasis: sale.costBasis,
        result: sale.result,
        shortQty: sale.shortQty,
      },
      allocations: outcome.allocations,
      coveredLots: outcome.coveredLots,
      inventory: outcome.inventory,
    };
  });
}

/**
 * Covers the open lots of an instrument with the inventory already held, in one transaction.
 * Call it after lots were created (a `TicketPurchased` projected): contracts bought ahead of that
 * exposure then cover the new lots without waiting for the next fill.
 */
export async function allocateHeldInventory(
  sql: AllocationSql,
  instrument: string,
): Promise<AllocationOutcome> {
  if (instrument === "") throw new AllocationInputError("instrument is empty");
  return inTransaction(sql, async (tx): Promise<AllocationOutcome> => {
    await lockInstrument(tx, instrument);
    const inventory = await loadInventory(tx, instrument, null);
    return allocateAndWrite(tx, instrument, inventory.pieces, inventory.shortQty);
  });
}

/**
 * `allocateHeldInventory` for every instrument that has an open lot, each in its own transaction:
 * one call per tick of the hedging loop (or after a projection batch) covers the lots created
 * while inventory was already held, without the caller knowing which instruments they are on.
 * Returns the outcomes of the instruments where something was allocated.
 */
export async function allocateHeldInventoryForOpenLots(
  sql: AllocationSql,
): Promise<{ instrument: string; outcome: AllocationOutcome }[]> {
  const instruments = await sql<{ instrument: string }[]>`
    select distinct l.instrument
    from lots l
    join campaigns c on c.id = l.campaign_id
    where l.filled_qty < l.qty
      and not l.charged
      and c.status <> all(${[...SETTLED_CAMPAIGN_STATUSES]}::text[])
    order by l.instrument
  `;
  const results: { instrument: string; outcome: AllocationOutcome }[] = [];
  for (const { instrument } of instruments) {
    const outcome = await allocateHeldInventory(sql, instrument);
    if (outcome.allocations.length > 0) results.push({ instrument, outcome });
  }
  return results;
}

/** The inventory an instrument holds ahead of exposure, as `recordFill` would rebuild it now. */
export async function heldInventoryOf(
  sql: AllocationSql,
  instrument: string,
): Promise<InventoryState> {
  return inTransaction(sql, async (tx): Promise<InventoryState> => {
    await lockInstrument(tx, instrument);
    const inventory = await loadInventory(tx, instrument, null);
    return inventoryState(inventory.pieces, inventory.shortQty);
  });
}

function batchKey(
  lots: readonly { ticketOnchainId: bigint; amount: bigint }[],
  failedAttempts: bigint,
): string {
  const hash = createHash("sha256");
  for (const lot of lots)
    hash.update(`${lot.ticketOnchainId.toString()}:${lot.amount.toString()};`);
  return `${CHARGE_HEDGE_TX_KIND}:${hash.digest("hex")}:${failedAttempts.toString()}`;
}

/**
 * Covered lots not charged yet, as `chargeHedge` batches of at most `batchSize` (≤ 50) tickets,
 * in FIFO order, at most `limit` lots in all. Leaves out: lots of a settled campaign (the escrow
 * would revert the whole batch), lots of a campaign whose budget was released (a stored
 * `CampaignReleased` event: `chargeHedge` reverts with `AlreadyReleased`), lots whose ticket or
 * campaign has no on-chain id yet, and lots whose ticket a `chargeHedge` of the outbox still holds
 * (queued, sent, or mined and not yet projected). A lot of zero quantity is covered from the start
 * and comes with amount 0.
 *
 * A campaign `at` or past `salesClose + EMERGENCY_DELAY` can be released before the batch is
 * mined, so its lots go in batches of their own (`isolated`), never mixed with other campaigns'.
 * `at` defaults to the database clock.
 */
export async function pendingCharges(
  sql: AllocationSql,
  options: { limit: number; batchSize?: number; at?: Date },
): Promise<ChargeBatch[]> {
  const batchSize = options.batchSize ?? MAX_CHARGE_BATCH;
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
    throw new AllocationInputError(
      `limit must be a positive integer, got ${options.limit.toString()}`,
    );
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_CHARGE_BATCH) {
    throw new AllocationInputError(
      `batch size must be between 1 and ${MAX_CHARGE_BATCH.toString()}`,
    );
  }
  if (options.at !== undefined && Number.isNaN(options.at.getTime())) {
    throw new AllocationInputError("at is not a valid time");
  }
  const at = options.at ?? null;
  const rows = await sql<
    {
      lot_id: string;
      qty: bigint;
      filled_qty: bigint;
      cost: bigint;
      max_hedge_cost: bigint;
      ticket_id: string;
      ticket_onchain_id: bigint;
      campaign_id: string;
      campaign_onchain_id: bigint;
      emergency: boolean;
    }[]
  >`
    select l.id as lot_id, l.qty, l.filled_qty, l.cost, l.max_hedge_cost,
           t.id as ticket_id, t.onchain_id as ticket_onchain_id,
           c.id as campaign_id, c.onchain_id as campaign_onchain_id,
           c.sales_close + make_interval(secs => ${EMERGENCY_DELAY_SECONDS}::double precision)
             <= coalesce(${at}::timestamptz, now()) as emergency
    from lots l
    join tickets t on t.id = l.ticket_id
    join campaigns c on c.id = l.campaign_id
    where not l.charged
      and l.filled_qty = l.qty
      and t.onchain_id is not null
      and c.onchain_id is not null
      and c.outcome is null
      and c.status <> all(${[...SETTLED_CAMPAIGN_STATUSES]}::text[])
      and not exists (
        select 1 from chain_events e
        where e.name = 'CampaignReleased' and e.args ->> 'id' = c.onchain_id::text
      )
      and not exists (
        select 1 from chain_txs x
        where x.kind = ${CHARGE_HEDGE_TX_KIND}
          and x.status = any(${[...HOLDING_TX_STATUSES]}::text[])
          and x.payload -> 'ticketIds' ? t.onchain_id::text
      )
    order by l.seq
    limit ${options.limit}
  `;

  // Chunks in FIFO order of their first lot: one shared stream for ordinary campaigns, one stream
  // per campaign in the emergency window.
  const streams = new Map<string, { isolated: boolean; lots: ChargeBatch["lots"] }[]>();
  const chunks: { isolated: boolean; lots: ChargeBatch["lots"] }[] = [];
  for (const row of rows) {
    const charge = chargeForLot({
      qty: row.qty,
      filledQty: row.filled_qty,
      cost: row.cost,
      maxHedgeCost: row.max_hedge_cost,
    });
    if (charge.status !== "chargeable")
      throw new AllocationStateError(`lot ${row.lot_id} is not covered`);
    const lot: ChargeBatch["lots"][number] = {
      lotId: row.lot_id,
      ticketId: row.ticket_id,
      ticketOnchainId: row.ticket_onchain_id,
      campaignId: row.campaign_id,
      campaignOnchainId: row.campaign_onchain_id,
      amount: charge.amount,
      maxHedgeCost: row.max_hedge_cost,
    };
    const key = row.emergency ? `campaign:${row.campaign_id}` : "shared";
    const stream = streams.get(key) ?? [];
    streams.set(key, stream);
    const current = stream[stream.length - 1];
    if (current !== undefined && current.lots.length < batchSize) {
      current.lots.push(lot);
    } else {
      const chunk = { isolated: row.emergency, lots: [lot] };
      stream.push(chunk);
      chunks.push(chunk);
    }
  }

  const batches: ChargeBatch[] = [];
  for (const chunk of chunks) {
    const ticketIds = chunk.lots.map((lot) => lot.ticketOnchainId);
    const [failed] = await sql<{ n: bigint }[]>`
      select count(*)::bigint as n from chain_txs x
      where x.kind = ${CHARGE_HEDGE_TX_KIND}
        and x.status = any(${[...FAILED_TX_STATUSES]}::text[])
        and x.payload -> 'ticketIds' ?| ${ticketIds.map((id) => id.toString())}::text[]
    `;
    batches.push({
      isolated: chunk.isolated,
      ticketIds,
      amounts: chunk.lots.map((lot) => lot.amount),
      lots: chunk.lots,
      idempotencyKey: batchKey(chunk.lots, failed?.n ?? 0n),
    });
  }
  return batches;
}

/**
 * The outbox request of a batch: `chargeHedge(ticketIds, amounts)` from the oracle key, with the
 * payload `pendingCharges` reads to leave its tickets out while it is pending.
 */
export function chargeHedgeTxRequest(batch: ChargeBatch, escrow: Address): TxRequest {
  if (batch.ticketIds.length === 0 || batch.ticketIds.length !== batch.amounts.length) {
    throw new AllocationInputError(
      "a charge batch needs as many amounts as tickets, and at least one",
    );
  }
  if (batch.ticketIds.length > MAX_CHARGE_BATCH) {
    throw new AllocationInputError(
      `a charge batch holds at most ${MAX_CHARGE_BATCH.toString()} tickets`,
    );
  }
  const data: Hex = encodeFunctionData({
    abi: winzEscrowAbi,
    functionName: "chargeHedge",
    args: [batch.ticketIds, batch.amounts],
  });
  return {
    idempotencyKey: batch.idempotencyKey,
    signer: "oracle",
    kind: CHARGE_HEDGE_TX_KIND,
    to: escrow,
    data,
    payload: {
      ticketIds: batch.ticketIds.map((id) => id.toString()),
      amounts: batch.amounts.map((amount) => amount.toString()),
    },
  };
}
