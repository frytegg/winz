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
import { serverLogger } from "./logger";
import {
  PaymentGatewayError,
  STRIPE_MAX_AMOUNT_CENTS,
  STRIPE_MIN_AMOUNT_CENTS,
  topUpGatewayOf,
  type CreatedPaymentIntent,
  type PaymentGateway,
  type TopUpPaymentGateway,
  type UnpaidCancellation,
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

export function checkCardAmount(field: string, amount: bigint): void {
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
 * The instrument of new terms, with the checks of a new campaign: 404 when it is unknown, delisted
 * or settled, 409 `sales_closed` when its game's sales are closed.
 */
async function openInstrument(db: Db, symbol: string, now: Date): Promise<InstrumentRow> {
  const [instrument] = await db<InstrumentRow[]>`
    select i.symbol, i.label, i.event_ticker, e.sales_close_at
    from instruments i
    join events e on e.ticker = i.event_ticker
    where i.symbol = ${symbol} and i.active and i.outcome is null
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
  return instrument;
}

/** The row values of new terms on an instrument. */
function campaignValues(
  terms: CampaignTermsInput,
  instrument: InstrumentRow,
): {
  threshold: bigint;
  promise: string;
} {
  return {
    threshold: pauseThresholdBps(
      maxCostBps(terms.usualMarginBps, terms.minMarginBps),
      terms.refundBps,
    ),
    promise: promiseText(terms.refundBps, instrument.label),
  };
}

/**
 * POST /api/campaigns (screen M7): validates the terms, inserts the campaign in `funding` and
 * creates its budget payment, whose id is stored in `campaigns.budget_pi`. The creation job is
 * enqueued later, by the webhook, once the budget is paid.
 *
 * With a `requestId` the request is idempotent (`createCampaignOnce`). Without one it behaves as it
 * always did, logged as a warning: the insert and the payment happen in one transaction, so that
 * when the payment provider fails no campaign row remains, but a double tap creates two campaigns
 * and two payments.
 */
export async function createCampaign(
  db: Db,
  payments: PaymentGateway,
  merchantId: string,
  body: CreateCampaignRequest,
  now: Date,
): Promise<CreateCampaignResponse> {
  const terms = parseCampaignTerms(body);
  if (body.requestId !== undefined) {
    return createCampaignOnce(db, payments, merchantId, body.requestId, terms, now);
  }
  serverLogger("campaign-writes").warn(
    { merchantId, instrumentSymbol: terms.instrumentSymbol },
    "campaign created without a requestId: a repeated request would create a second campaign",
  );
  const instrument = await openInstrument(db, terms.instrumentSymbol, now);
  const { threshold, promise } = campaignValues(terms, instrument);

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
// Creation, idempotent on the merchant's requestId
// ---------------------------------------------------------------------------------------------

/** The 409s of a creation request whose `requestId` is known. */
export const CREATE_CAMPAIGN_CONFLICTS = {
  /** The `requestId` belongs to a campaign with other terms: it never fits these ones. */
  usedElsewhere:
    "This request was already used for another promo; make a new request to create one",
  /** Other calls of the same request kept replacing its campaign (`MAX_CREATE_ROUNDS`). */
  busy: "This promo is still being created; try again in a moment",
} as const;

/** How many times a request starts over when its campaign row was discarded under it. */
export const MAX_CREATE_ROUNDS = 3;

/** A campaign row as the idempotent creation reads it. */
interface RequestRow {
  id: string;
  status: CampaignStatus;
  budget_pi: string | null;
  instrument: string;
  product: string;
  unit_price: bigint;
  refund_bps: number;
  usual_margin_bps: number;
  min_margin_bps: number;
  budget: bigint;
}

async function campaignOfRequest(
  db: Db,
  merchantId: string,
  requestId: string,
): Promise<RequestRow | null> {
  const [row] = await db<RequestRow[]>`
    select id, status, budget_pi, instrument, product, unit_price, refund_bps, usual_margin_bps,
           min_margin_bps, budget
    from campaigns
    where merchant_id = ${merchantId} and request_id = ${requestId}
  `;
  return row ?? null;
}

/**
 * Whether the row was made from these terms, the budget aside: the budget is compared with the
 * budget payment's amount (`campaigns.budget` grows with each top-up once the campaign is live).
 */
function sameTermsBesideBudget(row: RequestRow, terms: CampaignTermsInput): boolean {
  return (
    row.instrument === terms.instrumentSymbol &&
    row.product === terms.product &&
    row.unit_price === terms.unitPrice &&
    BigInt(row.refund_bps) === terms.refundBps &&
    BigInt(row.usual_margin_bps) === terms.usualMarginBps &&
    BigInt(row.min_margin_bps) === terms.minMarginBps
  );
}

/** Calls the gateway; a provider failure answers 502 and is logged without its payload. */
async function viaGateway<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error: unknown) {
    if (error instanceof PaymentGatewayError) {
      serverLogger("campaign-writes").error({ err: error }, "payment provider call failed");
      throw paymentUnavailable();
    }
    throw error;
  }
}

/**
 * Removes a `funding` campaign whose budget payment can never be paid (`budgetPi`, cancelled at
 * the provider) or that records none (`budgetPi` null), so that its request can start over with a
 * fresh campaign and a fresh payment. Nothing else references such a row: no ticket, lot, top-up
 * or job exists before the budget is paid. Returns whether the row was removed.
 */
async function discardUnpaidCampaign(
  sql: JobSql,
  campaignId: string,
  budgetPi: string | null,
): Promise<boolean> {
  const removed = await sql`
    delete from campaigns
    where id = ${campaignId} and status = 'funding'
      and (budget_pi is null or budget_pi = ${budgetPi})
    returning id
  `;
  return removed.length === 1;
}

/** What `withdraw` found under the campaign's lock. */
type Withdrawal =
  /** A row records this very payment (a concurrent call of the request): it was left alone. */
  | { kind: "recorded"; row: RequestRow }
  /** No row records it: the provider was asked to cancel it. */
  | { kind: "withdrawn" };

/**
 * A budget payment this request created and that no row ends up recording (the recording failed,
 * or the campaign row is gone or records another payment): cancelled at the provider, outside any
 * lock, so that no payable intent is left that no row knows (the webhook ignores a paid budget
 * intent that is not its campaign's `budget_pi`, so such a payment would be kept and never
 * credited).
 *
 * First, under the campaign's row lock, the row is read: when it records this very payment (a
 * concurrent call of the same request recorded it, the provider having answered both calls the
 * same intent), nothing is cancelled and the row is returned to be answered. When it records no
 * payment, the row is deleted in that same lock period (`discardUnpaidCampaign`): that is the
 * claim that stops a concurrent call from recording the intent after this check, since its
 * recording only updates an existing row. The request then starts over cleanly on a retry: a new
 * row, so a new idempotency key at the provider (`campaign_budget:<campaign id>`), so a payable
 * intent, never the cancelled one replayed.
 *
 * When the database cannot be reached the intent is cancelled all the same and nothing is
 * deleted: a later call of the request then gets the cancelled intent back from the provider,
 * sees it cancelled (`stillPayable`), discards the row and starts over. When the cancel fails or
 * finds the intent being paid it is logged at error: its client secret was never answered, so
 * nobody should pay it, and a payment no campaign records must then be refunded by hand.
 */
async function withdraw(
  db: Db,
  payments: TopUpPaymentGateway,
  campaignId: string,
  requestId: string,
  payment: CreatedPaymentIntent,
): Promise<Withdrawal> {
  const log = serverLogger("campaign-writes");
  const fields = { campaignId, requestId, paymentIntentId: payment.id };
  try {
    const recorded = await db.begin(async (tx) => {
      const [row] = await tx<RequestRow[]>`
        select id, status, budget_pi, instrument, product, unit_price, refund_bps,
               usual_margin_bps, min_margin_bps, budget
        from campaigns where id = ${campaignId}
        for update
      `;
      if (row === undefined) return null;
      if (row.budget_pi === payment.id) return row;
      if (row.budget_pi === null) await discardUnpaidCampaign(tx, campaignId, null);
      return null;
    });
    if (recorded !== null) {
      log.info(fields, "a budget payment to withdraw is recorded by its campaign: left as it is");
      return { kind: "recorded", row: recorded };
    }
  } catch (error: unknown) {
    log.warn(
      { ...fields, err: error },
      "a budget payment to withdraw could not be checked: it is cancelled all the same",
    );
  }

  let result: UnpaidCancellation | null = null;
  try {
    result = await payments.cancelUnpaidPaymentIntent(payment.id);
  } catch (error: unknown) {
    log.error(
      { ...fields, err: error },
      "an unused budget payment could not be cancelled: if it is ever paid, refund it by hand",
    );
  }
  if (result === "canceled") log.info(fields, "unused budget payment cancelled");
  if (result === "not_cancelable") {
    log.error(fields, "an unused budget payment is being paid: refund it by hand");
  }
  return { kind: "withdrawn" };
}

/**
 * Whether an intent can still be paid, read at the provider with no lock held. The provider keys
 * a budget payment on its campaign's id and replays the first intent for that key for about a
 * day, whatever became of it: a campaign row left over by a request whose payment was withdrawn
 * while the database was down gets that cancelled intent back.
 */
async function stillPayable(
  gateway: PaymentGateway,
  campaignId: string,
  paymentIntentId: string,
): Promise<{ payable: boolean; amount: bigint }> {
  const current = await viaGateway(() => gateway.retrievePaymentIntent(paymentIntentId));
  if (current === null) {
    serverLogger("campaign-writes").error(
      { campaignId, paymentIntentId },
      "a budget payment is unknown to the payment provider",
    );
    throw paymentUnavailable();
  }
  return { payable: current.status !== "canceled", amount: current.amount };
}

function answerOf(
  row: Pick<RequestRow, "id" | "status">,
  payment: CreatedPaymentIntent,
  amount: bigint,
): CreateCampaignResponse {
  return {
    campaignId: row.id,
    status: row.status,
    budgetPayment: {
      paymentIntentId: payment.id,
      clientSecret: payment.clientSecret,
      amount: digits(amount),
    },
  };
}

/** What the answer to a request whose campaign records its payment found. */
type Recorded =
  | { kind: "answer"; response: CreateCampaignResponse }
  /** The recorded payment was cancelled before anyone paid it: the row was discarded. */
  | { kind: "discarded" };

/**
 * The same request again, its campaign recording its payment: the same campaign and the same
 * payment, with the campaign's status of the moment, whatever it is (`funding` still unpaid or
 * paid and on its way, `live`, `paused`, closed, settled). 409 when the terms differ (the budget
 * against the payment's amount). The client secret is read from the provider unless the caller
 * holds it. A `funding` campaign whose payment is cancelled (left over by a withdrawal that could
 * not reach the database, see `withdraw`) can never be paid: it is discarded and the request starts
 * over.
 */
async function answerRecorded(
  db: Db,
  gateway: PaymentGateway,
  payments: TopUpPaymentGateway,
  row: RequestRow,
  terms: CampaignTermsInput,
  knownSecret: string | null,
): Promise<Recorded> {
  const paymentIntentId = row.budget_pi;
  if (paymentIntentId === null) throw new Error("answerRecorded needs a recorded payment");
  if (!sameTermsBesideBudget(row, terms)) throw conflict(CREATE_CAMPAIGN_CONFLICTS.usedElsewhere);
  const { payable, amount } = await stillPayable(gateway, row.id, paymentIntentId);
  if (amount !== terms.budget) throw conflict(CREATE_CAMPAIGN_CONFLICTS.usedElsewhere);
  if (!payable && row.status === "funding") {
    await db.begin((tx) => discardUnpaidCampaign(tx, row.id, paymentIntentId));
    serverLogger("campaign-writes").warn(
      { campaignId: row.id, paymentIntentId },
      "a funding campaign whose budget payment is cancelled was discarded: its request starts over",
    );
    return { kind: "discarded" };
  }
  const clientSecret =
    knownSecret ?? (await viaGateway(() => payments.retrieveClientSecret(paymentIntentId)));
  if (clientSecret === null) {
    serverLogger("campaign-writes").error(
      { campaignId: row.id, paymentIntentId },
      "the budget payment of a campaign has no client secret at the provider",
    );
    throw paymentUnavailable();
  }
  return {
    kind: "answer",
    response: answerOf(row, { id: paymentIntentId, clientSecret }, amount),
  };
}

/** What one round of the creation decided. */
type Round = { kind: "done"; response: CreateCampaignResponse } | { kind: "again" };

/**
 * The campaign of the request: the row this call inserts, or the one another call of the same
 * request inserted. The partial unique index `(merchant_id, request_id)` decides between two
 * calls at the same moment: one insert wins, the other reads the winner's row. A single statement,
 * so no lock outlives it.
 */
async function claimCampaign(
  db: Db,
  merchantId: string,
  requestId: string,
  terms: CampaignTermsInput,
  instrument: InstrumentRow,
): Promise<RequestRow | null> {
  const { threshold, promise } = campaignValues(terms, instrument);
  const [inserted] = await db<RequestRow[]>`
    insert into campaigns (
      merchant_id, request_id, instrument, event_ticker, product, condition_label, promise,
      unit_price, refund_bps, usual_margin_bps, min_margin_bps, pause_threshold_bps, budget,
      sales_close, status, sale_state
    ) values (
      ${merchantId}, ${requestId}, ${instrument.symbol}, ${instrument.event_ticker},
      ${terms.product}, ${instrument.label}, ${promise}, ${terms.unitPrice},
      ${Number(terms.refundBps)}, ${Number(terms.usualMarginBps)}, ${Number(terms.minMarginBps)},
      ${Number(threshold)}, ${terms.budget}, ${instrument.sales_close_at}, 'funding', 'closed'
    )
    on conflict (merchant_id, request_id) where request_id is not null do nothing
    returning id, status, budget_pi, instrument, product, unit_price, refund_bps,
              usual_margin_bps, min_margin_bps, budget
  `;
  return inserted ?? (await campaignOfRequest(db, merchantId, requestId));
}

/**
 * One round: the campaign of the request, then its payment. Returns `again` when the campaign
 * the round worked on was discarded under it (its payment found cancelled, or deleted by a
 * concurrent call that withdrew the same payment): the next round starts with a fresh row.
 */
async function createRound(
  db: Db,
  gateway: PaymentGateway,
  payments: TopUpPaymentGateway,
  merchantId: string,
  requestId: string,
  terms: CampaignTermsInput,
  now: Date,
): Promise<Round> {
  let campaign = await campaignOfRequest(db, merchantId, requestId);
  if (campaign === null) {
    const instrument = await openInstrument(db, terms.instrumentSymbol, now);
    campaign = await claimCampaign(db, merchantId, requestId, terms, instrument);
    // Inserted, then discarded by another call of the request before this read: start over.
    if (campaign === null) return { kind: "again" };
  }
  if (campaign.budget_pi !== null) {
    const recorded = await answerRecorded(db, gateway, payments, campaign, terms, null);
    return recorded.kind === "answer"
      ? { kind: "done", response: recorded.response }
      : { kind: "again" };
  }
  // No payment recorded yet: this call inserted the row, or another call of the request is
  // creating its payment right now, or one failed before recording it. Every call asks the
  // provider for the payment of this campaign: keyed on the campaign's id, they all get the same
  // intent, and the one that was perhaps created before a failure is found again. Nothing is paid
  // yet, so the condition must still be on sale, as for a new campaign.
  if (!sameTermsBesideBudget(campaign, terms) || campaign.budget !== terms.budget) {
    throw conflict(CREATE_CAMPAIGN_CONFLICTS.usedElsewhere);
  }
  await openInstrument(db, terms.instrumentSymbol, now);
  const claimed = campaign;
  const payment = await viaGateway(() =>
    gateway.createBudgetPayment({ campaignId: claimed.id, amount: terms.budget }),
  );
  if (!(await stillPayable(gateway, claimed.id, payment.id)).payable) {
    await db.begin((tx) => discardUnpaidCampaign(tx, claimed.id, payment.id));
    serverLogger("campaign-writes").info(
      { campaignId: claimed.id, requestId, paymentIntentId: payment.id },
      "the provider answered a cancelled budget payment: the campaign is discarded, the request starts over",
    );
    return { kind: "again" };
  }

  let recorded: RequestRow | null;
  try {
    // Only an existing row without a payment takes this one: a row deleted by a withdrawal, or
    // recording another payment, is never overwritten.
    const [updated] = await db<RequestRow[]>`
      update campaigns set budget_pi = ${payment.id}
      where id = ${claimed.id} and (budget_pi is null or budget_pi = ${payment.id})
      returning id, status, budget_pi, instrument, product, unit_price, refund_bps,
                usual_margin_bps, min_margin_bps, budget
    `;
    recorded =
      updated ??
      (
        await db<RequestRow[]>`
        select id, status, budget_pi, instrument, product, unit_price, refund_bps,
               usual_margin_bps, min_margin_bps, budget
        from campaigns where id = ${claimed.id}
      `
      )[0] ??
      null;
  } catch (error: unknown) {
    const withdrawal = await withdraw(db, payments, claimed.id, requestId, payment);
    if (withdrawal.kind === "recorded") {
      serverLogger("campaign-writes").warn(
        { campaignId: claimed.id, requestId, paymentIntentId: payment.id, err: error },
        "recording a budget payment failed after a concurrent call recorded it: answered as a repeat",
      );
      return { kind: "done", response: answerOf(withdrawal.row, payment, terms.budget) };
    }
    throw error;
  }

  if (recorded === null) {
    // Deleted meanwhile by a concurrent call that withdrew this same payment: cancel it too
    // (cancelling twice is harmless) and start over with a fresh row.
    await withdraw(db, payments, claimed.id, requestId, payment);
    return { kind: "again" };
  }
  if (recorded.budget_pi !== payment.id) {
    // Another payment was recorded for this campaign (an idempotency key the provider no longer
    // kept): this one is unused.
    await withdraw(db, payments, claimed.id, requestId, payment);
    const answer = await answerRecorded(db, gateway, payments, recorded, terms, null);
    return answer.kind === "answer"
      ? { kind: "done", response: answer.response }
      : { kind: "again" };
  }
  serverLogger("campaign-writes").info(
    { campaignId: recorded.id, requestId, paymentIntentId: payment.id },
    "campaign budget payment recorded",
  );
  return { kind: "done", response: answerOf(recorded, payment, terms.budget) };
}

/**
 * POST /api/campaigns with a `requestId` (the merchant's uuid, chosen once per "Fund" tap and kept
 * for its retries): one campaign and one budget payment per merchant and `requestId`, however
 * often and however concurrently the request is sent. Applies the lessons of the budget top-up
 * (`budget-top-up.ts`):
 *
 * - The partial unique index on `(merchant_id, request_id)` decides, never a read then a write:
 *   the first insert wins and every other call of the request works on the winner's row.
 * - No call to the payment provider is made while a lock or a transaction is open: the claim and
 *   the recording are single statements, and the provider is called between them.
 * - The provider's idempotency key is the campaign's id (`campaign_budget:<id>`, the key the
 *   gateway always used), and the campaign's id belongs to the `requestId` through the unique
 *   index: every call and retry of the request gets the same intent, even one created just
 *   before a failure. A request whose payment was withdrawn has no row any more, so its retry
 *   gets a new campaign and a new key: a payable intent, where a key built from the `requestId`
 *   alone would replay the cancelled intent for a day (the top-up's "this request is over").
 * - Its status is read before it is recorded (`stillPayable`): an intent the provider replays
 *   already cancelled is never answered; its campaign is discarded and the request starts over.
 * - A payment created and then not recorded (the recording failed, the campaign was discarded or
 *   records another payment) is cancelled (`withdraw`), never one a row records; a recording that
 *   fails after a concurrent call recorded the same intent is answered as the repeat it is.
 * - The same `requestId` again answers by the campaign's state of the moment (`answerRecorded`),
 *   whatever it is, and 409 when the terms differ.
 *
 * Not carried over, because creation has no such thing: the single open slot per campaign (a
 * request never replaces another one here: each `requestId` is its own campaign), the cap on a
 * campaign's total budget, and the webhook that refunds a paid intent no row expects (a budget
 * intent no campaign records cannot be paid: its client secret was never answered).
 *
 * A campaign row exists from the claim on, while its payment is being created: it stays out of
 * the merchant's list and detail until a payment is recorded, and a provider failure leaves it so
 * that the retry finds the intent the provider may have created.
 */
async function createCampaignOnce(
  db: Db,
  gateway: PaymentGateway,
  merchantId: string,
  requestId: string,
  terms: CampaignTermsInput,
  now: Date,
): Promise<CreateCampaignResponse> {
  const payments = topUpGatewayOf(gateway);
  if (payments === null) {
    throw new ApiRouteError(503, "internal", "Creating a promo is not available right now");
  }
  for (let round = 1; round <= MAX_CREATE_ROUNDS; round += 1) {
    const result = await createRound(db, gateway, payments, merchantId, requestId, terms, now);
    if (result.kind === "done") return result.response;
  }
  throw conflict(CREATE_CAMPAIGN_CONFLICTS.busy);
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

/**
 * The pause and resume jobs of a campaign form one sequence: each is stamped strictly after the
 * campaign's latest one, with the wall clock read once the campaign's row lock is held
 * (`enqueueJob`). Both routes enqueue under that lock, so the newest stamp is the request that
 * took the lock last, which is the merchant's last word, whatever the order in which the two
 * transactions began. The web route, the engine's handler (`isLatestRequest`) and the pause rule
 * (`pauseJoins`) all take the latest by `created_at desc, id desc`; the id never decides between
 * two of these jobs, whose stamps are never equal.
 */
const PAUSE_SEQUENCE = { sequenceBy: "campaignId" } as const;

/** The merchant's latest pause or resume request of a campaign (its `campaign.set_paused` job). */
export interface LatestPauseRequest {
  requestId: string | null;
  /** True for a pause, false for a resume. */
  paused: boolean;
  /** The job's state: `queued` or `running` until the engine has carried it out. */
  status: string;
}

/** Read under the campaign's lock by the routes; exported for the tests of the order. */
export async function latestPauseRequest(
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
      PAUSE_SEQUENCE,
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
 *
 * A second resume with ANOTHER `requestId` while the first waits in the queue answers 200 and
 * records nothing (its id is in no row). Sent again once the first resume has landed (the chain
 * live, the latest request a resume carried out), it is answered 409 "This promo is not paused",
 * like any new click on a live promo: nothing tells it from one without a row recording its id,
 * which needs either a second job (enqueued at most once is the rule) or a column or table the
 * schema does not have. Its effect is achieved either way and nothing is enqueued twice; a client
 * that retries keeps its first `requestId`, whose repeats always answer the stored state.
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
      PAUSE_SEQUENCE,
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
