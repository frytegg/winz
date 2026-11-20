import { randomUUID } from "node:crypto";

import {
  JOB_KINDS,
  STRIPE_PAYMENT_KINDS,
  apiErrorSchema,
  apiExamples,
  jobIdempotencyKey,
  topUpCampaignResponseSchema,
  webhookAckSchema,
  type ApiError,
  type TopUpCampaignResponse,
} from "@winz/shared";
import type { TransactionSql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as postTopUp } from "@/app/api/campaigns/[id]/top-up/route";
import { GET as getCheckout } from "@/app/api/checkout/[pi]/route";
import { POST as postStripe } from "@/app/api/webhooks/stripe/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  MAX_ROUNDS,
  TOP_UP_CONFLICTS,
  TOP_UP_MESSAGES,
  TOP_UP_OVER_MESSAGE,
  topUpCampaign,
} from "./budget-top-up";
import { MAX_CARD_AMOUNT } from "./campaign-writes";
import { findSellableCampaign } from "./checkout";
import type { Db } from "./db";
import { setServerDepsForTesting } from "./deps";
import { PaymentGatewayError, type PaymentGateway } from "./payments-gateway";
import { ApiRouteError } from "./route";
import {
  FakePaymentGateway,
  signStripeBody,
  stripeEventBody,
  type FakeIntent,
} from "./testing/fake-payments";
import {
  FakeIdentity,
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  minutesFrom,
  randomWallet,
  serverDepsFor,
  type CampaignInput,
} from "./testing/fixtures";

/**
 * POST /api/campaigns/:id/top-up and its webhooks (SPEC CA-6, task A-08), through the Next.js
 * handlers: authentication by the fake identity provider, a real Postgres with every migration,
 * the fake payment gateway, and webhooks signed and verified with Stripe's own code.
 */

const now = new Date();
const SYMBOL = "GEMI-NCAAF-TOPUP-S-TEX13";
const JOE = { authorization: "Bearer joe-token" };
const ANN = { authorization: "Bearer ann-token" };
const FIVE_HUNDRED = 500_000_000n;

let database: TestDatabase;
let db: Db;
let joeMerchant: string;
let payments: FakePaymentGateway;
let nextOnchainId = 1n;
const identity = new FakeIdentity();

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

function webhook(body: string): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signStripeBody(body) },
    body,
  });
}

async function topUp(
  campaignId: string,
  body: unknown,
  headers: Record<string, string> = JOE,
): Promise<Response> {
  return postTopUp(
    post(`/api/campaigns/${campaignId}/top-up`, body, headers),
    params({ id: campaignId }),
  );
}

async function topUpOk(
  campaignId: string,
  amount: bigint = FIVE_HUNDRED,
  requestId: string = randomUUID(),
): Promise<TopUpCampaignResponse> {
  const response = await topUp(campaignId, { amount: amount.toString(), requestId });
  const payload: unknown = await response.json();
  expect(response.status, JSON.stringify(payload)).toBe(200);
  return topUpCampaignResponseSchema.parse(payload);
}

async function refusal(response: Response): Promise<{ status: number; error: ApiError["error"] }> {
  return { status: response.status, error: apiErrorSchema.parse(await response.json()).error };
}

async function liveCampaign(input: Partial<CampaignInput> = {}): Promise<string> {
  nextOnchainId += 1n;
  return insertCampaign(db, {
    merchantId: joeMerchant,
    instrument: SYMBOL,
    eventTicker: "EV-TOPUP",
    salesClose: minutesFrom(now, 595),
    onchainId: nextOnchainId,
    slug: `joes-topup-${nextOnchainId.toString()}`,
    ...input,
  });
}

interface TopUpDbRow {
  request_id: string;
  campaign_id: string;
  stripe_pi: string;
  amount: bigint;
  status: string;
  message: string | null;
}

async function topUpRows(campaignId: string): Promise<TopUpDbRow[]> {
  return db<TopUpDbRow[]>`
    select request_id, campaign_id, stripe_pi, amount, status, message from budget_top_ups
    where campaign_id = ${campaignId}
    order by created_at
  `;
}

async function topUpJobs(
  campaignId: string,
): Promise<{ payload: unknown; idempotency_key: string }[]> {
  return db<{ payload: unknown; idempotency_key: string }[]>`
    select payload, idempotency_key from jobs
    where kind = ${JOB_KINDS.topUpBudget} and payload ->> 'campaignId' = ${campaignId}
  `;
}

async function campaignState(
  campaignId: string,
): Promise<{ budget: bigint; status: string; sale_state: string }> {
  const [row] = await db<{ budget: bigint; status: string; sale_state: string }[]>`
    select budget, status, sale_state from campaigns where id = ${campaignId}
  `;
  if (!row) throw new Error(`no campaign ${campaignId}`);
  return row;
}

/** Delivers a signed Stripe event of the intent as the fake holds it now. */
async function deliver(type: string, paymentIntentId: string): Promise<void> {
  const intent = payments.intents.get(paymentIntentId);
  if (!intent) throw new Error(`no fake intent ${paymentIntentId}`);
  const response = await postStripe(webhook(stripeEventBody(type, intent)), params());
  expect(response.status).toBe(200);
  expect(webhookAckSchema.parse(await response.json())).toEqual({ received: true });
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV-TOPUP", startsAt: minutesFrom(now, 600) });
  await insertInstrument(db, { symbol: SYMBOL, eventTicker: "EV-TOPUP", label: "Texas wins" });
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
});

function useGateway(gateway: PaymentGateway): void {
  setServerDepsForTesting(serverDepsFor(db, identity, now, gateway));
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (payments !== undefined) {
    payments.failure = null;
    payments.topUpFailure = null;
  }
});

afterAll(async () => {
  setServerDepsForTesting(undefined);
  await database?.drop();
});

/** A fresh gateway for each test, so call counts and failures never leak between tests. */
function freshGateway(): FakePaymentGateway {
  payments = new FakePaymentGateway();
  useGateway(payments);
  return payments;
}

