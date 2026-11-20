import { randomUUID } from "node:crypto";

import {
  JOB_KINDS,
  STRIPE_PAYMENT_KINDS,
  jobIdempotencyKey,
  type CampaignStatus,
  type CheckoutRequest,
  type CheckoutResponse,
  type CheckoutStatus,
  type CheckoutStatusResponse,
  type SaleState,
} from "@winz/shared";

import { normalizeEmail } from "./auth";
import { MAX_CARD_AMOUNT, paymentUnavailable } from "./campaign-writes";
import type { Db } from "./db";
import { enqueueJob, type JobSql } from "./jobs";
import { serverLogger } from "./logger";
import {
  PaymentGatewayError,
  paymentKindOf,
  type CreatedPaymentIntent,
  type PaymentGateway,
  topUpGatewayOf,
  type PaymentIntentStatus,
  type PaymentIntentView,
  type UnpaidCancellation,
} from "./payments-gateway";
import { ApiRouteError } from "./route";
import { digits } from "./wire";

/**
 * The customer's purchase (A-03, SPEC CO-2 and CO-3): the card is authorized here, the engine's
 * purchase job buys the ticket and captures. Every answer is shown to a customer: no e-mail, no
 * buyer address, no on-chain term, and the messages say whether they were charged.
 */

/** Messages shown to the customer as they are. */
export const CUSTOMER_MESSAGES = {
  salesPaused: "This promo is paused right now, you were not charged",
  salesClosed: "Sales are closed for this promo, you were not charged",
  cancelledPaused: "Promo just paused, you were not charged",
  failed: "Something went wrong, you were not charged",
  declined: "Your payment did not go through, you were not charged",
  cancelled: "Your payment was cancelled, you were not charged",
} as const;

const UNPUBLISHED: readonly CampaignStatus[] = ["draft", "funding"];
const SETTLED: readonly CampaignStatus[] = ["settled_yes", "settled_no", "void", "closed"];

// ---------------------------------------------------------------------------------------------
// POST /api/checkout
// ---------------------------------------------------------------------------------------------

interface SellableRow {
  id: string;
  status: CampaignStatus;
  sale_state: SaleState;
  sales_close: Date;
  outcome: string | null;
  unit_price: bigint;
}

/**
 * Why the campaign cannot sell right now, as the 409 the customer sees, or null when it can: it
 * must be live, with `sale_state` open, before its sales close and unsettled.
 */
export function saleRefusal(row: SellableRow, now: Date): ApiRouteError | null {
  const closed =
    row.outcome !== null ||
    SETTLED.includes(row.status) ||
    row.status === "sales_closed" ||
    row.sale_state === "closed" ||
    now.getTime() >= row.sales_close.getTime();
  if (closed) return new ApiRouteError(409, "sales_closed", CUSTOMER_MESSAGES.salesClosed);
  if (row.status !== "live" || row.sale_state !== "open") {
    return new ApiRouteError(409, "sales_paused", CUSTOMER_MESSAGES.salesPaused);
  }
  return null;
}

/** A published campaign that sells right now, and what `qty` units of it cost. */
export interface SellableCampaign {
  id: string;
  /** qty × unit price, in micro-USDC. */
  amount: bigint;
}

/**
 * The campaign of `slug` when it sells right now, with the price of `qty` units: 404 when no
 * published campaign has this slug, 409 `sales_paused` or `sales_closed` as `saleRefusal` says,
 * 400 when the amount is above what one card payment can carry. `lock` takes the campaign row
 * `for update` (inside a transaction), so a concurrent pause or close waits for the caller.
 *
 * The one check of POST /api/checkout, also used by the demo sale (POST /api/admin/demo/sale).
 */
export async function findSellableCampaign(
  sql: JobSql,
  slug: string,
  qty: number,
  now: Date,
  options: { lock?: boolean } = {},
): Promise<SellableCampaign> {
  const [row] = await sql<SellableRow[]>`
    select id, status, sale_state, sales_close, outcome, unit_price
    from campaigns
    where slug = ${slug} and status not in ${sql(UNPUBLISHED)}
    ${options.lock === true ? sql`for update` : sql``}
  `;
  if (!row) throw new ApiRouteError(404, "not_found", "Promo not found");
  const refusal = saleRefusal(row, now);
  if (refusal) throw refusal;

  const amount = BigInt(qty) * row.unit_price;
  if (amount > MAX_CARD_AMOUNT) {
    throw new ApiRouteError(400, "invalid_request", "That is too many for one payment");
  }
  return { id: row.id, amount };
}

