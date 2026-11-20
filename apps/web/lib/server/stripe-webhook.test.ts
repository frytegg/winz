import { JOB_KINDS, STRIPE_PAYMENT_KINDS, jobIdempotencyKey } from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { CUSTOMER_MESSAGES, startCheckout } from "./checkout";
import type { Db } from "./db";
import type { PaymentIntentStatus } from "./payments-gateway";
import { ApiRouteError } from "./route";
import { handleStripeWebhook } from "./stripe-webhook";
import { FakePaymentGateway, signStripeBody, stripeEventBody } from "./testing/fake-payments";
import {
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  minutesFrom,
} from "./testing/fixtures";

/**
 * `handleStripeWebhook`, the purchase paths: signed bodies as Stripe sends them, through the real
 * signature check, on the test Postgres and the fake Stripe. Stripe delivers at least once and in
 * any order, so the event's own payload is never trusted: the intent is read again from Stripe.
 */

vi.mock("./logger", () => {
  const noop = (): void => undefined;
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: (): unknown => logger,
  };
  return { serverLogger: (): unknown => logger };
});

const now = new Date();
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";

let database: TestDatabase;
let db: Db;
let joe: string;
let payments: FakePaymentGateway;
let slugCounter = 0;

async function checkout(): Promise<string> {
  slugCounter += 1;
  const slug = `webhook-promo-${slugCounter.toString()}`;
  await insertCampaign(db, {
    merchantId: joe,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose: minutesFrom(now, 595),
    slug,
  });
  return (await startCheckout(db, payments, { slug, qty: 1 }, now)).paymentIntentId;
}

/**
 * Delivers `type` for the intent. The event carries `as` as its status when given (an event
 * written earlier, delivered late), else the intent's status at Stripe now.
 */
async function deliver(type: string, pi: string, as?: PaymentIntentStatus): Promise<void> {
  const intent = payments.intents.get(pi);
  if (!intent) throw new Error(`no fake intent ${pi}`);
  const body = stripeEventBody(type, { ...intent, status: as ?? intent.status });
  expect(await handleStripeWebhook(db, payments, body, signStripeBody(body))).toEqual({
    received: true,
  });
}

async function paymentRow(pi: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await db<Record<string, unknown>[]>`
    select status, email, message from payments where stripe_pi = ${pi}
  `;
  return row;
}

async function purchaseJobs(pi: string): Promise<{ status: string; payload: unknown }[]> {
  return db<{ status: string; payload: unknown }[]>`
    select status, payload from jobs
    where kind = ${JOB_KINDS.purchase} and idempotency_key = ${jobIdempotencyKey.purchase(pi)}
  `;
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV", startsAt: minutesFrom(now, 600) });
  await insertInstrument(db, { symbol: SYMBOL, eventTicker: "EV", label: "Texas wins by 14+" });
  joe = (await insertMerchant(db, { email: "joe@example.com" })).merchantId;
});

afterAll(async () => {
  await database.drop();
});

beforeEach(() => {
  payments = new FakePaymentGateway();
});