describe("POST /api/campaigns/:id/top-up: the payment", () => {
  it("creates the card payment as the first budget's, and answers what the sheet needs", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const answer = await topUpOk(campaignId, FIVE_HUNDRED, requestId);

    expect(answer).toMatchObject({
      campaignId,
      requestId,
      amount: "500000000",
      budgetPayment: { amount: "500000000" },
    });
    const intent = payments.intents.get(answer.budgetPayment.paymentIntentId);
    expect(intent).toMatchObject({
      amount: FIVE_HUNDRED,
      currency: "usd",
      status: "requires_payment_method",
      captureMethod: "automatic",
      clientSecret: answer.budgetPayment.clientSecret,
      idempotencyKey: `campaign_budget_top_up:${requestId}`,
      metadata: { kind: STRIPE_PAYMENT_KINDS.campaignBudgetTopUp, campaignId, requestId },
    });
    expect(await topUpRows(campaignId)).toEqual([
      {
        request_id: requestId,
        campaign_id: campaignId,
        stripe_pi: answer.budgetPayment.paymentIntentId,
        amount: FIVE_HUNDRED,
        status: "requires_payment",
        message: null,
      },
    ]);
    // Nothing is enqueued and nothing of the campaign changes before the card is paid.
    expect(await topUpJobs(campaignId)).toEqual([]);
    expect(await campaignState(campaignId)).toEqual({
      budget: 1_000_000_000n,
      status: "live",
      sale_state: "open",
    });
  });

  it("answers the same payment to the same requestId and creates nothing", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const first = await topUpOk(campaignId, FIVE_HUNDRED, requestId);
    const createCalls = payments.createCalls;
    const again = await topUpOk(campaignId, FIVE_HUNDRED, requestId);
    const third = await topUpOk(campaignId, FIVE_HUNDRED, requestId);
    expect(again).toEqual(first);
    expect(third).toEqual(first);
    expect(payments.createCalls).toBe(createCalls);
    expect(payments.cancelCalls).toEqual([]);
    expect(await topUpRows(campaignId)).toHaveLength(1);
    expect(payments.intents.size).toBe(1);
  });

  it("answers the same payment to a repeated request even once the top-up moved on", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const first = await topUpOk(campaignId, FIVE_HUNDRED, requestId);
    expect(first.status).toBe("requires_payment");
    payments.pay(first.budgetPayment.paymentIntentId, "succeeded", "joe@example.com");
    await deliver("payment_intent.succeeded", first.budgetPayment.paymentIntentId);
    expect(await topUpOk(campaignId, FIVE_HUNDRED, requestId)).toEqual({
      ...first,
      status: "processing",
    });
    expect(await topUpJobs(campaignId)).toHaveLength(1);
  });

  it("refuses a requestId already used for another amount or another campaign", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const other = await liveCampaign();
    const requestId = randomUUID();
    await topUpOk(campaignId, FIVE_HUNDRED, requestId);
    const createCalls = payments.createCalls;

    const otherAmount = await refusal(await topUp(campaignId, { amount: "600000000", requestId }));
    expect(otherAmount).toEqual({
      status: 409,
      error: {
        code: "conflict",
        message: "This request was already used for another top-up; make a new request to top up",
      },
    });
    const otherCampaign = await refusal(
      await topUp(other, { amount: FIVE_HUNDRED.toString(), requestId }),
    );
    expect(otherCampaign.status).toBe(409);
    expect(otherCampaign.error.code).toBe("conflict");
    expect(payments.createCalls).toBe(createCalls);
    expect(await topUpRows(other)).toEqual([]);
  });

  it("creates nothing when the payment provider fails, and works once it is back", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    payments.failure = new PaymentGatewayError("Stripe is down");
    const failed = await refusal(
      await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId }),
    );
    expect(failed.status).toBe(502);
    expect(failed.error.code).toBe("internal");
    expect(await topUpRows(campaignId)).toEqual([]);

    payments.failure = null;
    const answer = await topUpOk(campaignId, FIVE_HUNDRED, requestId);
    expect((await topUpRows(campaignId)).map((row) => row.stripe_pi)).toEqual([
      answer.budgetPayment.paymentIntentId,
    ]);
  });

  it("answers 503 when the gateway has no top-up calls", async () => {
    const plain: PaymentGateway = {
      createBudgetPayment: () => Promise.reject(new Error("unused")),
      createPurchaseAuthorization: () => Promise.reject(new Error("unused")),
      retrievePaymentIntent: () => Promise.resolve(null),
      parseWebhook: () => {
        throw new Error("unused");
      },
    };
    useGateway(plain);
    const campaignId = await liveCampaign();
    const answer = await refusal(
      await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() }),
    );
    expect(answer).toEqual({
      status: 503,
      error: { code: "internal", message: "Top-ups are not available right now" },
    });
    expect(await topUpRows(campaignId)).toEqual([]);
  });

  it("is served from its example in mock mode", async () => {
    freshGateway();
    vi.stubEnv("APP_API_MOCK", "true");
    const response = await postTopUp(
      post("/api/campaigns/cmp_joes_texas/top-up", {
        amount: "500000000",
        requestId: randomUUID(),
      }),
      params({ id: "cmp_joes_texas" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(apiExamples.topUpCampaignExamples.created);
  });
});

describe("POST /api/campaigns/:id/top-up: refusals", () => {
  it("refuses a caller who is not signed in, or not the campaign's merchant", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const body = { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() };

    expect((await topUp(campaignId, body, {})).status).toBe(401);
    expect(await refusal(await topUp(campaignId, body, ANN))).toEqual({
      status: 404,
      error: { code: "not_found", message: "Campaign not found" },
    });
    expect((await refusal(await topUp(randomUUID(), body))).status).toBe(404);
    expect((await refusal(await topUp("not-a-uuid", body))).status).toBe(404);
    expect(payments.createCalls).toBe(0);
    expect(await topUpRows(campaignId)).toEqual([]);

    // Positive control: the merchant's own request with the very same body goes through.
    await topUpOk(campaignId, FIVE_HUNDRED, body.requestId);
  });

  it("never lets another merchant replay Joe's request or read his payment", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const joe = await topUpOk(campaignId, FIVE_HUNDRED, requestId);
    // Ann replaying Joe's requestId gets nothing of his payment.
    const ann = await refusal(
      await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId }, ANN),
    );
    expect(ann.status).toBe(404);
    expect(JSON.stringify(ann)).not.toContain(joe.budgetPayment.clientSecret);
    // The public checkout status knows only purchases: a top-up's payment is not found there.
    const pi = joe.budgetPayment.paymentIntentId;
    const status = await getCheckout(
      new Request(`http://localhost/api/checkout/${pi}`),
      params({ pi }),
    );
    expect(status.status).toBe(404);
  });

  it.each([
    ["it is not created on-chain yet", { status: "funding" as const, onchainId: null, slug: null }],
    ["it is a draft", { status: "draft" as const, onchainId: null, slug: null }],
  ])("refuses when %s", async (_label, input) => {
    freshGateway();
    const campaignId = await liveCampaign({ ...input, saleState: "closed" });
    expect(
      await refusal(
        await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() }),
      ),
    ).toEqual({ status: 409, error: { code: "conflict", message: "This promo is not live yet" } });
    expect(payments.createCalls).toBe(0);
  });

  it.each([
    ["settled YES", { status: "settled_yes" as const, outcome: "yes" as const }],
    ["settled NO", { status: "settled_no" as const, outcome: "no" as const }],
    ["void", { status: "void" as const, outcome: "void" as const }],
    ["closed", { status: "closed" as const }],
    ["settled in the outcome only", { status: "sales_closed" as const, outcome: "yes" as const }],
  ])("refuses a campaign %s", async (_label, input) => {
    freshGateway();
    const campaignId = await liveCampaign({ ...input, saleState: "closed" });
    expect(
      await refusal(
        await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() }),
      ),
    ).toEqual({
      status: 409,
      error: { code: "conflict", message: "This promo is already settled" },
    });
    expect(payments.createCalls).toBe(0);
  });

  it("refuses a campaign whose sales are closed, whichever way they closed", async () => {
    freshGateway();
    const closedStatus = await liveCampaign({ status: "sales_closed", saleState: "closed" });
    const closedState = await liveCampaign({ saleState: "closed" });
    const pastClose = await liveCampaign({ salesClose: minutesFrom(now, -1) });
    const closeAsked = await liveCampaign();
    await db`
      insert into jobs (kind, payload, idempotency_key)
      values (${JOB_KINDS.closeSales}, ${JSON.stringify({ campaignId: closeAsked })}::text::jsonb,
              ${jobIdempotencyKey.closeSales(closeAsked)})
    `;
    for (const campaignId of [closedStatus, closedState, pastClose, closeAsked]) {
      expect(
        await refusal(
          await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() }),
        ),
        campaignId,
      ).toEqual({
        status: 409,
        error: {
          code: "sales_closed",
          message: "Sales are closed for this promo: its budget can no longer be topped up",
        },
      });
    }
    expect(payments.createCalls).toBe(0);
    // Positive controls: paused (by hand or by the budget) still takes a top-up.
    await topUpOk(await liveCampaign({ status: "paused", saleState: "paused_manual" }));
    await topUpOk(await liveCampaign({ saleState: "paused_budget" }));
  });

  it.each([
    ["below $0.50", "490000", "must be at least $0.50"],
    ["above $999,999.99", "1000000000000", "must be at most $999,999.99"],
    ["not whole cents", "500001", "must be a whole number of cents"],
  ])("refuses an amount %s", async (_label, amount, reason) => {
    freshGateway();
    const campaignId = await liveCampaign();
    expect(await refusal(await topUp(campaignId, { amount, requestId: randomUUID() }))).toEqual({
      status: 400,
      error: { code: "invalid_request", message: `Invalid body.amount: ${reason}` },
    });
    expect(payments.createCalls).toBe(0);
  });

  it("refuses a body the wire schema refuses", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    for (const body of [
      { amount: "0", requestId: randomUUID() },
      { amount: "500000000", requestId: "req-1" },
      { amount: 500000000, requestId: randomUUID() },
      { requestId: randomUUID() },
      "not json",
    ]) {
      const answer = await refusal(await topUp(campaignId, body));
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(answer.error.code).toBe("invalid_request");
    }
    expect(payments.createCalls).toBe(0);
  });

  it("refuses a top-up that would take the budget above the cap of a budget", async () => {
    freshGateway();
    const campaignId = await liveCampaign({ budget: MAX_CARD_AMOUNT - 1_000_000n });
    expect(
      await refusal(await topUp(campaignId, { amount: "1010000", requestId: randomUUID() })),
    ).toEqual({
      status: 400,
      error: {
        code: "invalid_request",
        message: "Invalid body.amount: the promo's budget would go above $999,999.99",
      },
    });
    expect(payments.createCalls).toBe(0);
    // Exactly up to the cap is accepted.
    await topUpOk(campaignId, 1_000_000n);
  });
});