/**
 * POST /api/checkout: checks that the promo sells right now, creates the card authorization for
 * qty × unit price (`capture_method: manual`) and records the payment (`requires_payment`).
 * Nothing is created when the promo cannot sell. `idempotencyKey` reaches Stripe, so a retried
 * call to Stripe creates one authorization.
 */
export async function startCheckout(
  db: Db,
  payments: PaymentGateway,
  body: CheckoutRequest,
  now: Date,
  idempotencyKey: string = `checkout:${randomUUID()}`,
): Promise<CheckoutResponse> {
  const row = await findSellableCampaign(db, body.slug, body.qty, now);
  const amount = row.amount;

  let intent: CreatedPaymentIntent;
  try {
    intent = await payments.createPurchaseAuthorization({
      campaignId: row.id,
      qty: body.qty,
      amount,
      idempotencyKey,
    });
  } catch (error: unknown) {
    if (error instanceof PaymentGatewayError) {
      serverLogger("checkout").error({ err: error, campaignId: row.id }, "authorization failed");
      throw paymentUnavailable();
    }
    throw error;
  }
  await db`
    insert into payments (stripe_pi, campaign_id, qty, amount, status)
    values (${intent.id}, ${row.id}, ${body.qty}, ${amount}, 'requires_payment')
  `;
  return { paymentIntentId: intent.id, clientSecret: intent.clientSecret, amount: digits(amount) };
}

// ---------------------------------------------------------------------------------------------
// The authorized purchase: one path for the confirmation, the webhook and the status read (CO-3)
// ---------------------------------------------------------------------------------------------

/** What `processAuthorizedPurchase` did. */
export type PurchaseOutcome =
  /** No payments row has this id: not one of our checkouts. */
  | "unknown_payment"
  /** Stripe's intent does not match the row (kind, campaign, amount, currency) or is unknown. */
  | "mismatch"
  /**
   * The card is not authorized yet (or any more): nothing changed. `stripeStatus` says which: still
   * unpaid or over, or pending at Stripe (see `PurchaseProcessing`).
   */
  | "not_authorized"
  /** The payment already reached a final state: nothing changed. */
  | "final"
  /** The payment is `processing` and its purchase job exists (`created` says if this call made it). */
  | "enqueued";

export type PurchaseProcessing =
  | {
      outcome: Exclude<PurchaseOutcome, "not_authorized">;
      /** True when this call inserted the purchase job. */
      created: boolean;
    }
  | {
      outcome: "not_authorized";
      created: false;
      /**
       * Stripe's status of the intent, anything but `requires_capture`: the confirmation tells
       * « unpaid or over » (`STRIPE_UNPAID_STATUSES`) from « not authorized yet » (`requires_action`,
       * a 3-D Secure approval still open, or `processing`) with it.
       */
      stripeStatus: PaymentIntentStatus;
    };

/**
 * The Stripe statuses that say a purchase's card is not authorized and will not be without the fan
 * paying again: not paid yet or declined (`requires_payment_method`, `requires_confirmation`), or
 * over (`canceled`). Any other status short of `requires_capture` is a purchase still pending at
 * Stripe, which may be authorized without the page (a 3-D Secure approval in a bank app).
 */
export const STRIPE_UNPAID_STATUSES: readonly PaymentIntentStatus[] = [
  "requires_payment_method",
  "requires_confirmation",
  "canceled",
];

/**
 * The Stripe statuses of a purchase intent that waits on the fan (a card to enter or to approve, a
 * 3-D Secure approval left open): once its payment is older than ABANDONED_PURCHASE_AFTER_SECONDS
 * with no purchase job, the status read and the confirmation cancel it at Stripe (see
 * `cancelAbandonedPurchase`). Never `requires_capture` (authorized: the purchase is taken) nor
 * `processing` (Stripe is settling it).
 */
export const ABANDONED_PURCHASE_STATUSES: readonly PaymentIntentStatus[] = [
  "requires_action",
  "requires_payment_method",
  "requires_confirmation",
];

