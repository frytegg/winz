import {
  JOB_KINDS,
  jobIdempotencyKey,
  type CheckoutResponse,
  type CheckoutStatusResponse,
} from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WAIT_LIMIT_SECONDS,
  createCheckoutMemory,
  resumeCheckout,
  runCheckout,
  type Authorize,
  type CheckoutDeps,
} from "@/lib/fan/checkout-flow";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  ABANDONED_PURCHASE_AFTER_SECONDS,
  ABANDONED_PURCHASE_STATUSES,
  CHECKOUT_HEAL_AFTER_SECONDS,
  CUSTOMER_MESSAGES,
  confirmCheckout,
  pollCheckoutStatus,
  processAuthorizedPurchase,
  startCheckout,
} from "./checkout";
import type { Db } from "./db";
import { PaymentGatewayError, type PaymentIntentStatus } from "./payments-gateway";
import { handleStripeWebhook } from "./stripe-webhook";
import { FakePaymentGateway, signStripeBody, stripeEventBody } from "./testing/fake-payments";
import {
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  insertTicket,
  minutesFrom,
  randomWallet,
} from "./testing/fixtures";

/**
 * A payment row left `failed` by a declined card while the fan pays the same PaymentIntent with
 * another card (the sheet keeps it), and a purchase intent abandoned at Stripe. The real server
 * code (status read, confirmation, webhook) on the test Postgres and the fake Stripe, driven by the
 * real client flow (`runCheckout`, `resumeCheckout`) on a virtual clock whose every second also
 * passes for the database's heal window.
 */

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

const now = new Date();
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";
const FAN = "fan@example.com";

let database: TestDatabase;
let db: Db;
let joe: string;
let payments: FakePaymentGateway;
let slugCounter = 0;

interface Purchase {
  pi: string;
  slug: string;
  checkout: CheckoutResponse;
}

/** A fan's checkout: the authorization exists, its payment row is `requires_payment`. */
async function checkout(): Promise<Purchase> {
  slugCounter += 1;
  const slug = `failed-row-${slugCounter.toString()}`;
  await insertCampaign(db, {
    merchantId: joe,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose: minutesFrom(now, 595),
    slug,
  });
  const created = await startCheckout(db, payments, { slug, qty: 1 }, now);
  return { pi: created.paymentIntentId, slug, checkout: created };
}

/** A Stripe event for the intent as the fake has it now, through the real webhook handler. */
async function webhook(type: string, pi: string): Promise<void> {
  const intent = payments.intents.get(pi);
  if (!intent) throw new Error(`no fake intent ${pi}`);
  const body = stripeEventBody(type, intent);
  await handleStripeWebhook(db, payments, body, signStripeBody(body));
}

/**
 * Card A declined: Stripe leaves the intent `requires_payment_method` and the webhook fails the
 * row (no purchase job). Then card B on the same intent, as the sheet keeps it: `next`, when given.
 */
async function declinedThen(next?: PaymentIntentStatus): Promise<Purchase> {
  const purchase = await checkout();
  payments.pay(purchase.pi, "requires_payment_method", null);
  await webhook("payment_intent.payment_failed", purchase.pi);
  expect(await paymentRow(purchase.pi)).toMatchObject({
    status: "failed",
    message: CUSTOMER_MESSAGES.declined,
  });
  if (next !== undefined) payments.pay(purchase.pi, next, FAN);
  return purchase;
}

/** Moves `updated_at` back by `seconds` (the row's trigger bypassed, test database only). */
async function age(pi: string, seconds: number = CHECKOUT_HEAL_AFTER_SECONDS + 1): Promise<void> {
  await db.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`
      update payments set updated_at = updated_at - make_interval(secs => ${seconds})
      where stripe_pi = ${pi}
    `;
  });
}

