import { JOB_KINDS, STRIPE_PAYMENT_KINDS, jobIdempotencyKey } from "@winz/shared";

import { handleTopUpFailed, handleTopUpPaid } from "./budget-top-up";
import { CUSTOMER_MESSAGES, markPurchaseFailed, processAuthorizedPurchase } from "./checkout";
import type { Db } from "./db";
import { enqueueJob } from "./jobs";
import { serverLogger } from "./logger";
import {
  WebhookSignatureError,
  paymentKindOf,
  type PaymentGateway,
  type PaymentIntentView,
  type PaymentWebhookEvent,
} from "./payments-gateway";
import { ApiRouteError, type RouteResponse } from "./route";

/** `webhookAckSchema`. */
export type WebhookAck = RouteResponse<"stripeWebhook">;

/**
 * POST /api/webhooks/stripe (A-03, SPEC section 10): verified on the raw body, then turned into
 * rows and jobs. Stripe delivers at least once and in any order, so every branch is idempotent.
 * A database or Stripe failure throws, the route answers 500 and Stripe retries.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACK: WebhookAck = { received: true };

/**
 * The merchant's budget is paid: enqueue the creation job, only for a campaign still `funding`
 * whose stored `budget_pi` is this very intent, for the amount of its budget. Anything else (an
 * intent of another campaign, a replay after the campaign went live) is acknowledged and ignored.
 */
async function budgetPaid(
  db: Db,
  event: PaymentWebhookEvent,
  intent: PaymentIntentView,
): Promise<void> {
  const log = serverLogger("stripe-webhook");
  const campaignId = intent.metadata.campaignId ?? "";
  if (intent.status !== "succeeded" || !UUID.test(campaignId)) {
    log.warn({ eventId: event.id, paymentIntentId: intent.id }, "budget event ignored: not usable");
    return;
  }
  const [campaign] = await db<{ status: string; budget_pi: string | null; budget: bigint }[]>`
    select status, budget_pi, budget from campaigns where id = ${campaignId}
  `;
  if (!campaign || campaign.budget_pi !== intent.id) {
    log.warn(
      { eventId: event.id, paymentIntentId: intent.id, campaignId },
      "budget event ignored: the intent is not this campaign's budget payment",
    );
    return;
  }
  if (campaign.status !== "funding") {
    log.info({ eventId: event.id, campaignId }, "budget event ignored: campaign already funded");
    return;
  }
  if (intent.amount !== campaign.budget) {
    log.error(
      { eventId: event.id, campaignId, paid: intent.amount.toString() },
      "budget event ignored: amount paid differs from the campaign budget",
    );
    return;
  }
  const job = await enqueueJob(
    db,
    JOB_KINDS.createCampaign,
    { campaignId },
    jobIdempotencyKey.createCampaign(campaignId),
  );
  log.info({ eventId: event.id, campaignId, created: job.created }, "campaign creation enqueued");
}

/** The `payment_intent.*` events this handler acts on; every other one is acknowledged. */
const HANDLED_INTENT_EVENTS = new Set([
  "payment_intent.succeeded",
  "payment_intent.amount_capturable_updated",
  "payment_intent.canceled",
  "payment_intent.payment_failed",
]);

/**
 * A purchase's authorization was cancelled or an attempt failed, says the event. Stripe delivers
 * events late and out of order (an attempt declined, its event retried after a 500, delivered
 * after a second attempt was authorized and confirmed), so the event is never trusted: the intent
 * is read from Stripe, and the payment fails only when Stripe shows it `canceled` or waiting for a
 * new payment method. Even then `markPurchaseFailed` leaves alone a payment whose purchase job
 * exists, as the engine owns it.
 */