/**
 * How old a purchase's payment row must be, by the database's clock on its `created_at` (the first
 * tap on Pay, when `POST /api/checkout` created the intent), before an intent still waiting on the
 * fan is taken for abandoned and cancelled. Fifteen minutes: fifteen times the minute the page
 * follows a purchase, and far longer than a fan spends between a tap and the card's authorization,
 * a 3-D Secure approval in a bank app included; short enough that the fan who comes back later is
 * not held by a purchase nobody will finish. `created_at` and not `updated_at`: every status read
 * that asks Stripe stamps `updated_at`, so it never ages while a page polls.
 *
 * Cancelling is safe for the money whatever happens meanwhile: a cancelled intent can never be
 * captured, so the fan is not charged for it (Stripe releases an authorization that would have
 * landed between our read and the cancellation), and the sheet that kept the intent pays a new one,
 * once (`AuthorizeResult.ended`).
 */
export const ABANDONED_PURCHASE_AFTER_SECONDS = 15 * 60;

interface PaymentRow {
  stripe_pi: string;
  campaign_id: string;
  qty: number;
  amount: bigint;
  status: CheckoutStatus;
}

/**
 * Stripe's intent when it is the purchase of this payments row (kind, campaign, quantity, amount,
 * currency all match), else null, logged: an unknown intent or one that pays for something else
 * is never acted on. Throws `PaymentGatewayError` when Stripe cannot be read.
 */
async function readMatchingIntent(
  payments: PaymentGateway,
  payment: PaymentRow,
): Promise<PaymentIntentView | null> {
  const intent = await payments.retrievePaymentIntent(payment.stripe_pi);
  const matches =
    intent !== null &&
    paymentKindOf(intent) === STRIPE_PAYMENT_KINDS.purchase &&
    intent.metadata.campaignId === payment.campaign_id &&
    intent.metadata.qty === String(payment.qty) &&
    intent.amount === payment.amount &&
    intent.currency === "usd";
  if (!intent || !matches) {
    serverLogger("checkout").error(
      {
        paymentIntentId: payment.stripe_pi,
        campaignId: payment.campaign_id,
        known: intent !== null,
      },
      "PaymentIntent does not match its payment row: left untouched",
    );
    return null;
  }
  return intent;
}

/**
 * The second half of `processAuthorizedPurchase`, once Stripe's intent has been read and matched
 * to its row: when it is authorized and awaiting capture (`requires_capture`), in one transaction,
 * stores the payer's normalised e-mail, sets the payment `processing` and enqueues the purchase
 * job (key `jobIdempotencyKey.purchase(id)`). Every caller goes through here, so the idempotency
 * is the same whoever calls: the row lock plus the job's unique key, one job.
 */
async function takeAuthorizedIntent(
  db: Db,
  paymentIntentId: string,
  intent: PaymentIntentView,
): Promise<PurchaseProcessing> {
  if (intent.status !== "requires_capture") {
    return { outcome: "not_authorized", created: false, stripeStatus: intent.status };
  }

  const email = intent.payerEmail === null ? null : normalizeEmail(intent.payerEmail);
  if (email === null) {
    // The payment sheet requires the e-mail; the purchase job decides what to do without it.
    serverLogger("checkout").warn({ paymentIntentId }, "authorized payment without a payer e-mail");
  }
  const key = jobIdempotencyKey.purchase(paymentIntentId);

  return db.begin(async (tx) => {
    const [locked] = await tx<{ status: CheckoutStatus; job: boolean }[]>`
      select p.status, exists (select 1 from jobs j where j.idempotency_key = ${key}) as job
      from payments p
      where p.stripe_pi = ${paymentIntentId}
      for update of p
    `;
    if (!locked) return { outcome: "unknown_payment" as const, created: false };
    const takeable =
      locked.status === "requires_payment" ||
      locked.status === "processing" ||
      (locked.status === "failed" && !locked.job);
    if (!takeable) return { outcome: "final" as const, created: false };

    await tx`
      update payments
      set email = coalesce(${email}, email), status = 'processing', message = null
      where stripe_pi = ${paymentIntentId}
    `;
    const job = await enqueueJob(tx, JOB_KINDS.purchase, { paymentIntentId }, key);
    return { outcome: "enqueued" as const, created: job.created };
  });
}

