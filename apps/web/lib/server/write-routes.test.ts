import { randomUUID } from "node:crypto";

import {
  JOB_KINDS,
  apiErrorSchema,
  campaignActionResponseSchema,
  checkoutResponseSchema,
  checkoutStatusResponseSchema,
  createCampaignResponseSchema,
  jobIdempotencyKey,
  webhookAckSchema,
} from "@winz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as postCampaigns } from "@/app/api/campaigns/route";
import { POST as postClose } from "@/app/api/campaigns/[id]/close/route";
import { POST as postPause } from "@/app/api/campaigns/[id]/pause/route";
import { POST as postResume } from "@/app/api/campaigns/[id]/resume/route";
import { POST as postCheckout } from "@/app/api/checkout/route";
import { GET as getCheckout } from "@/app/api/checkout/[pi]/route";
import { POST as postConfirm } from "@/app/api/checkout/[pi]/confirm/route";
import { POST as postStripe } from "@/app/api/webhooks/stripe/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import type { Db } from "./db";
import { setServerDepsForTesting } from "./deps";
import { FakePaymentGateway, signStripeBody, stripeEventBody } from "./testing/fake-payments";
import {
  FakeIdentity,
  cryptoWordsIn,
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  minutesFrom,
  randomWallet,
  serverDepsFor,
} from "./testing/fixtures";

/**
 * The write routes end to end through their Next.js handlers: authentication by the fake identity
 * provider, a real Postgres, the fake payment gateway, and webhooks signed and verified with
 * Stripe's own code.
 */

const now = new Date();
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";
const JOE = { authorization: "Bearer joe-token" };
const ANN = { authorization: "Bearer ann-token" };
const TERMS = {
  instrumentSymbol: SYMBOL,
  product: "Large pizza",
  unitPrice: "20000000",
  refundBps: 10_000,
  usualMarginBps: 6500,
  minMarginBps: 4500,
  budget: "1000000000",
};

/** The body of one "Fund" tap: the terms under a fresh `requestId`, as the front sends them. */
function fundTap(): typeof TERMS & { requestId: string } {
  return { ...TERMS, requestId: randomUUID() };
}

let database: TestDatabase;
let db: Db;
let joeMerchant: string;
const identity = new FakeIdentity();
const payments = new FakePaymentGateway();

function params(values: Record<string, string> = {}): {
  params: Promise<Record<string, string>>;
} {
  return { params: Promise.resolve(values) };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function webhook(body: string, signature: string | null = signStripeBody(body)): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["stripe-signature"] = signature;
  return new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers, body });
}

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

async function snapshot(): Promise<unknown> {
  const [jobs, paymentsRows, campaigns] = await Promise.all([
    db`select kind, idempotency_key, payload, status from jobs order by idempotency_key`,
    db`select stripe_pi, status, email, message from payments order by stripe_pi`,
    db`select id, status, sale_state, budget_pi from campaigns order by id`,
  ]);
  return { jobs, paymentsRows, campaigns };
}

async function campaignsOfRequest(
  requestId: string,
): Promise<{ id: string; status: string; budget_pi: string | null }[]> {
  return db<{ id: string; status: string; budget_pi: string | null }[]>`
    select id, status, budget_pi from campaigns where request_id = ${requestId}
  `;
}

async function jobsWithKey(key: string): Promise<number> {
  const [row] = await db<{ n: bigint }[]>`
    select count(*)::bigint as n from jobs where idempotency_key = ${key}
  `;
  return Number(row?.n ?? 0n);
}

async function liveCampaign(slug: string): Promise<string> {
  return insertCampaign(db, {
    merchantId: joeMerchant,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose: minutesFrom(now, 595),
    slug,
  });
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV", startsAt: minutesFrom(now, 600) });
  await insertInstrument(db, { symbol: SYMBOL, eventTicker: "EV", label: "Texas wins by 14+" });
  joeMerchant = (await insertMerchant(db, { email: "joe@example.com", privyId: "did:privy:joe" }))
    .merchantId;
  await insertMerchant(db, { email: "ann@example.com", privyId: "did:privy:ann", name: "Ann's" });
  identity.addUser("joe-token", "did:privy:joe", {
    email: "joe@example.com",
    walletAddress: randomWallet(),
  });
  identity.addUser("ann-token", "did:privy:ann", {
    email: "ann@example.com",
    walletAddress: randomWallet(),
  });
  setServerDepsForTesting(serverDepsFor(db, identity, now, payments));
});

