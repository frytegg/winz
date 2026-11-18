import { limits } from "@winz/pricing";
import {
  ARC_TESTNET_EXPLORER_URL,
  type CampaignDetail,
  type CampaignReport,
  type CampaignStatus,
  type CampaignSummary,
  type CampaignsResponse,
  type InstrumentType,
  type Outcome,
  type SaleState,
} from "@winz/shared";

import { readCachedBook, readLiveQuote, unhedgedExposure } from "./books";
import { conditionWords } from "./condition";
import type { Db } from "./db";
import type { ServerConfig } from "./deps";
import { splitMoney } from "./me";
import { ApiRouteError } from "./route";
import {
  digits,
  effectiveSaleState,
  isoDate,
  liveProbabilityBps,
  ratioBps,
  ratioBpsUp,
  toCampaignEvent,
  type EventTeamsRow,
  type LiveQuoteRow,
} from "./wire";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One campaign with its game, its instrument's type and the totals of its tickets. */
export interface CampaignRow extends EventTeamsRow {
  id: string;
  slug: string | null;
  product: string;
  promise: string;
  status: CampaignStatus;
  sale_state: SaleState;
  sales_close: Date;
  condition_label: string;
  instrument: string;
  /** `instruments.type`: how `condition_label` is read (`condition.ts`). */
  instrument_type: InstrumentType;
  unit_price: bigint;
  refund_bps: number;
  usual_margin_bps: number;
  min_margin_bps: number;
  pause_threshold_bps: number;
  budget: bigint;
  outcome: Outcome | null;
  onchain_id: bigint | null;
  demo: boolean;
  event_title: string;
  starts_at: Date;
  created_at: Date;
  /** Set by the engine when it projects the campaign's creation on-chain; null until then. */
  live_at: Date | null;
  /** Units sold: sum of `tickets.qty`. */
  units: bigint;
  /** Sum of `tickets.paid`. */
  revenue: bigint;
  /** Sum of `tickets.refundable`. */
  exposure: bigint;
  /** Sum of `tickets.refundable` over refunded tickets. */
  refunds_paid: bigint;
}

/** Totals of the campaign's lots (SPEC 9.5). */
export interface LotTotals {
  /** Sum of `charged_amount` of the charged lots. */
  spent: bigint;
  /** Sum of `max_hedge_cost` of the lots not charged yet: reserved on the budget. */
  reserved: bigint;
  qty: bigint;
  filled: bigint;
}

/** What the detail needs besides the campaign row. */
export interface CampaignDetailExtras {
  lots: LotTotals;
  live: LiveQuoteRow | null;
  capacitySales: number;
  newCustomers: number;
}

/** `CampaignRow` on the wire (`campaignSummarySchema`). */
export function toCampaignSummary(row: CampaignRow, now: Date): CampaignSummary {
  return {
    id: row.id,
    slug: row.slug,
    product: row.product,
    promise: row.promise,
    status: row.status,
    saleState: effectiveSaleState(row.sale_state, row.sales_close, now),
    eventTitle: row.event_title,
    event: toCampaignEvent(row),
    startsAt: isoDate(row.starts_at),
    salesCloseAt: isoDate(row.sales_close),
    sales: Number(row.units),
    revenue: digits(row.revenue),
    createdAt: isoDate(row.created_at),
    liveAt: row.live_at === null ? null : isoDate(row.live_at),
  };
}

/** Received and pending of one campaign: `splitMoney` (see `me.ts`) over its tickets. */
export function campaignMoney(row: CampaignRow): { received: bigint; pending: bigint } {
  const settled = row.outcome !== null;
  const split = splitMoney({
    nonRefundable: row.revenue - row.exposure,
    refundableSettled: settled ? row.exposure : 0n,
    refundableOpen: settled ? 0n : row.exposure,
  });
  return { received: split.available, pending: split.pending };
}

/**
 * The after-game report (MDB-2), only once the campaign has an outcome.
 *
 * - `hedgeCost`: what the hedge was charged on the budget; zero on VOID, where the treasury pays
 *   it back to the merchant (ST-4).
 * - `hedgeCostBps` and `equivalentDiscountBps`: that cost as a share of revenue, rounded up (a cost
 *   is never understated, SPEC PR-5). A flat discount of that size would have cost the merchant
 *   the same, so both are equal.
 * - `refundsPaid`: refundable amounts of the tickets already refunded.
 * - `paidToMerchant`: what the merchant received from the sales (see `campaignMoney`).
 */
