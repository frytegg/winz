import {
  JOB_KINDS,
  STRIPE_PAYMENT_KINDS,
  jobIdempotencyKey,
  type CampaignStatus,
  type SaleState,
  type TopUpCampaignRequest,
  type TopUpCampaignResponse,
} from "@winz/shared";

import { MAX_CARD_AMOUNT, checkCardAmount, paymentUnavailable } from "./campaign-writes";
import type { Db } from "./db";
import { enqueueJob, type JobSql } from "./jobs";
import { serverLogger } from "./logger";
import {
  PaymentGatewayError,
  paymentKindOf,
  topUpGatewayOf,
  type CreatedPaymentIntent,
  type PaymentGateway,
  type PaymentIntentView,
  type PaymentWebhookEvent,
  type TopUpPaymentGateway,
  type UnpaidCancellation,
} from "./payments-gateway";
import { ApiRouteError } from "./route";
import { digits } from "./wire";

/**
 * A merchant adds hedge budget to their running campaign (SPEC CA-6, task A-08), paid by card as
 * the first budget was. The web app only writes rows and enqueues a job: the route creates the
 * card payment and a `budget_top_ups` row, the Stripe webhook turns a paid top-up into ONE
 * `campaign.top_up` job, and the engine adds it to the escrow with `topUpBudgetFor` (or refunds
 * the card when the campaign can no longer take it). The campaign's budget changes only when the
 * engine projects the on-chain `BudgetToppedUp`.
 *
 * One top-up per campaign at a time: while one is paid and on its way to the chain, a new one is
 * refused, so the cap on the campaign's total budget is checked against a budget that no top-up
 * in flight can still change, and a merchant who clicks twice is never charged twice. A top-up
 * still awaiting payment does not block: the merchant may have closed the payment sheet, so a new
 * request REPLACES it, after cancelling its PaymentIntent at Stripe (a cancelled intent can never
 * be paid). When Stripe answers that the old one is paid or being paid, the new one is refused.
 * The database backs this with a unique index (`budget_top_ups_one_open_key`).
 *
 * No call to the payment provider is ever made while the campaign's row is locked: that lock is
 * the one of the pause and close routes, of the demo sale's check and of the engine's projection
 * and sale state, so a slow Stripe would stop the campaign's sales for as long as it answers.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The statuses of a `budget_top_ups` row (see the migration). */
export const TOP_UP_STATUSES = [
  "requires_payment",
  "processing",
  "credited",
  "refunding",
  "refunded",
  "failed",
] as const;
export type TopUpStatus = (typeof TOP_UP_STATUSES)[number];

/** Statuses of a top-up that holds its campaign's single slot. */
const OPEN_STATUSES: readonly TopUpStatus[] = ["requires_payment", "processing"];

/** Statuses after which nothing can change any more. */
const SETTLED_STATUSES: readonly CampaignStatus[] = ["settled_yes", "settled_no", "void", "closed"];

/** Messages stored on a top-up that ended without being credited. */
export const TOP_UP_MESSAGES = {
  replaced: "Replaced by a newer top-up request",
  cancelled: "The payment was cancelled",
  declined: "The card was declined",
  /** Its payment was created, then the request was refused or lost the slot: cancelled unused. */
  withdrawn: "The request was refused after its payment was created; the payment is cancelled",
  /** Paid although nothing could take it any more: the engine's job refunds it. */
  paidUnused: "Paid after its request had ended: refunded",
  /**
   * Its payment was cancelled by a newer request, which did not record a top-up in its place (it
   * was refused, failed, or was answered as a repeat): a cancelled intent can never be paid.
   */
  cancelledForNewer: "Its payment was cancelled for a newer top-up request",
} as const;

/** The answer to a repeated request whose top-up is over without being credited (409). */
export const TOP_UP_OVER_MESSAGE =
  "This top-up request is over; make a new request to top up again";

/**
 * The 409s the route answers with a message of its own (besides the campaign's state and
 * `TOP_UP_OVER_MESSAGE`), by whether the same `requestId` can still succeed later. A request
 * whose payment was created and then withdrawn can never be paid, and the provider gives its
 * `requestId` that same cancelled intent again: its 409 says that a new request is needed. The
 * others are answered before any payment exists, so the same request does go through later.
 */
export const TOP_UP_CONFLICTS = {
  /** Before any payment: the same request goes through once the top-up on its way is credited. */
  inFlight: "A top-up of this promo is on its way; try again once it is credited",
  /** Before any payment: the same request goes through once the payment being made is over. */
  beingPaid: "A top-up of this promo is being paid; try again once it is credited",
  /** After this request's payment was created and withdrawn: the request is over. */
  inFlightOver:
    "A top-up of this promo is on its way; once it is credited, make a new request to top up again",
  /** After this request's payment was created and withdrawn: the request is over. */
  beingPaidOver:
    "A top-up of this promo is being paid; once it is credited, make a new request to top up again",
  /** Other requests kept taking the slot (`MAX_ROUNDS`): its payment is withdrawn, it is over. */
  justRequested:
    "Another top-up of this promo was just requested; make a new request to top up again",
  /** The `requestId` belongs to a top-up of another campaign or amount: it never fits this one. */
  usedElsewhere: "This request was already used for another top-up; make a new request to top up",
} as const;

/** How many times a request goes back to the provider when another request took the slot. */
export const MAX_ROUNDS = 3;

function conflict(message: string): ApiRouteError {
  return new ApiRouteError(409, "conflict", message);
}