/** Moves `created_at` (and `updated_at`) back by `seconds`, as if the first tap was that long ago. */
async function created(pi: string, secondsAgo: number): Promise<void> {
  await db.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`
      update payments set created_at = now() - make_interval(secs => ${secondsAgo}),
        updated_at = now() - make_interval(secs => ${secondsAgo})
      where stripe_pi = ${pi}
    `;
  });
}

async function paymentRow(pi: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await db<Record<string, unknown>[]>`
    select status, message from payments where stripe_pi = ${pi}
  `;
  return row;
}

async function purchaseJobs(pi: string): Promise<{ id: string; status: string }[]> {
  return db<{ id: string; status: string }[]>`
    select id, status from jobs
    where kind = ${JOB_KINDS.purchase} and idempotency_key = ${jobIdempotencyKey.purchase(pi)}
  `;
}

/**
 * The engine, run between two polls: a purchase job whose payment is `processing` buys the ticket
 * and captures (the payment becomes `ticketed`). Returns the ticket's token, once there is one.
 */
async function engineRuns(pi: string): Promise<void> {
  const [row] = await db<{ status: string; campaign_id: string }[]>`
    select status, campaign_id from payments where stripe_pi = ${pi}
  `;
  if (row?.status !== "processing" || (await purchaseJobs(pi)).length === 0) return;
  const ticket = await insertTicket(db, {
    campaignId: row.campaign_id,
    buyer: randomWallet(),
    token: `tkt_${pi.slice(-16)}`,
  });
  await db`update tickets set payment_pi = ${pi} where id = ${ticket.id}`;
  await db`update payments set status = 'ticketed', ticket_id = ${ticket.id} where stripe_pi = ${pi}`;
  const intent = payments.intents.get(pi);
  if (intent) intent.status = "succeeded";
}

/**
 * The client's deps on the real server functions. The clock is virtual: each sleep moves it and
 * ages the row by as much, so the heal's window passes as it would; the engine runs between two
 * polls; `atSecond` lets a test act at a given second (an approval in the bank app). `payment` is
 * the intent whose row ages and whose job the engine runs: a function when a run pays a new one.
 */
function serverDeps(
  payment: string | (() => string),
  options: { atSecond?: (second: number) => void } = {},
): CheckoutDeps & { clock: () => number } {
  const current = (): string => (typeof payment === "string" ? payment : payment());
  let clock = 0;
  return {
    create: async (body) => startCheckout(db, payments, body, now),
    confirm: (id) => confirmCheckout(db, payments, id),
    status: (id) => pollCheckoutStatus(db, payments, id),
    sleep: async (ms) => {
      if (clock > 2 * WAIT_LIMIT_SECONDS * 1000) throw new Error("runaway wait");
      clock += ms;
      await age(current(), ms / 1000);
      options.atSecond?.(clock / 1000);
      await engineRuns(current());
    },
    now: () => clock,
    clock: () => clock,
  };
}

const signal = new AbortController().signal;
const tokenOf = (pi: string): string => `tkt_${pi.slice(-16)}`;

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
  logged.length = 0;
});