/**
 * Given a PaymentIntent id, never trusting whoever sent it: reads the intent from Stripe, and when
 * it is one of our purchases, matching its payments row, authorized and awaiting capture
 * (`requires_capture`), then in one transaction stores the payer's normalised e-mail, sets the
 * payment `processing` and enqueues the purchase job (key `jobIdempotencyKey.purchase(id)`).
 * Called by the client confirmation, by the webhook and by the status read of a payment left
 * `requires_payment` (`pollCheckoutStatus`), any number of times, in any order and concurrently:
 * one job.
 *
 * A payment marked `failed` by a declined attempt is taken again when a later attempt on the same
 * intent is authorized, unless its purchase job already exists (then the engine owns the outcome).
 */
export async function processAuthorizedPurchase(
  db: Db,
  payments: PaymentGateway,
  paymentIntentId: string,
): Promise<PurchaseProcessing> {
  const [payment] = await db<PaymentRow[]>`
    select stripe_pi, campaign_id, qty, amount, status from payments
    where stripe_pi = ${paymentIntentId}
  `;
  if (!payment) return { outcome: "unknown_payment", created: false };

  const intent = await readMatchingIntent(payments, payment);
  if (intent === null) return { outcome: "mismatch", created: false };
  return takeAuthorizedIntent(db, paymentIntentId, intent);
}

// ---------------------------------------------------------------------------------------------
// Status: GET /api/checkout/:pi and POST /api/checkout/:pi/confirm
// ---------------------------------------------------------------------------------------------

interface StatusRow {
  status: CheckoutStatus;
  message: string | null;
  access_token: string | null;
  /** The purchase job exists: the engine owns the outcome. */
  job: boolean;
}

/** The payment's row with its ticket and whether its purchase job exists; 404 for an unknown id. */
async function readStatusRow(db: Db, paymentIntentId: string): Promise<StatusRow> {
  const [row] = await db<StatusRow[]>`
    select p.status, p.message, t.access_token,
      exists (
        select 1 from jobs j where j.idempotency_key = ${jobIdempotencyKey.purchase(paymentIntentId)}
      ) as job
    from payments p
    left join lateral (
      select access_token from tickets
      where id = p.ticket_id or payment_pi = p.stripe_pi
      order by (id = p.ticket_id) desc
      limit 1
    ) t on true
    where p.stripe_pi = ${paymentIntentId}
  `;
  if (!row) throw new ApiRouteError(404, "not_found", "Payment not found");
  return row;
}

/**
 * A payment whose card may still be authorized on its intent, so that its row is not the last
 * word: `requires_payment`, or `failed` with no purchase job (a declined attempt: the sheet keeps
 * the intent and the fan may pay it with another card, which `takeAuthorizedIntent` takes back).
 * A `failed` payment whose job exists is the engine's ending, final.
 */
function isOpen(row: StatusRow): boolean {
  return row.status === "requires_payment" || (row.status === "failed" && !row.job);
}

const PROCESSING: CheckoutStatusResponse = {
  status: "processing",
  ticketToken: null,
  message: null,
};
const REQUIRES_PAYMENT: CheckoutStatusResponse = {
  status: "requires_payment",
  ticketToken: null,
  message: null,
};

/**
 * The payment's state from its row, as the confirmation answers it and as GET /api/checkout/:pi
 * answers it after its heal (see `pollCheckoutStatus`, which answers a `failed` row with no
 * purchase job on Stripe's word only). `ticketToken` once ticketed (open `/t/<ticketToken>`), the
 * stored message (or a default) on `cancelled_paused` and `failed`. A payment marked ticketed
 * whose ticket row is not readable yet is reported `processing`, so the front keeps polling
 * instead of opening a broken link. 404 for an unknown id.
 */
export async function checkoutStatus(
  db: Db,
  paymentIntentId: string,
): Promise<CheckoutStatusResponse> {
  return answerOfRow(paymentIntentId, await readStatusRow(db, paymentIntentId));
}

function answerOfRow(paymentIntentId: string, row: StatusRow): CheckoutStatusResponse {
  switch (row.status) {
    case "ticketed":
      if (row.access_token === null) {
        serverLogger("checkout").warn({ paymentIntentId }, "ticketed payment without a ticket row");
        return { status: "processing", ticketToken: null, message: null };
      }
      return { status: "ticketed", ticketToken: row.access_token, message: null };
    case "cancelled_paused":
      return {
        status: "cancelled_paused",
        ticketToken: null,
        message: row.message ?? CUSTOMER_MESSAGES.cancelledPaused,
      };
    case "failed":
      return {
        status: "failed",
        ticketToken: null,
        message: row.message ?? CUSTOMER_MESSAGES.failed,
      };
    case "requires_payment":
    case "processing":
      return { status: row.status, ticketToken: null, message: null };
  }
}