describe("one top-up of a campaign at a time", () => {
  it("refuses a new top-up while a paid one is on its way, and accepts one once it is credited", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const first = await topUpOk(campaignId);
    payments.pay(first.budgetPayment.paymentIntentId, "succeeded", "joe@example.com");
    await deliver("payment_intent.succeeded", first.budgetPayment.paymentIntentId);
    const createCalls = payments.createCalls;

    expect(
      await refusal(
        await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() }),
      ),
    ).toEqual({
      status: 409,
      error: {
        code: "conflict",
        message: "A top-up of this promo is on its way; try again once it is credited",
      },
    });
    expect(payments.createCalls).toBe(createCalls);
    expect(payments.cancelCalls).toEqual([]);

    // The engine credits it (as its job does): the slot is free again.
    await db`
      update budget_top_ups set status = 'credited', tx_hash = ${`0x${"ab".repeat(32)}`}
      where stripe_pi = ${first.budgetPayment.paymentIntentId}
    `;
    await topUpOk(campaignId);
  });

  it("replaces an unpaid top-up, cancelling its payment first so it can never be charged", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const abandoned = await topUpOk(campaignId, 100_000_000n);
    const second = await topUpOk(campaignId, FIVE_HUNDRED);

    const oldPi = abandoned.budgetPayment.paymentIntentId;
    // Sent without an idempotency key of ours (see the cancel's tests below).
    expect(payments.cancelCalls).toEqual([{ id: oldPi, idempotencyKey: null }]);
    expect(payments.intents.get(oldPi)?.status).toBe("canceled");
    const rows = await topUpRows(campaignId);
    expect(rows.map((row) => [row.stripe_pi, row.status, row.message])).toEqual([
      [oldPi, "failed", TOP_UP_MESSAGES.replaced],
      [second.budgetPayment.paymentIntentId, "requires_payment", null],
    ]);
  });

  it("refuses a new top-up while the unpaid one is being paid, and leaves it alone", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const first = await topUpOk(campaignId);
    // Paid on Stripe's sheet, the webhook not delivered yet.
    payments.pay(first.budgetPayment.paymentIntentId, "succeeded", "joe@example.com");
    expect(
      await refusal(
        await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() }),
      ),
    ).toEqual({
      status: 409,
      error: {
        code: "conflict",
        message: "A top-up of this promo is being paid; try again once it is credited",
      },
    });
    expect((await topUpRows(campaignId)).map((row) => row.status)).toEqual(["requires_payment"]);
    expect(payments.intents.size).toBe(1);
    // The late webhook still turns it into its job.
    await deliver("payment_intent.succeeded", first.budgetPayment.paymentIntentId);
    expect(await topUpJobs(campaignId)).toHaveLength(1);
  });

  it("keeps the unpaid top-up when its cancellation cannot be made", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const first = await topUpOk(campaignId);
    payments.topUpFailure = new PaymentGatewayError("Stripe is down");
    const answer = await refusal(
      await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() }),
    );
    expect(answer.status).toBe(502);
    expect(await topUpRows(campaignId)).toMatchObject([
      { stripe_pi: first.budgetPayment.paymentIntentId, status: "requires_payment" },
    ]);
    expect(payments.intents.size).toBe(1);
  });

  it("two different requests racing: one payable top-up remains, the other's payment is cancelled", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const responses = await Promise.all([
      topUp(campaignId, { amount: "100000000", requestId: randomUUID() }),
      topUp(campaignId, { amount: "200000000", requestId: randomUUID() }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const answers = await Promise.all(
      responses.map(async (response) => topUpCampaignResponseSchema.parse(await response.json())),
    );
    const rows = await topUpRows(campaignId);
    expect(rows).toHaveLength(2);
    const open = rows.filter((row) => row.status === "requires_payment");
    const replaced = rows.filter((row) => row.status === "failed");
    expect(open).toHaveLength(1);
    expect(replaced).toHaveLength(1);
    // The replaced one can never be charged; the open one is still payable.
    expect(payments.intents.get(replaced[0]?.stripe_pi ?? "")?.status).toBe("canceled");
    expect(payments.intents.get(open[0]?.stripe_pi ?? "")?.status).toBe("requires_payment_method");
    expect(new Set(answers.map((answer) => answer.budgetPayment.paymentIntentId))).toEqual(
      new Set(rows.map((row) => row.stripe_pi)),
    );
  });

  it("the same request racing with itself creates one payment", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const responses = await Promise.all(
      [0, 1, 2].map(() => topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId })),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const answers = await Promise.all(
      responses.map(async (response) => topUpCampaignResponseSchema.parse(await response.json())),
    );
    expect(new Set(answers.map((answer) => answer.budgetPayment.clientSecret)).size).toBe(1);
    expect(await topUpRows(campaignId)).toHaveLength(1);
    expect(payments.intents.size).toBe(1);
    expect(payments.cancelCalls).toEqual([]);
  });
});

