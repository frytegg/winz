import {
  JOB_KINDS,
  checkoutStatusResponseSchema,
  jobIdempotencyKey,
  type CheckoutStatusResponse,
} from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getCheckout } from "@/app/api/checkout/[pi]/route";
import { POST as postConfirm } from "@/app/api/checkout/[pi]/confirm/route";
import { POST as postStripe } from "@/app/api/webhooks/stripe/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { CHECKOUT_HEAL_AFTER_SECONDS, CUSTOMER_MESSAGES, startCheckout } from "./checkout";
import type { Db } from "./db";
import { setServerDepsForTesting } from "./deps";
import { PaymentGatewayError, type PaymentIntentView } from "./payments-gateway";
import {
  FakePaymentGateway,
  HeldAnswers,
  signStripeBody,
  stripeEventBody,
} from "./testing/fake-payments";
import {
  FakeIdentity,
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  insertTicket,
  minutesFrom,
  randomWallet,
  serverDepsFor,
} from "./testing/fixtures";

/**
 * GET /api/checkout/:pi heals a payment the confirmation never moved on (SPEC CO-3): the polls
 * alone hand an authorized purchase to the engine when the confirmation failed and the webhook
 * never comes. Through the Next.js handlers, against a real Postgres and the fake Stripe.
 */

/** What the code under test logged. */
const logged = vi.hoisted(() => [] as { level: string; fields: unknown; message: unknown }[]);
vi.mock("./logger", () => {
  const record =
    (level: string) =>
    (fields: unknown, message?: unknown): void => {
      logged.push({ level, fields, message });
    };
  const logger = {
    trace: record("trace"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
    child: (): unknown => logger,
  };
  return { serverLogger: (): unknown => logger };
});

const HEAL_FAILURE_LOG =
  "status read could not ask Stripe about an unconfirmed payment: answered from its row";

const now = new Date();
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";

let database: TestDatabase;
let db: Db;
let joe: string;
let payments: FakePaymentGateway;
let slugCounter = 0;

function params(values: Record<string, string>): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve(values) };
}

/** A poll of the front: GET /api/checkout/:pi, its HTTP status and its validated body. */
async function poll(pi: string): Promise<{ http: number; body: CheckoutStatusResponse }> {
  const response = await getCheckout(
    new Request(`http://localhost/api/checkout/${pi}`),
    params({ pi }),
  );
  const payload: unknown = await response.json();
  expect(response.status, JSON.stringify(payload)).toBe(200);
  return { http: response.status, body: checkoutStatusResponseSchema.parse(payload) };
}

async function confirm(pi: string): Promise<Response> {
  return postConfirm(
    new Request(`http://localhost/api/checkout/${pi}/confirm`, { method: "POST", body: "" }),
    params({ pi }),
  );
}

async function webhook(type: string, pi: string): Promise<number> {
  const intent = payments.intents.get(pi);
  if (!intent) throw new Error(`no fake intent ${pi}`);
  const body = stripeEventBody(type, intent);
  const response = await postStripe(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signStripeBody(body) },
      body,
    }),
    params({}),
  );
  return response.status;
}

/** A fan's checkout: the authorization exists, its payment row is `requires_payment`. */
async function checkout(): Promise<string> {
  slugCounter += 1;
  const slug = `heal-promo-${slugCounter.toString()}`;
  await insertCampaign(db, {
    merchantId: joe,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose: minutesFrom(now, 595),
    slug,
  });
  return (await startCheckout(db, payments, { slug, qty: 1 }, now)).paymentIntentId;
}

/** A checkout whose card the fan authorized on Stripe's sheet. */
async function authorized(): Promise<string> {
  const pi = await checkout();
  payments.pay(pi, "requires_capture", " Fan@Example.COM ");
  return pi;
}

/**
 * Moves the payment's `updated_at` back by `seconds`, as if that long had passed since it was
 * created or last looked at. The row's trigger stamps `updated_at` on every update, so it is
 * bypassed for this one statement (`session_replication_role`, test database only).
 */
async function age(pi: string, seconds: number = CHECKOUT_HEAL_AFTER_SECONDS + 1): Promise<void> {
  await db.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`
      update payments set updated_at = updated_at - make_interval(secs => ${seconds})
      where stripe_pi = ${pi}
    `;
  });
}