/**
 * What Stripe said of a payment's intent, as the status read and the confirmation act on it:
 *
 * - `unread`: Stripe was not asked (the heal's window, a claim lost to another reader), could not
 *   be read, or its intent does not match the row: nothing is known;
 * - `unpaid`: unpaid or over (`STRIPE_UNPAID_STATUSES`), including an intent cancelled here as
 *   abandoned: the card is not authorized and will not be without the fan paying again;
 * - `pending`: anything else short of a purchase taken (`requires_action`, `processing`, an intent
 *   Stripe would not cancel because it moved on): the card may still be authorized without the page;
 * - `taken`: authorized, and handed to `takeAuthorizedIntent`; the row says the rest.
 */
type StripeWord = "unread" | "unpaid" | "pending" | "taken";

function wordOf(status: PaymentIntentStatus): Exclude<StripeWord, "unread" | "taken"> {
  return STRIPE_UNPAID_STATUSES.includes(status) ? "unpaid" : "pending";
}

/**
 * How long a payment stays open (`requires_payment`, or `failed` with no purchase job, see
 * `isOpen`) before a status read asks Stripe about it, and the shortest time between two such
 * reads of one payment, in seconds. Both are measured on the row's `updated_at` by the database's
 * clock: the row is created `requires_payment`, nothing touches it until the confirmation or the
 * webhook moves it on (or fails a declined attempt), and each read stamps it.
 *
 * The ordinary case is left alone: the front polls only once its confirmation has answered, and
 * a confirmation that worked has moved the payment to `processing`, which no poll reads Stripe
 * for. The delay keeps a payment just created, or a poll from another tab racing a confirmation
 * in flight, from costing a Stripe read; once the confirmation failed, the fan's next poll after
 * the delay hands the purchase over, five seconds late at most.
 */
export const CHECKOUT_HEAL_AFTER_SECONDS = 5;

/**
 * Claims the right to read Stripe for a payment still open, with one conditional statement: it
 * stamps `updated_at` only when the row is `requires_payment`, or `failed` with no purchase job (a
 * declined attempt whose intent the fan may pay with another card), and its `updated_at` is at
 * least `CHECKOUT_HEAL_AFTER_SECONDS` old, and returns the row when it did. Concurrent callers
 * (any number of pollers, on any number of server instances) queue on the row: the first stamps
 * it, the others re-check the stamped row and match nothing. No lock is held afterwards: the
 * statement commits on its own, before Stripe is called. A `failed` payment whose job exists is
 * the engine's and never claimed.
 */
async function claimHealRead(db: Db, paymentIntentId: string): Promise<PaymentRow | undefined> {
  const [claimed] = await db<PaymentRow[]>`
    update payments p set updated_at = now()
    where p.stripe_pi = ${paymentIntentId}
      and (
        p.status = 'requires_payment'
        or (
          p.status = 'failed'
          and not exists (
            select 1 from jobs j
            where j.idempotency_key = ${jobIdempotencyKey.purchase(paymentIntentId)}
          )
        )
      )
      and p.updated_at <= now() - make_interval(secs => ${CHECKOUT_HEAL_AFTER_SECONDS})
    returning p.stripe_pi, p.campaign_id, p.qty, p.amount, p.status
  `;
  return claimed;
}

/** What `cancelAbandonedPurchase` did. */
type AbandonedCancellation =
  /** Cancelled at Stripe (or found cancelled), and the payment failed with the cancellation. */
  | "canceled"
  /** Stripe refused: the intent moved on (authorized, or being paid). Nothing changed here. */
  | "not_cancelable"
  /** Not abandoned (too young, a job exists, a status worth waiting on), or Stripe failed. */
  | "kept";