describe("the Stripe webhook of a top-up", () => {
  it("enqueues ONE campaign.top_up job when the top-up is paid, however often Stripe delivers", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const answer = await topUpOk(campaignId);
    const pi = answer.budgetPayment.paymentIntentId;
    payments.pay(pi, "succeeded", "joe@example.com");
    for (let i = 0; i < 3; i += 1) await deliver("payment_intent.succeeded", pi);

    expect(await topUpJobs(campaignId)).toEqual([
      {
        idempotency_key: jobIdempotencyKey.topUpBudget(pi),
        payload: {
          campaignId,
          amount: "500000000",
          paymentIntentId: pi,
          requestId: answer.requestId,
        },
      },
    ]);
    expect((await topUpRows(campaignId)).map((row) => row.status)).toEqual(["processing"]);
    // The budget only changes once the engine projects the on-chain top-up.
    expect((await campaignState(campaignId)).budget).toBe(1_000_000_000n);
  });

  it("ignores a paid event that does not match its top-up, or no top-up at all", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const answer = await topUpOk(campaignId);
    const pi = answer.budgetPayment.paymentIntentId;
    const signed = async (intent: Parameters<typeof stripeEventBody>[1]): Promise<void> => {
      const response = await postStripe(
        webhook(stripeEventBody("payment_intent.succeeded", intent)),
        params(),
      );
      expect(response.status).toBe(200);
    };
    const metadata = {
      kind: STRIPE_PAYMENT_KINDS.campaignBudgetTopUp,
      campaignId,
      requestId: answer.requestId,
    };
    // Another amount, another campaign, another request, and an intent nobody created.
    await signed({ id: pi, status: "succeeded", amount: 600_000_000n, metadata });
    await signed({
      id: pi,
      status: "succeeded",
      amount: FIVE_HUNDRED,
      metadata: { ...metadata, campaignId: randomUUID() },
    });
    await signed({
      id: pi,
      status: "succeeded",
      amount: FIVE_HUNDRED,
      metadata: { ...metadata, requestId: randomUUID() },
    });
    await signed({ id: "pi_forged", status: "succeeded", amount: FIVE_HUNDRED, metadata });
    // Not paid: a `processing` intent announced as succeeded.
    await signed({ id: pi, status: "processing", amount: FIVE_HUNDRED, metadata });
    expect(await topUpJobs(campaignId)).toEqual([]);
    expect((await topUpRows(campaignId)).map((row) => row.status)).toEqual(["requires_payment"]);

    // Positive control: the matching event is taken.
    payments.pay(pi, "succeeded", "joe@example.com");
    await deliver("payment_intent.succeeded", pi);
    expect(await topUpJobs(campaignId)).toHaveLength(1);
  });

  it("a declined payment ends the request (its intent cancelled) and another can be made", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const answer = await topUpOk(campaignId);
    const pi = answer.budgetPayment.paymentIntentId;
    payments.pay(pi, "requires_payment_method", "joe@example.com");
    await deliver("payment_intent.payment_failed", pi);
    await deliver("payment_intent.payment_failed", pi);

    expect(payments.intents.get(pi)?.status).toBe("canceled");
    expect(await topUpRows(campaignId)).toMatchObject([
      { stripe_pi: pi, status: "failed", message: TOP_UP_MESSAGES.declined },
    ]);
    expect(await topUpJobs(campaignId)).toEqual([]);
    expect(await campaignState(campaignId)).toEqual({
      budget: 1_000_000_000n,
      status: "live",
      sale_state: "open",
    });
    const cancels = payments.cancelCalls.length;
    // Another request goes through without cancelling anything more.
    await topUpOk(campaignId);
    expect(payments.cancelCalls).toHaveLength(cancels);
  });

  it("a cancelled payment ends the request", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const answer = await topUpOk(campaignId);
    const pi = answer.budgetPayment.paymentIntentId;
    payments.pay(pi, "canceled", null);
    await deliver("payment_intent.canceled", pi);
    expect(await topUpRows(campaignId)).toMatchObject([
      { status: "failed", message: TOP_UP_MESSAGES.cancelled },
    ]);
    expect(payments.cancelCalls).toEqual([]);
  });

  it("a stale failure event changes nothing once Stripe shows the payment went through", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const answer = await topUpOk(campaignId);
    const pi = answer.budgetPayment.paymentIntentId;
    // Declined, then paid with another card; the decline's event arrives last.
    const intent = payments.pay(pi, "requires_payment_method", "joe@example.com");
    const declined = stripeEventBody("payment_intent.payment_failed", intent);
    payments.pay(pi, "succeeded", "joe@example.com");
    expect((await postStripe(webhook(declined), params())).status).toBe(200);
    expect(payments.intents.get(pi)?.status).toBe("succeeded");
    expect((await topUpRows(campaignId)).map((row) => row.status)).toEqual(["requires_payment"]);
    await deliver("payment_intent.succeeded", pi);
    expect(await topUpJobs(campaignId)).toHaveLength(1);
    // A failure event after the payment is on its way changes nothing either.
    await deliver("payment_intent.payment_failed", pi);
    expect((await topUpRows(campaignId)).map((row) => row.status)).toEqual(["processing"]);
  });

  it("refunds, never keeps, a payment Stripe shows paid for a top-up that ended failed", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const replaced = await topUpOk(campaignId);
    await topUpOk(campaignId);
    const pi = replaced.budgetPayment.paymentIntentId;
    // Stripe cannot pay a cancelled intent; were it ever to, the money goes back.
    payments.pay(pi, "succeeded", "joe@example.com");
    await deliver("payment_intent.succeeded", pi);
    await deliver("payment_intent.succeeded", pi);
    expect((await topUpRows(campaignId)).map((row) => [row.stripe_pi, row.status])).toEqual([
      [pi, "refunding"],
      [expect.any(String), "requires_payment"],
    ]);
    expect(await topUpJobs(campaignId)).toEqual([
      {
        idempotency_key: jobIdempotencyKey.topUpBudget(pi),
        payload: {
          campaignId,
          amount: "500000000",
          paymentIntentId: pi,
          requestId: replaced.requestId,
        },
      },
    ]);
  });

  it("never turns a cancelled top-up into a job", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const replaced = await topUpOk(campaignId);
    await topUpOk(campaignId);
    const pi = replaced.budgetPayment.paymentIntentId;
    const forged = stripeEventBody("payment_intent.succeeded", {
      id: pi,
      status: "succeeded",
      amount: FIVE_HUNDRED,
      metadata: {
        kind: STRIPE_PAYMENT_KINDS.campaignBudgetTopUp,
        campaignId,
        requestId: replaced.requestId,
      },
    });
    expect((await postStripe(webhook(forged), params())).status).toBe(200);
    expect(await topUpJobs(campaignId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Review follow-ups: no call to the payment provider under the campaign's lock, the
// cancel without a repeatable key, a repeated request answered by the top-up's status
// ---------------------------------------------------------------------------------------------

/** `promise`, or a failure naming `what` when it takes longer than `ms`. */
async function within<T>(ms: number, promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what}: still waiting after ${ms.toString()} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function slugOf(campaignId: string): Promise<string> {
  const [row] = await db<
    { slug: string | null }[]
  >`select slug from campaigns where id = ${campaignId}`;
  if (!row?.slug) throw new Error(`campaign ${campaignId} has no slug`);
  return row.slug;
}

/** The close of a campaign's sales as the engine records it, while a top-up is in flight. */
async function closeItsSales(campaignId: string): Promise<void> {
  await db`
    update campaigns set status = 'sales_closed', sale_state = 'closed' where id = ${campaignId}
  `;
}

/** The settlement of a campaign as the engine records it, while a top-up is in flight. */
async function settleIt(campaignId: string): Promise<void> {
  await db`
    update campaigns set status = 'settled_yes', sale_state = 'closed', outcome = 'yes'
    where id = ${campaignId}
  `;
}

/** The fake's intents of one campaign's top-ups, whatever became of them. */
function topUpIntentsOf(campaignId: string): FakeIntent[] {
  return [...payments.intents.values()].filter(
    (intent) =>
      intent.metadata.kind === STRIPE_PAYMENT_KINDS.campaignBudgetTopUp &&
      intent.metadata.campaignId === campaignId,
  );
}

describe("no call to the payment provider while the campaign's row is locked", () => {
  it.each([
    ["creating the payment", "createBudgetTopUpPayment" as const],
    ["cancelling the unpaid top-up it replaces", "cancelUnpaidPaymentIntent" as const],
    ["reading back a repeated request's payment", "retrieveClientSecret" as const],
  ])(
    "a checkout of the campaign does not wait for a top-up whose provider is slow %s",
    async (_label, call) => {
      freshGateway();
      const campaignId = await liveCampaign();
      const slug = await slugOf(campaignId);
      const earlier = await topUpOk(campaignId, 100_000_000n);
      const requestId = call === "retrieveClientSecret" ? earlier.requestId : randomUUID();
      const amount = call === "retrieveClientSecret" ? 100_000_000n : FIVE_HUNDRED;

      const held = payments.holdTopUpCalls([call]);
      const pending = topUp(campaignId, { amount: amount.toString(), requestId });
      try {
        await within(5_000, held.waiting(1), "the top-up reaching the provider");
        // The check of a checkout that locks the campaign row (the demo sale's, and the pause and
        // close routes take the same lock) answers while the provider still holds its answer.
        const sellable = await within(
          2_000,
          db.begin((tx) => findSellableCampaign(tx, slug, 1, now, { lock: true })),
          "the checkout's locked check of the campaign",
        );
        expect(sellable.id).toBe(campaignId);
      } finally {
        held.release();
      }
      const response = await pending;
      expect(response.status).toBe(200);
    },
  );

  it("two different requests racing while the provider is slow: both reach it, one payable top-up remains", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
    const pending = [
      topUp(campaignId, { amount: "100000000", requestId: randomUUID() }),
      topUp(campaignId, { amount: "200000000", requestId: randomUUID() }),
    ];
    try {
      // Neither waits for the other's call to the provider.
      await within(5_000, held.waiting(2), "both requests reaching the provider");
    } finally {
      held.release();
    }
    const responses = await Promise.all(pending);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const answers = await Promise.all(
      responses.map(async (response) => topUpCampaignResponseSchema.parse(await response.json())),
    );
    const rows = await topUpRows(campaignId);
    expect(rows.filter((row) => row.status === "requires_payment")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "failed")).toHaveLength(1);
    // Exactly one intent of the campaign can still be paid: the open top-up's.
    const payable = topUpIntentsOf(campaignId).filter((intent) => intent.status !== "canceled");
    expect(payable.map((intent) => intent.id)).toEqual(
      rows.filter((row) => row.status === "requires_payment").map((row) => row.stripe_pi),
    );
    // Every intent created is known by a row.
    expect(new Set(topUpIntentsOf(campaignId).map((intent) => intent.id))).toEqual(
      new Set(rows.map((row) => row.stripe_pi)),
    );
    expect(new Set(answers.map((answer) => answer.budgetPayment.paymentIntentId))).toEqual(
      new Set(rows.map((row) => row.stripe_pi)),
    );
  });

  it("the same requestId twice at once while the provider is slow: one payment, answered to both", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
    const pending = [0, 1].map(() =>
      topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId }),
    );
    try {
      await within(5_000, held.waiting(2), "both requests reaching the provider");
    } finally {
      held.release();
    }
    const responses = await Promise.all(pending);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const [first, second] = await Promise.all(
      responses.map(async (response) => topUpCampaignResponseSchema.parse(await response.json())),
    );
    expect(second).toEqual(first);
    expect(await topUpRows(campaignId)).toMatchObject([
      { request_id: requestId, status: "requires_payment" },
    ]);
    expect(payments.intents.size).toBe(1);
    expect(payments.cancelCalls).toEqual([]);
  });

  it.each([
    [
      "its sales close",
      closeItsSales,
      {
        code: "sales_closed",
        message: "Sales are closed for this promo: its budget can no longer be topped up",
      },
    ],
    ["it is settled", settleIt, { code: "conflict", message: "This promo is already settled" }],
  ])(
    "the campaign changes while the provider answers (%s): the payment created is cancelled and the request refused",
    async (_label, change, error) => {
      freshGateway();
      const campaignId = await liveCampaign();
      const requestId = randomUUID();
      const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
      const pending = topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId });
      try {
        await within(5_000, held.waiting(1), "the top-up reaching the provider");
        await within(2_000, change(campaignId), "the change of the campaign");
      } finally {
        held.release();
      }
      expect(await refusal(await pending)).toEqual({ status: 409, error });
      // Nothing payable is left: the intent created is cancelled, and no top-up is open.
      const intents = topUpIntentsOf(campaignId);
      expect(intents).toHaveLength(1);
      expect(intents[0]?.status).toBe("canceled");
      expect(await topUpRows(campaignId)).toMatchObject([
        { request_id: requestId, stripe_pi: intents[0]?.id, status: "failed" },
      ]);
      expect(await topUpJobs(campaignId)).toEqual([]);
      // The same request again is told it is over.
      const again = await refusal(
        await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId }),
      );
      expect(again.status).toBe(409);
    },
  );

  /** The payment of another request of the campaign, created at the fake, not recorded yet. */
  async function otherRequestsPayment(
    campaignId: string,
  ): Promise<{ requestId: string; pi: string }> {
    const requestId = randomUUID();
    const created = await payments.createBudgetTopUpPayment({
      campaignId,
      requestId,
      amount: 300_000_000n,
    });
    return { requestId, pi: created.id };
  }

  /** That other request's top-up recorded, as its own commit would, while this one waits. */
  async function recordOpen(
    campaignId: string,
    other: { requestId: string; pi: string },
  ): Promise<void> {
    await db`
      insert into budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
      values (${other.requestId}, ${campaignId}, ${other.pi}, 300000000, 'requires_payment')
    `;
  }

  it("another request took the slot meanwhile with an unpaid top-up: replaced in turn, the newest wins", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const other = await otherRequestsPayment(campaignId);
    const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
    const pending = topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId });
    try {
      await within(5_000, held.waiting(1), "the top-up reaching the provider");
      await recordOpen(campaignId, other);
    } finally {
      held.release();
    }
    const answer = topUpCampaignResponseSchema.parse(await (await pending).json());
    expect(answer.requestId).toBe(requestId);
    expect(payments.intents.get(other.pi)?.status).toBe("canceled");
    expect(payments.intents.get(answer.budgetPayment.paymentIntentId)?.status).toBe(
      "requires_payment_method",
    );
    const rows = await topUpRows(campaignId);
    expect(rows.map((row) => [row.request_id, row.status])).toEqual([
      [other.requestId, "failed"],
      [requestId, "requires_payment"],
    ]);
  });

  it("another request's top-up took the slot and is being paid: refused, its own payment withdrawn", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const other = await otherRequestsPayment(campaignId);
    const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
    const pending = topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId });
    try {
      await within(5_000, held.waiting(1), "the top-up reaching the provider");
      await recordOpen(campaignId, other);
      payments.pay(other.pi, "processing", "joe@example.com");
    } finally {
      held.release();
    }
    // Its own payment was created, then withdrawn: the request is over, and the answer says so.
    expect(await refusal(await pending)).toEqual({
      status: 409,
      error: {
        code: "conflict",
        message:
          "A top-up of this promo is being paid; once it is credited, make a new request to top up again",
      },
    });
    const mine = topUpIntentsOf(campaignId).find(
      (intent) => intent.metadata.requestId === requestId,
    );
    expect(mine?.status).toBe("canceled");
    expect(payments.intents.get(other.pi)?.status).toBe("processing");
    expect(
      (await topUpRows(campaignId)).map((row) => [row.request_id, row.status, row.message]),
    ).toEqual([
      [other.requestId, "requires_payment", null],
      [requestId, "failed", TOP_UP_MESSAGES.withdrawn],
    ]);
    expect(
      await refusal(await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId })),
    ).toEqual({ status: 409, error: { code: "conflict", message: TOP_UP_OVER_MESSAGE } });
  });

  it("an unneeded payment whose cancel fails is refunded, never kept, if it is ever paid", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
    const pending = topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId });
    try {
      await within(5_000, held.waiting(1), "the top-up reaching the provider");
      await within(2_000, closeItsSales(campaignId), "the close of the campaign");
      // Stripe goes down before the unneeded payment can be cancelled.
      payments.topUpFailure = new PaymentGatewayError("Stripe is down");
    } finally {
      held.release();
    }
    expect((await refusal(await pending)).status).toBe(409);
    const [orphan] = topUpIntentsOf(campaignId);
    if (orphan === undefined) throw new Error("no intent was created");
    expect(orphan.status).toBe("requires_payment_method");
    expect(await topUpRows(campaignId)).toEqual([]);

    // Paid anyway (whoever held its secret): the webhook records it to be refunded by the
    // engine's job, exactly once however often Stripe delivers, and the budget is untouched.
    payments.topUpFailure = null;
    payments.pay(orphan.id, "succeeded", "joe@example.com");
    await deliver("payment_intent.succeeded", orphan.id);
    await deliver("payment_intent.succeeded", orphan.id);
    expect(await topUpRows(campaignId)).toMatchObject([
      { request_id: requestId, stripe_pi: orphan.id, amount: FIVE_HUNDRED, status: "refunding" },
    ]);
    expect(await topUpJobs(campaignId)).toEqual([
      {
        idempotency_key: jobIdempotencyKey.topUpBudget(orphan.id),
        payload: { campaignId, amount: "500000000", paymentIntentId: orphan.id, requestId },
      },
    ]);
    expect((await campaignState(campaignId)).budget).toBe(1_000_000_000n);
  });
});