describe("B1: a payment failed by a declined card is not over while its intent can still be paid", () => {
  it("A: picked up with card B authorized and the webhook not in yet: followed to its ticket, one purchase", async () => {
    const { pi } = await declinedThen("requires_capture");
    const onSecuring = vi.fn();
    const outcome = await resumeCheckout({
      paymentIntentId: pi,
      authorized: false,
      signal,
      onSecuring,
      deps: serverDeps(pi),
    });
    expect(outcome).toEqual({ kind: "ticketed", token: tokenOf(pi) });
    expect(onSecuring).toHaveBeenCalledTimes(1);
    // The webhook comes in late: nothing twice.
    await webhook("payment_intent.amount_capturable_updated", pi);
    expect(await purchaseJobs(pi)).toHaveLength(1);
    expect(await paymentRow(pi)).toMatchObject({ status: "ticketed" });
  });

  it("A, Stripe unreachable during the pick-up: the record stays, never `gone`", async () => {
    const { pi } = await declinedThen("requires_capture");
    payments.retrievePaymentIntent = async (): Promise<never> => {
      throw new PaymentGatewayError("Stripe is down");
    };
    const outcome = await resumeCheckout({
      paymentIntentId: pi,
      authorized: false,
      signal,
      deps: serverDeps(pi),
    });
    expect(outcome).toEqual({ kind: "unresolved" });
    expect(await purchaseJobs(pi)).toEqual([]);
  });

  it("B: picked up while card B waits on a 3-D Secure approval: followed, and taken once approved", async () => {
    const { pi } = await declinedThen("requires_action");
    // The confirmation reads Stripe: pending, not the row's `failed`.
    expect(await confirmCheckout(db, payments, pi)).toEqual({
      status: "processing",
      ticketToken: null,
      message: null,
    });
    expect(await paymentRow(pi)).toMatchObject({ status: "failed" });

    const onSecuring = vi.fn();
    const outcome = await resumeCheckout({
      paymentIntentId: pi,
      authorized: false,
      signal,
      onSecuring,
      deps: serverDeps(pi, {
        // Approved in the bank app 20 s into the pick-up.
        atSecond: (second) => {
          if (second === 20) payments.pay(pi, "requires_capture", FAN);
        },
      }),
    });
    expect(outcome).toEqual({ kind: "ticketed", token: tokenOf(pi) });
    expect(onSecuring).toHaveBeenCalledTimes(1);
    await webhook("payment_intent.amount_capturable_updated", pi);
    expect(await purchaseJobs(pi)).toHaveLength(1);
  });

  it("C: after a tap, card B authorized on the failed row, the confirmation lost: followed to its ticket", async () => {
    const { pi, slug, checkout: kept } = await declinedThen();
    const memory = createCheckoutMemory();
    memory.keep(slug, 1, kept);
    const deps = serverDeps(pi);
    deps.confirm = () => Promise.reject(new Error("the connection dropped"));
    const authorize: Authorize = async () => {
      payments.pay(pi, "requires_capture", FAN);
      return { ok: true };
    };
    const outcome = await runCheckout({ slug, qty: 1, authorize, signal, memory, deps });
    expect(outcome).toEqual({ kind: "ticketed", token: tokenOf(pi) });
    expect(payments.createCalls).toBe(1); // The first checkout only: no second payment.
    await webhook("payment_intent.amount_capturable_updated", pi);
    expect(await purchaseJobs(pi)).toHaveLength(1);
  });

  it("C, with a 502 and Stripe unreachable for the status read: unresolved, the payment kept", async () => {
    const { pi, slug, checkout: kept } = await declinedThen();
    const memory = createCheckoutMemory();
    memory.keep(slug, 1, kept);
    const deps = serverDeps(pi);
    const authorize: Authorize = async () => {
      payments.pay(pi, "requires_capture", FAN);
      // Stripe goes down right after: the confirmation answers 502, the heal reads nothing.
      payments.retrievePaymentIntent = async (): Promise<never> => {
        throw new PaymentGatewayError("Stripe is down");
      };
      return { ok: true };
    };
    const outcome = await runCheckout({ slug, qty: 1, authorize, signal, memory, deps });
    expect(outcome).toEqual({ kind: "unresolved" });
    // Kept: the next tap follows this payment instead of paying again.
    expect(memory.peek()).toEqual(kept);
    expect(deps.clock()).toBe(WAIT_LIMIT_SECONDS * 1000);
  });

  it("a genuinely declined card still ends at once after a tap, and lets an unseen pick-up go", async () => {
    const { pi, slug, checkout: kept } = await declinedThen();
    const memory = createCheckoutMemory();
    memory.keep(slug, 1, kept);
    const deps = serverDeps(pi);
    const outcome = await runCheckout({
      slug,
      qty: 1,
      authorize: () => Promise.resolve({ ok: false, message: "Your card was declined." }),
      signal,
      memory,
      deps,
    });
    expect(outcome).toEqual({ kind: "failed", message: "Your card was declined." });
    expect(deps.clock()).toBe(0);
    // The page lost after the decline: picked up, it lets the record go on the confirmation's word.
    const picked = await resumeCheckout({
      paymentIntentId: pi,
      authorized: false,
      signal,
      deps: serverDeps(pi),
    });
    expect(picked).toEqual({ kind: "gone" });
    expect(await purchaseJobs(pi)).toEqual([]);
  });
});

