import {
  JOB_KINDS,
  checkoutResponseSchema,
  checkoutStatusResponseSchema,
  jobIdempotencyKey,
  type CampaignStatus,
  type SaleState,
} from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  CUSTOMER_MESSAGES,
  checkoutStatus,
  confirmCheckout,
  markPurchaseFailed,
  processAuthorizedPurchase,
  startCheckout,
} from "./checkout";
import type { Db } from "./db";
import { PaymentGatewayError } from "./payments-gateway";
import { ApiRouteError } from "./route";
import { FakePaymentGateway } from "./testing/fake-payments";
import {
  cryptoWordsIn,
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  insertTicket,
  minutesFrom,
  randomWallet,
} from "./testing/fixtures";

const now = new Date("2026-11-20T18:00:00.000Z");
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";
const salesClose = minutesFrom(now, 595);

let database: TestDatabase;
let db: Db;
let joe: string;
let payments: FakePaymentGateway;
let slugCounter = 0;

async function liveCampaign(
  overrides: {
    status?: CampaignStatus;
    saleState?: SaleState;
    salesClose?: Date;
    outcome?: "yes" | "no" | "void" | null;
    unitPrice?: bigint;
  } = {},
): Promise<{ id: string; slug: string }> {
  slugCounter += 1;
  const slug = `joes-promo-${slugCounter}`;
  const id = await insertCampaign(db, {
    merchantId: joe,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose: overrides.salesClose ?? salesClose,
    slug,
    status: overrides.status,
    saleState: overrides.saleState,
    outcome: overrides.outcome,
    unitPrice: overrides.unitPrice,
  });
  return { id, slug };
}

async function paymentRows(campaignId: string): Promise<Record<string, unknown>[]> {
  return db<Record<string, unknown>[]>`
    select stripe_pi, status, qty, amount, email, message from payments
    where campaign_id = ${campaignId}
  `;
}

async function purchaseJobs(pi: string): Promise<{ status: string; payload: unknown }[]> {
  return db<{ status: string; payload: unknown }[]>`
    select status, payload from jobs where kind = ${JOB_KINDS.purchase}
      and idempotency_key = ${jobIdempotencyKey.purchase(pi)}
  `;
}

async function caught(promise: Promise<unknown>): Promise<ApiRouteError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiRouteError);
  return error as ApiRouteError;
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

describe("startCheckout", () => {
  it("authorizes qty × unit price and records the payment", async () => {
    const { id, slug } = await liveCampaign();
    const response = await startCheckout(db, payments, { slug, qty: 3 }, now, "checkout:k1");
    expect(checkoutResponseSchema.parse(response)).toEqual(response);
    expect(response.amount).toBe("60000000");
    expect(cryptoWordsIn(response)).toEqual([]);

    const intent = payments.intents.get(response.paymentIntentId);
    expect(intent).toMatchObject({
      amount: 60_000_000n,
      captureMethod: "manual",
      idempotencyKey: "checkout:k1",
      metadata: { kind: "purchase", campaignId: id, qty: "3" },
    });
    expect(response.clientSecret).toBe(intent?.clientSecret);
    expect(await paymentRows(id)).toEqual([
      {
        stripe_pi: response.paymentIntentId,
        status: "requires_payment",
        qty: 3,
        amount: 60_000_000n,
        email: null,
        message: null,
      },
    ]);
  });

  it.each([
    ["paused by hand", { saleState: "paused_manual" as const }, 409, "sales_paused"],
    ["paused on price", { saleState: "paused_price" as const }, 409, "sales_paused"],
    ["paused on-chain", { status: "paused" as const }, 409, "sales_paused"],
    ["closed early", { saleState: "closed" as const }, 409, "sales_closed"],
    ["sales_closed", { status: "sales_closed" as const }, 409, "sales_closed"],
    ["past sales close", { salesClose: minutesFrom(now, -1) }, 409, "sales_closed"],
    [
      "settled",
      { status: "settled_no" as const, outcome: "no" as const, saleState: "closed" as const },
      409,
      "sales_closed",
    ],
    ["still funding", { status: "funding" as const }, 404, "not_found"],
  ])("creates nothing when the promo is %s", async (_case, overrides, status, code) => {
    const { id, slug } = await liveCampaign(overrides);
    const error = await caught(startCheckout(db, payments, { slug, qty: 1 }, now));
    expect({ status: error.status, code: error.code }).toEqual({ status, code });
    expect(cryptoWordsIn(error.message)).toEqual([]);
    expect(payments.createCalls).toBe(0);
    expect(await paymentRows(id)).toEqual([]);
  });

  it("answers 404 for an unknown promo", async () => {
    const error = await caught(startCheckout(db, payments, { slug: "nobody-here", qty: 1 }, now));
    expect(error.status).toBe(404);
    expect(payments.createCalls).toBe(0);
  });

  it("records nothing when the authorization cannot be created", async () => {
    const { id, slug } = await liveCampaign();
    payments.failure = new PaymentGatewayError("Stripe is down");
    const error = await caught(startCheckout(db, payments, { slug, qty: 1 }, now));
    expect(error.status).toBe(502);
    expect(await paymentRows(id)).toEqual([]);
  });
});