describe("the cancel of a top-up's payment sends no key Stripe could replay", () => {
  it("the fake replays a cancel's first answer for the same key, as Stripe does (control)", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const pi = (await topUpOk(campaignId)).budgetPayment.paymentIntentId;
    payments.pay(pi, "processing", null);
    expect(await payments.cancelUnpaidPaymentIntent(pi, "k")).toBe("not_cancelable");
    payments.pay(pi, "requires_payment_method", null);
    // The same key: Stripe's saved 400, although the intent can be cancelled now.
    expect(await payments.cancelUnpaidPaymentIntent(pi, "k")).toBe("not_cancelable");
    expect(payments.intents.get(pi)?.status).toBe("requires_payment_method");
    // Without a key, it is cancelled.
    expect(await payments.cancelUnpaidPaymentIntent(pi)).toBe("canceled");
    expect(payments.intents.get(pi)?.status).toBe("canceled");
  });

  it("a cancel refused while the payment was processing never blocks the campaign's later top-ups", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const first = await topUpOk(campaignId);
    const pi = first.budgetPayment.paymentIntentId;
    // The merchant's bank is processing the payment: a new request cannot replace it.
    payments.pay(pi, "processing", "joe@example.com");
    expect(
      await refusal(
        await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() }),
      ),
    ).toEqual({
      status: 409,
      error: {
        code: "conflict",
        message: "A top-up of this promo is being paid; try again once it is credited",
      },
    });
    // The payment then fails: the webhook's cancel goes through and ends the top-up.
    payments.pay(pi, "requires_payment_method", "joe@example.com");
    await deliver("payment_intent.payment_failed", pi);
    expect(payments.intents.get(pi)?.status).toBe("canceled");
    expect(await topUpRows(campaignId)).toMatchObject([
      { stripe_pi: pi, status: "failed", message: TOP_UP_MESSAGES.declined },
    ]);
    // And a new top-up request is accepted.
    await topUpOk(campaignId);
    expect(payments.cancelCalls.map((call) => call.idempotencyKey)).toEqual(
      payments.cancelCalls.map(() => null),
    );
  });
});