describe("B1: GET and the confirmation answer a failed payment with no purchase job on Stripe's word", () => {
  const processing: CheckoutStatusResponse = {
    status: "processing",
    ticketToken: null,
    message: null,
  };
  const declined: CheckoutStatusResponse = {
    status: "failed",
    ticketToken: null,
    message: CUSTOMER_MESSAGES.declined,
  };

  it("inside the heal's window, Stripe not asked: requires_payment, never the row's failed", async () => {
    const { pi } = await declinedThen("requires_capture");
    expect(await pollCheckoutStatus(db, payments, pi)).toEqual({
      status: "requires_payment",
      ticketToken: null,
      message: null,
    });
    expect(payments.retrieveCalls).toBe(1); // The webhook's own read only.
  });

  it.each([
    ["requires_action", processing],
    ["processing", processing],
    ["requires_capture", processing],
    ["requires_payment_method", declined],
    ["requires_confirmation", declined],
    ["canceled", declined],
  ] as const)("Stripe says %s: GET answers %o", async (stripe, expected) => {
    const { pi } = await declinedThen(stripe);
    await age(pi);
    expect(await pollCheckoutStatus(db, payments, pi)).toEqual(expected);
    // Once a window, as for a requires_payment row.
    expect(payments.retrieveCalls).toBe(2);
    await pollCheckoutStatus(db, payments, pi);
    expect(payments.retrieveCalls).toBe(2);
    expect(await purchaseJobs(pi)).toHaveLength(stripe === "requires_capture" ? 1 : 0);
    expect(await paymentRow(pi)).toMatchObject({
      status: stripe === "requires_capture" ? "processing" : "failed",
    });
  });

  it("Stripe unreachable or not matching: requires_payment, logged", async () => {
    const { pi } = await declinedThen("requires_capture");
    const read = payments.retrievePaymentIntent.bind(payments);
    payments.retrievePaymentIntent = async (): Promise<never> => {
      throw new PaymentGatewayError("Stripe is down");
    };
    await age(pi);
    expect((await pollCheckoutStatus(db, payments, pi)).status).toBe("requires_payment");
    expect(logged.some((entry) => entry.level === "error")).toBe(true);
    payments.retrievePaymentIntent = read;
    const intent = payments.intents.get(pi);
    if (!intent) throw new Error("missing intent");
    intent.amount = 1_000_000n;
    await age(pi);
    expect((await pollCheckoutStatus(db, payments, pi)).status).toBe("requires_payment");
    expect(await purchaseJobs(pi)).toEqual([]);
  });

  it.each([
    ["requires_action", processing],
    ["processing", processing],
    ["requires_payment_method", declined],
    ["requires_confirmation", declined],
  ] as const)("the confirmation, Stripe saying %s, answers %o", async (stripe, expected) => {
    const { pi } = await declinedThen(stripe);
    expect(await confirmCheckout(db, payments, pi)).toEqual(expected);
    expect(await paymentRow(pi)).toMatchObject({ status: "failed" });
    expect(await purchaseJobs(pi)).toEqual([]);
  });

  it("a failed payment whose purchase job exists is never re-taken: the engine's ending stands", async () => {
    const { pi } = await checkout();
    payments.pay(pi, "requires_capture", FAN);
    expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("enqueued");
    const [job] = await purchaseJobs(pi);
    // The engine failed it (it would cancel the authorization; left authorized here, to show that
    // even Stripe's requires_capture does not bring it back).
    await db`update payments set status = 'failed', message = 'The engine said no' where stripe_pi = ${pi}`;
    await age(pi, 3600);
    const reads = payments.retrieveCalls;
    for (let i = 0; i < 3; i += 1) {
      expect(await pollCheckoutStatus(db, payments, pi)).toEqual({
        status: "failed",
        ticketToken: null,
        message: "The engine said no",
      });
    }
    expect(payments.retrieveCalls).toBe(reads); // Never claimed by the heal.
    expect(await confirmCheckout(db, payments, pi)).toEqual({
      status: "failed",
      ticketToken: null,
      message: "The engine said no",
    });
    await webhook("payment_intent.amount_capturable_updated", pi);
    payments.pay(pi, "requires_action", FAN);
    expect((await confirmCheckout(db, payments, pi)).status).toBe("failed");
    expect(await purchaseJobs(pi)).toEqual([job]);
    expect(await paymentRow(pi)).toEqual({ status: "failed", message: "The engine said no" });
    expect(payments.cancelCalls).toEqual([]);
  });
});