describe("processAuthorizedPurchase and the status routes", () => {
  async function authorized(email: string | null = " Fan@Example.COM "): Promise<{
    id: string;
    pi: string;
  }> {
    const { id, slug } = await liveCampaign();
    const { paymentIntentId } = await startCheckout(db, payments, { slug, qty: 1 }, now);
    payments.pay(paymentIntentId, "requires_capture", email);
    return { id, pi: paymentIntentId };
  }

  it("stores the normalised e-mail, sets processing and enqueues one purchase job", async () => {
    const { id, pi } = await authorized();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => processAuthorizedPurchase(db, payments, pi)),
    );
    expect(results.every((result) => result.outcome === "enqueued")).toBe(true);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await purchaseJobs(pi)).toEqual([
      { status: "queued", payload: { paymentIntentId: pi } },
    ]);
    expect(await paymentRows(id)).toMatchObject([
      { status: "processing", email: "fan@example.com" },
    ]);
  });

  it("changes nothing while the card is not authorized", async () => {
    const { id, slug } = await liveCampaign();
    const { paymentIntentId: pi } = await startCheckout(db, payments, { slug, qty: 1 }, now);
    expect(await processAuthorizedPurchase(db, payments, pi)).toEqual({
      outcome: "not_authorized",
      created: false,
      stripeStatus: "requires_payment_method",
    });
    payments.pay(pi, "requires_action", "fan@example.com");
    expect(await processAuthorizedPurchase(db, payments, pi)).toEqual({
      outcome: "not_authorized",
      created: false,
      stripeStatus: "requires_action",
    });
    expect(await purchaseJobs(pi)).toEqual([]);
    expect(await paymentRows(id)).toMatchObject([{ status: "requires_payment", email: null }]);
  });

  it("trusts Stripe, not the row: a mismatching intent is left untouched", async () => {
    const { id, pi } = await authorized();
    const intent = payments.intents.get(pi);
    if (!intent) throw new Error("missing intent");
    intent.amount = 1_000_000n;
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("mismatch");
    intent.amount = 20_000_000n;
    intent.metadata = { ...intent.metadata, kind: "campaign_budget" };
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("mismatch");
    payments.intents.delete(pi);
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("mismatch");
    expect(await purchaseJobs(pi)).toEqual([]);
    expect(await paymentRows(id)).toMatchObject([{ status: "requires_payment" }]);
  });

  it("refuses an intent whose campaign or quantity differs from its payment row", async () => {
    const { id, pi } = await authorized();
    const intent = payments.intents.get(pi);
    if (!intent) throw new Error("missing intent");
    const original = { ...intent.metadata };
    const other = await liveCampaign();

    intent.metadata = { ...original, campaignId: other.id };
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("mismatch");
    intent.metadata = { ...original, qty: "2" };
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("mismatch");
    const withoutQty: Record<string, string> = { ...original };
    delete withoutQty.qty;
    intent.metadata = withoutQty;
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("mismatch");
    expect(await purchaseJobs(pi)).toEqual([]);
    expect(await paymentRows(id)).toMatchObject([{ status: "requires_payment" }]);

    // The same intent with its own metadata back is taken.
    intent.metadata = original;
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("enqueued");
  });

  it("does not touch a payment that already ended", async () => {
    for (const status of ["ticketed", "cancelled_paused"] as const) {
      const { pi } = await authorized();
      await db`update payments set status = ${status} where stripe_pi = ${pi}`;
      expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("final");
      expect(await purchaseJobs(pi)).toEqual([]);
    }
  });

  it("takes back a payment whose first attempt failed, but not one the engine failed", async () => {
    const { pi } = await authorized();
    await markPurchaseFailed(db, pi, CUSTOMER_MESSAGES.declined);
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("enqueued");
    expect((await checkoutStatus(db, pi)).status).toBe("processing");

    // The engine failed it after running the job: nothing restarts it.
    await db`update payments set status = 'failed', message = 'x' where stripe_pi = ${pi}`;
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("final");
    expect(await purchaseJobs(pi)).toHaveLength(1);
  });

  it("answers 404 for an unknown payment without calling Stripe", async () => {
    expect(await processAuthorizedPurchase(db, payments, "pi_unknown")).toEqual({
      outcome: "unknown_payment",
      created: false,
    });
    expect(payments.retrieveCalls).toBe(0);
    expect((await caught(confirmCheckout(db, payments, "pi_unknown"))).status).toBe(404);
    expect((await caught(checkoutStatus(db, "pi_unknown"))).status).toBe(404);
  });

  it("confirm answers the current status, and 502 when Stripe is unreachable", async () => {
    const { pi } = await authorized();
    const answer = await confirmCheckout(db, payments, pi);
    expect(checkoutStatusResponseSchema.parse(answer)).toEqual({
      status: "processing",
      ticketToken: null,
      message: null,
    });
    payments.retrievePaymentIntent = async (): Promise<never> => {
      throw new PaymentGatewayError("down");
    };
    expect((await caught(confirmCheckout(db, payments, pi))).status).toBe(502);
  });

  it("confirm answers 502, not the row's requires_payment, for an intent it cannot check", async () => {
    // The pick-up of an unseen card lets its record go on the confirmation's requires_payment, so
    // that answer must mean « Stripe said unpaid »: an intent Stripe does not know (its 404) or one
    // that does not match its row (another account or mode) proves nothing about the card.
    const { id, pi } = await authorized();
    const intent = payments.intents.get(pi);
    if (!intent) throw new Error("missing intent");
    intent.amount = 1_000_000n;
    const mismatching = await caught(confirmCheckout(db, payments, pi));
    expect({ status: mismatching.status, code: mismatching.code }).toEqual({
      status: 502,
      code: "internal",
    });
    intent.amount = 20_000_000n;
    intent.metadata = { ...intent.metadata, campaignId: (await liveCampaign()).id };
    expect((await caught(confirmCheckout(db, payments, pi))).status).toBe(502);
    payments.intents.delete(pi);
    const unknownAtStripe = await caught(confirmCheckout(db, payments, pi));
    expect(unknownAtStripe.status).toBe(502);
    expect(cryptoWordsIn(unknownAtStripe.message)).toEqual([]);
    expect(await purchaseJobs(pi)).toEqual([]);
    expect(await paymentRows(id)).toMatchObject([{ status: "requires_payment" }]);
  });

  it.each(["requires_action", "processing"] as const)(
    "confirm answers processing, not requires_payment, while Stripe says %s",
    async (pending) => {
      // A card not authorized yet but pending at Stripe (a 3-D Secure approval left open in a bank
      // app after the page was lost): the purchase may still be authorized without the page, so the
      // pick-up must keep its record. Nothing is taken until Stripe says requires_capture.
      const { id, slug } = await liveCampaign();
      const { paymentIntentId: pi } = await startCheckout(db, payments, { slug, qty: 1 }, now);
      payments.pay(pi, pending, "fan@example.com");
      const answer = await confirmCheckout(db, payments, pi);
      expect(checkoutStatusResponseSchema.parse(answer)).toEqual({
        status: "processing",
        ticketToken: null,
        message: null,
      });
      expect(await purchaseJobs(pi)).toEqual([]);
      expect(await paymentRows(id)).toMatchObject([{ status: "requires_payment", email: null }]);

      // Approved at last: the next confirmation (or the status read's heal) takes it, once.
      payments.pay(pi, "requires_capture", "fan@example.com");
      expect((await confirmCheckout(db, payments, pi)).status).toBe("processing");
      expect(await purchaseJobs(pi)).toHaveLength(1);
      expect(await paymentRows(id)).toMatchObject([{ status: "processing" }]);
    },
  );

  it.each(["requires_payment_method", "requires_confirmation", "canceled"] as const)(
    "confirm answers requires_payment when Stripe says %s: unpaid or over",
    async (unpaid) => {
      const { id, slug } = await liveCampaign();
      const { paymentIntentId: pi } = await startCheckout(db, payments, { slug, qty: 1 }, now);
      payments.pay(pi, unpaid, null);
      expect(await confirmCheckout(db, payments, pi)).toEqual({
        status: "requires_payment",
        ticketToken: null,
        message: null,
      });
      expect(await purchaseJobs(pi)).toEqual([]);
      expect(await paymentRows(id)).toMatchObject([{ status: "requires_payment" }]);
    },
  );

  it("reports the ticket token once ticketed and the message on a failure", async () => {
    const { id, pi } = await authorized();
    await processAuthorizedPurchase(db, payments, pi);
    expect(await checkoutStatus(db, pi)).toEqual({
      status: "processing",
      ticketToken: null,
      message: null,
    });

    // Ticketed before the ticket row is readable: still processing.
    await db`update payments set status = 'ticketed' where stripe_pi = ${pi}`;
    expect((await checkoutStatus(db, pi)).status).toBe("processing");

    const buyer = randomWallet();
    const ticket = await insertTicket(db, {
      campaignId: id,
      buyer,
      token: "tkt_0123456789abcdef01234567",
    });
    await db`update tickets set payment_pi = ${pi} where id = ${ticket.id}`;
    await db`update payments set ticket_id = ${ticket.id}, buyer = ${buyer} where stripe_pi = ${pi}`;
    const ticketed = await checkoutStatus(db, pi);
    expect(ticketed).toEqual({
      status: "ticketed",
      ticketToken: "tkt_0123456789abcdef01234567",
      message: null,
    });
    // Never the e-mail, the buyer address or any on-chain term.
    const text = JSON.stringify(ticketed);
    expect(text).not.toContain("fan@example.com");
    expect(text).not.toContain(buyer);
    expect(cryptoWordsIn(ticketed)).toEqual([]);

    const paused = await authorized();
    await db`update payments set status = 'cancelled_paused' where stripe_pi = ${paused.pi}`;
    expect(await checkoutStatus(db, paused.pi)).toEqual({
      status: "cancelled_paused",
      ticketToken: null,
      message: "Promo just paused, you were not charged",
    });

    const failed = await authorized();
    await db`
      update payments set status = 'failed', message = 'Your card was declined, you were not charged'
      where stripe_pi = ${failed.pi}
    `;
    expect(await checkoutStatus(db, failed.pi)).toEqual({
      status: "failed",
      ticketToken: null,
      message: "Your card was declined, you were not charged",
    });
  });
});

