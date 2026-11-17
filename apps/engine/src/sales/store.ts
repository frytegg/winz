import type { TransactionSql } from "postgres";
import { z } from "zod";

import {
  CAMPAIGN_STATUSES,
  JOB_KINDS,
  OUTCOMES,
  SALES_CLOSE_BEFORE_START_MS,
  SALE_STATES,
} from "@winz/shared";
import type {
  Bps,
  CampaignStatus,
  MicroContracts,
  MicroUsdc,
  Outcome,
  SaleState,
} from "@winz/shared";

import type { Db } from "../db";
import { SaleStateConfigError, SaleStateRowError } from "./errors";
import type { PauseJobView } from "./manual-pause";
import type { SaleTerms } from "./evaluate";

/**
 * Everything the sale state of one campaign depends on, read from Postgres in one query.
 *
 * The budget and the pending exposure are the database's view: the purchase job re-checks the
 * real figures on-chain (the escrow's available budget) and prices the sale again at the moment
 * it is made, so these are for the displayed state and for the checkout pre-check only. A sale
 * whose quote is signed but whose `TicketPurchased` is not projected yet has no lot: its
 * reservation is missing here for that short while, which the on-chain check covers.
 */
export interface CampaignSaleRow {
  id: string;
  slug: string | null;
  hasOnchainId: boolean;
  /** `campaigns.onchain_id`, for the logs. */
  onchainId: bigint | null;
  instrument: string;
  status: CampaignStatus;
  outcome: Outcome | null;
  /** `campaigns.sale_state` as stored now. */
  storedState: SaleState;
  /** `live_campaigns.sale_state` of the campaign's slug, null when there is no such row. */
  liveState: SaleState | null;
  /**
   * When sales close, epoch milliseconds: `campaigns.sales_close`, or 5 min before the event
   * starts if that is earlier (SPEC 4.5: no sale is possible after).
   */
  salesCloseMs: number;
  /**
   * `campaigns.sales_close` alone, epoch milliseconds: the escrow's `salesClose`, which only an
   * early close can move (earlier). The status becomes `sales_closed` only once this is reached,
   * because that status is final and the chain still accepts sales until then; a start time moved
   * earlier by the catalog and back again closes the sale state for that while, not the campaign.
   */
  onchainSalesCloseMs: number;
  terms: SaleTerms;
  /** budget − charged amounts of charged lots − max_hedge_cost of lots not charged yet. */
  availableBudget: MicroUsdc;
  /** positions.exposure − positions.held of the instrument, floored at 0 (0 without a position). */
  pending: MicroContracts;
  latestPauseJob: PauseJobView | null;
  lastOnChainPauseAtMs: number | null;
  /** A `campaign.close_sales` job exists: the merchant closed sales early. */
  closeRequested: boolean;
}

const dateSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const bigintSchema = z.union([
  z.bigint(),
  z
    .string()
    .regex(/^-?\d+$/u)
    .transform((value) => BigInt(value)),
]);

const rowSchema = z.object({
  id: z.string().min(1),
  slug: z.string().nullable(),
  onchain_id: bigintSchema.nullable(),
  instrument: z.string().min(1),
  status: z.enum(CAMPAIGN_STATUSES),
  outcome: z.enum(OUTCOMES).nullable(),
  sale_state: z.enum(SALE_STATES),
  live_sale_state: z.enum(SALE_STATES).nullable(),
  sales_close: dateSchema,
  starts_at: dateSchema,
  unit_price: bigintSchema,
  refund_bps: z.number().int(),
  usual_margin_bps: z.number().int(),
  min_margin_bps: z.number().int(),
  pause_threshold_bps: z.number().int(),
  budget: bigintSchema,
  charged: bigintSchema,
  reserved: bigintSchema,
  pending: bigintSchema,
  job_paused: z.boolean().nullable(),
  job_created_at: dateSchema.nullable(),
  last_pause_at: dateSchema.nullable(),
  close_requested: z.boolean(),
});

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function bps(value: number): Bps {
  return BigInt(value);
}

