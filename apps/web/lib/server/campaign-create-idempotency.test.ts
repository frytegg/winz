import { randomUUID } from "node:crypto";

import {
  STRIPE_PAYMENT_KINDS,
  apiErrorSchema,
  createCampaignResponseSchema,
  type CampaignStatus,
  type CreateCampaignRequest,
  type Outcome,
} from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as postCampaigns } from "@/app/api/campaigns/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { CREATE_CAMPAIGN_CONFLICTS, createCampaign } from "./campaign-writes";
import { getCampaignDetail, listCampaigns } from "./campaigns";
import type { Db } from "./db";
import { setServerDepsForTesting } from "./deps";
import {
  PaymentGatewayError,
  type BudgetPaymentInput,
  type CreatedPaymentIntent,
  type PaymentGateway,
  type PaymentIntentView,
  type UnpaidCancellation,
} from "./payments-gateway";
import { ApiRouteError } from "./route";
import { FakePaymentGateway, HeldAnswers, type FakeIntent } from "./testing/fake-payments";
import {
  FakeIdentity,
  TEST_CONFIG,
  insertEvent,
  insertInstrument,
  insertMerchant,
  minutesFrom,
  randomWallet,
  serverDepsFor,
} from "./testing/fixtures";

/**
 * POST /api/campaigns made idempotent on the merchant's `requestId` (F-05, request 3.1 of the
 * front end): a double tap on "Fund $1,000" never creates two campaigns and two payments.
 * Against a real Postgres with every migration applied and the fake payment gateway.
 */

const now = new Date("2026-11-20T18:00:00.000Z");
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";
const startsAt = minutesFrom(now, 600);

let database: TestDatabase;
let db: Db;
let joe: string;
let ann: string;

type SlowCall = "retrievePaymentIntent" | "retrieveClientSecret" | "cancelUnpaidPaymentIntent";

/** The fake gateway, with its budget payment slowed down or its answer lost on demand. */
class BudgetGateway extends FakePaymentGateway {
  /** While set, `createBudgetPayment` does its work at once and answers once released. */
  gate: HeldAnswers | null = null;
  /** The next `createBudgetPayment` creates the intent, then fails as if its answer was lost. */
  loseNextAnswer = false;

  /** While set, the answers of these other calls are held too (a slow Stripe on every call). */
  slow: { calls: ReadonlySet<SlowCall>; gate: HeldAnswers } | null = null;

  override async createBudgetPayment(input: BudgetPaymentInput): Promise<CreatedPaymentIntent> {
    const created = await super.createBudgetPayment(input);
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      throw new PaymentGatewayError("the answer of Stripe was lost");
    }
    if (this.gate !== null) await this.gate.enter();
    return created;
  }

  override async retrievePaymentIntent(id: string): Promise<PaymentIntentView | null> {
    const intent = await super.retrievePaymentIntent(id);
    await this.slowAnswer("retrievePaymentIntent");
    return intent;
  }

  override async retrieveClientSecret(id: string): Promise<string | null> {
    const secret = await super.retrieveClientSecret(id);
    await this.slowAnswer("retrieveClientSecret");
    return secret;
  }

  override async cancelUnpaidPaymentIntent(id: string): Promise<UnpaidCancellation> {
    const result = await super.cancelUnpaidPaymentIntent(id);
    await this.slowAnswer("cancelUnpaidPaymentIntent");
    return result;
  }

  private async slowAnswer(call: SlowCall): Promise<void> {
    if (this.slow !== null && this.slow.calls.has(call)) await this.slow.gate.enter();
  }

  budgetIntents(): FakeIntent[] {
    return [...this.intents.values()].filter(
      (intent) => intent.metadata.kind === STRIPE_PAYMENT_KINDS.campaignBudget,
    );
  }
}

let payments: BudgetGateway;

function request(overrides: Partial<CreateCampaignRequest> = {}): CreateCampaignRequest {
  return {
    instrumentSymbol: SYMBOL,
    product: "Large pizza",
    unitPrice: "20000000",
    refundBps: 10_000,
    usualMarginBps: 6500,
    minMarginBps: 4500,
    budget: "1000000000",
    requestId: randomUUID(),
    ...overrides,
  };
}