/**
 * Cancels at Stripe a purchase intent nobody is finishing, so that a page that picks it up sees an
 * ending instead of following it for a minute on every visit (a 3-D Secure approval abandoned in a
 * bank app keeps the intent `requires_action` for as long as Stripe keeps it). Only when Stripe's
 * status (just read by the caller) is in ABANDONED_PURCHASE_STATUSES, the payment is open
 * (`requires_payment`, or `failed` by a declined attempt) with no purchase job, and its row is
 * older than ABANDONED_PURCHASE_AFTER_SECONDS. Never an intent whose job exists or that Stripe has
 * authorized (`requires_capture`): those are the engine's to capture or cancel.
 *
 * Once Stripe says it is cancelled, the payment becomes `failed` with the cancellation message,
 * replacing a declined attempt's message (the intent can never be paid any more). Stripe failing
 * on the cancellation is logged and nothing is marked: the next read tries again. A route cut by
 * its time limit between Stripe's cancellation and the mark is no worse: the next status read
 * finds the intent `canceled` and fails the payment, and the confirmation answers it unpaid.
 */
async function cancelAbandonedPurchase(
  db: Db,
  payments: PaymentGateway,
  paymentIntentId: string,
  stripeStatus: PaymentIntentStatus,
): Promise<AbandonedCancellation> {
  if (!ABANDONED_PURCHASE_STATUSES.includes(stripeStatus)) return "kept";
  const [row] = await db<{ abandoned: boolean }[]>`
    select p.created_at <= now() - make_interval(secs => ${ABANDONED_PURCHASE_AFTER_SECONDS})
      as abandoned
    from payments p
    where p.stripe_pi = ${paymentIntentId}
      and p.status in ('requires_payment', 'failed')
      and not exists (
        select 1 from jobs j
        where j.idempotency_key = ${jobIdempotencyKey.purchase(paymentIntentId)}
      )
  `;
  if (row?.abandoned !== true) return "kept";

  const log = serverLogger("checkout");
  const gateway = topUpGatewayOf(payments);
  if (gateway === null) {
    log.warn({ paymentIntentId }, "abandoned purchase not cancelled: the gateway cannot cancel");
    return "kept";
  }
  let cancelled: UnpaidCancellation;
  try {
    cancelled = await gateway.cancelUnpaidPaymentIntent(paymentIntentId);
  } catch (error: unknown) {
    if (error instanceof PaymentGatewayError) {
      log.error(
        { err: error, paymentIntentId, stripeStatus },
        "abandoned purchase could not be cancelled at Stripe: left as it is",
      );
      return "kept";
    }
    throw error;
  }
  if (cancelled === "not_cancelable") {
    log.info({ paymentIntentId, stripeStatus }, "abandoned purchase moved on at Stripe: kept");
    return "not_cancelable";
  }
  const changed = await failPurchase(db, paymentIntentId, CUSTOMER_MESSAGES.cancelled, {
    replaceFailed: true,
  });
  log.info({ paymentIntentId, stripeStatus, changed }, "abandoned purchase cancelled at Stripe");
  return "canceled";
}

/**
 * An open payment the confirmation never moved on (`requires_payment`, or `failed` by a declined
 * attempt with no purchase job): asks Stripe once (under the claim of `claimHealRead`) and applies
 * what the confirmation or the webhook would have applied, then says what Stripe said.
 *
 * - authorized (`requires_capture`): `takeAuthorizedIntent`, the very path of the confirmation
 *   and of the webhook, so one purchase job whoever gets there first (`taken`);
 * - cancelled (`canceled`, final at Stripe): `markPurchaseFailed` with the message the webhook
 *   writes for a cancellation; it is safe to call twice and never fails a payment whose purchase
 *   job exists (`unpaid`);
 * - waiting on the fan for longer than ABANDONED_PURCHASE_AFTER_SECONDS: cancelled at Stripe
 *   (`cancelAbandonedPurchase`, `unpaid`; `pending` when Stripe refuses because it moved on);
 * - anything else: nothing changes, and the answer is `unpaid` or `pending` by Stripe's status.
 *   `requires_payment_method` never fails a `requires_payment` row here: Stripe shows that status
 *   both before the fan has paid and after a declined attempt, and only the webhook's event type
 *   tells them apart, so failing the payment from it could tell a fan still paying "you were not
 *   charged, your payment did not go through".
 *
 * `unread` when nothing was claimed, or when Stripe failed (logged once per claim, so once per
 * window, and swallowed) or answered an intent that does not match the row.
 */