/** Parses one row of `loadCampaignSaleRows`. Throws `SaleStateRowError` on an unexpected shape. */
export function parseCampaignSaleRow(row: unknown): CampaignSaleRow {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) {
    const id =
      typeof row === "object" && row !== null && "id" in row && typeof row.id === "string"
        ? row.id
        : "?";
    throw new SaleStateRowError(
      id,
      parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join(".") || "$"}: ${issue.message}`,
      ),
    );
  }
  const r = parsed.data;
  const closeMs = toMs(r.sales_close);
  const startCloseMs = toMs(r.starts_at) - SALES_CLOSE_BEFORE_START_MS;
  const latestPauseJob: PauseJobView | null =
    r.job_paused === null || r.job_created_at === null
      ? null
      : { paused: r.job_paused, createdAtMs: toMs(r.job_created_at) };
  const pending = r.pending > 0n ? r.pending : 0n;
  return {
    id: r.id,
    slug: r.slug,
    hasOnchainId: r.onchain_id !== null,
    onchainId: r.onchain_id,
    instrument: r.instrument,
    status: r.status,
    outcome: r.outcome,
    storedState: r.sale_state,
    liveState: r.live_sale_state,
    salesCloseMs: Math.min(closeMs, startCloseMs),
    onchainSalesCloseMs: closeMs,
    terms: {
      unitPrice: r.unit_price,
      refundBps: bps(r.refund_bps),
      usualMarginBps: bps(r.usual_margin_bps),
      minMarginBps: bps(r.min_margin_bps),
      pauseThresholdBps: bps(r.pause_threshold_bps),
    },
    availableBudget: r.budget - r.charged - r.reserved,
    pending,
    latestPauseJob,
    lastOnChainPauseAtMs: r.last_pause_at === null ? null : toMs(r.last_pause_at),
    closeRequested: r.close_requested,
  };
}

/** Default longest time one statement of the sale states may run or wait for a lock. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;

export interface StoreQueryOptions {
  /**
   * Longest time one statement may run, and may wait for a row lock, before Postgres cancels it
   * (`statement_timeout`, `lock_timeout`). Default `DEFAULT_STATEMENT_TIMEOUT_MS`. Without it a
   * query stuck behind a lock would freeze every sale state, `open` included, with no error.
   */
  statementTimeoutMs?: number;
}

/** Sets `statement_timeout` and `lock_timeout` for the rest of the transaction. */
async function limitStatementTime(
  tx: TransactionSql,
  timeoutMs: number | undefined,
): Promise<void> {
  const ms = timeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new SaleStateConfigError(
      `statementTimeoutMs must be a positive integer, got ${String(ms)}`,
    );
  }
  const value = `${String(ms)}ms`;
  await tx`
    select set_config('statement_timeout', ${value}, true), set_config('lock_timeout', ${value}, true)
  `;
}

/**
 * Reads every campaign whose sale state may need a decision: live or paused on-chain, or with a
 * stored sale state other than `closed` (a settled campaign still shown open, a campaign whose
 * sales close passed). With `instruments`, only the campaigns on those instruments.
 *
 * Rows that do not parse are returned as errors, so one bad row never hides the others.
 */
export async function loadCampaignSaleRows(
  db: Db,
  instruments?: readonly string[],
  options: StoreQueryOptions = {},
): Promise<{ rows: CampaignSaleRow[]; errors: SaleStateRowError[] }> {
  const raw = await db.begin(async (tx) => {
    await limitStatementTime(tx, options.statementTimeoutMs);
    const filter = instruments === undefined ? tx`` : tx`and c.instrument in ${tx(instruments)}`;
    return tx`
    select
      c.id::text as id,
      c.slug,
      c.onchain_id,
      c.instrument,
      c.status,
      c.outcome,
      c.sale_state,
      lc.sale_state as live_sale_state,
      c.sales_close,
      e.starts_at,
      c.unit_price,
      c.refund_bps,
      c.usual_margin_bps,
      c.min_margin_bps,
      c.pause_threshold_bps,
      c.budget,
      coalesce(lot.charged, 0)::bigint as charged,
      coalesce(lot.reserved, 0)::bigint as reserved,
      greatest(coalesce(p.exposure, 0) - coalesce(p.held, 0), 0)::bigint as pending,
      pj.paused as job_paused,
      pj.created_at as job_created_at,
      ev.paused_at as last_pause_at,
      exists (
        select 1 from jobs cj
        where cj.kind = ${JOB_KINDS.closeSales} and cj.payload ->> 'campaignId' = c.id::text
      ) as close_requested
    from campaigns c
    join events e on e.ticker = c.event_ticker
    left join live_campaigns lc on lc.slug = c.slug
    left join positions p on p.instrument = c.instrument
    left join lateral (
      select
        sum(l.charged_amount) filter (where l.charged) as charged,
        sum(l.max_hedge_cost) filter (where not l.charged) as reserved
      from lots l
      where l.campaign_id = c.id
    ) lot on true
    left join lateral (
      select (j.payload ->> 'paused')::boolean as paused, j.created_at
      from jobs j
      where j.kind = ${JOB_KINDS.setPaused} and j.payload ->> 'campaignId' = c.id::text
      order by j.created_at desc, j.id desc
      limit 1
    ) pj on true
    left join lateral (
      select max(coalesce(ce.block_time, ce.created_at)) as paused_at
      from chain_events ce
      where c.onchain_id is not null
        and ce.name = 'CampaignPaused'
        and ce.args ->> 'id' = c.onchain_id::text
        and (ce.args ->> 'paused')::boolean
        and ce.processed_at is not null
    ) ev on true
    where (c.status in ('live', 'paused') or c.sale_state <> 'closed') ${filter}
    order by c.id
  `;
  });
  const rows: CampaignSaleRow[] = [];
  const errors: SaleStateRowError[] = [];
  for (const row of raw as readonly unknown[]) {
    try {
      rows.push(parseCampaignSaleRow(row));
    } catch (error: unknown) {
      if (error instanceof SaleStateRowError) errors.push(error);
      else throw error;
    }
  }
  return { rows, errors };
}

export interface SaleStateWrite {
  campaignId: string;
  /** The sale state the decision was taken against: the write is skipped if it changed since. */
  expectedState: SaleState;
  /** The new sale state, or null to leave `campaigns.sale_state` alone. */
  state: SaleState | null;
  /** Re-copy `state` (or the stored state) into `live_campaigns` for the campaign's slug. */
  syncLive: boolean;
  /** Set `campaigns.status` to `sales_closed` if it is still `live` or `paused`. */
  closeStatus: boolean;
}

export interface SaleStateWriteResult {
  /** False when `campaigns.sale_state` was no longer `expectedState`: nothing was written. */
  applied: boolean;
  /** Number of rows actually written (campaigns, live_campaigns). */
  rowsWritten: number;
  /** True when the status was moved to `sales_closed`. */
  statusClosed: boolean;
}

/**
 * Writes one decision in a single transaction. The campaign row is locked first and its sale
 * state compared with `expectedState`: if the web API changed it in between (a manual pause, an
 * early close), nothing is written and the next pass decides again. The projector locks the same
 * row before copying `sale_state` into `live_campaigns`, so the two copies cannot diverge.
 *
 * `live_campaigns` is written only for a campaign that has a slug, and only when its stored value
 * differs. A missing row is created with the same figures the projection computes (units sold,
 * exposure, share hedged), which the projection keeps up to date afterwards.
 */
export async function writeSaleState(
  db: Db,
  write: SaleStateWrite,
  options: StoreQueryOptions = {},
): Promise<SaleStateWriteResult> {
  return db.begin(async (tx) => {
    await limitStatementTime(tx, options.statementTimeoutMs);
    const [current] = await tx<{ sale_state: string; status: string; slug: string | null }[]>`
      select sale_state, status, slug from campaigns where id = ${write.campaignId} for update
    `;
    if (current === undefined || current.sale_state !== write.expectedState) {
      return { applied: false, rowsWritten: 0, statusClosed: false };
    }
    let rowsWritten = 0;
    let statusClosed = false;
    const state = write.state ?? write.expectedState;
    if (write.state !== null && write.state !== current.sale_state) {
      await tx`update campaigns set sale_state = ${write.state} where id = ${write.campaignId}`;
      rowsWritten += 1;
    }
    if (write.closeStatus && (current.status === "live" || current.status === "paused")) {
      await tx`
        update campaigns set status = 'sales_closed'
        where id = ${write.campaignId} and status in ('live', 'paused')
      `;
      rowsWritten += 1;
      statusClosed = true;
    }
    if (write.syncLive && current.slug !== null) {
      const rows = await tx`
        insert into live_campaigns (slug, sale_state, sales, exposure, hedged_bps, outcome)
        select
          c.slug,
          ${state},
          coalesce((select sum(t.qty) from tickets t where t.campaign_id = c.id), 0)::integer,
          coalesce((select sum(t.refundable) from tickets t where t.campaign_id = c.id), 0)::bigint,
          coalesce((
            select floor(sum(l.filled_qty) * 10000 / nullif(sum(l.qty), 0))
            from lots l where l.campaign_id = c.id
          ), 0)::integer,
          c.outcome
        from campaigns c
        where c.id = ${write.campaignId}
        on conflict (slug) do update
          set sale_state = excluded.sale_state
          where live_campaigns.sale_state is distinct from excluded.sale_state
        returning slug
      `;
      rowsWritten += rows.length;
    }
    return { applied: true, rowsWritten, statusClosed };
  });
}