interface CampaignRow {
  id: string;
  onchain_id: bigint | null;
  status: CampaignStatus;
  sale_state: SaleState;
  sales_close: Date;
  outcome: string | null;
  budget: bigint;
  close_requested: boolean;
}

/**
 * Locks the merchant's own campaign for the rest of the transaction, as the pause route does:
 * 404 for an unknown id and for another merchant's campaign alike (its existence is not revealed),
 * and for the claim of a creation request whose payment is not recorded (no campaign yet).
 * The caller makes no call to the payment provider before the transaction ends.
 */
async function lockOwnCampaign(
  tx: JobSql,
  merchantId: string,
  campaignId: string,
): Promise<CampaignRow> {
  const [row] = UUID.test(campaignId)
    ? await tx<CampaignRow[]>`
        select c.id, c.onchain_id, c.status, c.sale_state, c.sales_close, c.outcome, c.budget,
               exists (
                 select 1 from jobs j
                 where j.idempotency_key = ${jobIdempotencyKey.closeSales(campaignId)}
               ) as close_requested
        from campaigns c
        where c.id = ${campaignId} and c.merchant_id = ${merchantId}
          -- A creation request's claim whose payment is not recorded is not a campaign yet.
          and not (c.request_id is not null and c.budget_pi is null)
        for update of c
      `
    : [];
  if (!row) throw new ApiRouteError(404, "not_found", "Campaign not found");
  return row;
}

/**
 * The same row lock, for a lock period that only writes what a request found out with the lock
 * released (its campaign was found and is the merchant's already).
 */
async function lockCampaignRow(tx: JobSql, campaignId: string): Promise<void> {
  await tx`select id from campaigns where id = ${campaignId} for update`;
}

/** Why the campaign cannot take a top-up now, as the error to answer, or null when it can. */
function cannotTakeTopUp(row: CampaignRow, now: Date): ApiRouteError | null {
  if (row.outcome !== null || SETTLED_STATUSES.includes(row.status)) {
    return conflict("This promo is already settled");
  }
  if (row.onchain_id === null || row.status === "draft" || row.status === "funding") {
    return conflict("This promo is not live yet");
  }
  // A top-up after the close could never be spent: the contract would take it until the
  // settlement, the product does not.
  if (
    row.status === "sales_closed" ||
    row.sale_state === "closed" ||
    row.close_requested ||
    now.getTime() >= row.sales_close.getTime()
  ) {
    return new ApiRouteError(
      409,
      "sales_closed",
      "Sales are closed for this promo: its budget can no longer be topped up",
    );
  }
  if (row.status !== "live" && row.status !== "paused") {
    return conflict("This promo cannot be topped up now");
  }
  return null;
}

/** The refusal of the campaign's state or of the cap on its budget, or null when it can take it. */
function refusalOf(row: CampaignRow, amount: bigint, now: Date): ApiRouteError | null {
  const refusal = cannotTakeTopUp(row, now);
  if (refusal !== null) return refusal;
  if (row.budget + amount > MAX_CARD_AMOUNT) {
    return new ApiRouteError(
      400,
      "invalid_request",
      "Invalid body.amount: the promo's budget would go above $999,999.99",
    );
  }
  return null;
}

/** The amount of the body, after the checks of a card amount (400 naming the field). */
export function parseTopUpAmount(body: TopUpCampaignRequest): bigint {
  const amount = BigInt(body.amount);
  checkCardAmount("amount", amount);
  return amount;
}

interface TopUpRow {
  request_id: string;
  campaign_id: string;
  stripe_pi: string;
  amount: bigint;
  status: TopUpStatus;
}

async function topUpOfRequest(sql: JobSql, requestId: string): Promise<TopUpRow | null> {
  const [row] = await sql<TopUpRow[]>`
    select request_id, campaign_id, stripe_pi, amount, status from budget_top_ups
    where request_id = ${requestId}
  `;
  return row ?? null;
}

/**
 * The status the answer carries: only those of a top-up answered 200. A top-up over without being
 * credited (`failed`, `refunding`, `refunded`) is refused: its request can only be made anew.
 */
function answeredStatus(status: TopUpStatus): NonNullable<TopUpCampaignResponse["status"]> {
  if (status === "requires_payment" || status === "processing" || status === "credited") {
    return status;
  }
  throw conflict(TOP_UP_OVER_MESSAGE);
}

function answer(row: TopUpRow, clientSecret: string): TopUpCampaignResponse {
  return {
    campaignId: row.campaign_id,
    requestId: row.request_id,
    amount: digits(row.amount),
    budgetPayment: {
      paymentIntentId: row.stripe_pi,
      clientSecret,
      amount: digits(row.amount),
    },
    status: answeredStatus(row.status),
  };
}

/** Calls the gateway; a provider failure answers 502. */
async function viaGateway<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error: unknown) {
    if (error instanceof PaymentGatewayError) {
      serverLogger("budget-top-up").error({ err: error }, "payment provider call failed");
      throw paymentUnavailable();
    }
    throw error;
  }
}

/**
 * The same request sent again: answered by where its top-up stands, and nothing is created. 409
 * when it was used for another campaign or another amount, or when its top-up is over without
 * being credited (cancelled, declined, replaced, refunded: a new request must be made); otherwise
 * 200 with its payment and its status. The client secret is read from the provider (outside any
 * lock) unless the caller holds it, and the row is read again after that call, so that a top-up
 * replaced meanwhile is not answered with the secret of a cancelled intent.
 */
