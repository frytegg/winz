import type { Outcome } from "@winz/shared";

import type { TxStatus } from "../chain";
import type { Db } from "../db";
import type { SettlementCampaign } from "./types";

/**
 * The database reads of the watcher, and its one write (`campaigns.demo`). Tickets, lots and
 * campaign statuses are the chain projection's; this module never writes them.
 *
 * Ticket lists come from `chain_events` (the escrow's own events, written by the transaction
 * receipts and the log poller) rather than from `tickets`, which the projector derives from the
 * same rows a little later. Every list is a hint checked against the chain before money moves.
 */

interface CandidateRow {
  id: string;
  onchain_id: bigint | null;
  instrument: string;
  outcome: Outcome | null;
  forced: boolean;
}

function toCampaign(row: CandidateRow): SettlementCampaign | null {
  if (row.onchain_id === null || row.outcome === null) return null;
  return {
    id: row.id,
    onchainId: row.onchain_id,
    instrument: row.instrument,
    outcome: row.outcome,
    forced: row.forced,
  };
}

/**
 * Campaigns the watcher has work for, at chain time `chainNow`: on-chain (an `onchain_id`), sales
 * closed, and a result known for their instrument (a forced demo result wins over Gemini's).
 * Unsettled ones, and settled ones that are not finished as far as `chain_events` and the
 * projection know: not released, a `merchantDue` never paid, or (YES) a ticket not refunded.
 */
export async function findCandidates(db: Db, chainNow: Date): Promise<SettlementCampaign[]> {
  const rows = await db<CandidateRow[]>`
    select c.id, c.onchain_id, c.instrument,
           coalesce(d.forced_result, i.outcome) as outcome,
           (d.forced_result is not null) as forced
    from campaigns c
    join instruments i on i.symbol = c.instrument
    left join demo_overrides d on d.instrument = c.instrument
    where c.onchain_id is not null
      and c.sales_close <= ${chainNow}
      and coalesce(d.forced_result, i.outcome) is not null
      and (
        c.status in ('live', 'paused', 'sales_closed')
        or (
          c.status in ('settled_yes', 'settled_no', 'void')
          and (
            not exists (
              select 1 from chain_events e
              where e.name = 'CampaignReleased' and e.args ->> 'id' = c.onchain_id::text
            )
            or (
              exists (
                select 1 from chain_events e
                where e.name = 'CampaignSettled' and e.args ->> 'id' = c.onchain_id::text
                  and (e.args ->> 'merchantDue')::numeric > 0
              )
              and not exists (
                select 1 from chain_events e
                where e.name = 'MerchantPaid' and e.args ->> 'id' = c.onchain_id::text
              )
            )
            or (
              c.status = 'settled_yes'
              and exists (
                select 1 from tickets t where t.campaign_id = c.id and t.status <> 'refunded'
              )
            )
          )
        )
      )
    order by c.sales_close, c.onchain_id
  `;
  return rows.map(toCampaign).filter((row): row is SettlementCampaign => row !== null);
}

export interface CampaignLookup {
  exists: boolean;
  /** Null when the campaign is not on-chain yet or its instrument has no result. */
  campaign: SettlementCampaign | null;
  onchainId: bigint | null;
}

/** One campaign by `campaigns.id`, whatever its state (for `settleCampaignNow`). */
export async function findCampaign(db: Db, campaignId: string): Promise<CampaignLookup> {
  const rows = await db<CandidateRow[]>`
    select c.id, c.onchain_id, c.instrument,
           coalesce(d.forced_result, i.outcome) as outcome,
           (d.forced_result is not null) as forced
    from campaigns c
    join instruments i on i.symbol = c.instrument
    left join demo_overrides d on d.instrument = c.instrument
    where c.id::text = ${campaignId}
  `;
  const row = rows[0];
  if (row === undefined) return { exists: false, campaign: null, onchainId: null };
  return { exists: true, campaign: toCampaign(row), onchainId: row.onchain_id };
}