describe("handleStripeWebhook: a purchase", () => {
  it("authorized: one purchase job, however many times the event is delivered", async () => {
    const pi = await checkout();
    payments.pay(pi, "requires_capture", " Fan@Example.COM ");
    for (let i = 0; i < 3; i += 1) await deliver("payment_intent.amount_capturable_updated", pi);
    expect(await purchaseJobs(pi)).toEqual([
      { status: "queued", payload: { paymentIntentId: pi } },
    ]);
    expect(await paymentRow(pi)).toEqual({
      status: "processing",
      email: "fan@example.com",
      message: null,
    });
  });

  it("payment_failed: the payment fails with the declined message, and no job", async () => {
    const pi = await checkout();
    payments.pay(pi, "requires_payment_method", null);
    await deliver("payment_intent.payment_failed", pi);
    expect(await paymentRow(pi)).toEqual({
      status: "failed",
      email: null,
      message: CUSTOMER_MESSAGES.declined,
    });
    expect(await purchaseJobs(pi)).toEqual([]);
  });

  it("canceled: the payment fails with the cancellation message", async () => {
    const pi = await checkout();
    payments.pay(pi, "canceled", null);
    await deliver("payment_intent.canceled", pi);
    expect(await paymentRow(pi)).toMatchObject({
      status: "failed",
      message: CUSTOMER_MESSAGES.cancelled,
    });
  });

  it("payment_failed after an authorization on the same intent: not failed, the purchase stands", async () => {
    const pi = await checkout();
    // Card A declined, its event held back; card B authorized and handed over.
    payments.pay(pi, "requires_capture", "fan@example.com");
    await deliver("payment_intent.amount_capturable_updated", pi);
    await deliver("payment_intent.payment_failed", pi, "requires_payment_method");
    expect(await paymentRow(pi)).toMatchObject({ status: "processing", message: null });
    expect(await purchaseJobs(pi)).toHaveLength(1);

    // The same late event before the authorization's own event came in: Stripe says authorized.
    const other = await checkout();
    payments.pay(other, "requires_capture", "fan@example.com");
    await deliver("payment_intent.payment_failed", other, "requires_payment_method");
    expect(await paymentRow(other)).toMatchObject({ status: "requires_payment", message: null });
    // And the authorization's event then takes it.
    await deliver("payment_intent.amount_capturable_updated", other);
    expect(await paymentRow(other)).toMatchObject({ status: "processing" });
    expect(await purchaseJobs(other)).toHaveLength(1);
  });

  it("a failure event whose job exists never fails the payment: the engine owns it", async () => {
    const pi = await checkout();
    payments.pay(pi, "requires_capture", "fan@example.com");
    await deliver("payment_intent.amount_capturable_updated", pi);
    // Stripe now says the intent is over (the engine cancelled it): still the engine's to end.
    payments.pay(pi, "canceled", "fan@example.com");
    await deliver("payment_intent.canceled", pi);
    expect(await paymentRow(pi)).toMatchObject({ status: "processing" });
  });

  it("a stale event is read again at Stripe: its own status is never acted on", async () => {
    // A failure event whose intent has moved on to a 3-D Secure approval: left alone.
    const pending = await checkout();
    payments.pay(pending, "requires_action", "fan@example.com");
    await deliver("payment_intent.payment_failed", pending, "requires_payment_method");
    expect(await paymentRow(pending)).toMatchObject({ status: "requires_payment" });

    // An authorization event whose intent is no longer authorized (declined since, or forged):
    // nothing taken.
    const unpaid = await checkout();
    payments.pay(unpaid, "requires_payment_method", null);
    const retrievals = payments.retrieveCalls;
    await deliver("payment_intent.amount_capturable_updated", unpaid, "requires_capture");
    expect(payments.retrieveCalls).toBe(retrievals + 1);
    expect(await paymentRow(unpaid)).toMatchObject({ status: "requires_payment" });
    expect(await purchaseJobs(unpaid)).toEqual([]);

    // A cancellation event for an intent Stripe shows authorized: not failed.
    const authorized = await checkout();
    payments.pay(authorized, "requires_capture", "fan@example.com");
    await deliver("payment_intent.canceled", authorized, "canceled");
    expect(await paymentRow(authorized)).toMatchObject({ status: "requires_payment" });
  });

  it("an event for an intent Stripe does not know, or that is not a purchase, changes nothing", async () => {
    const pi = await checkout();
    payments.pay(pi, "requires_payment_method", null);
    const intent = payments.intents.get(pi);
    if (!intent) throw new Error("missing intent");
    const body = stripeEventBody("payment_intent.payment_failed", intent);
    payments.intents.delete(pi);
    await handleStripeWebhook(db, payments, body, signStripeBody(body));
    expect(await paymentRow(pi)).toMatchObject({ status: "requires_payment" });

    const other = await checkout();
    const known = payments.intents.get(other);
    if (!known) throw new Error("missing intent");
    known.metadata = { ...known.metadata, kind: STRIPE_PAYMENT_KINDS.campaignBudget };
    known.status = "requires_payment_method";
    await deliver("payment_intent.payment_failed", other);
    expect(await paymentRow(other)).toMatchObject({ status: "requires_payment" });
  });

  it("a bad signature is refused with a 400 and changes nothing", async () => {
    const pi = await checkout();
    payments.pay(pi, "requires_capture", "fan@example.com");
    const intent = payments.intents.get(pi);
    if (!intent) throw new Error("missing intent");
    const body = stripeEventBody("payment_intent.amount_capturable_updated", intent);
    const refused = await handleStripeWebhook(
      db,
      payments,
      body,
      signStripeBody(body, "whsec_not_the_secret_0123456789abcdef"),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ApiRouteError);
    expect((refused as ApiRouteError).status).toBe(400);
    expect(await purchaseJobs(pi)).toEqual([]);
  });
});