async function repeatedRequest(
  db: Db,
  payments: TopUpPaymentGateway,
  existing: TopUpRow,
  campaignId: string,
  amount: bigint,
  knownSecret: string | null,
): Promise<TopUpCampaignResponse> {
  if (existing.campaign_id !== campaignId || existing.amount !== amount) {
    throw conflict(TOP_UP_CONFLICTS.usedElsewhere);
  }
  answeredStatus(existing.status);
  const clientSecret =
    knownSecret ?? (await viaGateway(() => payments.retrieveClientSecret(existing.stripe_pi)));
  if (clientSecret === null) {
    serverLogger("budget-top-up").error(
      { campaignId, paymentIntentId: existing.stripe_pi },
      "the payment of a top-up is unknown to the payment provider",
    );
    throw paymentUnavailable();
  }
  const now = (await topUpOfRequest(db, existing.request_id)) ?? existing;
  return answer(now, clientSecret);
}

/** What the first look at the campaign, under its lock, decided. */
type Decision =
  /** The `requestId` is recorded: answer it (`repeatedRequest`). */
  | { kind: "repeat"; campaignId: string; row: TopUpRow }
  /** Create the payment, after cancelling the unpaid top-up holding the slot (if any). */
  | { kind: "create"; campaignId: string; replace: TopUpRow | null };

/** The first lock period: database reads only, no call to the provider. */
async function decide(
  tx: JobSql,
  merchantId: string,
  campaignId: string,
  requestId: string,
  amount: bigint,
  now: Date,
): Promise<Decision> {
  const campaign = await lockOwnCampaign(tx, merchantId, campaignId);
  const existing = await topUpOfRequest(tx, requestId);
  if (existing !== null) return { kind: "repeat", campaignId: campaign.id, row: existing };
  const refusal = refusalOf(campaign, amount, now);
  if (refusal !== null) throw refusal;
  const open = await tx<TopUpRow[]>`
    select request_id, campaign_id, stripe_pi, amount, status from budget_top_ups
    where campaign_id = ${campaign.id} and status in ${tx([...OPEN_STATUSES])}
  `;
  if (open.some((row) => row.status === "processing")) {
    throw conflict(TOP_UP_CONFLICTS.inFlight);
  }
  return { kind: "create", campaignId: campaign.id, replace: open[0] ?? null };
}

/**
 * Ends the unpaid top-ups this request cancelled the intents of (`cancelHolder`), in the caller's
 * lock period: their intents can never be paid, so a repeat of their requests must be told they
 * are over instead of being answered a dead client secret, and the campaign's slot is freed at
 * once instead of when the provider's `payment_intent.canceled` webhook arrives. Only a row still
 * `requires_payment` with the very intent that was cancelled changes.
 */
async function endCancelledHolders(
  tx: JobSql,
  campaignId: string,
  holders: readonly TopUpRow[],
  message: string,
): Promise<void> {
  for (const holder of holders) {
    const ended = await tx`
      update budget_top_ups set status = 'failed', message = ${message}
      where request_id = ${holder.request_id} and stripe_pi = ${holder.stripe_pi}
        and status = 'requires_payment'
      returning request_id
    `;
    if (ended.length === 1) {
      serverLogger("budget-top-up").info(
        { campaignId, ended: holder.request_id, paymentIntentId: holder.stripe_pi, message },
        "unpaid top-up ended: its payment was cancelled for a newer request",
      );
    }
  }
}

/** What the second lock period found, once the payment exists at the provider. */
type Commit =
  /** The top-up is recorded with the payment just created. */
  | { kind: "created"; row: TopUpRow }
  /** The same `requestId` was recorded meanwhile by a concurrent call. */
  | { kind: "repeat"; row: TopUpRow }
  /** Another request's unpaid top-up took the slot meanwhile: replace it in turn. */
  | { kind: "slot_taken"; holder: TopUpRow }
  /** The campaign can no longer take this top-up, or a top-up of it was paid meanwhile. */
  | { kind: "refused"; error: ApiRouteError };

/**
 * The second lock period: everything that may have changed while the provider answered is read
 * again (the campaign closed or settled, the cap, the slot, the same request recorded by another
 * call), then the top-up is recorded. The unpaid top-ups whose intents this request cancelled
 * (`cancelled`) end `failed` in this same lock period whatever it decides: replaced when the
 * top-up is recorded, cancelled for a newer request otherwise (`endCancelledHolders`).
 */