async function purchaseJobs(pi: string): Promise<{ status: string; payload: unknown }[]> {
  return db<{ status: string; payload: unknown }[]>`
    select status, payload from jobs
    where kind = ${JOB_KINDS.purchase} and idempotency_key = ${jobIdempotencyKey.purchase(pi)}
  `;
}

async function allPurchaseJobs(pi: string): Promise<number> {
  const [row] = await db<{ n: bigint }[]>`
    select count(*)::bigint as n from jobs where payload ->> 'paymentIntentId' = ${pi}
  `;
  return Number(row?.n ?? 0n);
}

async function paymentRow(pi: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await db<Record<string, unknown>[]>`
    select status, email, message from payments where stripe_pi = ${pi}
  `;
  return row;
}

function healFailureLogs(pi: string): number {
  return logged.filter(
    (entry) =>
      entry.level === "error" &&
      entry.message === HEAL_FAILURE_LOG &&
      (entry.fields as { paymentIntentId?: string }).paymentIntentId === pi,
  ).length;
}

/** Resolves once `condition` holds, checking every 10 ms for at most 10 s. */
async function until(what: string, condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${what}: not within 10 s`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** Makes every Stripe read wait at `gate` before answering (a slow Stripe). */
function holdReads(gate: HeldAnswers): void {
  const read = payments.retrievePaymentIntent.bind(payments);
  payments.retrievePaymentIntent = async (id: string): Promise<PaymentIntentView | null> => {
    const answer = await read(id);
    await gate.enter();
    return answer;
  };
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV", startsAt: minutesFrom(now, 600) });
  await insertInstrument(db, { symbol: SYMBOL, eventTicker: "EV", label: "Texas wins by 14+" });
  joe = (await insertMerchant(db, { email: "joe@example.com" })).merchantId;
});

afterAll(async () => {
  setServerDepsForTesting(undefined);
  await database.drop();
});

beforeEach(() => {
  payments = new FakePaymentGateway();
  setServerDepsForTesting(serverDepsFor(db, new FakeIdentity(), now, payments));
  logged.length = 0;
});

describe("GET /api/checkout/:pi heals a payment left requires_payment", () => {
  it("the confirmation fails once and the webhook never comes: the polls alone hand it over", async () => {
    const pi = await authorized();

    // The one confirmation of the front fails: Stripe could not be read (a 502).
    const read = payments.retrievePaymentIntent.bind(payments);
    payments.retrievePaymentIntent = async (id: string): Promise<PaymentIntentView | null> => {
      payments.retrievePaymentIntent = read;
      payments.retrieveCalls += 1;
      throw new PaymentGatewayError(`Stripe timed out reading ${id}`);
    };
    expect((await confirm(pi)).status).toBe(502);
    expect(payments.retrieveCalls).toBe(1);

    // Within the first seconds the poll answers the row without asking Stripe.
    expect((await poll(pi)).body.status).toBe("requires_payment");
    expect(payments.retrieveCalls).toBe(1);
    expect(await purchaseJobs(pi)).toEqual([]);

    // Past the delay, the next poll finds the card authorized and hands the purchase over.
    await age(pi);
    expect((await poll(pi)).body).toEqual({
      status: "processing",
      ticketToken: null,
      message: null,
    });
    expect(payments.retrieveCalls).toBe(2);
    expect(await purchaseJobs(pi)).toEqual([
      { status: "queued", payload: { paymentIntentId: pi } },
    ]);
    expect(await paymentRow(pi)).toEqual({
      status: "processing",
      email: "fan@example.com",
      message: null,
    });

    // From then on the polls only read the row, however late they come.
    await age(pi, 600);
    for (let i = 0; i < 3; i += 1) expect((await poll(pi)).body.status).toBe("processing");
    expect(payments.retrieveCalls).toBe(2);
    expect(await allPurchaseJobs(pi)).toBe(1);
  });

  it("leaves the ordinary case alone: a confirmed payment is never read again by a poll", async () => {
    const pi = await authorized();
    expect((await confirm(pi)).status).toBe(200);
    expect(payments.retrieveCalls).toBe(1);
    await age(pi, 3600);
    for (let i = 0; i < 3; i += 1) expect((await poll(pi)).body.status).toBe("processing");
    expect(payments.retrieveCalls).toBe(1);
    expect(await allPurchaseJobs(pi)).toBe(1);
  });

  it("the confirmation and the heal race: one job", async () => {
    const pi = await authorized();
    await age(pi);
    const answers = await Promise.all([
      poll(pi),
      confirm(pi),
      poll(pi),
      confirm(pi),
      poll(pi),
      webhook("payment_intent.amount_capturable_updated", pi),
      poll(pi),
    ]);
    expect(answers).toHaveLength(7);
    expect(await purchaseJobs(pi)).toEqual([
      { status: "queued", payload: { paymentIntentId: pi } },
    ]);
    expect(await allPurchaseJobs(pi)).toBe(1);
    expect((await poll(pi)).body.status).toBe("processing");
    expect(await paymentRow(pi)).toMatchObject({ status: "processing", email: "fan@example.com" });
  });

  it("the webhook arrives after the heal: nothing twice", async () => {
    const pi = await authorized();
    await age(pi);
    expect((await poll(pi)).body.status).toBe("processing");
    const [jobBefore] = await db`
      select id, status, payload, created_at from jobs
      where idempotency_key = ${jobIdempotencyKey.purchase(pi)}
    `;

    expect(await webhook("payment_intent.amount_capturable_updated", pi)).toBe(200);
    expect(await webhook("payment_intent.amount_capturable_updated", pi)).toBe(200);
    expect((await confirm(pi)).status).toBe(200);
    const jobsAfter = await db`
      select id, status, payload, created_at from jobs
      where idempotency_key = ${jobIdempotencyKey.purchase(pi)}
    `;
    expect(jobsAfter).toEqual([jobBefore]);
    expect(await allPurchaseJobs(pi)).toBe(1);

    // Once the engine has issued the ticket, a late webhook changes nothing either.
    const ticket = await insertTicket(db, {
      campaignId:
        (
          await db<{ campaign_id: string }[]>`
        select campaign_id from payments where stripe_pi = ${pi}
      `
        )[0]?.campaign_id ?? "",
      buyer: randomWallet(),
      token: `tkt_heal_${pi.slice(-12)}`,
    });
    await db`update tickets set payment_pi = ${pi} where id = ${ticket.id}`;
    await db`update payments set status = 'ticketed', ticket_id = ${ticket.id} where stripe_pi = ${pi}`;
    expect(await webhook("payment_intent.amount_capturable_updated", pi)).toBe(200);
    expect((await poll(pi)).body).toEqual({
      status: "ticketed",
      ticketToken: `tkt_heal_${pi.slice(-12)}`,
      message: null,
    });
    expect(await allPurchaseJobs(pi)).toBe(1);
  });
});

describe("the throttle: one Stripe read per payment per window, decided in the database", () => {
  it("N concurrent polls read Stripe once; a poll after the window reads again", async () => {
    const pi = await checkout(); // Not authorized: it stays requires_payment and keeps polling.
    await age(pi);
    const gate = new HeldAnswers();
    holdReads(gate);

    let answered = 0;
    const polls = Array.from({ length: 12 }, async () => {
      const answer = await poll(pi);
      answered += 1;
      return answer;
    });
    // One poll is inside Stripe, held; the eleven others answer without waiting for it.
    await gate.waiting(1);
    await until("eleven polls answered", () => answered === 11);
    expect(payments.retrieveCalls).toBe(1);
    gate.release();
    const first = await Promise.all(polls);
    expect(first.map((answer) => answer.body.status)).toEqual(Array(12).fill("requires_payment"));
    expect(payments.retrieveCalls).toBe(1);

    // Within the window: no read.
    for (let i = 0; i < 3; i += 1) expect((await poll(pi)).body.status).toBe("requires_payment");
    expect(payments.retrieveCalls).toBe(1);

    // After the window: one more.
    await age(pi);
    const again = await Promise.all(Array.from({ length: 6 }, () => poll(pi)));
    expect(again.map((answer) => answer.body.status)).toEqual(Array(6).fill("requires_payment"));
    expect(payments.retrieveCalls).toBe(2);
  });

  it("a payment younger than the delay is not read at all", async () => {
    const pi = await authorized();
    for (let i = 0; i < 5; i += 1) expect((await poll(pi)).body.status).toBe("requires_payment");
    expect(payments.retrieveCalls).toBe(0);
    expect(await purchaseJobs(pi)).toEqual([]);
  });
});

describe("what a heal never does", () => {
  it("Stripe down during the heal: 200 with the row's state, one log line per window", async () => {
    const pi = await authorized();
    payments.retrievePaymentIntent = async (): Promise<never> => {
      payments.retrieveCalls += 1;
      throw new PaymentGatewayError("Stripe is down");
    };
    await age(pi);
    const answers = await Promise.all(Array.from({ length: 8 }, () => poll(pi)));
    for (const answer of answers) {
      expect(answer).toEqual({
        http: 200,
        body: { status: "requires_payment", ticketToken: null, message: null },
      });
    }
    for (let i = 0; i < 3; i += 1) expect((await poll(pi)).http).toBe(200);
    expect(payments.retrieveCalls).toBe(1);
    expect(healFailureLogs(pi)).toBe(1);

    await age(pi);
    expect((await poll(pi)).body.status).toBe("requires_payment");
    expect((await poll(pi)).body.status).toBe("requires_payment");
    expect(payments.retrieveCalls).toBe(2);
    expect(healFailureLogs(pi)).toBe(2);
    expect(await purchaseJobs(pi)).toEqual([]);
    // Never the payer's e-mail or the card in what was logged.
    expect(JSON.stringify(logged.map((entry) => entry.fields))).not.toMatch(/example\.com/i);
  });

  it("an intent that is not authorized: nothing enqueued, the row as it was", async () => {
    for (const status of ["requires_payment_method", "requires_action", "processing"] as const) {
      const pi = await checkout();
      payments.pay(pi, status, "fan@example.com");
      await age(pi);
      expect((await poll(pi)).body).toEqual({
        status: "requires_payment",
        ticketToken: null,
        message: null,
      });
      expect(await purchaseJobs(pi)).toEqual([]);
      expect(await paymentRow(pi)).toEqual({
        status: "requires_payment",
        email: null,
        message: null,
      });
    }
    expect(payments.retrieveCalls).toBe(3);
  });

  it("an intent that does not match its row is left untouched", async () => {
    const pi = await authorized();
    const intent = payments.intents.get(pi);
    if (!intent) throw new Error("missing intent");
    intent.amount = 1_000_000n;
    await age(pi);
    expect((await poll(pi)).body.status).toBe("requires_payment");
    expect(await purchaseJobs(pi)).toEqual([]);
  });

  it("a cancelled intent fails the payment as the webhook would, once", async () => {
    const pi = await checkout();
    payments.pay(pi, "canceled", null);
    await age(pi);
    expect((await poll(pi)).body).toEqual({
      status: "failed",
      ticketToken: null,
      message: CUSTOMER_MESSAGES.cancelled,
    });
    expect(payments.retrieveCalls).toBe(1);
    // The webhook's cancellation arriving now changes nothing.
    expect(await webhook("payment_intent.canceled", pi)).toBe(200);
    expect(payments.retrieveCalls).toBe(2); // The webhook's own read.
    // A `failed` payment with no purchase job is still asked about (another card could have paid
    // the same intent): Stripe says cancelled, so the poll answers the ending.
    await age(pi);
    expect((await poll(pi)).body).toEqual({
      status: "failed",
      ticketToken: null,
      message: CUSTOMER_MESSAGES.cancelled,
    });
    expect(payments.retrieveCalls).toBe(3);
    expect(await purchaseJobs(pi)).toEqual([]);
  });

  it("a payment processing or ended is never read by a poll", async () => {
    const statuses = ["processing", "ticketed", "cancelled_paused"] as const;
    for (const status of statuses) {
      const pi = await authorized();
      await db`update payments set status = ${status} where stripe_pi = ${pi}`;
      await age(pi, 3600);
      await Promise.all(Array.from({ length: 4 }, () => poll(pi)));
      expect(await purchaseJobs(pi)).toEqual([]);
    }
    expect(payments.retrieveCalls).toBe(0);
  });

  it("answers 404 for an unknown payment without asking Stripe", async () => {
    const response = await getCheckout(
      new Request("http://localhost/api/checkout/pi_unknown"),
      params({ pi: "pi_unknown" }),
    );
    expect(response.status).toBe(404);
    expect(payments.retrieveCalls).toBe(0);
  });
});
