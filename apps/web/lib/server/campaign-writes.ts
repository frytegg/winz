import { randomUUID } from "node:crypto";

import { maxCostBps, pauseThresholdBps } from "@winz/pricing";
import {
  JOB_KINDS,
  MICRO_PER_CENT,
  centsToMicroUsdc,
  jobIdempotencyKey,
  type CampaignActionResponse,
  type CampaignStatus,
  type CreateCampaignRequest,
  type CreateCampaignResponse,
  type SaleState,
} from "@winz/shared";

import type { Db } from "./db";
import { enqueueJob, type JobSql } from "./jobs";
import {
  PaymentGatewayError,
  STRIPE_MAX_AMOUNT_CENTS,
  STRIPE_MIN_AMOUNT_CENTS,
  type CreatedPaymentIntent,
  type PaymentGateway,
} from "./payments-gateway";
import { parsePreviewTerms } from "./preview";
import { ApiRouteError } from "./route";
import { digits, effectiveSaleState, percentLabel } from "./wire";

/**
 * The merchant's writes on campaigns (A-02, SPEC CA-2 and CA-4): creation with its budget payment,
 * and the manual pause, resume and close. The web app never sends a transaction: it writes rows
 * and enqueues the jobs the engine executes. `campaigns.status` only changes when the engine
 * projects the on-chain event.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses after which nothing can change any more. */
const SETTLED_STATUSES: readonly CampaignStatus[] = ["settled_yes", "settled_no", "void", "closed"];

/** Smallest card payment Stripe takes, in micro-USDC ($0.50). */
export const MIN_CARD_AMOUNT = centsToMicroUsdc(STRIPE_MIN_AMOUNT_CENTS);
/** Largest card payment Stripe takes, in micro-USDC ($999,999.99). */
export const MAX_CARD_AMOUNT = centsToMicroUsdc(STRIPE_MAX_AMOUNT_CENTS);

/** Answered when the payment provider fails: nothing was created, the merchant can try again. */
export function paymentUnavailable(): ApiRouteError {
  return new ApiRouteError(
    502,
    "internal",
    "The payment service is unavailable right now, please try again in a moment",
  );
}

// ---------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------

/** The promise printed on the poster: "100% back if Texas wins by 14+", "50% back if ...". */
export function promiseText(refundBps: bigint, conditionLabel: string): string {
  return `${percentLabel(refundBps)}% back if ${conditionLabel}`;
}

export interface CampaignTermsInput {
  instrumentSymbol: string;
  product: string;
  unitPrice: bigint;
  refundBps: bigint;
  usualMarginBps: bigint;
  minMarginBps: bigint;
  budget: bigint;
}

function invalid(field: string, reason: string): ApiRouteError {
  return new ApiRouteError(400, "invalid_request", `Invalid body.${field}: ${reason}`);
}

function checkCardAmount(field: string, amount: bigint): void {
  if (amount <= 0n) throw invalid(field, "must be above zero");
  if (amount % MICRO_PER_CENT !== 0n) throw invalid(field, "must be a whole number of cents");
  if (amount < MIN_CARD_AMOUNT) throw invalid(field, "must be at least $0.50");
  if (amount > MAX_CARD_AMOUNT) throw invalid(field, "must be at most $999,999.99");
}

/**
 * The terms of a new campaign, after the checks the wire schema cannot make (400
 * `invalid_request` naming the field): the preview's checks (positive price, minimum margin not
 * above the usual one), then card-payable amounts. The unit price and the budget are paid by card,
 * so each must be a whole number of cents between Stripe's floor and ceiling: a price is refused
 * here rather than rounded at payment.
 */
export function parseCampaignTerms(body: CreateCampaignRequest): CampaignTermsInput {
  const terms = parsePreviewTerms(body);
  const product = body.product.trim();
  if (product === "") throw invalid("product", "must not be blank");
  checkCardAmount("unitPrice", terms.unitPrice);
  checkCardAmount("budget", terms.budget);
  return { ...terms, product };
}