async function healUnconfirmedPurchase(
  db: Db,
  payments: PaymentGateway,
  paymentIntentId: string,
): Promise<StripeWord> {
  const claimed = await claimHealRead(db, paymentIntentId);
  if (!claimed) return "unread";
  const log = serverLogger("checkout");
  let intent: PaymentIntentView | null;
  try {
    intent = await readMatchingIntent(payments, claimed);
  } catch (error: unknown) {
    if (error instanceof PaymentGatewayError) {
      log.error(
        { err: error, paymentIntentId },
        "status read could not ask Stripe about an unconfirmed payment: answered from its row",
      );
      return "unread";
    }
    throw error;
  }
  if (intent === null) return "unread";
  if (intent.status === "requires_capture") {
    const result = await takeAuthorizedIntent(db, paymentIntentId, intent);
    log.info(
      { paymentIntentId, ...result },
      "unconfirmed payment found authorized by a status read",
    );
    return "taken";
  }
  if (intent.status === "canceled") {
    const changed = await markPurchaseFailed(db, paymentIntentId, CUSTOMER_MESSAGES.cancelled);
    log.info({ paymentIntentId, changed }, "unconfirmed payment found cancelled by a status read");
    return "unpaid";
  }
  const abandoned = await cancelAbandonedPurchase(db, payments, paymentIntentId, intent.status);
  if (abandoned === "canceled") return "unpaid";
  if (abandoned === "not_cancelable") return "pending";
  return wordOf(intent.status);
}

/**
 * GET /api/checkout/:pi: `checkoutStatus`, after healing a payment still open
 * `CHECKOUT_HEAL_AFTER_SECONDS` after it was created or last looked at (see
 * `healUnconfirmedPurchase`): the confirmation may have been lost and the webhook may never come,
 * and the fan polls this route until the end. Stripe is read at most once per payment per window,
 * whoever polls, and never for a payment that is `processing`, ended, or `failed` with its
 * purchase job. A Stripe failure never fails the poll: it answers with its usual 200.
 *
 * A `failed` payment with no purchase job (a declined attempt) is not final: the fan may have paid
 * the same intent with another card since, and a webhook still on its way would hand it to the
 * engine. So this route answers it on Stripe's word only, never on the row's:
 *
 * - `failed` (the row's message) when this very read found Stripe's intent unpaid or over
 *   (`STRIPE_UNPAID_STATUSES`, or cancelled here as abandoned);
 * - `processing` when it found the card authorized (the purchase is taken: the row says so) or
 *   pending at Stripe (`requires_action`, `processing`);
 * - `requires_payment` when this read did not ask Stripe (inside the window, or another poll holds
 *   the claim), could not read it, or found an intent that does not match the row: not authorized
 *   as far as this read knows, and not over.
 *
 * Every other row is answered as it is: a `failed` this route answers is therefore always either
 * Stripe's word or the engine's ending.
 */
export async function pollCheckoutStatus(
  db: Db,
  payments: PaymentGateway,
  paymentIntentId: string,
): Promise<CheckoutStatusResponse> {
  const word = await healUnconfirmedPurchase(db, payments, paymentIntentId);
  const row = await readStatusRow(db, paymentIntentId);
  if (row.status === "failed" && !row.job) {
    if (word === "unpaid") return answerOfRow(paymentIntentId, row);
    if (word === "pending" || word === "taken") return PROCESSING;
    return REQUIRES_PAYMENT;
  }
  return answerOfRow(paymentIntentId, row);
}

/**
 * POST /api/checkout/:pi/confirm: called by the front once the payment sheet confirmed, and by the
 * pick-up of a purchase whose card the page never saw authorized. Runs `processAuthorizedPurchase`
 * (the same path as the webhook), which reads Stripe on every call, then answers the current
 * status. Its `requires_payment`, and its `failed` for a payment with no purchase job, therefore
 * mean Stripe itself said the card is unpaid or the payment over (`STRIPE_UNPAID_STATUSES`), and
 * the pick-up lets its record go on them:
 *
 * - Stripe cannot be read: 502 (`paymentUnavailable`);
 * - Stripe does not know the intent (404), or it does not match its row (another account, another
 *   mode, another purchase): 502 as well, logged. The row's `requires_payment` would say « not
 *   authorized » for a payment nobody could check;
 * - the card not authorized yet but pending at Stripe (`requires_action`, `processing`, or any
 *   status outside `STRIPE_UNPAID_STATUSES`) while the payment is open (`requires_payment`, or
 *   `failed` by a declined attempt with no purchase job): `processing`. The purchase may still be
 *   authorized without the page (a 3-D Secure approval in a bank app); the status read's heal
 *   takes it once Stripe says `requires_capture`;
 * - an intent waiting on the fan for longer than ABANDONED_PURCHASE_AFTER_SECONDS: cancelled at
 *   Stripe (`cancelAbandonedPurchase`), and `failed` with the cancellation message;
 * - an unknown payment: 404 `not_found`.
 */