/** Marks a campaign settled on a forced result as a demo campaign. */
export async function markDemo(db: Db, campaignId: string): Promise<boolean> {
  const rows = await db<{ id: string }[]>`
    update campaigns set demo = true where id = ${campaignId} and demo = false returning id
  `;
  return rows.length > 0;
}

/** A ticket of a campaign, as `chain_events` and the projection know it. */
export interface KnownTicket {
  ticketId: bigint;
  refundable: bigint;
  maxHedgeCost: bigint;
  /** A `HedgeCharged` of the ticket is stored. */
  charged: boolean;
  /** A `TicketRefunded` of the ticket is stored. */
  refunded: boolean;
  /** Number of `RefundFailed` stored for the ticket. */
  refundFailures: number;
  /** The ticket's lot, when projected. */
  lotCost: bigint | null;
  lotFilledQty: bigint | null;
  lotMaxHedgeCost: bigint | null;
}

interface KnownTicketRow {
  ticket_id: string;
  refundable: string;
  max_hedge_cost: string;
  charged: boolean | null;
  refunded: boolean | null;
  refund_failures: number | null;
  lot_cost: bigint | null;
  lot_filled_qty: bigint | null;
  lot_max_hedge_cost: bigint | null;
}

/** Every ticket bought on a campaign, in ticket id order, with what is known of its state. */
export async function knownTickets(db: Db, onchainId: bigint): Promise<KnownTicket[]> {
  const id = onchainId.toString();
  const rows = await db<KnownTicketRow[]>`
    with purchased as (
      select distinct on ((args ->> 'ticketId')::numeric(78, 0))
             (args ->> 'ticketId')::numeric(78, 0) as ticket_id,
             (args ->> 'refundable')::numeric(78, 0) as refundable,
             (args ->> 'maxHedgeCost')::numeric(78, 0) as max_hedge_cost
      from chain_events
      where name = 'TicketPurchased' and args ->> 'id' = ${id}
      order by (args ->> 'ticketId')::numeric(78, 0)
    ),
    later as (
      select (args ->> 'ticketId')::numeric(78, 0) as ticket_id,
             bool_or(name = 'HedgeCharged') as charged,
             bool_or(name = 'TicketRefunded') as refunded,
             (count(*) filter (where name = 'RefundFailed'))::integer as refund_failures
      from chain_events
      where name in ('HedgeCharged', 'TicketRefunded', 'RefundFailed') and args ->> 'id' = ${id}
      group by 1
    )
    select p.ticket_id::text as ticket_id, p.refundable::text as refundable,
           p.max_hedge_cost::text as max_hedge_cost,
           later.charged, later.refunded, later.refund_failures,
           l.cost as lot_cost, l.filled_qty as lot_filled_qty,
           l.max_hedge_cost as lot_max_hedge_cost
    from purchased p
    left join later on later.ticket_id = p.ticket_id
    left join tickets t on t.onchain_id = p.ticket_id
    left join lots l on l.ticket_id = t.id
    order by p.ticket_id
  `;
  return rows.map((row) => ({
    ticketId: BigInt(row.ticket_id),
    refundable: BigInt(row.refundable),
    maxHedgeCost: BigInt(row.max_hedge_cost),
    charged: row.charged === true,
    refunded: row.refunded === true,
    refundFailures: row.refund_failures ?? 0,
    lotCost: row.lot_cost,
    lotFilledQty: row.lot_filled_qty,
    lotMaxHedgeCost: row.lot_max_hedge_cost,
  }));
}

/** A row of `chain_txs` the watcher wrote, as far as the step logic needs it. */
export interface StepTxRow {
  id: string;
  idempotencyKey: string;
  status: TxStatus;
  lastError: string | null;
}

/** The watcher's transactions whose idempotency key starts with `prefix`, oldest first. */
export async function stepTxs(db: Db, prefix: string): Promise<StepTxRow[]> {
  const rows = await db<
    { id: string; idempotency_key: string; status: TxStatus; last_error: string | null }[]
  >`
    select id, idempotency_key, status, last_error
    from chain_txs
    where starts_with(idempotency_key, ${prefix})
    order by created_at, idempotency_key
  `;
  return rows.map((row) => ({
    id: row.id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    lastError: row.last_error,
  }));
}