afterAll(async () => {
  setServerDepsForTesting(undefined);
  await database.drop();
});

describe("campaign creation and its budget webhook", () => {
  it("creates the campaign, then enqueues its creation once when the budget is paid", async () => {
    const response = await postCampaigns(post("/api/campaigns", fundTap(), JOE), params());
    expect(response.status).toBe(200);
    const created = createCampaignResponseSchema.parse(await json(response));
    expect(created.status).toBe("funding");

    const pi = created.budgetPayment.paymentIntentId;
    const intent = payments.pay(pi, "succeeded", "joe@example.com");
    const body = stripeEventBody("payment_intent.succeeded", intent);
    for (let i = 0; i < 3; i += 1) {
      const ack = await postStripe(webhook(body), params());
      expect(ack.status).toBe(200);
      expect(webhookAckSchema.parse(await json(ack))).toEqual({ received: true });
    }
    expect(await jobsWithKey(jobIdempotencyKey.createCampaign(created.campaignId))).toBe(1);
    const [job] = await db`
      select kind, payload from jobs
      where idempotency_key = ${jobIdempotencyKey.createCampaign(created.campaignId)}
    `;
    expect(job).toEqual({
      kind: JOB_KINDS.createCampaign,
      payload: { campaignId: created.campaignId },
    });
    // The status only changes when the engine projects the on-chain creation.
    const [row] = await db`select status from campaigns where id = ${created.campaignId}`;
    expect(row?.status).toBe("funding");
  });

  it("ignores a budget payment that is not the campaign's own", async () => {
    const response = await postCampaigns(post("/api/campaigns", fundTap(), JOE), params());
    const created = createCampaignResponseSchema.parse(await json(response));
    const other = await postCampaigns(post("/api/campaigns", fundTap(), JOE), params());
    const otherCreated = createCampaignResponseSchema.parse(await json(other));

    // A paid intent of the second campaign, claiming to fund the first.
    const body = stripeEventBody("payment_intent.succeeded", {
      id: otherCreated.budgetPayment.paymentIntentId,
      status: "succeeded",
      amount: 1_000_000_000n,
      metadata: { kind: "campaign_budget", campaignId: created.campaignId },
    });
    const ack = await postStripe(webhook(body), params());
    expect(ack.status).toBe(200);
    expect(await jobsWithKey(jobIdempotencyKey.createCampaign(created.campaignId))).toBe(0);

    // The right intent for a campaign that is no longer funding: ignored as well.
    await db`update campaigns set status = 'live' where id = ${created.campaignId}`;
    const late = stripeEventBody("payment_intent.succeeded", {
      id: created.budgetPayment.paymentIntentId,
      status: "succeeded",
      amount: 1_000_000_000n,
      metadata: { kind: "campaign_budget", campaignId: created.campaignId },
    });
    expect((await postStripe(webhook(late), params())).status).toBe(200);
    expect(await jobsWithKey(jobIdempotencyKey.createCampaign(created.campaignId))).toBe(0);
  });

  it("ignores a budget payment whose amount differs from the campaign budget", async () => {
    const response = await postCampaigns(post("/api/campaigns", fundTap(), JOE), params());
    const created = createCampaignResponseSchema.parse(await json(response));
    const pi = created.budgetPayment.paymentIntentId;
    payments.pay(pi, "succeeded", "joe@example.com");

    for (const amount of [999_990_000n, 1_000_010_000n]) {
      const body = stripeEventBody("payment_intent.succeeded", {
        id: pi,
        status: "succeeded",
        amount,
        metadata: { kind: "campaign_budget", campaignId: created.campaignId },
      });
      expect((await postStripe(webhook(body), params())).status).toBe(200);
    }
    expect(await jobsWithKey(jobIdempotencyKey.createCampaign(created.campaignId))).toBe(0);

    // The exact budget is enqueued.
    const exact = stripeEventBody("payment_intent.succeeded", {
      id: pi,
      status: "succeeded",
      amount: 1_000_000_000n,
      metadata: { kind: "campaign_budget", campaignId: created.campaignId },
    });
    expect((await postStripe(webhook(exact), params())).status).toBe(200);
    expect(await jobsWithKey(jobIdempotencyKey.createCampaign(created.campaignId))).toBe(1);
  });

  it("refuses a price that is not whole cents, creating nothing", async () => {
    const before = await snapshot();
    const callsBefore = payments.createCalls;
    const response = await postCampaigns(
      post("/api/campaigns", { ...fundTap(), unitPrice: "20000001" }, JOE),
      params(),
    );
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await json(response)).error).toEqual({
      code: "invalid_request",
      message: "Invalid body.unitPrice: must be a whole number of cents",
    });
    expect(await snapshot()).toEqual(before);
    expect(payments.createCalls).toBe(callsBefore);
  });

  it("leaves no paid campaign and no job when the gateway fails, and its retry makes one", async () => {
    const body = fundTap();
    const before = await campaignsOfRequest(body.requestId);
    payments.failure = new Error("network down");
    try {
      const response = await postCampaigns(post("/api/campaigns", body, JOE), params());
      expect(response.status).toBe(500);
    } finally {
      payments.failure = null;
    }
    expect(before).toEqual([]);
    // Only the request's claim remains, without a payment, for its retry to find.
    const claimed = await campaignsOfRequest(body.requestId);
    expect(claimed).toEqual([{ id: claimed[0]?.id, status: "funding", budget_pi: null }]);
    expect(await jobsWithKey(jobIdempotencyKey.createCampaign(claimed[0]?.id ?? ""))).toBe(0);

    const retried = await postCampaigns(post("/api/campaigns", body, JOE), params());
    expect(retried.status).toBe(200);
    const created = createCampaignResponseSchema.parse(await json(retried));
    expect(await campaignsOfRequest(body.requestId)).toEqual([
      {
        id: created.campaignId,
        status: "funding",
        budget_pi: created.budgetPayment.paymentIntentId,
      },
    ]);
  });

  it("needs a merchant", async () => {
    const response = await postCampaigns(post("/api/campaigns", fundTap()), params());
    expect(response.status).toBe(401);
  });
});

