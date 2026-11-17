/**
 * What the hedging service reads from, and writes to, Postgres outside the policy events: the
 * instruments to hedge, the state a runner is rebuilt from after a restart, and the clean-up of a
 * paper venue's orders that did not survive the previous process.
 */
import type { MicroContracts } from "@winz/shared";

import type { AllocationSql } from "../allocation";
import { orderSeqOf } from "./ids";

/** `campaigns.status` values of a settled campaign (the projection's list). */
export const SETTLED_CAMPAIGN_STATUSES = ["settled_yes", "settled_no", "void", "closed"] as const;
/** `orders.status` values of an order the venue may still fill. */
export const OPEN_ORDER_STATUSES = ["working", "partially_filled"] as const;

/** One instrument the hedging service may have to follow, as the database has it now. */
export interface HedgeInstrumentRow {
  symbol: string;
  eventTicker: string;
  label: string;
  eventTitle: string;
  eventStartsAt: Date;
  /** `positions.exposure`: written by the chain projection only. */
  exposure: MicroContracts;
  held: MicroContracts;
  openOrders: number;
  /** Campaigns on-chain and not settled. */
  unsettledCampaigns: number;
  /** Latest `sales_close` of those campaigns; null when there is none. */
  lastSalesClose: Date | null;
}

/**
 * Every instrument with a position or an open order, with what decides whether it needs a runner
 * (`needsRunner`) and whether its sales are over.
 */
export async function listHedgeInstruments(sql: AllocationSql): Promise<HedgeInstrumentRow[]> {
  const rows = await sql<
    {
      symbol: string;
      event_ticker: string;
      label: string;
      title: string;
      starts_at: Date;
      exposure: bigint;
      held: bigint;
      open_orders: bigint;
      unsettled_campaigns: bigint;
      last_sales_close: Date | null;
    }[]
  >`
    with candidates as (
      select instrument from positions
      union
      select instrument from orders where status = any(${[...OPEN_ORDER_STATUSES]}::text[])
    )
    select i.symbol, i.event_ticker, i.label, e.title, e.starts_at,
           coalesce(p.exposure, 0)::bigint as exposure,
           coalesce(p.held, 0)::bigint as held,
           (select count(*) from orders o
             where o.instrument = i.symbol
               and o.status = any(${[...OPEN_ORDER_STATUSES]}::text[]))::bigint as open_orders,
           (select count(*) from campaigns c
             where c.instrument = i.symbol and c.onchain_id is not null
               and c.status <> all(${[...SETTLED_CAMPAIGN_STATUSES]}::text[]))::bigint
             as unsettled_campaigns,
           (select max(c.sales_close) from campaigns c
             where c.instrument = i.symbol and c.onchain_id is not null
               and c.status <> all(${[...SETTLED_CAMPAIGN_STATUSES]}::text[])) as last_sales_close
    from candidates k
    join instruments i on i.symbol = k.instrument
    join events e on e.ticker = i.event_ticker
    left join positions p on p.instrument = i.symbol
    order by i.symbol
  `;
  return rows.map((row) => ({
    symbol: row.symbol,
    eventTicker: row.event_ticker,
    label: row.label,
    eventTitle: row.title,
    eventStartsAt: row.starts_at,
    exposure: row.exposure,
    held: row.held,
    openOrders: Number(row.open_orders),
    unsettledCampaigns: Number(row.unsettled_campaigns),
    lastSalesClose: row.last_sales_close,
  }));
}

/**
 * Whether an instrument needs a runner: an order is open, or a campaign on it is not settled and
 * something is owed or held. Once every campaign is settled, what is held stays held (the venue
 * pays it out) and nothing more is traded.
 */
export function needsRunner(row: HedgeInstrumentRow): boolean {
  if (row.openOrders > 0) return true;
  return row.unsettledCampaigns > 0 && (row.exposure > 0n || row.held > 0n);
}

/** True once every unsettled campaign of the instrument is past its sales close. */
export function salesOver(row: HedgeInstrumentRow, now: Date): boolean {
  return (
    row.unsettledCampaigns > 0 &&
    row.lastSalesClose !== null &&
    row.lastSalesClose.getTime() <= now.getTime()
  );
}

/** One instrument row, or null. */
export async function getHedgeInstrument(
  sql: AllocationSql,
  symbol: string,
): Promise<HedgeInstrumentRow | null> {
  const rows = await listHedgeInstruments(sql);
  return rows.find((row) => row.symbol === symbol) ?? null;
}

/** What a runner is rebuilt from (the fields of `PolicyRestore`). */
export interface RestoreState {
  exposure: MicroContracts;
  /** Bought minus sold, from the recorded fills of the instrument (never below zero). */
  held: MicroContracts;
  nextOrderSeq: number;
  /** Open orders of this venue and prefix, with the quantity their recorded fills add up to. */
  openOrders: { clientOrderId: string; recordedFilledQty: MicroContracts }[];
}