async function campaignsOf(
  merchantId: string,
  requestId: string,
): Promise<{ id: string; budget_pi: string | null; status: string }[]> {
  return db<{ id: string; budget_pi: string | null; status: string }[]>`
    select id, budget_pi, status from campaigns
    where merchant_id = ${merchantId} and request_id = ${requestId}
  `;
}

async function refusal(promise: Promise<unknown>): Promise<ApiRouteError> {
  const error = await promise.then(
    () => new Error("expected a refusal"),
    (caught: unknown) => caught,
  );
  if (error instanceof ApiRouteError) return error;
  throw error;
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV", title: "Arkansas vs Texas", startsAt });
  await insertInstrument(db, {
    symbol: SYMBOL,
    eventTicker: "EV",
    label: "Texas wins by 14+",
    side: "home",
  });
  joe = (await insertMerchant(db, { email: "joe@example.com", privyId: "did:privy:joe" }))
    .merchantId;
  ann = (await insertMerchant(db, { email: "ann@example.com", name: "Ann's Bar" })).merchantId;
});

afterAll(async () => {
  await database.drop();
});

beforeEach(() => {
  payments = new BudgetGateway();
});

describe("the same requestId again", () => {
  it("answers the same campaign and payment, and creates nothing", async () => {
    const body = request();
    const first = await createCampaign(db, payments, joe, body, now);
    expect(createCampaignResponseSchema.parse(first)).toEqual(first);
    expect(first.status).toBe("funding");

    const again = await createCampaign(db, payments, joe, body, now);
    expect(again).toEqual(first);
    expect(payments.createCalls).toBe(1);
    expect(payments.budgetIntents()).toHaveLength(1);
    expect(payments.cancelCalls).toEqual([]);
    const rows = await campaignsOf(joe, body.requestId);
    expect(rows).toEqual([
      { id: first.campaignId, budget_pi: first.budgetPayment.paymentIntentId, status: "funding" },
    ]);
    // The intent is the campaign's budget payment, keyed on the campaign the request owns.
    expect(payments.intents.get(first.budgetPayment.paymentIntentId)).toMatchObject({
      amount: 1_000_000_000n,
      metadata: { kind: "campaign_budget", campaignId: first.campaignId },
      idempotencyKey: `campaign_budget:${first.campaignId}`,
    });
  });

  // Every state the campaign can have reached since: the answer is the same campaign and payment,
  // with the status of the moment. The engine's projection is imitated by updating the row.
  it.each([
    ["funding", null, false],
    ["funding", null, true],
    ["live", null, true],
    ["paused", null, true],
    ["sales_closed", null, true],
    ["settled_yes", "yes", true],
    ["settled_no", "no", true],
    ["void", "void", true],
    ["closed", "no", true],
  ] as const satisfies readonly (readonly [CampaignStatus, Outcome | null, boolean])[])(
    "answers it once the campaign is %s (outcome %s, budget paid: %s)",
    async (status, outcome, paid) => {
      const body = request();
      const first = await createCampaign(db, payments, joe, body, now);
      const pi = first.budgetPayment.paymentIntentId;
      if (paid) payments.pay(pi, "succeeded", null);
      if (status !== "funding") {
        // Live on-chain, later topped up by $500: the stored budget moved, the payment did not.
        await db`
          update campaigns
          set status = ${status}, outcome = ${outcome}, slug = ${`joes-${randomUUID().slice(0, 8)}`},
              onchain_id = ${BigInt(Math.floor(Math.random() * 1e9))}, live_at = ${now},
              sale_state = 'closed', budget = budget + 500000000
          where id = ${first.campaignId}
        `;
      }
      // Asked again a day later, sales long closed: still the same answer.
      const later = minutesFrom(now, 24 * 60);
      const again = await createCampaign(db, payments, joe, body, later);
      expect(again).toEqual({ ...first, status });
      expect(payments.createCalls).toBe(1);
      expect(payments.budgetIntents()).toHaveLength(1);
      expect(payments.cancelCalls).toEqual([]);
      expect(await campaignsOf(joe, body.requestId)).toHaveLength(1);
    },
  );

  it.each([
    ["budget", { budget: "2000000000" }],
    ["product", { product: "Small pizza" }],
    ["unit price", { unitPrice: "25000000" }],
    ["refund rate", { refundBps: 5000 }],
    ["usual margin", { usualMarginBps: 7000 }],
    ["minimum margin", { minMarginBps: 4000 }],
  ] as const)("refuses the same requestId with another %s (409)", async (_name, change) => {
    const body = request();
    const first = await createCampaign(db, payments, joe, body, now);
    const error = await refusal(createCampaign(db, payments, joe, { ...body, ...change }, now));
    expect({ status: error.status, code: error.code, message: error.message }).toEqual({
      status: 409,
      code: "conflict",
      message: CREATE_CAMPAIGN_CONFLICTS.usedElsewhere,
    });
    expect(payments.createCalls).toBe(1);
    expect(payments.cancelCalls).toEqual([]);
    expect(await campaignsOf(joe, body.requestId)).toEqual([
      { id: first.campaignId, budget_pi: first.budgetPayment.paymentIntentId, status: "funding" },
    ]);
  });

  it("refuses another condition with the same requestId (409)", async () => {
    const other = "GEMI-NCAAF-ARK-TEX-M-TEX";
    await insertInstrument(db, {
      symbol: other,
      eventTicker: "EV",
      label: "Texas wins",
      type: "moneyline",
      side: "home",
    });
    const body = request();
    await createCampaign(db, payments, joe, body, now);
    const error = await refusal(
      createCampaign(db, payments, joe, { ...body, instrumentSymbol: other }, now),
    );
    expect(error.status).toBe(409);
    expect(await campaignsOf(joe, body.requestId)).toHaveLength(1);
  });

  it("lets another merchant use the same uuid: the uniqueness is per merchant", async () => {
    const body = request();
    const joes = await createCampaign(db, payments, joe, body, now);
    const anns = await createCampaign(db, payments, ann, body, now);
    expect(anns.campaignId).not.toBe(joes.campaignId);
    expect(anns.budgetPayment.paymentIntentId).not.toBe(joes.budgetPayment.paymentIntentId);
    expect(await campaignsOf(joe, body.requestId)).toHaveLength(1);
    expect(await campaignsOf(ann, body.requestId)).toHaveLength(1);
    // Each one's repeat still answers its own.
    expect(await createCampaign(db, payments, ann, body, now)).toEqual(anns);
    expect(await createCampaign(db, payments, joe, body, now)).toEqual(joes);
  });
});