describe("a repeated request answered by the status of its top-up", () => {
  it("tells the merchant to make a new request", () => {
    expect(TOP_UP_OVER_MESSAGE).toBe(
      "This top-up request is over; make a new request to top up again",
    );
  });

  async function setStatus(pi: string, status: string): Promise<void> {
    await db`
      update budget_top_ups
      set status = ${status},
          tx_hash = case when ${status} = 'credited' then ${`0x${"cd".repeat(32)}`} else tx_hash end,
          refunded_at = case when ${status} = 'refunded' then now() else refunded_at end
      where stripe_pi = ${pi}
    `;
  }

  it.each([["requires_payment"], ["processing"], ["credited"]])(
    "a top-up %s answers 200 with its payment and its status",
    async (status) => {
      freshGateway();
      const campaignId = await liveCampaign();
      const first = await topUpOk(campaignId);
      await setStatus(first.budgetPayment.paymentIntentId, status);
      const again = await topUpOk(campaignId, FIVE_HUNDRED, first.requestId);
      expect(again).toEqual({ ...first, status });
      expect(payments.intents.size).toBe(1);
    },
  );

  it.each([["failed"], ["refunding"], ["refunded"]])(
    "a top-up %s answers 409: the request is over, a new one must be made",
    async (status) => {
      freshGateway();
      const campaignId = await liveCampaign();
      const first = await topUpOk(campaignId);
      await setStatus(first.budgetPayment.paymentIntentId, status);
      const retrieves = payments.retrieveCalls;
      const again = await refusal(
        await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: first.requestId }),
      );
      expect(again).toEqual({
        status: 409,
        error: { code: "conflict", message: TOP_UP_OVER_MESSAGE },
      });
      expect(JSON.stringify(again)).not.toContain(first.budgetPayment.clientSecret);
      expect(payments.retrieveCalls).toBe(retrieves);
      expect(payments.createCalls).toBe(1);
    },
  );

  it("a top-up replaced by a newer request answers 409 to its own repeat", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const replaced = await topUpOk(campaignId);
    await topUpOk(campaignId);
    const again = await refusal(
      await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: replaced.requestId }),
    );
    expect(again).toEqual({
      status: 409,
      error: { code: "conflict", message: TOP_UP_OVER_MESSAGE },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The second follow-up: no request is left on a payment that can no longer be paid, and no
// merchant is locked out of topping up
// ---------------------------------------------------------------------------------------------

class InjectedDbError extends Error {
  constructor(readonly code: string) {
    super(`injected database error ${code}`);
    this.name = "InjectedDbError";
  }
}

interface ScriptedDb {
  /** `db`, with the transactions (and, while down, every query) scripted. */
  db: Db;
  /** How many transactions were begun through `db`: the first is the decision's. */
  begins: () => number;
  /** The errors injected so far, in order. */
  injected: InjectedDbError[];
  /** While true, every transaction and every query fails as when the database is down. */
  down: boolean;
}

/**
 * `db` for one call of `topUpCampaign`, as `failFirstTransactions` of the sign-in's tests does it:
 * `before` runs before the n-th transaction begins (1: the decision, 2: the first commit), and a
 * code from `failAfterWork` makes that transaction do its work, then fail with that code (so it
 * rolls back, as the unique index's refusal would).
 */
function scriptedDb(
  script: {
    before?: (begin: number) => Promise<void>;
    failAfterWork?: (begin: number) => string | null;
  } = {},
): ScriptedDb {
  let begins = 0;
  const injected: InjectedDbError[] = [];
  const fail = (code: string): InjectedDbError => {
    const error = new InjectedDbError(code);
    injected.push(error);
    return error;
  };
  const begin = async (work: (tx: TransactionSql) => Promise<unknown>): Promise<unknown> => {
    begins += 1;
    const n = begins;
    await script.before?.(n);
    if (state.down) throw fail("08006");
    const code = script.failAfterWork?.(n) ?? null;
    if (code === null) return db.begin(work);
    return db.begin(async (tx: TransactionSql): Promise<unknown> => {
      await work(tx);
      throw fail(code);
    });
  };
  const wrapped = new Proxy(db, {
    get(target: Db, property: string | symbol, receiver: unknown): unknown {
      if (property === "begin") return begin;
      return Reflect.get(target, property, receiver) as unknown;
    },
    apply(target: Db, thisArg: unknown, args: unknown[]): unknown {
      if (state.down) return Promise.reject(fail("08006"));
      return Reflect.apply(target, thisArg, args) as unknown;
    },
  });
  const state: ScriptedDb = { db: wrapped, begins: () => begins, injected, down: false };
  return state;
}

/** The whole answer of a response, whatever its status: a failure shows what came back. */
async function answerOf(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: (await response.json()) as unknown };
}

/** The body of a 409 to a request that is over. */
const overBody = { error: { code: "conflict", message: TOP_UP_OVER_MESSAGE } };

/** The error `promise` rejects with; a failure if it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected a rejection");
}

/** `topUpCampaign` called directly as Joe, on a scripted database. */
async function topUpThrough(
  scripted: ScriptedDb,
  campaignId: string,
  requestId: string,
  amount: bigint = FIVE_HUNDRED,
): Promise<TopUpCampaignResponse> {
  return topUpCampaign(
    scripted.db,
    payments,
    joeMerchant,
    campaignId,
    { amount: amount.toString(), requestId },
    now,
  );
}

/** Another request's payment, created at the fake, not recorded yet. */
async function anotherPayment(campaignId: string): Promise<{ requestId: string; pi: string }> {
  const requestId = randomUUID();
  const created = await payments.createBudgetTopUpPayment({
    campaignId,
    requestId,
    amount: 300_000_000n,
  });
  return { requestId, pi: created.id };
}

/** Every intent of the campaign that can still be paid is recorded by an open top-up. */
async function expectNoPayableOrphan(campaignId: string): Promise<void> {
  const rows = await topUpRows(campaignId);
  const payable = topUpIntentsOf(campaignId)
    .filter((intent) => intent.status !== "canceled")
    .map((intent) => intent.id)
    .sort();
  const open = rows
    .filter((row) => row.status === "requires_payment" || row.status === "processing")
    .map((row) => row.stripe_pi)
    .sort();
  expect(payable).toEqual(open);
}

describe("a repeated request whose top-up changes while its client secret is read", () => {
  it.each([
    [
      "replaced by a newer request",
      async (campaignId: string): Promise<void> => {
        await topUpOk(campaignId);
      },
    ],
    [
      "declined, its payment cancelled by the webhook",
      async (_campaignId: string, pi: string): Promise<void> => {
        payments.pay(pi, "requires_payment_method", "joe@example.com");
        await deliver("payment_intent.payment_failed", pi);
      },
    ],
  ])("%s: answers 409, never the secret of the cancelled intent", async (_label, change) => {
    freshGateway();
    const campaignId = await liveCampaign();
    const first = await topUpOk(campaignId);
    const pi = first.budgetPayment.paymentIntentId;
    const held = payments.holdTopUpCalls(["retrieveClientSecret"]);
    const pending = topUp(campaignId, {
      amount: FIVE_HUNDRED.toString(),
      requestId: first.requestId,
    });
    try {
      await within(5_000, held.waiting(1), "the repeat reaching the provider");
      await within(5_000, change(campaignId, pi), "the change of the top-up");
    } finally {
      held.release();
    }
    const answer = await refusal(await pending);
    expect(answer).toEqual({
      status: 409,
      error: { code: "conflict", message: TOP_UP_OVER_MESSAGE },
    });
    expect(JSON.stringify(answer)).not.toContain(first.budgetPayment.clientSecret);
    expect(payments.intents.get(pi)?.status).toBe("canceled");
  });

  it("answers the secret when the top-up did not change meanwhile (control)", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const first = await topUpOk(campaignId);
    const held = payments.holdTopUpCalls(["retrieveClientSecret"]);
    const pending = topUp(campaignId, {
      amount: FIVE_HUNDRED.toString(),
      requestId: first.requestId,
    });
    try {
      await within(5_000, held.waiting(1), "the repeat reaching the provider");
    } finally {
      held.release();
    }
    expect(topUpCampaignResponseSchema.parse(await (await pending).json())).toEqual(first);
  });
});