export function campaignReport(
  row: CampaignRow,
  lots: LotTotals,
  newCustomers: number,
): CampaignReport | null {
  if (row.outcome === null) return null;
  const hedgeCost = row.outcome === "void" ? 0n : lots.spent;
  const costBps = ratioBpsUp(hedgeCost, row.revenue);
  return {
    sales: Number(row.units),
    newCustomers,
    hedgeCost: digits(hedgeCost),
    hedgeCostBps: costBps,
    equivalentDiscountBps: costBps,
    refundsPaid: digits(row.refunds_paid),
    paidToMerchant: digits(campaignMoney(row).received),
  };
}

/** The collapsed "technical details": null until the campaign is on-chain and the escrow is known. */
export function onchainBlock(
  onchainId: bigint | null,
  escrowAddress: string | null,
): CampaignDetail["onchain"] {
  if (onchainId === null || escrowAddress === null) return null;
  return {
    campaignId: onchainId.toString(),
    escrowAddress,
    explorerUrl: `${ARC_TESTNET_EXPLORER_URL}/address/${escrowAddress}`,
  };
}

/** `CampaignRow` and its extras on the wire (`campaignDetailSchema`). */
export function toCampaignDetail(
  row: CampaignRow,
  extras: CampaignDetailExtras,
  config: Pick<ServerConfig, "baseUrl" | "escrowAddress">,
  now: Date,
): CampaignDetail {
  const used = extras.lots.spent + extras.lots.reserved;
  const available = row.budget > used ? row.budget - used : 0n;
  const money = campaignMoney(row);
  const words = conditionWords(row.instrument_type, row.condition_label, row.outcome);
  return {
    ...toCampaignSummary(row, now),
    conditionLabel: words.conditionLabel,
    subjectName: words.subjectName,
    resultLabel: words.resultLabel,
    instrumentSymbol: row.instrument,
    unitPrice: digits(row.unit_price),
    refundBps: row.refund_bps,
    usualMarginBps: row.usual_margin_bps,
    minMarginBps: row.min_margin_bps,
    pauseThresholdBps: row.pause_threshold_bps,
    probabilityBps: liveProbabilityBps(extras.live, row.outcome !== null, now),
    budget: digits(row.budget),
    hedgeSpent: digits(extras.lots.spent),
    hedgeReserved: digits(extras.lots.reserved),
    budgetAvailable: digits(available),
    exposure: digits(row.exposure),
    hedgedBps: ratioBps(extras.lots.filled, extras.lots.qty),
    capacitySales: extras.capacitySales,
    received: digits(money.received),
    pending: digits(money.pending),
    outcome: row.outcome,
    url: row.slug === null ? null : `${config.baseUrl}/c/${row.slug}`,
    onchain: onchainBlock(row.onchain_id, config.escrowAddress),
    report: campaignReport(row, extras.lots, extras.newCustomers),
    demo: row.demo,
  };
}

async function selectCampaigns(
  db: Db,
  merchantId: string,
  campaignId: string | null,
): Promise<CampaignRow[]> {
  return db<CampaignRow[]>`
    select
      c.id, c.slug, c.product, c.promise, c.status, c.sale_state, c.sales_close,
      c.condition_label, c.instrument, c.unit_price, c.refund_bps, c.usual_margin_bps,
      c.min_margin_bps, c.pause_threshold_bps, c.budget, c.outcome, c.onchain_id, c.demo,
      c.created_at, c.live_at, i.type as instrument_type,
      e.title as event_title, e.starts_at, e.sport as event_sport, e.league as event_league,
      e.home_name, e.home_abbreviation, e.home_logo_url,
      e.away_name, e.away_abbreviation, e.away_logo_url,
      coalesce(t.units, 0)::bigint as units,
      coalesce(t.revenue, 0)::bigint as revenue,
      coalesce(t.exposure, 0)::bigint as exposure,
      coalesce(t.refunds_paid, 0)::bigint as refunds_paid
    from campaigns c
    join events e on e.ticker = c.event_ticker
    join instruments i on i.symbol = c.instrument
    left join lateral (
      select
        sum(qty) as units,
        sum(paid) as revenue,
        sum(refundable) as exposure,
        sum(refundable) filter (where status = 'refunded') as refunds_paid
      from tickets
      where campaign_id = c.id
    ) t on true
    where c.merchant_id = ${merchantId}
      and (${campaignId}::uuid is null or c.id = ${campaignId}::uuid)
      -- A creation request whose payment is not recorded yet (being created, or the provider
      -- failed) is not a campaign yet: its id was never answered.
      and not (c.status = 'funding' and c.budget_pi is null)
    order by c.created_at desc, c.id
  `;
}