async function purchaseFailed(
  db: Db,
  payments: PaymentGateway,
  event: PaymentWebhookEvent,
  intent: PaymentIntentView,
): Promise<void> {
  const log = serverLogger("stripe-webhook");
  const current = await payments.retrievePaymentIntent(intent.id);
  if (current === null || paymentKindOf(current) !== STRIPE_PAYMENT_KINDS.purchase) {
    log.warn(
      { eventId: event.id, paymentIntentId: intent.id, known: current !== null },
      "failure event ignored: Stripe has no such purchase",
    );
    return;
  }
  let message: string;
  if (current.status === "canceled") {
    message = CUSTOMER_MESSAGES.cancelled;
  } else if (current.status === "requires_payment_method") {
    message = CUSTOMER_MESSAGES.declined;
  } else {
    log.info(
      { eventId: event.id, type: event.type, paymentIntentId: intent.id, now: current.status },
      "failure event ignored: stale, Stripe shows the payment moved on",
    );
    return;
  }
  const changed = await markPurchaseFailed(db, intent.id, message);
  log.info(
    { eventId: event.id, type: event.type, paymentIntentId: intent.id, changed },
    "purchase failure handled",
  );
}

/**
 * Verifies and handles one Stripe webhook:
 *
 * - `payment_intent.succeeded` of a `campaign_budget` → the creation job (see `budgetPaid`);
 * - `payment_intent.succeeded` of a `campaign_budget_top_up` → the top-up job, and
 *   `payment_intent.canceled` or `payment_intent.payment_failed` of one → the top-up ends, so
 *   another can be made (see `handleTopUpPaid`, `handleTopUpFailed`);
 * - `payment_intent.amount_capturable_updated` of a `purchase` → `processAuthorizedPurchase`, the
 *   same path as the client confirmation;
 * - `payment_intent.canceled` and `payment_intent.payment_failed` of a `purchase` → the payment
 *   becomes `failed`, only when Stripe confirms the intent is cancelled or declined now, and never
 *   once ticketed, cancelled because the promo paused, or handed to the engine (see
 *   `purchaseFailed`);
 * - anything else is acknowledged and ignored.
 *
 * A bad signature answers 400 and changes nothing; it is logged without the payload. A signed
 * event whose PaymentIntent cannot be read is acknowledged and logged (a retry cannot fix it).
 */
export async function handleStripeWebhook(
  db: Db,
  payments: PaymentGateway,
  rawBody: string,
  signature: string | null,
): Promise<WebhookAck> {
  const log = serverLogger("stripe-webhook");
  let event: PaymentWebhookEvent;
  try {
    event = payments.parseWebhook(rawBody, signature);
  } catch (error: unknown) {
    if (error instanceof WebhookSignatureError) {
      log.warn({ reason: error.message, bytes: rawBody.length }, "webhook signature rejected");
      throw new ApiRouteError(400, "invalid_request", "Invalid webhook signature");
    }
    throw error;
  }

  if (event.payloadError !== null) {
    // Signed by Stripe but unreadable: retrying cannot help, so acknowledge, loudly if it mattered.
    const handled = HANDLED_INTENT_EVENTS.has(event.type);
    log[handled ? "error" : "debug"](
      { eventId: event.id, type: event.type, reason: event.payloadError },
      "webhook event acknowledged without handling: its PaymentIntent could not be read",
    );
    return ACK;
  }

  const intent = event.paymentIntent;
  const kind = intent === null ? null : paymentKindOf(intent);
  if (intent === null || kind === null) {
    log.debug({ eventId: event.id, type: event.type }, "webhook event ignored");
    return ACK;
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      if (kind === STRIPE_PAYMENT_KINDS.campaignBudget) await budgetPaid(db, event, intent);
      if (kind === STRIPE_PAYMENT_KINDS.campaignBudgetTopUp) {
        await handleTopUpPaid(db, payments, event, intent);
      }
      break;
    case "payment_intent.amount_capturable_updated":
      if (kind === STRIPE_PAYMENT_KINDS.purchase) {
        const result = await processAuthorizedPurchase(db, payments, intent.id);
        log.info(
          { eventId: event.id, paymentIntentId: intent.id, ...result },
          "authorized purchase handled",
        );
      }
      break;
    case "payment_intent.canceled":
    case "payment_intent.payment_failed":
      if (kind === STRIPE_PAYMENT_KINDS.purchase) await purchaseFailed(db, payments, event, intent);
      if (kind === STRIPE_PAYMENT_KINDS.campaignBudgetTopUp) {
        await handleTopUpFailed(db, payments, event, intent);
      }
      break;
    default:
      log.debug({ eventId: event.id, type: event.type }, "webhook event ignored");
  }
  return ACK;
}