describe("M1: a purchase intent abandoned at Stripe is cancelled lazily, by a read that finds it", () => {
  const PAST_BOUND = ABANDONED_PURCHASE_AFTER_SECONDS + 60;
  const BEFORE_BOUND = ABANDONED_PURCHASE_AFTER_SECONDS - 60;
  const cancelled: CheckoutStatusResponse = {
    status: "failed",
    ticketToken: null,
    message: CUSTOMER_MESSAGES.cancelled,
  };

  function cancelLogs(): number {
    return logged.filter((entry) => entry.message === "abandoned purchase cancelled at Stripe")
      .length;
  }

  it("is fifteen minutes", () => {
    expect(ABANDONED_PURCHASE_AFTER_SECONDS).toBe(15 * 60);
    expect([...ABANDONED_PURCHASE_STATUSES].sort()).toEqual([
      "requires_action",
      "requires_confirmation",
      "requires_payment_method",
    ]);
  });

  it.each(["requires_action", "requires_payment_method", "requires_confirmation"] as const)(
    "past the bound, Stripe saying %s: the status read cancels it and answers the ending",
    async (stripe) => {
      const { pi } = await checkout();
      payments.pay(pi, stripe, null);
      await created(pi, PAST_BOUND);
      expect(await pollCheckoutStatus(db, payments, pi)).toEqual(cancelled);
      expect(payments.cancelCalls).toEqual([{ id: pi, idempotencyKey: null }]);
      expect(payments.intents.get(pi)?.status).toBe("canceled");
      expect(await paymentRow(pi)).toEqual({
        status: "failed",
        message: CUSTOMER_MESSAGES.cancelled,
      });
      expect(cancelLogs()).toBe(1);
    },
  );

  it.each(["requires_action", "requires_payment_method", "requires_confirmation"] as const)(
    "past the bound, Stripe saying %s: the confirmation cancels it and answers the ending",
    async (stripe) => {
      const { pi } = await checkout();
      payments.pay(pi, stripe, null);
      await created(pi, PAST_BOUND);
      expect(await confirmCheckout(db, payments, pi)).toEqual(cancelled);
      expect(payments.cancelCalls).toHaveLength(1);
      expect(payments.intents.get(pi)?.status).toBe("canceled");
    },
  );

  it("a declined payment whose card B was left in 3-D Secure: cancelled, its message replaced", async () => {
    const { pi } = await declinedThen("requires_action");
    await created(pi, PAST_BOUND);
    expect(await pollCheckoutStatus(db, payments, pi)).toEqual(cancelled);
    expect(await paymentRow(pi)).toEqual({
      status: "failed",
      message: CUSTOMER_MESSAGES.cancelled,
    });
  });

  it("not before the bound", async () => {
    for (const stripe of ["requires_action", "requires_payment_method"] as const) {
      const { pi } = await checkout();
      payments.pay(pi, stripe, null);
      await created(pi, BEFORE_BOUND);
      expect((await pollCheckoutStatus(db, payments, pi)).status).toBe("requires_payment");
      expect((await confirmCheckout(db, payments, pi)).status).toBe(
        stripe === "requires_action" ? "processing" : "requires_payment",
      );
      expect(payments.intents.get(pi)?.status).toBe(stripe);
      expect(await paymentRow(pi)).toEqual({ status: "requires_payment", message: null });
    }
    expect(payments.cancelCalls).toEqual([]);
  });

  it("never with a purchase job, whatever Stripe says", async () => {
    for (const rowStatus of ["processing", "failed"] as const) {
      const { pi } = await checkout();
      payments.pay(pi, "requires_capture", FAN);
      expect((await processAuthorizedPurchase(db, payments, pi)).outcome).toBe("enqueued");
      await db`update payments set status = ${rowStatus} where stripe_pi = ${pi}`;
      // Contrived, to prove the job alone is enough: Stripe shows the intent waiting on the fan.
      payments.pay(pi, "requires_action", FAN);
      await created(pi, PAST_BOUND);
      await pollCheckoutStatus(db, payments, pi);
      await confirmCheckout(db, payments, pi);
      expect(payments.intents.get(pi)?.status).toBe("requires_action");
      expect(await paymentRow(pi)).toMatchObject({ status: rowStatus });
    }
    expect(payments.cancelCalls).toEqual([]);
  });

  it("never once authorized, nor while Stripe settles it", async () => {
    const authorized = await checkout();
    payments.pay(authorized.pi, "requires_capture", FAN);
    await created(authorized.pi, PAST_BOUND);
    expect((await pollCheckoutStatus(db, payments, authorized.pi)).status).toBe("processing");
    expect(await purchaseJobs(authorized.pi)).toHaveLength(1);

    const settling = await checkout();
    payments.pay(settling.pi, "processing", FAN);
    await created(settling.pi, PAST_BOUND);
    expect((await pollCheckoutStatus(db, payments, settling.pi)).status).toBe("requires_payment");
    expect((await confirmCheckout(db, payments, settling.pi)).status).toBe("processing");
    expect(payments.cancelCalls).toEqual([]);
  });

  it("Stripe failing on the cancellation: logged, nothing marked, answered as before", async () => {
    const { pi } = await checkout();
    payments.pay(pi, "requires_action", FAN);
    await created(pi, PAST_BOUND);
    payments.topUpFailure = new PaymentGatewayError("Stripe could not cancel");
    expect((await pollCheckoutStatus(db, payments, pi)).status).toBe("requires_payment");
    expect(await confirmCheckout(db, payments, pi)).toEqual({
      status: "processing",
      ticketToken: null,
      message: null,
    });
    expect(payments.cancelCalls).toHaveLength(2);
    expect(payments.intents.get(pi)?.status).toBe("requires_action");
    expect(await paymentRow(pi)).toEqual({ status: "requires_payment", message: null });
    expect(
      logged.filter(
        (entry) =>
          entry.level === "error" &&
          entry.message === "abandoned purchase could not be cancelled at Stripe: left as it is",
      ),
    ).toHaveLength(2);
    expect(cancelLogs()).toBe(0);

    // Stripe back: the next read cancels it.
    payments.topUpFailure = null;
    expect(await confirmCheckout(db, payments, pi)).toEqual(cancelled);
  });

  it.each(["status read", "confirmation"] as const)(
    "Stripe refusing the cancellation because the fan is paying it now: the %s answers processing, never the decline",
    async (reader) => {
      // Card A declined, card B left in 3-D Secure for 15 minutes, then paid right as we cancel.
      const { pi } = await declinedThen("requires_action");
      await created(pi, PAST_BOUND);
      const cancel = payments.cancelUnpaidPaymentIntent.bind(payments);
      payments.cancelUnpaidPaymentIntent = async (id: string, key?: string) => {
        // Between our read (requires_action) and the cancellation, the payment starts at Stripe.
        payments.pay(id, "processing", FAN);
        return cancel(id, key);
      };
      const answer =
        reader === "status read"
          ? await pollCheckoutStatus(db, payments, pi)
          : await confirmCheckout(db, payments, pi);
      // Not the row's « declined, not charged »: Stripe is settling a payment.
      expect(answer).toEqual({ status: "processing", ticketToken: null, message: null });
      expect(payments.cancelCalls).toHaveLength(1);
      expect(payments.intents.get(pi)?.status).toBe("processing");
      expect(await paymentRow(pi)).toEqual({
        status: "failed",
        message: CUSTOMER_MESSAGES.declined,
      });
      expect(cancelLogs()).toBe(0);
    },
  );

  it("a cancellation landing after the webhook took an approval: not charged, logged as an error", async () => {
    const { pi } = await declinedThen("requires_action");
    await created(pi, PAST_BOUND);
    const cancel = payments.cancelUnpaidPaymentIntent.bind(payments);
    payments.cancelUnpaidPaymentIntent = async (id: string, key?: string) => {
      // Between our read and the cancellation: the fan approves, the webhook takes the purchase.
      payments.pay(id, "requires_capture", FAN);
      await webhook("payment_intent.amount_capturable_updated", id);
      return cancel(id, key);
    };
    expect((await pollCheckoutStatus(db, payments, pi)).status).toBe("processing");
    // Stripe released the authorization: it can never be captured, the fan is never charged.
    expect(payments.intents.get(pi)?.status).toBe("canceled");
    // One job, the engine's; the row stays its.
    expect(await purchaseJobs(pi)).toHaveLength(1);
    expect(await paymentRow(pi)).toMatchObject({ status: "processing" });
    expect(
      logged.filter(
        (entry) =>
          entry.level === "error" &&
          entry.message ===
            "abandoned purchase cancelled at Stripe after its purchase job was taken: the capture will fail, the fan is not charged",
      ),
    ).toHaveLength(1);
  });

  it("the pick-up of an abandoned 3-D Secure lets go, and the next tap pays a new intent once", async () => {
    const { pi, slug, checkout: kept } = await checkout();
    payments.pay(pi, "requires_action", FAN);
    await created(pi, PAST_BOUND);
    const onSecuring = vi.fn();
    expect(
      await resumeCheckout({
        paymentIntentId: pi,
        authorized: false,
        signal,
        onSecuring,
        deps: serverDeps(pi),
      }),
    ).toEqual({ kind: "gone" });
    expect(onSecuring).not.toHaveBeenCalled();
    expect(payments.intents.get(pi)?.status).toBe("canceled");

    // The sheet that kept the intent: Stripe says it is over (`ended`), so one new purchase.
    const memory = createCheckoutMemory();
    memory.keep(slug, 1, kept);
    const authorize: Authorize = async (attempt) => {
      if (payments.intents.get(attempt.paymentIntentId)?.status === "canceled") {
        return { ok: false, message: "This payment was cancelled.", ended: true };
      }
      payments.pay(attempt.paymentIntentId, "requires_capture", FAN);
      return { ok: true };
    };
    let paid: string | null = null;
    const deps = serverDeps(() => paid ?? pi);
    const outcome = await runCheckout({
      slug,
      qty: 1,
      authorize,
      signal,
      memory,
      onPayment: (attempt) => {
        paid = attempt.paymentIntentId;
      },
      deps,
    });
    expect(paid).not.toBe(pi);
    expect(outcome).toEqual({ kind: "ticketed", token: tokenOf(paid ?? "") });
    expect(payments.createCalls).toBe(2);
  });
});