/**
 * GET /api/campaigns: the merchant's own campaigns, newest first (`createdAt`), each with its
 * game (`event`) and the time it went live (`liveAt`, null until then).
 *
 * A campaign whose budget was never paid (the merchant closed the payment sheet) is listed as it
 * is: `funding`, `liveAt` null. The back end never expires it, nor its PaymentIntent: the same
 * request (`requestId`) can still pay it later. The front hides the old ones from `createdAt`.
 */
export async function listCampaigns(
  db: Db,
  merchantId: string,
  now: Date,
): Promise<CampaignsResponse> {
  const rows = await selectCampaigns(db, merchantId, null);
  return { campaigns: rows.map((row) => toCampaignSummary(row, now)) };
}

async function lotTotals(db: Db, campaignId: string): Promise<LotTotals> {
  const [row] = await db<LotTotals[]>`
    select
      coalesce(sum(charged_amount) filter (where charged), 0)::bigint as spent,
      coalesce(sum(max_hedge_cost) filter (where not charged), 0)::bigint as reserved,
      coalesce(sum(qty), 0)::bigint as qty,
      coalesce(sum(filled_qty), 0)::bigint as filled
    from lots
    where campaign_id = ${campaignId}
  `;
  return row ?? { spent: 0n, reserved: 0n, qty: 0n, filled: 0n };
}

/**
 * Buyers whose first ticket at this merchant (by purchase time) belongs to this campaign: the
 * customers the promo brought in.
 */
async function newCustomers(db: Db, merchantId: string, campaignId: string): Promise<number> {
  const [row] = await db<{ n: bigint }[]>`
    select count(*)::bigint as n
    from (
      select distinct on (t.buyer) t.buyer, t.campaign_id
      from tickets t
      join campaigns c on c.id = t.campaign_id
      where c.merchant_id = ${merchantId}
      order by t.buyer, t.purchased_at, t.id
    ) first_ticket
    where first_ticket.campaign_id = ${campaignId}
  `;
  return Number(row?.n ?? 0n);
}

/**
 * Sales the campaign could still take right now: the capacity of `limits()` on the latest cached
 * book, behind the instrument's unhedged exposure, with the budget left. Zero when it cannot sell
 * any more (not live or paused, past its sales close, settled) or when there is no book.
 */
async function capacityNow(
  db: Db,
  row: CampaignRow,
  budgetAvailable: bigint,
  now: Date,
): Promise<number> {
  const selling = row.status === "live" || row.status === "paused";
  if (!selling || row.outcome !== null || now.getTime() >= row.sales_close.getTime()) return 0;
  if (row.unit_price <= 0n) return 0;
  const [book, pending] = await Promise.all([
    readCachedBook(db, row.instrument),
    unhedgedExposure(db, row.instrument),
  ]);
  if (book === null) return 0;
  return limits({
    book,
    pending,
    nowMs: now.getTime(),
    unitPrice: row.unit_price,
    refundBps: BigInt(row.refund_bps),
    usualMarginBps: BigInt(row.usual_margin_bps),
    minMarginBps: BigInt(row.min_margin_bps),
    availableBudget: budgetAvailable,
  }).capacity.sales;
}

/**
 * GET /api/campaigns/:id (screen "campaign detail", MDB-1). Another merchant's campaign answers
 * 404, exactly like a campaign that does not exist: its existence is not revealed.
 */
export async function getCampaignDetail(
  db: Db,
  merchantId: string,
  campaignId: string,
  config: Pick<ServerConfig, "baseUrl" | "escrowAddress">,
  now: Date,
): Promise<CampaignDetail> {
  const [row] = UUID.test(campaignId) ? await selectCampaigns(db, merchantId, campaignId) : [];
  if (!row) throw new ApiRouteError(404, "not_found", "Campaign not found");

  const [lots, live, customers] = await Promise.all([
    lotTotals(db, row.id),
    readLiveQuote(db, row.instrument),
    newCustomers(db, merchantId, row.id),
  ]);
  const used = lots.spent + lots.reserved;
  const budgetAvailable = row.budget > used ? row.budget - used : 0n;
  const capacitySales = await capacityNow(db, row, budgetAvailable, now);
  return toCampaignDetail(row, { lots, live, capacitySales, newCustomers: customers }, config, now);
}