async function commit(
  tx: JobSql,
  merchantId: string,
  campaignId: string,
  body: TopUpCampaignRequest,
  amount: bigint,
  now: Date,
  cancelled: readonly TopUpRow[],
  payment: CreatedPaymentIntent,
): Promise<Commit> {
  const campaign = await lockOwnCampaign(tx, merchantId, campaignId);
  const endCancelled = (message: string): Promise<void> =>
    endCancelledHolders(tx, campaign.id, cancelled, message);
  const existing = await topUpOfRequest(tx, body.requestId);
  if (existing !== null) {
    await endCancelled(TOP_UP_MESSAGES.cancelledForNewer);
    return { kind: "repeat", row: existing };
  }
  const refusal = refusalOf(campaign, amount, now);
  if (refusal !== null) {
    await endCancelled(TOP_UP_MESSAGES.cancelledForNewer);
    return { kind: "refused", error: refusal };
  }
  const open = await tx<TopUpRow[]>`
    select request_id, campaign_id, stripe_pi, amount, status from budget_top_ups
    where campaign_id = ${campaign.id} and status in ${tx([...OPEN_STATUSES])}
  `;
  if (open.some((row) => row.status === "processing")) {
    // Paid between the two lock periods: this request's payment exists already and is
    // withdrawn, so the same request can never go through.
    await endCancelled(TOP_UP_MESSAGES.cancelledForNewer);
    return { kind: "refused", error: conflict(TOP_UP_CONFLICTS.inFlightOver) };
  }
  const mine = new Set(cancelled.map((row) => row.request_id));
  const holder = open.find((row) => !mine.has(row.request_id));
  if (holder !== undefined) {
    await endCancelled(TOP_UP_MESSAGES.cancelledForNewer);
    return { kind: "slot_taken", holder };
  }
  for (const replaced of open) {
    await tx`
      update budget_top_ups set status = 'failed', message = ${TOP_UP_MESSAGES.replaced}
      where request_id = ${replaced.request_id} and stripe_pi = ${replaced.stripe_pi}
        and status = 'requires_payment'
    `;
    serverLogger("budget-top-up").info(
      { campaignId, replaced: replaced.request_id, paymentIntentId: replaced.stripe_pi },
      "unpaid top-up replaced by a newer request; its payment is cancelled",
    );
  }
  const [row] = await tx<TopUpRow[]>`
    insert into budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
    values (${body.requestId}, ${campaign.id}, ${payment.id}, ${amount}, 'requires_payment')
    returning request_id, campaign_id, stripe_pi, amount, status
  `;
  if (!row) throw new Error("budget_top_ups insert returned no row");
  return { kind: "created", row };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

/**
 * Cancels the unpaid top-up's intent holding the slot (outside any lock), or refuses (409) when it
 * is paid or being paid. Its row ends `failed` in the next lock period, whatever that decides
 * (`commit`, `endCancelledHolders`). `paymentCreated`: this request's own payment exists already,
 * so a refusal ends the request for good and says so.
 */
async function cancelHolder(
  payments: TopUpPaymentGateway,
  holder: TopUpRow,
  paymentCreated: boolean,
): Promise<void> {
  const result: UnpaidCancellation = await viaGateway(() =>
    payments.cancelUnpaidPaymentIntent(holder.stripe_pi),
  );
  if (result === "not_cancelable") {
    throw conflict(paymentCreated ? TOP_UP_CONFLICTS.beingPaidOver : TOP_UP_CONFLICTS.beingPaid);
  }
}

/**
 * Whether the intent the creation answered can still be paid, read at the provider with the lock
 * released. The provider keys the creation on the `requestId` and replays the same intent for
 * about a day whatever became of it, and its replay cannot be told from a first creation here: a
 * request whose payment was withdrawn earlier (and whose refusal could not be recorded, the
 * database being down) gets that cancelled intent back, showing it unpaid. One read per request.
 */
async function stillPayable(
  gateway: PaymentGateway,
  campaignId: string,
  requestId: string,
  payment: CreatedPaymentIntent,
): Promise<boolean> {
  const current = await viaGateway(() => gateway.retrievePaymentIntent(payment.id));
  if (current === null) {
    serverLogger("budget-top-up").error(
      { campaignId, requestId, paymentIntentId: payment.id },
      "the payment just created for a top-up is unknown to the payment provider",
    );
    throw paymentUnavailable();
  }
  return current.status !== "canceled";
}

/**
 * The request's payment is cancelled already (`stillPayable`): in one lock period the request is
 * recorded `failed` (or its row, recorded meanwhile on that same dead intent, ends `failed`), and
 * the top-ups it cancelled the intents of end too.
 */
async function recordDeadPayment(
  tx: JobSql,
  campaignId: string,
  requestId: string,
  amount: bigint,
  payment: CreatedPaymentIntent,
  cancelled: readonly TopUpRow[],
): Promise<void> {
  await lockCampaignRow(tx, campaignId);
  await endCancelledHolders(tx, campaignId, cancelled, TOP_UP_MESSAGES.cancelledForNewer);
  await tx`
    insert into budget_top_ups (request_id, campaign_id, stripe_pi, amount, status, message)
    values (${requestId}, ${campaignId}, ${payment.id}, ${amount}, 'failed',
            ${TOP_UP_MESSAGES.cancelled})
    on conflict do nothing
  `;
  await tx`
    update budget_top_ups set status = 'failed', message = ${TOP_UP_MESSAGES.cancelled}
    where request_id = ${requestId} and stripe_pi = ${payment.id} and status = 'requires_payment'
  `;
}

/**
 * Ends the top-ups this request cancelled the intents of, in a short lock period of its own, when
 * the request fails before any payment of its own exists (the creation failed). A failure here is
 * logged: the provider's `payment_intent.canceled` webhook still ends them.
 */
async function endCancelledHoldersAlone(
  db: Db,
  campaignId: string,
  cancelled: readonly TopUpRow[],
): Promise<void> {
  try {
    await db.begin(async (tx) => {
      await lockCampaignRow(tx, campaignId);
      await endCancelledHolders(tx, campaignId, cancelled, TOP_UP_MESSAGES.cancelledForNewer);
    });
  } catch (error: unknown) {
    serverLogger("budget-top-up").warn(
      { campaignId, holders: cancelled.map((row) => row.request_id), err: error },
      "top-ups whose payments were cancelled could not be ended: their canceled webhook ends them",
    );
  }
}

/**
 * A payment this request created and no row records as open (the request was refused, lost the
 * slot, or failed): cancelled at the provider, outside any lock, so that no payable intent is left
 * that no row knows. First, under the campaign's lock, the request is recorded `failed` under its
 * `requestId` (a concurrent call of the same request, which the provider answers the very same
 * intent, then sees it over instead of recording that intent open after the check), and the
 * top-ups this request cancelled the intents of end (`endCancelledHolders`).
 *
 * When a row already records this intent, nothing is cancelled: never an intent a row records
 * open, which a concurrent call of the same request recorded and answered. That row is returned
 * when it is this request's own and open, for the caller to answer it as the repeat it is.
 *
 * When the cancel fails or finds the intent being paid, the record is taken back (a `failed` top-up
 * is one whose intent is cancelled) and it is logged at error. Its client secret was never
 * answered, so nobody should pay it; if it is paid all the same, the webhook (`handleTopUpPaid`)
 * records it `refunding` and enqueues the job that refunds it: the money is never kept without
 * being credited. When the database cannot be reached, the intent is cancelled all the same and
 * nothing is recorded: a later repeat of the request finds it cancelled (`stillPayable`).
 */
async function withdraw(
  db: Db,
  payments: TopUpPaymentGateway,
  campaignId: string,
  requestId: string,
  amount: bigint,
  payment: CreatedPaymentIntent,
  cancelled: readonly TopUpRow[],
): Promise<TopUpRow | null> {
  const log = serverLogger("budget-top-up");
  const fields = { campaignId, requestId, paymentIntentId: payment.id };
  let claimed = false;
  try {
    const found = await db.begin(async (tx) => {
      await lockCampaignRow(tx, campaignId);
      await endCancelledHolders(tx, campaignId, cancelled, TOP_UP_MESSAGES.cancelledForNewer);
      const inserted = await tx`
        insert into budget_top_ups (request_id, campaign_id, stripe_pi, amount, status, message)
        values (${requestId}, ${campaignId}, ${payment.id}, ${amount}, 'failed',
                ${TOP_UP_MESSAGES.withdrawn})
        on conflict do nothing
        returning request_id
      `;
      if (inserted.length === 1) return { claimed: true, recorded: null };
      return { claimed: false, recorded: await topUpRowOf(tx, payment.id) };
    });
    claimed = found.claimed;
    if (found.recorded !== null) {
      const row = found.recorded;
      log.info(
        { ...fields, recordedBy: row.request_id, status: row.status },
        "a top-up payment to withdraw is recorded by a top-up: left as it is",
      );
      const own = row.request_id === requestId && OPEN_STATUSES.includes(row.status);
      return own ? row : null;
    }
  } catch (error: unknown) {
    log.warn(
      { ...fields, err: error },
      "a top-up payment to withdraw could not be checked or recorded: it is cancelled all the same",
    );
  }

  let result: UnpaidCancellation | null = null;
  try {
    result = await payments.cancelUnpaidPaymentIntent(payment.id);
  } catch (error: unknown) {
    log.error(
      { ...fields, err: error },
      "an unused top-up payment could not be cancelled: if it is ever paid, it is refunded",
    );
  }
  if (result === "canceled") {
    log.info({ ...fields, recorded: claimed }, "unused top-up payment cancelled");
    return null;
  }
  if (result === "not_cancelable") {
    log.error(
      fields,
      "an unused top-up payment is being paid: the webhook records it and the engine refunds it",
    );
  }
  if (claimed) {
    try {
      await db`
        delete from budget_top_ups
        where request_id = ${requestId} and stripe_pi = ${payment.id} and status = 'failed'
          and message = ${TOP_UP_MESSAGES.withdrawn}
      `;
    } catch (error: unknown) {
      log.error(
        { ...fields, err: error },
        "a top-up recorded withdrawn whose payment is not cancelled could not be taken back",
      );
    }
  }
  return null;
}

/**
 * POST /api/campaigns/:id/top-up, in three steps so that the campaign's row is never locked
 * while the payment provider answers:
 *
 * 1. Under the campaign's row lock (the lock of the pause route), database reads only: a
 *    `requestId` already recorded is a repeated request (`repeatedRequest`); otherwise the
 *    campaign must be live or paused on-chain, before its sales close, never settled; the amount
 *    a card amount; the campaign's total budget after it at most `MAX_CARD_AMOUNT`, the cap
 *    `createCampaign` puts on a budget; and no top-up of the campaign paid and on its way.
 * 2. The lock released: the unpaid top-up holding the slot, if any, has its intent cancelled
 *    (409 when it is paid or being paid), then the card payment is created as the first budget's
 *    is (captured automatically, keyed on the request at Stripe, so the same request creates one
 *    intent however often it is sent), and its status is read: an intent Stripe replays already
 *    cancelled ends the request (`stillPayable`, 409 `TOP_UP_OVER_MESSAGE`).
 * 3. Under the lock again, everything is read again and the top-up recorded `requires_payment`
 *    (`commit`). The same request recorded meanwhile by a concurrent call is answered as a
 *    repeat. Another request's unpaid top-up recorded meanwhile is replaced in turn, as in step 2
 *    (at most `MAX_ROUNDS` times, then 409): the newest request wins, as when they come one after
 *    the other, and the unique index on open top-ups is the last word. A campaign that closed or
 *    settled meanwhile refuses the request.
 *
 * A payment created in step 2 that no row ends up recording is cancelled (`withdraw`), never one
 * a row records open; a top-up whose intent step 2 cancelled ends `failed` whatever becomes of
 * the request, so that no row is left open on an intent that can never be paid.
 */
export async function topUpCampaign(
  db: Db,
  gateway: PaymentGateway,
  merchantId: string,
  campaignId: string,
  body: TopUpCampaignRequest,
  now: Date,
): Promise<TopUpCampaignResponse> {
  const payments = topUpGatewayOf(gateway);
  if (payments === null) {
    throw new ApiRouteError(503, "internal", "Top-ups are not available right now");
  }
  const amount = parseTopUpAmount(body);
  const decision = await db.begin((tx) =>
    decide(tx, merchantId, campaignId, body.requestId, amount, now),
  );
  // The campaign's id as stored (the path may spell it in capitals): the payment's metadata and
  // the rows carry this one.
  const id = decision.campaignId;
  if (decision.kind === "repeat") {
    return repeatedRequest(db, payments, decision.row, id, amount, null);
  }

  let holder = decision.replace;
  let payment: CreatedPaymentIntent | null = null;
  // The top-ups whose intents this request cancelled and whose rows no committed lock period has
  // ended yet: every way out of the request ends them (`endCancelledHolders`).
  const cancelled: TopUpRow[] = [];
  // True once the payment created is recorded by a row, or withdrawn: nothing more to undo.
  let accounted = false;
  try {
    for (let round = 1; ; round += 1) {
      if (holder !== null) {
        await cancelHolder(payments, holder, payment !== null);
        cancelled.push(holder);
        holder = null;
      }
      if (payment === null) {
        const fresh = await viaGateway(() =>
          payments.createBudgetTopUpPayment({ campaignId: id, requestId: body.requestId, amount }),
        );
        payment = fresh;
        if (!(await stillPayable(gateway, id, body.requestId, fresh))) {
          await db.begin((tx) =>
            recordDeadPayment(tx, id, body.requestId, amount, fresh, cancelled),
          );
          cancelled.length = 0;
          accounted = true;
          serverLogger("budget-top-up").info(
            { campaignId: id, requestId: body.requestId, paymentIntentId: fresh.id },
            "the provider answered a cancelled payment for this request: it is over",
          );
          throw conflict(TOP_UP_OVER_MESSAGE);
        }
      }
      const created: CreatedPaymentIntent = payment;

      let outcome: Commit;
      try {
        outcome = await db.begin((tx) =>
          commit(tx, merchantId, id, body, amount, now, cancelled, created),
        );
      } catch (error: unknown) {
        // The unique indexes decide a race the reads above did not see: read everything again.
        // At the last round the error goes to `withdraw`, which reads again under the lock and
        // answers the request's own row, recorded by a concurrent call of it, as a repeat.
        if (!isUniqueViolation(error) || round >= MAX_ROUNDS) throw error;
        continue;
      }
      // The lock period committed: it ended the top-ups this request cancelled.
      cancelled.length = 0;

      switch (outcome.kind) {
        case "created":
          accounted = true;
          serverLogger("budget-top-up").info(
            { campaignId: id, requestId: body.requestId, paymentIntentId: created.id },
            "top-up payment created",
          );
          return answer(outcome.row, created.clientSecret);
        case "repeat": {
          // Stripe's key on the request gives the same intent to every call of the request: a
          // row with another one (a key Stripe no longer kept) leaves this one unused.
          const same = outcome.row.stripe_pi === created.id;
          if (!same) await withdraw(db, payments, id, body.requestId, amount, created, []);
          accounted = true;
          return await repeatedRequest(
            db,
            payments,
            outcome.row,
            id,
            amount,
            same ? created.clientSecret : null,
          );
        }
        case "refused":
          throw outcome.error;
        case "slot_taken":
          if (round >= MAX_ROUNDS) throw conflict(TOP_UP_CONFLICTS.justRequested);
          holder = outcome.holder;
          break;
      }
    }
  } catch (error: unknown) {
    if (payment !== null && !accounted) {
      const own = await withdraw(db, payments, id, body.requestId, amount, payment, cancelled);
      if (own !== null) {
        serverLogger("budget-top-up").warn(
          { campaignId: id, requestId: body.requestId, paymentIntentId: payment.id, err: error },
          "a top-up request failed after a concurrent call of it recorded its payment: answered as a repeat",
        );
        return await repeatedRequest(db, payments, own, id, amount, payment.clientSecret);
      }
    } else if (cancelled.length > 0) {
      await endCancelledHoldersAlone(db, id, cancelled);
    }
    // A unique index that kept refusing the top-up, and no row of this request: another request
    // holds the slot, and this request's payment is withdrawn.
    if (isUniqueViolation(error)) throw conflict(TOP_UP_CONFLICTS.justRequested);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------------------------

/** Why a PaymentIntent cannot be this top-up's payment, or null when it can. */
function intentMismatch(row: TopUpRow, intent: PaymentIntentView): string | null {
  if (paymentKindOf(intent) !== STRIPE_PAYMENT_KINDS.campaignBudgetTopUp) return "not a top-up";
  if (intent.metadata.campaignId !== row.campaign_id) return "pays another campaign";
  if (intent.metadata.requestId !== row.request_id) return "belongs to another request";
  if (intent.currency !== "usd") return "not in USD";
  if (intent.amount !== row.amount) return "amount differs from the top-up";
  return null;
}

async function topUpRowOf(sql: JobSql, paymentIntentId: string): Promise<TopUpRow | null> {
  const [row] = await sql<TopUpRow[]>`
    select request_id, campaign_id, stripe_pi, amount, status from budget_top_ups
    where stripe_pi = ${paymentIntentId}
  `;
  return row ?? null;
}

/** The top-up a paid intent's metadata names, when it is a well-formed one of ours. */
function claimedTopUp(intent: PaymentIntentView): { campaignId: string; requestId: string } | null {
  const campaignId = intent.metadata.campaignId ?? "";
  const requestId = intent.metadata.requestId ?? "";
  if (paymentKindOf(intent) !== STRIPE_PAYMENT_KINDS.campaignBudgetTopUp) return null;
  if (!UUID.test(campaignId) || !UUID.test(requestId)) return null;
  if (intent.currency !== "usd" || intent.amount <= 0n) return null;
  return { campaignId, requestId };
}

/**
 * Stripe's own view of a paid top-up intent, read back (a signed event can still be stale, and
 * these paths act on intents no open top-up expects): the intent when Stripe shows it paid, for
 * the same top-up (kind, campaign, request, amount), else null.
 */
async function confirmedPaid(
  gateway: PaymentGateway,
  intent: PaymentIntentView,
): Promise<PaymentIntentView | null> {
  const current = await gateway.retrievePaymentIntent(intent.id);
  if (
    current === null ||
    current.status !== "succeeded" ||
    paymentKindOf(current) !== STRIPE_PAYMENT_KINDS.campaignBudgetTopUp ||
    current.metadata.campaignId !== intent.metadata.campaignId ||
    current.metadata.requestId !== intent.metadata.requestId ||
    current.currency !== "usd" ||
    current.amount !== intent.amount
  ) {
    return null;
  }
  return current;
}

/**
 * A top-up payment Stripe shows paid although no open top-up expects it: the payment of a request
 * that was refused or lost the slot and whose cancel failed (see `withdraw`), or, if Stripe ever
 * let one through, of a top-up that ended `failed`. The money must not be kept without being
 * credited: in one transaction the top-up is recorded `refunding` (its row created from the
 * intent's metadata when there is none) and ONE `campaign.top_up` job is enqueued, which refunds
 * the card exactly once (the engine's handler finishes the refund of a `refunding` top-up and
 * never sends a transaction for it). A duplicate delivery finds the job and enqueues nothing.
 */
async function refundUnexpectedPayment(
  db: Db,
  event: PaymentWebhookEvent,
  intent: PaymentIntentView,
  claimed: { campaignId: string; requestId: string },
): Promise<"handled" | "open"> {
  const log = serverLogger("budget-top-up");
  const fields = { eventId: event.id, paymentIntentId: intent.id, ...claimed };
  const outcome = await db.begin(async (tx) => {
    await tx`
      insert into budget_top_ups (request_id, campaign_id, stripe_pi, amount, status, message)
      select ${claimed.requestId}, c.id, ${intent.id}, ${intent.amount}, 'refunding',
             ${TOP_UP_MESSAGES.paidUnused}
      from campaigns c where c.id = ${claimed.campaignId}
      on conflict do nothing
    `;
    const [row] = await tx<TopUpRow[]>`
      select request_id, campaign_id, stripe_pi, amount, status from budget_top_ups
      where stripe_pi = ${intent.id}
      for update
    `;
    if (
      row === undefined ||
      row.request_id !== claimed.requestId ||
      row.campaign_id !== claimed.campaignId.toLowerCase() ||
      row.amount !== intent.amount
    ) {
      return { recorded: false, open: false, created: false };
    }
    if (row.status === "requires_payment" || row.status === "processing") {
      // Recorded as an open top-up meanwhile: the ordinary path takes it.
      return { recorded: true, open: true, created: false };
    }
    if (row.status === "failed") {
      await tx`
        update budget_top_ups set status = 'refunding', message = ${TOP_UP_MESSAGES.paidUnused}
        where stripe_pi = ${intent.id} and status = 'failed'
      `;
    } else if (row.status !== "refunding") {
      // Credited or refunded already: nothing to add.
      return { recorded: true, open: false, created: false };
    }
    const job = await enqueueJob(
      tx,
      JOB_KINDS.topUpBudget,
      {
        campaignId: row.campaign_id,
        amount: digits(row.amount),
        paymentIntentId: row.stripe_pi,
        requestId: row.request_id,
      },
      jobIdempotencyKey.topUpBudget(row.stripe_pi),
    );
    return { recorded: true, open: false, created: job.created };
  });
  if (!outcome.recorded) {
    // Left as it is, on purpose: an orphan intent paid while its `requestId` already holds ANOTHER
    // intent cannot be recorded (`request_id` is the table's primary key, so recording it needs a
    // schema change), and it takes the provider returning two different intents for one key,
    // which it does only once that key has expired (about a day). It is refunded by hand.
    log.error(
      fields,
      "a paid top-up payment cannot be recorded (unknown campaign, or its request holds another payment): it must be refunded by hand",
    );
    return "handled";
  }
  if (outcome.open) return "open";
  log.warn(
    { ...fields, created: outcome.created },
    "a top-up payment no open top-up expected was paid: its refund is enqueued",
  );
  return "handled";
}

/**
 * `payment_intent.succeeded` of a top-up: the payment becomes `processing` and ONE
 * `campaign.top_up` job is enqueued (key `jobIdempotencyKey.topUpBudget(pi)`), in one
 * transaction. A duplicate delivery finds the job and enqueues nothing. The campaign's state is
 * not checked here: the money is taken, so the engine's job decides between crediting it and
 * refunding it, never neither. An intent that disagrees with its row is acknowledged and logged.
 *
 * A paid intent that no open top-up expects (no row, or a row `failed`) is never kept without
 * being credited: once Stripe confirms it paid, it is recorded for a refund
 * (`refundUnexpectedPayment`).
 */
export async function handleTopUpPaid(
  db: Db,
  gateway: PaymentGateway,
  event: PaymentWebhookEvent,
  intent: PaymentIntentView,
): Promise<void> {
  const log = serverLogger("budget-top-up");
  if (intent.status !== "succeeded") {
    log.warn({ eventId: event.id, paymentIntentId: intent.id }, "top-up event ignored: not paid");
    return;
  }
  const row = await topUpRowOf(db, intent.id);
  if (row !== null) {
    const mismatch = intentMismatch(row, intent);
    if (mismatch !== null) {
      log.error(
        { eventId: event.id, paymentIntentId: intent.id, campaignId: row.campaign_id, mismatch },
        "top-up event ignored: the payment does not match its top-up",
      );
      return;
    }
  }
  if (row === null || row.status === "failed") {
    const claimed = claimedTopUp(intent);
    const confirmed = claimed === null ? null : await confirmedPaid(gateway, intent);
    if (claimed === null || confirmed === null) {
      log.error(
        { eventId: event.id, paymentIntentId: intent.id, status: row?.status ?? null },
        "top-up event ignored: Stripe does not show this payment paid for one of our top-ups",
      );
      return;
    }
    if ((await refundUnexpectedPayment(db, event, confirmed, claimed)) === "open") {
      await handleTopUpPaid(db, gateway, event, intent);
    }
    return;
  }
  const outcome = await db.begin(async (tx) => {
    const [locked] = await tx<{ status: TopUpStatus }[]>`
      select status from budget_top_ups where stripe_pi = ${intent.id} for update
    `;
    if (!locked) return { status: "missing" as const, created: false };
    if (locked.status !== "requires_payment" && locked.status !== "processing") {
      return { status: locked.status, created: false };
    }
    await tx`
      update budget_top_ups set status = 'processing', message = null
      where stripe_pi = ${intent.id}
    `;
    const job = await enqueueJob(
      tx,
      JOB_KINDS.topUpBudget,
      {
        campaignId: row.campaign_id,
        amount: digits(row.amount),
        paymentIntentId: row.stripe_pi,
        requestId: row.request_id,
      },
      jobIdempotencyKey.topUpBudget(row.stripe_pi),
    );
    return { status: "processing" as const, created: job.created };
  });
  if (outcome.status === "failed") {
    // Ended between the two reads: handled as any paid intent no open top-up expects.
    await handleTopUpPaid(db, gateway, event, intent);
    return;
  }
  log.info(
    { eventId: event.id, campaignId: row.campaign_id, ...outcome },
    outcome.status === "processing" ? "top-up job enqueued" : "top-up event ignored: already final",
  );
}

/**
 * `payment_intent.canceled` or `payment_intent.payment_failed` of a top-up: the request ends so
 * that another can be made, and the campaign is untouched. Stripe delivers late and out of order,
 * so the intent is read from Stripe: cancelled, the top-up ends `failed`; waiting for a new card
 * after a decline, it is cancelled first (a declined intent could still be paid with another
 * card, and a top-up must never be charged after it ended), then ends `failed`; anything else
 * (paid since, being paid) leaves it alone. Only a top-up still `requires_payment` changes.
 */
export async function handleTopUpFailed(
  db: Db,
  gateway: PaymentGateway,
  event: PaymentWebhookEvent,
  intent: PaymentIntentView,
): Promise<void> {
  const log = serverLogger("budget-top-up");
  const row = await topUpRowOf(db, intent.id);
  if (row === null || row.status !== "requires_payment") {
    log.info(
      { eventId: event.id, paymentIntentId: intent.id, status: row?.status ?? null },
      "top-up failure event ignored: no unpaid top-up has this payment",
    );
    return;
  }
  const current = await gateway.retrievePaymentIntent(intent.id);
  if (current === null || intentMismatch(row, current) !== null) {
    log.error(
      { eventId: event.id, paymentIntentId: intent.id, known: current !== null },
      "top-up failure event ignored: Stripe has no such top-up payment",
    );
    return;
  }
  let message: string;
  if (current.status === "canceled") {
    message = TOP_UP_MESSAGES.cancelled;
  } else if (current.status === "requires_payment_method") {
    const payments = topUpGatewayOf(gateway);
    if (payments === null) {
      log.warn(
        { eventId: event.id, paymentIntentId: intent.id },
        "declined top-up left open: the gateway cannot cancel it (a new request replaces it)",
      );
      return;
    }
    // No idempotency key of ours: Stripe would replay a first refusal (the intent was
    // `processing` then) for a day, and cancelling twice is harmless.
    const result = await payments.cancelUnpaidPaymentIntent(intent.id);
    if (result === "not_cancelable") {
      log.info(
        { eventId: event.id, paymentIntentId: intent.id },
        "top-up failure event ignored: the payment moved on",
      );
      return;
    }
    message = TOP_UP_MESSAGES.declined;
  } else {
    log.info(
      { eventId: event.id, type: event.type, paymentIntentId: intent.id, now: current.status },
      "top-up failure event ignored: stale, Stripe shows the payment moved on",
    );
    return;
  }
  const changed = await db`
    update budget_top_ups set status = 'failed', message = ${message}
    where stripe_pi = ${intent.id} and status = 'requires_payment'
    returning request_id
  `;
  log.info(
    { eventId: event.id, campaignId: row.campaign_id, ended: changed.length === 1 },
    "unpaid top-up ended",
  );
}