interface InstrumentRow {
  symbol: string;
  label: string;
  event_ticker: string;
  sales_close_at: Date;
}

/**
 * POST /api/campaigns (screen M7): validates the terms, inserts the campaign in `funding` and
 * creates its budget payment, whose id is stored in `campaigns.budget_pi`. Both happen in one
 * transaction: when the payment provider fails, no campaign row remains. The creation job is
 * enqueued later, by the webhook, once the budget is paid.
 */
export async function createCampaign(
  db: Db,
  payments: PaymentGateway,
  merchantId: string,
  body: CreateCampaignRequest,
  now: Date,
): Promise<CreateCampaignResponse> {
  const terms = parseCampaignTerms(body);
  const [instrument] = await db<InstrumentRow[]>`
    select i.symbol, i.label, i.event_ticker, e.sales_close_at
    from instruments i
    join events e on e.ticker = i.event_ticker
    where i.symbol = ${terms.instrumentSymbol} and i.active and i.outcome is null
  `;
  if (!instrument) {
    throw new ApiRouteError(404, "not_found", "This promo condition is not available");
  }
  if (now.getTime() >= instrument.sales_close_at.getTime()) {
    throw new ApiRouteError(
      409,
      "sales_closed",
      "Sales for this game are already closed, pick another game",
    );
  }

  const threshold = pauseThresholdBps(
    maxCostBps(terms.usualMarginBps, terms.minMarginBps),
    terms.refundBps,
  );
  const promise = promiseText(terms.refundBps, instrument.label);

  return db.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into campaigns (
        merchant_id, instrument, event_ticker, product, condition_label, promise, unit_price,
        refund_bps, usual_margin_bps, min_margin_bps, pause_threshold_bps, budget, sales_close,
        status, sale_state
      ) values (
        ${merchantId}, ${instrument.symbol}, ${instrument.event_ticker}, ${terms.product},
        ${instrument.label}, ${promise}, ${terms.unitPrice}, ${Number(terms.refundBps)},
        ${Number(terms.usualMarginBps)}, ${Number(terms.minMarginBps)}, ${Number(threshold)},
        ${terms.budget}, ${instrument.sales_close_at}, 'funding', 'closed'
      )
      returning id
    `;
    if (!row) throw new Error("campaigns insert returned no row");

    let payment: CreatedPaymentIntent;
    try {
      payment = await payments.createBudgetPayment({ campaignId: row.id, amount: terms.budget });
    } catch (error: unknown) {
      // Rolls the campaign back: no draft without its payment.
      if (error instanceof PaymentGatewayError) throw paymentUnavailable();
      throw error;
    }
    await tx`update campaigns set budget_pi = ${payment.id} where id = ${row.id}`;
    return {
      campaignId: row.id,
      status: "funding" as const,
      budgetPayment: {
        paymentIntentId: payment.id,
        clientSecret: payment.clientSecret,
        amount: digits(terms.budget),
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Manual pause, resume, close
// ---------------------------------------------------------------------------------------------

interface ActionRow {
  id: string;
  status: CampaignStatus;
  sale_state: SaleState;
  sales_close: Date;
  outcome: string | null;
}

function conflict(message: string): ApiRouteError {
  return new ApiRouteError(409, "conflict", message);
}

/**
 * Locks the merchant's own campaign for the rest of the transaction; 404 for an unknown id and
 * for another merchant's campaign alike (its existence is not revealed). Refuses any change after
 * settlement.
 */
async function lockOwnCampaign(
  tx: JobSql,
  merchantId: string,
  campaignId: string,
): Promise<ActionRow> {
  const [row] = UUID.test(campaignId)
    ? await tx<ActionRow[]>`
        select id, status, sale_state, sales_close, outcome
        from campaigns
        where id = ${campaignId} and merchant_id = ${merchantId}
        for update
      `
    : [];
  if (!row) throw new ApiRouteError(404, "not_found", "Campaign not found");
  if (row.outcome !== null || SETTLED_STATUSES.includes(row.status)) {
    throw conflict("This promo is already settled");
  }
  return row;
}

function salesOver(row: ActionRow, now: Date): boolean {
  return (
    row.status === "sales_closed" ||
    row.sale_state === "closed" ||
    now.getTime() >= row.sales_close.getTime()
  );
}

function notLiveYet(row: ActionRow): boolean {
  return row.status === "draft" || row.status === "funding";
}

function answer(row: ActionRow, saleState: SaleState, now: Date): CampaignActionResponse {
  return { status: row.status, saleState: effectiveSaleState(saleState, row.sales_close, now) };
}

/** The merchant's latest pause or resume request of a campaign (its `campaign.set_paused` job). */
interface LatestPauseRequest {
  requestId: string | null;
  /** True for a pause, false for a resume. */
  paused: boolean;
  /** The job's state: `queued` or `running` until the engine has carried it out. */
  status: string;
}

async function latestPauseRequest(
  tx: JobSql,
  campaignId: string,
): Promise<LatestPauseRequest | null> {
  const [latest] = await tx<
    { request_id: string | null; paused: boolean | null; status: string }[]
  >`
    select payload ->> 'requestId' as request_id, (payload ->> 'paused')::boolean as paused, status
    from jobs
    where kind = ${JOB_KINDS.setPaused} and payload ->> 'campaignId' = ${campaignId}
    order by created_at desc, id desc
    limit 1
  `;
  if (latest === undefined || latest.paused === null) return null;
  return { requestId: latest.request_id, paused: latest.paused, status: latest.status };
}

/**
 * The request `requestId` already made for this campaign (a repeated call: a retry of the same
 * click), or null. Its key is global: a key already used for another campaign or for the other
 * action is refused.
 */
async function repeatedRequest(
  tx: JobSql,
  campaignId: string,
  requestId: string,
  paused: boolean,
): Promise<boolean> {
  const [job] = await tx<{ campaign_id: string | null; paused: boolean | null }[]>`
    select payload ->> 'campaignId' as campaign_id, (payload ->> 'paused')::boolean as paused
    from jobs
    where idempotency_key = ${jobIdempotencyKey.setPaused(requestId)}
  `;
  if (job === undefined) return false;
  if (job.campaign_id !== campaignId || job.paused !== paused) {
    throw conflict("This request was already used for another action");
  }
  return true;
}

function unfinished(request: LatestPauseRequest): boolean {
  return request.status === "queued" || request.status === "running";
}

/**
 * POST /api/campaigns/:id/pause: only while live or paused, before sales close. The pause is the
 * merchant's safety control, so it is refused as "already paused" only when their LATEST request
 * for this campaign is itself a pause that is still in force (stored `paused_manual`, or the
 * campaign paused on-chain), or when they have made none and the campaign is paused on-chain.
 * When their latest request is a resume, landed or not, a new pause is accepted: the resume may
 * be on its way, and the state stays `paused_manual` until it lands, which is no reason to let the
 * promo reopen against the merchant's latest word. The engine carries out the latest request
 * only (a superseded resume sends nothing, or is undone by this pause).
 *
 * `sale_state` becomes `paused_manual` at once, so no quote is signed from now on, and the
 * `setPaused` job writes the pause on-chain. The same `requestId` twice enqueues once and answers
 * the stored state. Answers the stored status (it changes when the engine projects the on-chain
 * pause) and `paused_manual`.
 */
export async function pauseCampaign(
  db: Db,
  merchantId: string,
  campaignId: string,
  now: Date,
  requestId: string = randomUUID(),
): Promise<CampaignActionResponse> {
  return db.begin(async (tx) => {
    const row = await lockOwnCampaign(tx, merchantId, campaignId);
    if (notLiveYet(row)) throw conflict("This promo is not live yet");
    if (salesOver(row, now)) throw conflict("Sales are already closed for this promo");
    if (row.status !== "live" && row.status !== "paused") {
      throw conflict("This promo cannot be paused now");
    }
    if (await repeatedRequest(tx, row.id, requestId, true)) {
      return answer(row, row.sale_state, now);
    }
    const latest = await latestPauseRequest(tx, row.id);
    const pausedOnChain = row.status === "paused";
    const alreadyPaused =
      latest === null
        ? pausedOnChain
        : latest.paused && (pausedOnChain || row.sale_state === "paused_manual");
    if (alreadyPaused) throw conflict("This promo is already paused");
    await tx`update campaigns set sale_state = 'paused_manual' where id = ${row.id}`;
    await enqueueJob(
      tx,
      JOB_KINDS.setPaused,
      { campaignId: row.id, paused: true, requestId },
      jobIdempotencyKey.setPaused(requestId),
    );
    return answer(row, "paused_manual", now);
  });
}

/**
 * POST /api/campaigns/:id/resume: before sales close, unless both the merchant's latest intent
 * and the chain say live: their latest request is a resume that the engine has carried out (or
 * they have made none) and the campaign is live on-chain ("not paused"). A resume asked while a
 * pause is still on its way is accepted: it supersedes the pause (the engine carries out the
 * latest request only, and a pause already sent is undone after it is mined). A resume already
 * waiting in the queue is not enqueued twice, nor is the same `requestId`. `sale_state` is left
 * as it is and recomputed by the engine once the resume is on-chain (it may then be any
 * automatic pause). Answers the stored state.
 */
export async function resumeCampaign(
  db: Db,
  merchantId: string,
  campaignId: string,
  now: Date,
  requestId: string = randomUUID(),
): Promise<CampaignActionResponse> {
  return db.begin(async (tx) => {
    const row = await lockOwnCampaign(tx, merchantId, campaignId);
    if (notLiveYet(row)) throw conflict("This promo is not live yet");
    if (salesOver(row, now)) throw conflict("Sales are already closed for this promo");
    if (row.status !== "live" && row.status !== "paused") {
      throw conflict("This promo cannot be resumed now");
    }
    if (await repeatedRequest(tx, row.id, requestId, false)) {
      return answer(row, row.sale_state, now);
    }
    const latest = await latestPauseRequest(tx, row.id);
    // A second click while the resume waits in the queue adds nothing.
    if (latest !== null && !latest.paused && unfinished(latest)) {
      return answer(row, row.sale_state, now);
    }
    const intentLive = latest === null || !latest.paused;
    if (intentLive && row.status === "live") throw conflict("This promo is not paused");
    await enqueueJob(
      tx,
      JOB_KINDS.setPaused,
      { campaignId: row.id, paused: false, requestId },
      jobIdempotencyKey.setPaused(requestId),
    );
    return answer(row, row.sale_state, now);
  });
}

/**
 * POST /api/campaigns/:id/close: closes sales early, only while live or paused and before sales
 * close. `sale_state` becomes `closed` at once and the `closeSales` job writes it on-chain.
 */
export async function closeCampaign(
  db: Db,
  merchantId: string,
  campaignId: string,
  now: Date,
): Promise<CampaignActionResponse> {
  return db.begin(async (tx) => {
    const row = await lockOwnCampaign(tx, merchantId, campaignId);
    if (notLiveYet(row)) throw conflict("This promo is not live yet");
    if (salesOver(row, now)) throw conflict("Sales are already closed for this promo");
    if (row.status !== "live" && row.status !== "paused") {
      throw conflict("Sales cannot be closed now");
    }
    await tx`update campaigns set sale_state = 'closed' where id = ${row.id}`;
    await enqueueJob(
      tx,
      JOB_KINDS.closeSales,
      { campaignId: row.id },
      jobIdempotencyKey.closeSales(row.id),
    );
    return answer(row, "closed", now);
  });
}