export async function confirmCheckout(
  db: Db,
  payments: PaymentGateway,
  paymentIntentId: string,
): Promise<CheckoutStatusResponse> {
  const log = serverLogger("checkout");
  let result: PurchaseProcessing;
  try {
    result = await processAuthorizedPurchase(db, payments, paymentIntentId);
  } catch (error: unknown) {
    if (error instanceof PaymentGatewayError) {
      log.error({ err: error, paymentIntentId }, "confirmation failed");
      throw paymentUnavailable();
    }
    throw error;
  }
  if (result.outcome === "unknown_payment") {
    throw new ApiRouteError(404, "not_found", "Payment not found");
  }
  if (result.outcome === "mismatch") {
    log.error(
      { paymentIntentId },
      "confirmation could not check the payment at Stripe (unknown or mismatching intent): answered 502",
    );
    throw paymentUnavailable();
  }
  let word: StripeWord = "taken";
  if (result.outcome === "not_authorized") {
    const abandoned = await cancelAbandonedPurchase(
      db,
      payments,
      paymentIntentId,
      result.stripeStatus,
    );
    word =
      abandoned === "canceled"
        ? "unpaid"
        : abandoned === "not_cancelable"
          ? "pending"
          : wordOf(result.stripeStatus);
  }
  const row = await readStatusRow(db, paymentIntentId);
  if (word === "pending" && isOpen(row)) {
    log.info(
      {
        paymentIntentId,
        stripeStatus: result.outcome === "not_authorized" ? result.stripeStatus : null,
      },
      "confirmation found the payment pending at Stripe: answered processing",
    );
    return PROCESSING;
  }
  return answerOfRow(paymentIntentId, row);
}

/**
 * The card authorization was cancelled or a payment attempt failed (webhook): the payment becomes
 * `failed` with a customer-safe message, unless it already ended (ticketed, cancelled because the
 * promo paused, or already failed with its own message) or its purchase job exists. Once the job
 * exists the engine owns the outcome (it captures, or cancels and writes the customer's message):
 * failing the row here would tell the customer "you were not charged" while the engine may still
 * buy and capture. Returns whether a row changed.
 *
 * The row is locked first and the job looked up by a later statement, so a concurrent
 * `processAuthorizedPurchase` (which inserts the job under the same lock) is always seen.
 */
export async function markPurchaseFailed(
  db: Db,
  paymentIntentId: string,
  message: string,
): Promise<boolean> {
  return failPurchase(db, paymentIntentId, message, { replaceFailed: false });
}

/**
 * `markPurchaseFailed`, and with `replaceFailed` also a payment already `failed` (with no purchase
 * job) whose message is replaced: an intent cancelled at Stripe after a declined attempt says so.
 */
async function failPurchase(
  db: Db,
  paymentIntentId: string,
  message: string,
  { replaceFailed }: { replaceFailed: boolean },
): Promise<boolean> {
  const key = jobIdempotencyKey.purchase(paymentIntentId);
  const ended: readonly CheckoutStatus[] = replaceFailed
    ? ["ticketed", "cancelled_paused"]
    : ["ticketed", "cancelled_paused", "failed"];
  return db.begin(async (tx) => {
    const [locked] = await tx<{ status: CheckoutStatus }[]>`
      select status from payments where stripe_pi = ${paymentIntentId} for update
    `;
    if (!locked || ended.includes(locked.status)) {
      return false;
    }
    const [job] = await tx<{ found: boolean }[]>`
      select exists (select 1 from jobs where idempotency_key = ${key}) as found
    `;
    if (job?.found) {
      serverLogger("checkout").warn(
        { paymentIntentId, status: locked.status },
        "failure not applied: the purchase job exists, the engine owns this payment",
      );
      return false;
    }
    const updated = await tx`
      update payments set status = 'failed', message = ${message}
      where stripe_pi = ${paymentIntentId}
    `;
    return updated.count > 0;
  });
}