describe("markPurchaseFailed", () => {
  it("fails an open payment but never a ticketed or paused one", async () => {
    const { id, slug } = await liveCampaign();
    const pis: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      pis.push((await startCheckout(db, payments, { slug, qty: 1 }, now)).paymentIntentId);
    }
    const [open, ticketed, paused] = pis as [string, string, string];
    await db`update payments set status = 'ticketed' where stripe_pi = ${ticketed}`;
    await db`update payments set status = 'cancelled_paused' where stripe_pi = ${paused}`;
    expect(await markPurchaseFailed(db, open, CUSTOMER_MESSAGES.cancelled)).toBe(true);
    expect(await markPurchaseFailed(db, open, CUSTOMER_MESSAGES.declined)).toBe(false);
    expect(await markPurchaseFailed(db, ticketed, CUSTOMER_MESSAGES.cancelled)).toBe(false);
    expect(await markPurchaseFailed(db, paused, CUSTOMER_MESSAGES.cancelled)).toBe(false);
    const rows = await paymentRows(id);
    expect(rows.find((row) => row.stripe_pi === open)).toMatchObject({
      status: "failed",
      message: CUSTOMER_MESSAGES.cancelled,
    });
  });

  it("never fails a payment whose purchase job exists: the engine owns its outcome", async () => {
    const { id, slug } = await liveCampaign();
    const { paymentIntentId: pi } = await startCheckout(db, payments, { slug, qty: 1 }, now);
    payments.pay(pi, "requires_capture", "fan@example.com");
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("enqueued");

    expect(await markPurchaseFailed(db, pi, CUSTOMER_MESSAGES.declined)).toBe(false);
    expect(await markPurchaseFailed(db, pi, CUSTOMER_MESSAGES.cancelled)).toBe(false);
    expect(await paymentRows(id)).toMatchObject([{ status: "processing", message: null }]);
    expect(await purchaseJobs(pi)).toEqual([
      { status: "queued", payload: { paymentIntentId: pi } },
    ]);
  });

  it("uses customer-safe messages only", () => {
    expect(cryptoWordsIn(CUSTOMER_MESSAGES)).toEqual([]);
  });
});