describe("a double tap", () => {
  it("with the provider slow: one campaign, one intent, no cancel, both answered the same", async () => {
    const gate = new HeldAnswers();
    payments.gate = gate;
    const body = request();
    const taps = Promise.all([
      createCampaign(db, payments, joe, body, now),
      createCampaign(db, payments, joe, body, now),
    ]);
    // Both calls are inside the provider at the same time: neither waits on a database lock.
    await gate.waiting(2);
    gate.release();
    const [first, second] = await taps;
    expect(second).toEqual(first);
    expect(await campaignsOf(joe, body.requestId)).toEqual([
      { id: first.campaignId, budget_pi: first.budgetPayment.paymentIntentId, status: "funding" },
    ]);
    expect(payments.budgetIntents()).toHaveLength(1);
    expect(payments.cancelCalls).toEqual([]);
    expect(payments.intents.get(first.budgetPayment.paymentIntentId)?.status).toBe(
      "requires_payment_method",
    );
  });

  it("of five calls at once still makes one campaign and one intent", async () => {
    const body = request();
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => createCampaign(db, payments, joe, body, now)),
    );
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(await campaignsOf(joe, body.requestId)).toHaveLength(1);
    expect(payments.budgetIntents()).toHaveLength(1);
    expect(payments.cancelCalls).toEqual([]);
  });
});

/** Makes the recording of a budget payment fail for campaigns of this product. */
async function failRecordingOf(product: string): Promise<void> {
  await db.unsafe(`
    create or replace function test_fail_budget_record() returns trigger
    language plpgsql as $$
    begin
      raise exception 'recording refused by the test';
    end;
    $$
  `);
  await db.unsafe(`
    create trigger test_fail_budget_record before update of budget_pi on public.campaigns
    for each row when (new.product = '${product}' and new.budget_pi is not null)
    execute function test_fail_budget_record()
  `);
}