describe("webhook signature", () => {
  it("answers 400 to a bad or missing signature and changes nothing", async () => {
    const id = await liveCampaign("sig-promo");
    const checkout = checkoutResponseSchema.parse(
      await json(
        await postCheckout(post("/api/checkout", { slug: "sig-promo", qty: 1 }), params()),
      ),
    );
    const intent = payments.pay(checkout.paymentIntentId, "requires_capture", "fan@example.com");
    const body = stripeEventBody("payment_intent.amount_capturable_updated", intent);
    const before = await snapshot();

    for (const signature of [signStripeBody(body, "whsec_attacker"), null, "garbage"]) {
      const response = await postStripe(webhook(body, signature), params());
      expect(response.status).toBe(400);
      expect(apiErrorSchema.parse(await json(response)).error.code).toBe("invalid_request");
    }
    // A body changed after signing.
    const tampered = body.replace(intent.id, `${intent.id}x`);
    expect((await postStripe(webhook(tampered, signStripeBody(body)), params())).status).toBe(400);

    expect(await snapshot()).toEqual(before);
    expect(await jobsWithKey(jobIdempotencyKey.purchase(checkout.paymentIntentId))).toBe(0);
    expect(id).toBeTruthy();
  });

  it("acknowledges a signed PaymentIntent event it cannot read instead of failing forever", async () => {
    const before = await snapshot();
    const intentObject = (status: string): Record<string, unknown> => ({
      id: "pi_odd",
      object: "payment_intent",
      status,
      amount: 2000,
      currency: "usd",
      metadata: { kind: "purchase", campaignId: "x", qty: "1" },
    });
    const bodies = [
      // An event type this server does not handle, with a status it does not know.
      { id: "evt_odd_1", type: "payment_intent.created", object: intentObject("brand_new") },
      // A handled event type whose object does not parse.
      {
        id: "evt_odd_2",
        type: "payment_intent.payment_failed",
        object: intentObject("brand_new"),
      },
      {
        id: "evt_odd_3",
        type: "payment_intent.amount_capturable_updated",
        object: { ...intentObject("requires_capture"), amount: "lots" },
      },
    ].map(({ id, type, object }) =>
      JSON.stringify({ id, object: "event", type, data: { object } }),
    );
    for (const body of bodies) {
      const response = await postStripe(webhook(body), params());
      expect(response.status).toBe(200);
      expect(webhookAckSchema.parse(await json(response))).toEqual({ received: true });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("acknowledges and ignores other event types", async () => {
    const before = await snapshot();
    const body = JSON.stringify({
      id: "evt_other",
      object: "event",
      type: "charge.refunded",
      data: { object: { id: "ch_1", object: "charge" } },
    });
    const response = await postStripe(webhook(body), params());
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ received: true });
    expect(await snapshot()).toEqual(before);
  });
});

describe("checkout end to end", () => {
  it("a replayed webhook plus the client confirmation create exactly one job", async () => {
    await liveCampaign("replay-promo");
    const response = await postCheckout(
      post("/api/checkout", { slug: "replay-promo", qty: 2 }),
      params(),
    );
    expect(response.status).toBe(200);
    const checkout = checkoutResponseSchema.parse(await json(response));
    expect(checkout.amount).toBe("40000000");
    const pi = checkout.paymentIntentId;

    // Before authorization: confirm changes nothing and answers requires_payment.
    const early = await postConfirm(post(`/api/checkout/${pi}/confirm`, ""), params({ pi }));
    expect(checkoutStatusResponseSchema.parse(await json(early)).status).toBe("requires_payment");

    const intent = payments.pay(pi, "requires_capture", "Fan@Example.com");
    const body = stripeEventBody("payment_intent.amount_capturable_updated", intent);
    const answers = await Promise.all([
      postStripe(webhook(body), params()),
      postConfirm(post(`/api/checkout/${pi}/confirm`, ""), params({ pi })),
      postStripe(webhook(body), params()),
      postConfirm(post(`/api/checkout/${pi}/confirm`, ""), params({ pi })),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200]);
    const confirmed = checkoutStatusResponseSchema.parse(await json(answers[1] as Response));
    expect(confirmed).toEqual({ status: "processing", ticketToken: null, message: null });
    expect(await jobsWithKey(jobIdempotencyKey.purchase(pi))).toBe(1);

    const status = await getCheckout(
      new Request(`http://localhost/api/checkout/${pi}`),
      params({ pi }),
    );
    const polled = checkoutStatusResponseSchema.parse(await json(status));
    expect(polled.status).toBe("processing");
    for (const payload of [checkout, confirmed, polled]) {
      expect(cryptoWordsIn(payload)).toEqual([]);
      expect(JSON.stringify(payload)).not.toContain("fan@example.com");
    }
    const [row] = await db`select email, status from payments where stripe_pi = ${pi}`;
    expect(row).toEqual({ email: "fan@example.com", status: "processing" });
  });

  it("marks the payment failed on cancellation or a failed attempt, never once ticketed", async () => {
    await liveCampaign("fail-promo");
    const pis: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await postCheckout(
        post("/api/checkout", { slug: "fail-promo", qty: 1 }),
        params(),
      );
      pis.push(checkoutResponseSchema.parse(await json(response)).paymentIntentId);
    }
    const [cancelled, declined, ticketed] = pis as [string, string, string];
    await db`update payments set status = 'ticketed' where stripe_pi = ${ticketed}`;

    const send = async (type: string, pi: string): Promise<void> => {
      const intent = payments.pay(
        pi,
        type === "payment_intent.canceled" ? "canceled" : "requires_payment_method",
        null,
      );
      const response = await postStripe(webhook(stripeEventBody(type, intent)), params());
      expect(response.status).toBe(200);
    };
    await send("payment_intent.canceled", cancelled);
    await send("payment_intent.payment_failed", declined);
    await send("payment_intent.canceled", ticketed);

    const rows = await db<{ stripe_pi: string; status: string; message: string | null }[]>`
      select stripe_pi, status, message from payments where stripe_pi in ${db(pis)}
    `;
    expect(
      Object.fromEntries(rows.map((row) => [row.stripe_pi, [row.status, row.message]])),
    ).toEqual({
      [cancelled]: ["failed", "Your payment was cancelled, you were not charged"],
      [declined]: ["failed", "Your payment did not go through, you were not charged"],
      [ticketed]: ["ticketed", null],
    });

    // A `failed` payment with no purchase job is answered on Stripe's word: the confirmation reads
    // Stripe on every call; the status read reads it once its 5 s window has passed and answers
    // `requires_payment` until then (another card may have paid the same intent since).
    const confirmed = async (pi: string): Promise<unknown> =>
      json(await postConfirm(post(`/api/checkout/${pi}/confirm`, ""), params({ pi })));
    const cancelledStatus = checkoutStatusResponseSchema.parse(await confirmed(cancelled));
    expect(cancelledStatus).toEqual({
      status: "failed",
      ticketToken: null,
      message: "Your payment was cancelled, you were not charged",
    });
    const declinedStatus = checkoutStatusResponseSchema.parse(await confirmed(declined));
    expect(declinedStatus).toEqual({
      status: "failed",
      ticketToken: null,
      message: "Your payment did not go through, you were not charged",
    });
    expect(cryptoWordsIn([cancelledStatus, declinedStatus])).toEqual([]);
    const polled = checkoutStatusResponseSchema.parse(
      await json(
        await getCheckout(
          new Request(`http://localhost/api/checkout/${declined}`),
          params({ pi: declined }),
        ),
      ),
    );
    expect(polled).toEqual({ status: "requires_payment", ticketToken: null, message: null });
  });

  it("a late failure event never fails a payment that was authorized since", async () => {
    await liveCampaign("stale-promo");
    const pis: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const response = await postCheckout(
        post("/api/checkout", { slug: "stale-promo", qty: 1 }),
        params(),
      );
      pis.push(checkoutResponseSchema.parse(await json(response)).paymentIntentId);
    }
    const [confirmed, pending] = pis as [string, string];

    // Attempt 1 is declined; its event reaches us only later (Stripe retried it after a 500).
    const declined = stripeEventBody(
      "payment_intent.payment_failed",
      payments.pay(confirmed, "requires_payment_method", null),
    );
    // Attempt 2 is authorized and confirmed by the front: the purchase job is queued.
    payments.pay(confirmed, "requires_capture", "fan@example.com");
    const confirm = await postConfirm(
      post(`/api/checkout/${confirmed}/confirm`, ""),
      params({ pi: confirmed }),
    );
    expect(checkoutStatusResponseSchema.parse(await json(confirm)).status).toBe("processing");

    // And a cancellation event for it that Stripe does not confirm (forged order, stale copy).
    const lateCancel = stripeEventBody("payment_intent.canceled", {
      id: confirmed,
      status: "canceled",
      amount: 20_000_000n,
      metadata: { kind: "purchase", campaignId: "x", qty: "1" },
    });
    for (const body of [declined, lateCancel]) {
      expect((await postStripe(webhook(body), params())).status).toBe(200);
    }
    const status = checkoutStatusResponseSchema.parse(
      await json(
        await getCheckout(
          new Request(`http://localhost/api/checkout/${confirmed}`),
          params({ pi: confirmed }),
        ),
      ),
    );
    expect(status).toEqual({ status: "processing", ticketToken: null, message: null });
    const [job] = await db`
      select status from jobs where idempotency_key = ${jobIdempotencyKey.purchase(confirmed)}
    `;
    expect(job?.status).toBe("queued");

    // A failure event whose intent Stripe already shows as authorized, with no job yet: ignored
    // as well; the authorization path takes the payment.
    const stale = stripeEventBody(
      "payment_intent.payment_failed",
      payments.pay(pending, "requires_payment_method", null),
    );
    payments.pay(pending, "requires_capture", "fan@example.com");
    expect((await postStripe(webhook(stale), params())).status).toBe(200);
    const [row] = await db`select status from payments where stripe_pi = ${pending}`;
    expect(row?.status).toBe("requires_payment");
  });

  it("answers 404 for an unknown payment on both status routes", async () => {
    const pi = "pi_does_not_exist";
    const confirm = await postConfirm(post(`/api/checkout/${pi}/confirm`, ""), params({ pi }));
    expect(confirm.status).toBe(404);
    const status = await getCheckout(
      new Request(`http://localhost/api/checkout/${pi}`),
      params({ pi }),
    );
    expect(status.status).toBe(404);
  });

  it("a webhook for an unknown purchase is acknowledged and creates nothing", async () => {
    const before = await snapshot();
    const body = stripeEventBody("payment_intent.amount_capturable_updated", {
      id: "pi_foreign",
      status: "requires_capture",
      amount: 20_000_000n,
      metadata: { kind: "purchase", campaignId: "x", qty: "1" },
    });
    expect((await postStripe(webhook(body), params())).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });
});