export async function loadRestoreState(
  sql: AllocationSql,
  instrument: string,
  venue: string,
  prefix: string,
): Promise<RestoreState> {
  const [position] = await sql<{ exposure: bigint }[]>`
    select exposure from positions where instrument = ${instrument}
  `;
  const [held] = await sql<{ bought: bigint; sold: bigint }[]>`
    select coalesce(sum(f.qty) filter (where o.side = 'buy'), 0)::bigint as bought,
           coalesce(sum(f.qty) filter (where o.side = 'sell'), 0)::bigint as sold
    from fills f join orders o on o.id = f.order_id
    where o.instrument = ${instrument}
  `;
  const ids = await sql<{ venue_order_id: string }[]>`
    select venue_order_id from orders
    where venue = ${venue} and venue_order_id like ${`${prefix}-%`}
  `;
  let maxSeq = 0;
  for (const row of ids) {
    const seq = orderSeqOf(prefix, row.venue_order_id);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  const open = await sql<{ venue_order_id: string; recorded: bigint }[]>`
    select o.venue_order_id, coalesce(sum(f.qty), 0)::bigint as recorded
    from orders o left join fills f on f.order_id = o.id
    where o.instrument = ${instrument} and o.venue = ${venue}
      and o.venue_order_id like ${`${prefix}-%`}
      and o.status = any(${[...OPEN_ORDER_STATUSES]}::text[])
    group by o.id
    order by o.created_at
  `;
  const bought = held?.bought ?? 0n;
  const sold = held?.sold ?? 0n;
  return {
    exposure: position?.exposure ?? 0n,
    held: bought > sold ? bought - sold : 0n,
    nextOrderSeq: maxSeq + 1,
    openOrders: open.map((row) => ({
      clientOrderId: row.venue_order_id,
      recordedFilledQty: row.recorded,
    })),
  };
}

/**
 * Marks cancelled every open order of a venue that keeps nothing across a restart (the paper
 * venue): those orders no longer exist anywhere, and a fill can never reach them. Returns them.
 */
export async function cancelVanishedOrders(
  sql: AllocationSql,
  venue: string,
): Promise<{ instrument: string; clientOrderId: string | null }[]> {
  const rows = await sql<{ instrument: string; venue_order_id: string | null }[]>`
    update orders set status = 'cancelled'
    where venue = ${venue} and status = any(${[...OPEN_ORDER_STATUSES]}::text[])
    returning instrument, venue_order_id
  `;
  return rows.map((row) => ({ instrument: row.instrument, clientOrderId: row.venue_order_id }));
}

/**
 * At a restore: H as the recorded fills have it, W zero (the runner has placed nothing yet).
 * Creates the position when the instrument has none.
 */
export async function resetPosition(
  sql: AllocationSql,
  instrument: string,
  held: MicroContracts,
  venue: string,
): Promise<void> {
  await sql`
    insert into positions (instrument, held, working, venue)
    values (${instrument}, ${held.toString()}::bigint, 0, ${venue})
    on conflict (instrument) do update
      set held = excluded.held, working = 0, venue = excluded.venue
  `;
}

/** W as the runner reports it. Writes nothing when it is unchanged. */
export async function writeWorking(
  sql: AllocationSql,
  instrument: string,
  working: MicroContracts,
): Promise<void> {
  await sql`
    update positions set working = ${working.toString()}::bigint
    where instrument = ${instrument} and working <> ${working.toString()}::bigint
  `;
}

/** The uncharged lots of some campaigns, with their on-chain ids, for the final charges. */
export interface RemainingLot {
  lotId: string;
  ticketId: string;
  ticketOnchainId: bigint;
  campaignId: string;
  campaignOnchainId: bigint;
  eventTicker: string;
  qty: MicroContracts;
  filledQty: MicroContracts;
  cost: bigint;
  maxHedgeCost: bigint;
}

/**
 * Lots of these campaigns not charged yet, whatever their coverage, in FIFO order. Leaves out the
 * lots `pendingCharges` would also leave out (no on-chain id yet, campaign settled or released)
 * and the tickets a `chargeHedge` of the outbox still holds (queued, sent, or mined and not
 * projected yet).
 */
export async function remainingLots(
  sql: AllocationSql,
  campaignIds: readonly string[],
): Promise<RemainingLot[]> {
  if (campaignIds.length === 0) return [];
  const rows = await sql<
    {
      lot_id: string;
      ticket_id: string;
      ticket_onchain_id: bigint;
      campaign_id: string;
      campaign_onchain_id: bigint;
      event_ticker: string;
      qty: bigint;
      filled_qty: bigint;
      cost: bigint;
      max_hedge_cost: bigint;
    }[]
  >`
    select l.id as lot_id, t.id as ticket_id, t.onchain_id as ticket_onchain_id,
           c.id as campaign_id, c.onchain_id as campaign_onchain_id, c.event_ticker,
           l.qty, l.filled_qty, l.cost, l.max_hedge_cost
    from lots l
    join tickets t on t.id = l.ticket_id
    join campaigns c on c.id = l.campaign_id
    where l.campaign_id = any(${[...campaignIds]}::uuid[])
      and not l.charged
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
        where x.kind = 'chargeHedge'
          and x.status in ('queued', 'sent', 'mined')
          and x.payload -> 'ticketIds' ? t.onchain_id::text
      )
    order by l.seq
  `;
  return rows.map((row) => ({
    lotId: row.lot_id,
    ticketId: row.ticket_id,
    ticketOnchainId: row.ticket_onchain_id,
    campaignId: row.campaign_id,
    campaignOnchainId: row.campaign_onchain_id,
    eventTicker: row.event_ticker,
    qty: row.qty,
    filledQty: row.filled_qty,
    cost: row.cost,
    maxHedgeCost: row.max_hedge_cost,
  }));
}

/** Unsettled on-chain campaigns of an instrument whose sales are closed at `at`. */
export async function closedCampaignsOf(
  sql: AllocationSql,
  instrument: string,
  at: Date,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from campaigns
    where instrument = ${instrument} and onchain_id is not null
      and status <> all(${[...SETTLED_CAMPAIGN_STATUSES]}::text[])
      and sales_close <= ${at}
    order by created_at
  `;
  return rows.map((row) => row.id);
}