describe("a unique index refusing the commit of a top-up", () => {
  it("a 23505 on the first commit is retried: one row, a payable intent, nothing cancelled", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const scripted = scriptedDb({ failAfterWork: (n) => (n === 2 ? "23505" : null) });
    const answer = await topUpThrough(scripted, campaignId, requestId);
    expect(scripted.injected.map((error) => error.code)).toEqual(["23505"]);
    expect(scripted.begins()).toBe(3);
    expect(answer).toMatchObject({ requestId, status: "requires_payment" });
    expect(await topUpRows(campaignId)).toMatchObject([
      {
        request_id: requestId,
        stripe_pi: answer.budgetPayment.paymentIntentId,
        status: "requires_payment",
      },
    ]);
    expect(payments.intents.get(answer.budgetPayment.paymentIntentId)?.status).toBe(
      "requires_payment_method",
    );
    expect(payments.cancelCalls).toEqual([]);
    expect(payments.createCalls).toBe(1);
  });

  it("the same requestId twice, the provider slow, one call refused by the index every round: both answer the same payable intent, never cancelled", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const body = { amount: FIVE_HUNDRED.toString(), requestId };
    const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
    const twin = topUp(campaignId, body);
    // Every commit of this call waits for the twin's answer, then is refused by the index.
    const scripted = scriptedDb({
      before: async (n) => {
        if (n >= 2) await twin;
      },
      failAfterWork: (n) => (n >= 2 && n <= 1 + MAX_ROUNDS ? "23505" : null),
    });
    const pending = topUpThrough(scripted, campaignId, requestId);
    try {
      await within(5_000, held.waiting(2), "both calls reaching the provider");
    } finally {
      held.release();
    }
    const twinResponse = await twin;
    expect(twinResponse.status).toBe(200);
    const twinAnswer = topUpCampaignResponseSchema.parse(await twinResponse.json());
    const answer = await pending;
    expect(scripted.injected).toHaveLength(MAX_ROUNDS);
    expect(answer).toEqual(twinAnswer);
    expect(payments.cancelCalls).toEqual([]);
    expect(payments.intents.get(answer.budgetPayment.paymentIntentId)?.status).toBe(
      "requires_payment_method",
    );
    expect(await topUpRows(campaignId)).toMatchObject([
      { request_id: requestId, stripe_pi: answer.budgetPayment.paymentIntentId },
    ]);
    expect((await topUpRows(campaignId))[0]?.status).toBe("requires_payment");
  });

  it("the index refusing every round with no row of the request: 409, its payment withdrawn", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const scripted = scriptedDb({
      failAfterWork: (n) => (n >= 2 && n <= 1 + MAX_ROUNDS ? "23505" : null),
    });
    const error = await rejectionOf(topUpThrough(scripted, campaignId, requestId));
    expect(error).toBeInstanceOf(ApiRouteError);
    expect(error).toMatchObject({ status: 409, message: TOP_UP_CONFLICTS.justRequested });
    expect(await topUpRows(campaignId)).toMatchObject([
      { request_id: requestId, status: "failed", message: TOP_UP_MESSAGES.withdrawn },
    ]);
    await expectNoPayableOrphan(campaignId);
    expect(topUpIntentsOf(campaignId)).toHaveLength(1);
  });

  it("other requests taking the slot every round: after MAX_ROUNDS, 409 and no payable intent that no row knows", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const others: { requestId: string; pi: string }[] = [];
    // Before each commit, another request records an unpaid top-up, replacing the one before it
    // (whose intent this request has just cancelled).
    const scripted = scriptedDb({
      before: async (n) => {
        if (n < 2 || n > 1 + MAX_ROUNDS) return;
        const previous = others.at(-1);
        if (previous !== undefined) {
          await db`
            update budget_top_ups set status = 'failed', message = ${TOP_UP_MESSAGES.replaced}
            where request_id = ${previous.requestId}
          `;
        }
        const other = await anotherPayment(campaignId);
        others.push(other);
        await db`
          insert into budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
          values (${other.requestId}, ${campaignId}, ${other.pi}, 300000000, 'requires_payment')
        `;
      },
    });
    const error = await rejectionOf(topUpThrough(scripted, campaignId, requestId));
    expect(error).toBeInstanceOf(ApiRouteError);
    expect(error).toMatchObject({ status: 409, message: TOP_UP_CONFLICTS.justRequested });
    expect(others).toHaveLength(MAX_ROUNDS);
    const mine = topUpIntentsOf(campaignId).find(
      (intent) => intent.metadata.requestId === requestId,
    );
    expect(mine?.status).toBe("canceled");
    // The last other request's top-up is the one open, and its intent the one payable.
    const last = others.at(-1);
    expect(payments.intents.get(last?.pi ?? "")?.status).toBe("requires_payment_method");
    await expectNoPayableOrphan(campaignId);
    expect(
      (await topUpRows(campaignId)).filter((row) => row.request_id === requestId),
    ).toMatchObject([{ status: "failed", message: TOP_UP_MESSAGES.withdrawn }]);
    // The message says it: the same request can never go through.
    expect(
      await refusal(await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId })),
    ).toEqual({ status: 409, error: { code: "conflict", message: TOP_UP_OVER_MESSAGE } });
  });

  it("a top-up paid between the two lock periods: 409, the new payment withdrawn", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const other = await anotherPayment(campaignId);
    const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
    const pending = topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId });
    try {
      await within(5_000, held.waiting(1), "the top-up reaching the provider");
      // Another request's top-up recorded and paid meanwhile, its webhook delivered.
      payments.pay(other.pi, "succeeded", "joe@example.com");
      await db`
        insert into budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
        values (${other.requestId}, ${campaignId}, ${other.pi}, 300000000, 'processing')
      `;
    } finally {
      held.release();
    }
    expect(await refusal(await pending)).toEqual({
      status: 409,
      error: { code: "conflict", message: TOP_UP_CONFLICTS.inFlightOver },
    });
    const mine = topUpIntentsOf(campaignId).find(
      (intent) => intent.metadata.requestId === requestId,
    );
    expect(mine?.status).toBe("canceled");
    expect(payments.cancelCalls.map((call) => call.id)).toEqual([mine?.id]);
    expect(
      (await topUpRows(campaignId)).map((row) => [row.request_id, row.status, row.message]),
    ).toEqual([
      [other.requestId, "processing", null],
      [requestId, "failed", TOP_UP_MESSAGES.withdrawn],
    ]);
    await expectNoPayableOrphan(campaignId);
    expect(
      await refusal(await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId })),
    ).toEqual({ status: 409, error: { code: "conflict", message: TOP_UP_OVER_MESSAGE } });
  });
});

describe("a request whose payment was withdrawn can never be paid", () => {
  it("the database down for both the commit and the withdraw's record, then the same request: 409, never a dead secret", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const scripted = scriptedDb();
    const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
    const pending = topUpThrough(scripted, campaignId, requestId);
    try {
      await within(5_000, held.waiting(1), "the top-up reaching the provider");
      scripted.down = true;
    } finally {
      held.release();
    }
    const error = await rejectionOf(pending);
    expect(error).toBeInstanceOf(InjectedDbError);
    scripted.down = false;
    // The payment is cancelled, and nothing could record it.
    const [intent] = topUpIntentsOf(campaignId);
    if (intent === undefined) throw new Error("no intent was created");
    expect(intent.status).toBe("canceled");
    expect(await topUpRows(campaignId)).toEqual([]);
    // Stripe's canceled webhook comes, finds no top-up, and is acknowledged.
    await deliver("payment_intent.canceled", intent.id);
    expect(await topUpRows(campaignId)).toEqual([]);

    // The front retries with the same requestId: the provider answers the same (cancelled)
    // intent, which is read and found dead (without that read: 200 with the dead secret).
    const retry = await answerOf(
      await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId }),
    );
    expect(retry).toEqual({ status: 409, body: overBody });
    expect(JSON.stringify(retry)).not.toContain(intent.clientSecret);
    expect(await topUpRows(campaignId)).toMatchObject([
      {
        request_id: requestId,
        stripe_pi: intent.id,
        status: "failed",
        message: TOP_UP_MESSAGES.cancelled,
      },
    ]);
    // Nothing holds the campaign's slot: a new request goes through.
    const fresh = await topUpOk(campaignId);
    expect(fresh.requestId).not.toBe(requestId);
    await expectNoPayableOrphan(campaignId);
  });

  it("reads the status of every payment it creates, once, with the lock released", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const before = payments.retrieveCalls;
    await topUpOk(campaignId);
    expect(payments.retrieveCalls).toBe(before + 1);
  });
});