describe("manual actions through the routes", () => {
  it("a merchant cannot pause another merchant's campaign", async () => {
    const id = await liveCampaign("joes-own");
    for (const handler of [postPause, postResume, postClose]) {
      const response = await handler(post(`/api/campaigns/${id}/x`, "", ANN), params({ id }));
      expect(response.status).toBe(404);
    }
    const [row] = await db`select sale_state from campaigns where id = ${id}`;
    expect(row?.sale_state).toBe("open");
    const [jobs] = await db<{ n: bigint }[]>`
      select count(*)::bigint as n from jobs where payload ->> 'campaignId' = ${id}
    `;
    expect(jobs?.n).toBe(0n);
  });

  it("pause blocks checkout at once; resume and close answer the stored state", async () => {
    const id = await liveCampaign("pause-promo");
    const paused = await postPause(post(`/api/campaigns/${id}/pause`, "", JOE), params({ id }));
    expect(paused.status).toBe(200);
    expect(campaignActionResponseSchema.parse(await json(paused))).toEqual({
      status: "live",
      saleState: "paused_manual",
    });

    const callsBefore = payments.createCalls;
    const refused = await postCheckout(
      post("/api/checkout", { slug: "pause-promo", qty: 1 }),
      params(),
    );
    expect(refused.status).toBe(409);
    const error = apiErrorSchema.parse(await json(refused)).error;
    expect(error.code).toBe("sales_paused");
    expect(cryptoWordsIn(error)).toEqual([]);
    expect(payments.createCalls).toBe(callsBefore);
    const [count] = await db<{ n: bigint }[]>`
      select count(*)::bigint as n from payments where campaign_id = ${id}
    `;
    expect(count?.n).toBe(0n);

    const again = await postPause(post(`/api/campaigns/${id}/pause`, "", JOE), params({ id }));
    expect(again.status).toBe(409);
    expect(apiErrorSchema.parse(await json(again)).error.code).toBe("conflict");

    const resumed = await postResume(post(`/api/campaigns/${id}/resume`, "", JOE), params({ id }));
    expect(campaignActionResponseSchema.parse(await json(resumed))).toEqual({
      status: "live",
      saleState: "paused_manual",
    });
    const closed = await postClose(post(`/api/campaigns/${id}/close`, "", JOE), params({ id }));
    expect(campaignActionResponseSchema.parse(await json(closed))).toEqual({
      status: "live",
      saleState: "closed",
    });
    const kinds = await db<{ kind: string; paused: string | null }[]>`
      select kind, payload ->> 'paused' as paused from jobs
      where payload ->> 'campaignId' = ${id}
      order by created_at, id
    `;
    expect(kinds).toEqual([
      { kind: JOB_KINDS.setPaused, paused: "true" },
      { kind: JOB_KINDS.setPaused, paused: "false" },
      { kind: JOB_KINDS.closeSales, paused: null },
    ]);
    const closedCheckout = await postCheckout(
      post("/api/checkout", { slug: "pause-promo", qty: 1 }),
      params(),
    );
    expect(apiErrorSchema.parse(await json(closedCheckout)).error.code).toBe("sales_closed");
  });
});

describe("database failure", () => {
  it("answers 500 to a webhook so Stripe retries", async () => {
    const broken = await createTestDatabase();
    await broken.drop();
    setServerDepsForTesting(serverDepsFor(broken.db, identity, now, payments));
    try {
      const body = stripeEventBody("payment_intent.succeeded", {
        id: "pi_any",
        status: "succeeded",
        amount: 1_000_000_000n,
        metadata: { kind: "campaign_budget", campaignId: "6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d" },
      });
      const response = await postStripe(webhook(body), params());
      expect(response.status).toBe(500);
      expect(apiErrorSchema.parse(await json(response)).error.code).toBe("internal");
    } finally {
      setServerDepsForTesting(serverDepsFor(db, identity, now, payments));
    }
  });
});