async function stopFailing(): Promise<void> {
  await db.unsafe(`drop trigger if exists test_fail_budget_record on public.campaigns`);
}

/** Connections of this test's database that hold a transaction open while doing nothing. */
async function idleTransactions(): Promise<number> {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from pg_stat_activity
    where datname = current_database() and state like 'idle in transaction%'
  `;
  return row?.count ?? 0;
}

describe("no call to the payment provider while a transaction or a lock is held", () => {
  it("a transaction left open while waiting is seen by the measure (control)", async () => {
    // The creation without a requestId used to be this control (it held its transaction open
    // across the provider's answer); the field is now required, so the control holds one itself.
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened: () => void = () => undefined;
    const isOpen = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const pending = db.begin(async (tx) => {
      await tx`select id from campaigns limit 1`;
      opened();
      await released;
    });
    try {
      await isOpen;
      await expect.poll(() => idleTransactions()).toBe(1);
    } finally {
      release();
    }
    await pending;
    expect(await idleTransactions()).toBe(0);
  });

  it("creating the payment: no transaction open, the claimed row lockable at once", async () => {
    const gate = new HeldAnswers();
    payments.gate = gate;
    const body = request();
    const pending = createCampaign(db, payments, joe, body, now);
    try {
      await gate.waiting(1);
      expect(await idleTransactions()).toBe(0);
      // The row the request claimed is committed and nobody holds its lock.
      const locked = await db.begin(
        (tx) => tx`
          select id from campaigns
          where merchant_id = ${joe} and request_id = ${body.requestId}
          for update nowait
        `,
      );
      expect(locked).toHaveLength(1);
    } finally {
      gate.release();
    }
    expect((await pending).status).toBe("funding");
  });

  it.each([["retrievePaymentIntent" as const], ["retrieveClientSecret" as const]])(
    "answering a repeat (%s): no transaction open, the campaign lockable at once",
    async (call) => {
      const body = request();
      const first = await createCampaign(db, payments, joe, body, now);
      const gate = new HeldAnswers();
      payments.slow = { calls: new Set([call]), gate };
      const pending = createCampaign(db, payments, joe, body, now);
      try {
        await gate.waiting(1);
        expect(await idleTransactions()).toBe(0);
        const locked = await db.begin(
          (tx) => tx`select id from campaigns where id = ${first.campaignId} for update nowait`,
        );
        expect(locked).toHaveLength(1);
      } finally {
        gate.release();
      }
      expect(await pending).toEqual(first);
    },
  );

  it("withdrawing a payment it could not record: the cancel is sent with no transaction open", async () => {
    const body = request({ product: "Slow cancel" });
    await failRecordingOf("Slow cancel");
    const gate = new HeldAnswers();
    payments.slow = { calls: new Set(["cancelUnpaidPaymentIntent"]), gate };
    const pending = createCampaign(db, payments, joe, body, now).then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await gate.waiting(1);
      expect(await idleTransactions()).toBe(0);
      // The claim was discarded before the cancel was sent.
      expect(await campaignsOf(joe, body.requestId)).toEqual([]);
    } finally {
      gate.release();
      await stopFailing();
    }
    expect(String(await pending)).toMatch(/recording refused by the test/);
    expect(payments.budgetIntents().map((intent) => intent.status)).toEqual(["canceled"]);
  });
});

describe("a payment created and then not recorded", () => {
  it("is withdrawn when the recording fails, and a retry of the same request then succeeds", async () => {
    const body = request({ product: "Fail record" });
    await failRecordingOf("Fail record");
    try {
      await expect(createCampaign(db, payments, joe, body, now)).rejects.toThrow(
        /recording refused by the test/,
      );
    } finally {
      await stopFailing();
    }
    const [withdrawn] = payments.budgetIntents();
    expect(payments.budgetIntents()).toHaveLength(1);
    expect(withdrawn?.status).toBe("canceled");
    expect(payments.cancelCalls.map((call) => call.id)).toEqual([withdrawn?.id]);
    // Its campaign is gone with it: nothing was answered, nothing remains.
    expect(await campaignsOf(joe, body.requestId)).toEqual([]);

    const retried = await createCampaign(db, payments, joe, body, now);
    expect(retried.status).toBe("funding");
    expect(retried.budgetPayment.paymentIntentId).not.toBe(withdrawn?.id);
    expect(payments.intents.get(retried.budgetPayment.paymentIntentId)?.status).toBe(
      "requires_payment_method",
    );
    expect(await campaignsOf(joe, body.requestId)).toEqual([
      {
        id: retried.campaignId,
        budget_pi: retried.budgetPayment.paymentIntentId,
        status: "funding",
      },
    ]);
    expect(await createCampaign(db, payments, joe, body, now)).toEqual(retried);
  });

  it("whose cancel fails: the request still fails cleanly, and its retry gets a fresh payment", async () => {
    const body = request({ product: "Cancel fails" });
    await failRecordingOf("Cancel fails");
    payments.topUpFailure = new PaymentGatewayError("Stripe is down for the cancel");
    try {
      await expect(createCampaign(db, payments, joe, body, now)).rejects.toThrow(
        /recording refused by the test/,
      );
    } finally {
      payments.topUpFailure = null;
      await stopFailing();
    }
    // The cancel was asked and failed: the intent stays unpaid, its client secret never answered
    // (logged at error, to be refunded by hand if anyone ever paid it). Its claim is gone.
    const [orphan] = payments.budgetIntents();
    expect(payments.cancelCalls.map((call) => call.id)).toEqual([orphan?.id]);
    expect(orphan?.status).toBe("requires_payment_method");
    expect(await campaignsOf(joe, body.requestId)).toEqual([]);

    const retried = await createCampaign(db, payments, joe, body, now);
    expect(retried.budgetPayment.paymentIntentId).not.toBe(orphan?.id);
    expect(await campaignsOf(joe, body.requestId)).toEqual([
      {
        id: retried.campaignId,
        budget_pi: retried.budgetPayment.paymentIntentId,
        status: "funding",
      },
    ]);
  });

  it("is answered again, not created twice, when the provider's answer was lost", async () => {
    const body = request();
    payments.loseNextAnswer = true;
    const error = await refusal(createCampaign(db, payments, joe, body, now));
    expect(error.status).toBe(502);
    const [created] = payments.budgetIntents();
    expect(created).toBeDefined();
    // The request's campaign is kept, out of the merchant's list until its payment is recorded.
    const [claim] = await campaignsOf(joe, body.requestId);
    expect(claim).toMatchObject({ budget_pi: null, status: "funding" });
    const listed = await listCampaigns(db, joe, now);
    expect(listed.campaigns.map((campaign) => campaign.id)).not.toContain(claim?.id);
    await expect(
      getCampaignDetail(db, joe, claim?.id ?? "", TEST_CONFIG, now),
    ).rejects.toMatchObject({ status: 404 });

    const retried = await createCampaign(db, payments, joe, body, now);
    expect(retried.campaignId).toBe(claim?.id);
    expect(retried.budgetPayment.paymentIntentId).toBe(created?.id);
    expect(payments.budgetIntents()).toHaveLength(1);
    expect(payments.cancelCalls).toEqual([]);
    const after = await listCampaigns(db, joe, now);
    expect(after.campaigns.map((campaign) => campaign.id)).toContain(claim?.id);
  });

  it("starts over when the provider replays an intent cancelled meanwhile", async () => {
    // What a withdrawal leaves when the database was down: the campaign row without a payment,
    // and the intent of its key cancelled at the provider.
    const body = request();
    payments.loseNextAnswer = true;
    await refusal(createCampaign(db, payments, joe, body, now));
    const [stale] = payments.budgetIntents();
    await payments.cancelUnpaidPaymentIntent(stale?.id ?? "");
    const [leftover] = await campaignsOf(joe, body.requestId);

    const retried = await createCampaign(db, payments, joe, body, now);
    expect(retried.campaignId).not.toBe(leftover?.id);
    expect(retried.budgetPayment.paymentIntentId).not.toBe(stale?.id);
    expect(payments.intents.get(retried.budgetPayment.paymentIntentId)?.status).toBe(
      "requires_payment_method",
    );
    expect(await campaignsOf(joe, body.requestId)).toEqual([
      {
        id: retried.campaignId,
        budget_pi: retried.budgetPayment.paymentIntentId,
        status: "funding",
      },
    ]);
  });

  it("starts over when the recorded payment of a funding campaign was cancelled", async () => {
    const body = request();
    const first = await createCampaign(db, payments, joe, body, now);
    await payments.cancelUnpaidPaymentIntent(first.budgetPayment.paymentIntentId);
    const retried = await createCampaign(db, payments, joe, body, now);
    expect(retried.campaignId).not.toBe(first.campaignId);
    expect(retried.budgetPayment.paymentIntentId).not.toBe(first.budgetPayment.paymentIntentId);
    expect(await campaignsOf(joe, body.requestId)).toHaveLength(1);
    // A cancelled payment is never answered: its client secret could not be paid.
    expect(await createCampaign(db, payments, joe, body, now)).toEqual(retried);
  });
});

describe("POST /api/campaigns through its handler", () => {
  const identity = new FakeIdentity();
  const JOE = { authorization: "Bearer joe-token" };

  function post(body: unknown): Request {
    return new Request("http://localhost/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json", ...JOE },
      body: JSON.stringify(body),
    });
  }
  const noParams = { params: Promise.resolve({}) };

  beforeAll(() => {
    identity.addUser("joe-token", "did:privy:joe", {
      email: "joe@example.com",
      walletAddress: randomWallet(),
    });
  });
  afterAll(() => {
    setServerDepsForTesting(undefined);
  });

  it("answers the same JSON to the same requestId, and 409 to other terms", async () => {
    setServerDepsForTesting(serverDepsFor(db, identity, now, payments));
    const body = request();
    const first = await postCampaigns(post(body), noParams);
    expect(first.status).toBe(200);
    const firstJson: unknown = await first.json();
    const second = await postCampaigns(post(body), noParams);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstJson);
    expect(payments.budgetIntents()).toHaveLength(1);

    const other = await postCampaigns(post({ ...body, budget: "3000000000" }), noParams);
    expect(other.status).toBe(409);
    expect(apiErrorSchema.parse(await other.json()).error.message).toBe(
      CREATE_CAMPAIGN_CONFLICTS.usedElsewhere,
    );
  });

  it("refuses a body without a requestId (400 invalid_request) and creates nothing", async () => {
    setServerDepsForTesting(serverDepsFor(db, identity, now, payments));
    const { requestId: _requestId, ...body } = request({ product: "No request id" });
    const response = await postCampaigns(post(body), noParams);
    expect(response.status).toBe(400);
    const { error } = apiErrorSchema.parse(await response.json());
    expect(error.code).toBe("invalid_request");
    expect(error.message).toMatch(/^Invalid body\.requestId: /);
    expect(payments.createCalls).toBe(0);
    const rows = await db`select id from campaigns where product = 'No request id'`;
    expect(rows).toHaveLength(0);
  });

  it("refuses a requestId that is not a uuid (400) and creates nothing", async () => {
    setServerDepsForTesting(serverDepsFor(db, identity, now, payments));
    const response = await postCampaigns(post({ ...request(), requestId: "tap-1" }), noParams);
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.message).toMatch(/requestId/);
    expect(payments.createCalls).toBe(0);
  });

  it("answers 503 with a requestId when the gateway cannot cancel or read a payment", async () => {
    const plain: PaymentGateway = {
      createBudgetPayment: (input) => payments.createBudgetPayment(input),
      createPurchaseAuthorization: (input) => payments.createPurchaseAuthorization(input),
      retrievePaymentIntent: (id) => payments.retrievePaymentIntent(id),
      parseWebhook: (raw, signature) => payments.parseWebhook(raw, signature),
    };
    const error = await refusal(createCampaign(db, plain, joe, request(), now));
    expect(error.status).toBe(503);
    expect(payments.createCalls).toBe(0);
  });
});