describe("every 409 of the route says whether the same requestId can succeed later", () => {
  it("the messages of a request that is over ask for a new request; the others for a retry", () => {
    for (const message of [
      TOP_UP_OVER_MESSAGE,
      TOP_UP_CONFLICTS.inFlightOver,
      TOP_UP_CONFLICTS.beingPaidOver,
      TOP_UP_CONFLICTS.justRequested,
      TOP_UP_CONFLICTS.usedElsewhere,
    ]) {
      expect(message).toContain("make a new request");
    }
    for (const message of [TOP_UP_CONFLICTS.inFlight, TOP_UP_CONFLICTS.beingPaid]) {
      expect(message).toContain("try again");
      expect(message).not.toContain("new request");
    }
  });

  it("a top-up on its way, refused before any payment: the same request goes through once it is credited", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const first = await topUpOk(campaignId);
    payments.pay(first.budgetPayment.paymentIntentId, "succeeded", "joe@example.com");
    await deliver("payment_intent.succeeded", first.budgetPayment.paymentIntentId);
    const requestId = randomUUID();
    const body = { amount: FIVE_HUNDRED.toString(), requestId };
    expect(await refusal(await topUp(campaignId, body))).toEqual({
      status: 409,
      error: { code: "conflict", message: TOP_UP_CONFLICTS.inFlight },
    });
    await db`
      update budget_top_ups set status = 'credited', tx_hash = ${`0x${"ef".repeat(32)}`}
      where stripe_pi = ${first.budgetPayment.paymentIntentId}
    `;
    expect(await topUpOk(campaignId, FIVE_HUNDRED, requestId)).toMatchObject({
      requestId,
      status: "requires_payment",
    });
  });

  it("a top-up being paid, refused before any payment: the same request goes through once that payment failed", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const first = await topUpOk(campaignId);
    const pi = first.budgetPayment.paymentIntentId;
    payments.pay(pi, "processing", "joe@example.com");
    const requestId = randomUUID();
    const body = { amount: FIVE_HUNDRED.toString(), requestId };
    expect(await refusal(await topUp(campaignId, body))).toEqual({
      status: 409,
      error: { code: "conflict", message: TOP_UP_CONFLICTS.beingPaid },
    });
    expect(topUpIntentsOf(campaignId)).toHaveLength(1);
    payments.pay(pi, "requires_payment_method", "joe@example.com");
    await deliver("payment_intent.payment_failed", pi);
    expect(await topUpOk(campaignId, FIVE_HUNDRED, requestId)).toMatchObject({
      requestId,
      status: "requires_payment",
    });
  });

  it("a promo not live yet: the same request goes through once it is", async () => {
    freshGateway();
    const campaignId = await liveCampaign({
      status: "funding",
      onchainId: null,
      slug: null,
      saleState: "closed",
    });
    const requestId = randomUUID();
    const body = { amount: FIVE_HUNDRED.toString(), requestId };
    expect(await refusal(await topUp(campaignId, body))).toEqual({
      status: 409,
      error: { code: "conflict", message: "This promo is not live yet" },
    });
    nextOnchainId += 1n;
    await db`
      update campaigns set status = 'live', sale_state = 'open', onchain_id = ${nextOnchainId}
      where id = ${campaignId}
    `;
    expect(await topUpOk(campaignId, FIVE_HUNDRED, requestId)).toMatchObject({ requestId });
  });
});

describe("a top-up whose payment a newer request cancelled, the newer request then refused", () => {
  async function raiseBudgetToTheCap(campaignId: string): Promise<void> {
    await db`update campaigns set budget = ${MAX_CARD_AMOUNT} where id = ${campaignId}`;
  }

  it.each([
    [
      "the campaign closes while the provider answers",
      closeItsSales,
      {
        status: 409,
        error: {
          code: "sales_closed",
          message: "Sales are closed for this promo: its budget can no longer be topped up",
        },
      },
    ],
    [
      "the budget reaches the cap while the provider answers",
      raiseBudgetToTheCap,
      {
        status: 400,
        error: {
          code: "invalid_request",
          message: "Invalid body.amount: the promo's budget would go above $999,999.99",
        },
      },
    ],
  ])(
    "%s: the cancelled top-up ends at once, and its repeat answers 409",
    async (_label, change, refused) => {
      freshGateway();
      const campaignId = await liveCampaign();
      const replaced = await topUpOk(campaignId);
      const pi = replaced.budgetPayment.paymentIntentId;
      const held = payments.holdTopUpCalls(["createBudgetTopUpPayment"]);
      const pending = topUp(campaignId, {
        amount: FIVE_HUNDRED.toString(),
        requestId: randomUUID(),
      });
      try {
        await within(5_000, held.waiting(1), "the top-up reaching the provider");
        await within(2_000, change(campaignId), "the change of the campaign");
      } finally {
        held.release();
      }
      expect(await refusal(await pending)).toEqual(refused);
      expect(payments.intents.get(pi)?.status).toBe("canceled");
      // Without ending it: 200 with the secret of its cancelled intent.
      const repeat = await answerOf(
        await topUp(campaignId, {
          amount: FIVE_HUNDRED.toString(),
          requestId: replaced.requestId,
        }),
      );
      expect(repeat).toEqual({ status: 409, body: overBody });
      expect(JSON.stringify(repeat)).not.toContain(replaced.budgetPayment.clientSecret);
      expect((await topUpRows(campaignId))[0]).toMatchObject({
        request_id: replaced.requestId,
        status: "failed",
        message: TOP_UP_MESSAGES.cancelledForNewer,
      });
      // The provider's late canceled webhook changes nothing.
      await deliver("payment_intent.canceled", pi);
      expect((await topUpRows(campaignId))[0]).toMatchObject({
        request_id: replaced.requestId,
        status: "failed",
        message: TOP_UP_MESSAGES.cancelledForNewer,
      });
      await expectNoPayableOrphan(campaignId);
    },
  );

  it("the creation of the newer payment fails: the cancelled top-up ends at once, and its repeat answers 409", async () => {
    freshGateway();
    const campaignId = await liveCampaign();
    const replaced = await topUpOk(campaignId);
    const pi = replaced.budgetPayment.paymentIntentId;
    payments.failure = new PaymentGatewayError("Stripe is down");
    const failed = await refusal(
      await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: randomUUID() }),
    );
    expect(failed.status).toBe(502);
    payments.failure = null;
    expect(payments.intents.get(pi)?.status).toBe("canceled");
    // Without ending it: 200 with the secret of its cancelled intent.
    const repeat = await answerOf(
      await topUp(campaignId, { amount: FIVE_HUNDRED.toString(), requestId: replaced.requestId }),
    );
    expect(repeat).toEqual({ status: 409, body: overBody });
    expect(JSON.stringify(repeat)).not.toContain(replaced.budgetPayment.clientSecret);
    expect(await topUpRows(campaignId)).toMatchObject([
      {
        request_id: replaced.requestId,
        status: "failed",
        message: TOP_UP_MESSAGES.cancelledForNewer,
      },
    ]);
    await deliver("payment_intent.canceled", pi);
    expect(await topUpRows(campaignId)).toMatchObject([
      { status: "failed", message: TOP_UP_MESSAGES.cancelledForNewer },
    ]);
    // The slot is free: a new request goes through without cancelling anything more.
    const cancels = payments.cancelCalls.length;
    await topUpOk(campaignId);
    expect(payments.cancelCalls).toHaveLength(cancels);
  });
});
