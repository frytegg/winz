import { randomUUID } from "node:crypto";

import { maxCostBps, pauseThresholdBps } from "@winz/pricing";
import {
  JOB_KINDS,
  campaignActionResponseSchema,
  createCampaignResponseSchema,
  jobIdempotencyKey,
  type CreateCampaignRequest,
  type CreateCampaignResponse,
} from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  closeCampaign,
  createCampaign,
  parseCampaignTerms,
  pauseCampaign,
  promiseText,
  resumeCampaign,
} from "./campaign-writes";
import type { Db } from "./db";
import { PaymentGatewayError } from "./payments-gateway";
import { ApiRouteError } from "./route";
import { FakePaymentGateway } from "./testing/fake-payments";
import {
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  minutesFrom,
} from "./testing/fixtures";

const now = new Date("2026-11-20T18:00:00.000Z");
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";
const PAST_SYMBOL = "GEMI-NCAAF-OLD-S-1";
const SETTLED_SYMBOL = "GEMI-NCAAF-ARK-TEX-SETTLED";
const INACTIVE_SYMBOL = "GEMI-NCAAF-ARK-TEX-OFF";
const startsAt = minutesFrom(now, 600);

let database: TestDatabase;
let db: Db;
let joe: string;
let ann: string;

const terms: CreateCampaignRequest = {
  instrumentSymbol: SYMBOL,
  product: "Large pizza",
  unitPrice: "20000000",
  refundBps: 10_000,
  usualMarginBps: 6500,
  minMarginBps: 4500,
  budget: "1000000000",
  requestId: "6f1d1c3e-9b7a-4c55-8f3e-2a1b0c9d8e7f",
};

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
  message?: RegExp,
): Promise<ApiRouteError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiRouteError);
  const apiError = error as ApiRouteError;
  expect({ status: apiError.status, code: apiError.code }).toEqual({ status, code });
  if (message) expect(apiError.message).toMatch(message);
  return apiError;
}

async function countRows(table: "campaigns" | "jobs"): Promise<number> {
  const [row] = await db<{ n: bigint }[]>`select count(*)::bigint as n from ${db(table)}`;
  return Number(row?.n ?? 0n);
}

async function jobsOf(campaignId: string): Promise<{ kind: string; payload: unknown }[]> {
  return db<{ kind: string; payload: unknown }[]>`
    select kind, payload from jobs
    where payload ->> 'campaignId' = ${campaignId}
    order by created_at, id
  `;
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV", title: "Arkansas vs Texas", startsAt });
  await insertEvent(db, {
    ticker: "OLD",
    startsAt: minutesFrom(now, 3),
    salesCloseAt: minutesFrom(now, -2),
  });
  await insertInstrument(db, { symbol: SYMBOL, eventTicker: "EV", label: "Texas wins by 14+" });
  await insertInstrument(db, { symbol: PAST_SYMBOL, eventTicker: "OLD", label: "Old game" });
  await insertInstrument(db, {
    symbol: INACTIVE_SYMBOL,
    eventTicker: "EV",
    label: "Off",
    active: false,
  });
  await insertInstrument(db, { symbol: SETTLED_SYMBOL, eventTicker: "EV", label: "Settled" });
  await db`update instruments set outcome = 'no', settled_at = now() where symbol = ${SETTLED_SYMBOL}`;
  joe = (await insertMerchant(db, { email: "joe@example.com" })).merchantId;
  ann = (await insertMerchant(db, { email: "ann@example.com", name: "Ann's Bar" })).merchantId;
});

afterAll(async () => {
  await database.drop();
});

describe("promiseText", () => {
  it("prints the refund rate as a percent", () => {
    expect(promiseText(10_000n, "Texas wins by 14+")).toBe("100% back if Texas wins by 14+");
    expect(promiseText(5_000n, "Texas wins")).toBe("50% back if Texas wins");
    expect(promiseText(1_250n, "Over 50.5")).toBe("12.5% back if Over 50.5");
  });
});

describe("parseCampaignTerms", () => {
  it.each([
    ["unitPrice", { unitPrice: "20005000" }, /unitPrice: must be a whole number of cents/],
    ["unitPrice", { unitPrice: "1" }, /unitPrice: must be a whole number of cents/],
    ["unitPrice", { unitPrice: "100000" }, /unitPrice: must be at least \$0.50/],
    ["budget", { budget: "0" }, /budget: must be above zero/],
    ["budget", { budget: "1000000001" }, /budget: must be a whole number of cents/],
    ["budget", { budget: "1000000000000" }, /budget: must be at most/],
    ["minMarginBps", { minMarginBps: 7000 }, /minMarginBps: must not be above the usual margin/],
    ["product", { product: "   " }, /product: must not be blank/],
  ])("refuses a bad %s with a clear 400", (_field, change, message) => {
    expect(() => parseCampaignTerms({ ...terms, ...change })).toThrow(message);
    try {
      parseCampaignTerms({ ...terms, ...change });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiRouteError);
      expect((error as ApiRouteError).status).toBe(400);
      expect((error as ApiRouteError).code).toBe("invalid_request");
    }
  });

  it("accepts equal margins and trims the product", () => {
    const parsed = parseCampaignTerms({
      ...terms,
      product: "  Pizza ",
      minMarginBps: 6500,
    });
    expect(parsed.product).toBe("Pizza");
    expect(parsed.unitPrice).toBe(20_000_000n);
  });
});

describe("createCampaign", () => {
  let payments: FakePaymentGateway;
  beforeEach(() => {
    payments = new FakePaymentGateway();
  });

  /** One "Fund" tap: these terms under a fresh `requestId`, so no test answers another's request. */
  function create(body: CreateCampaignRequest = terms): Promise<CreateCampaignResponse> {
    return createCampaign(db, payments, joe, { ...body, requestId: randomUUID() }, now);
  }

  async function rowsOfRequest(
    requestId: string,
  ): Promise<{ status: string; budget_pi: string | null }[]> {
    return db<{ status: string; budget_pi: string | null }[]>`
      select status, budget_pi from campaigns where merchant_id = ${joe} and request_id = ${requestId}
    `;
  }

  it("inserts a funding campaign with its budget payment and the computed terms", async () => {
    const response = await create();
    expect(createCampaignResponseSchema.parse(response)).toEqual(response);
    expect(response.status).toBe("funding");
    expect(response.budgetPayment.amount).toBe("1000000000");

    const intent = payments.intents.get(response.budgetPayment.paymentIntentId);
    expect(intent).toMatchObject({
      amount: 1_000_000_000n,
      captureMethod: "automatic",
      metadata: { kind: "campaign_budget", campaignId: response.campaignId },
    });
    expect(response.budgetPayment.clientSecret).toBe(intent?.clientSecret);

    const [row] = await db`
      select * from campaigns where id = ${response.campaignId}
    `;
    expect(row).toMatchObject({
      merchant_id: joe,
      instrument: SYMBOL,
      event_ticker: "EV",
      product: "Large pizza",
      condition_label: "Texas wins by 14+",
      promise: "100% back if Texas wins by 14+",
      unit_price: 20_000_000n,
      refund_bps: 10_000,
      usual_margin_bps: 6500,
      min_margin_bps: 4500,
      pause_threshold_bps: Number(pauseThresholdBps(maxCostBps(6500n, 4500n), 10_000n)),
      budget: 1_000_000_000n,
      status: "funding",
      sale_state: "closed",
      budget_pi: response.budgetPayment.paymentIntentId,
      slug: null,
    });
    expect(row?.pause_threshold_bps).toBe(1800);
    const [event] = await db<{ sales_close_at: Date }[]>`
      select sales_close_at from events where ticker = 'EV'
    `;
    expect((row?.sales_close as Date).getTime()).toBe(event?.sales_close_at.getTime());
    // No job before the budget is paid: the webhook enqueues the creation.
    expect(await jobsOf(response.campaignId)).toEqual([]);
  });

  it("prints a partial refund in the promise", async () => {
    const response = await create({ ...terms, refundBps: 5000 });
    const [row] = await db<{ promise: string }[]>`
      select promise from campaigns where id = ${response.campaignId}
    `;
    expect(row?.promise).toBe("50% back if Texas wins by 14+");
  });

  it("refuses a price that is not whole cents before creating anything", async () => {
    const before = await countRows("campaigns");
    await expectApiError(
      create({ ...terms, unitPrice: "19999999" }),
      400,
      "invalid_request",
      /whole number of cents/,
    );
    expect(await countRows("campaigns")).toBe(before);
    expect(payments.createCalls).toBe(0);
  });

  it.each([
    ["unknown", "NOPE"],
    ["inactive", INACTIVE_SYMBOL],
    ["settled", SETTLED_SYMBOL],
  ])("refuses an %s instrument with 404", async (_case, symbol) => {
    await expectApiError(create({ ...terms, instrumentSymbol: symbol }), 404, "not_found");
    expect(payments.createCalls).toBe(0);
  });

  it("refuses a game whose sales already closed", async () => {
    await expectApiError(create({ ...terms, instrumentSymbol: PAST_SYMBOL }), 409, "sales_closed");
    expect(payments.createCalls).toBe(0);
  });

  it("answers 502 when the payment provider fails, and its retry makes one campaign", async () => {
    payments.failure = new PaymentGatewayError("Stripe is down");
    const body = { ...terms, requestId: randomUUID() };
    const before = await countRows("campaigns");
    await expectApiError(createCampaign(db, payments, joe, body, now), 502, "internal");
    expect(payments.createCalls).toBe(1);
    // The claim stays, unpaid and without a payment, for the retry of the same request to find.
    expect(await rowsOfRequest(body.requestId)).toEqual([{ status: "funding", budget_pi: null }]);

    payments.failure = null;
    const retried = await createCampaign(db, payments, joe, body, now);
    expect(await countRows("campaigns")).toBe(before + 1);
    expect(await rowsOfRequest(body.requestId)).toEqual([
      { status: "funding", budget_pi: retried.budgetPayment.paymentIntentId },
    ]);
  });

  it("lets an unexpected provider error through, and its retry makes one campaign", async () => {
    payments.failure = new Error("boom");
    const body = { ...terms, requestId: randomUUID() };
    const before = await countRows("campaigns");
    await expect(createCampaign(db, payments, joe, body, now)).rejects.toThrow("boom");

    payments.failure = null;
    const retried = await createCampaign(db, payments, joe, body, now);
    expect(await countRows("campaigns")).toBe(before + 1);
    expect(await rowsOfRequest(body.requestId)).toEqual([
      { status: "funding", budget_pi: retried.budgetPayment.paymentIntentId },
    ]);
  });
});

describe("manual pause, resume and close", () => {
  const salesClose = minutesFrom(now, 595);

  async function campaign(
    overrides: Partial<Parameters<typeof insertCampaign>[1]> = {},
  ): Promise<string> {
    return insertCampaign(db, {
      merchantId: joe,
      instrument: SYMBOL,
      eventTicker: "EV",
      salesClose,
      ...overrides,
    });
  }

  async function stored(id: string): Promise<{ status: string; sale_state: string }> {
    const [row] = await db<{ status: string; sale_state: string }[]>`
      select status, sale_state from campaigns where id = ${id}
    `;
    if (!row) throw new Error("campaign vanished");
    return row;
  }

  it("pause sets paused_manual at once and enqueues setPaused", async () => {
    const id = await campaign();
    const response = await pauseCampaign(db, joe, id, now, "11111111-1111-4111-8111-111111111111");
    expect(campaignActionResponseSchema.parse(response)).toEqual({
      status: "live",
      saleState: "paused_manual",
    });
    expect(await stored(id)).toEqual({ status: "live", sale_state: "paused_manual" });
    const [job] = await db`
      select kind, status, payload from jobs
      where idempotency_key = ${jobIdempotencyKey.setPaused("11111111-1111-4111-8111-111111111111")}
    `;
    expect(job).toMatchObject({
      kind: JOB_KINDS.setPaused,
      status: "queued",
      payload: { campaignId: id, paused: true, requestId: "11111111-1111-4111-8111-111111111111" },
    });
  });

  it("refuses to pause twice, or anything not live", async () => {
    const id = await campaign();
    await pauseCampaign(db, joe, id, now);
    await expectApiError(pauseCampaign(db, joe, id, now), 409, "conflict", /already paused/);
    for (const status of ["funding", "draft", "paused", "sales_closed"] as const) {
      const other = await campaign({ status });
      await expectApiError(pauseCampaign(db, joe, other, now), 409, "conflict");
    }
    const closed = await campaign({ saleState: "closed" });
    await expectApiError(pauseCampaign(db, joe, closed, now), 409, "conflict");
    expect((await jobsOf(id)).length).toBe(1);
  });

  it("refuses every action after settlement and after sales close", async () => {
    const settled = await campaign({ status: "settled_yes", outcome: "yes", saleState: "closed" });
    const late = await campaign({ salesClose: minutesFrom(now, -1) });
    for (const id of [settled, late]) {
      await expectApiError(pauseCampaign(db, joe, id, now), 409, "conflict");
      await expectApiError(resumeCampaign(db, joe, id, now), 409, "conflict");
      await expectApiError(closeCampaign(db, joe, id, now), 409, "conflict");
      expect(await jobsOf(id)).toEqual([]);
    }
  });

  it("answers 404 for another merchant's campaign and changes nothing", async () => {
    const id = await campaign();
    await expectApiError(pauseCampaign(db, ann, id, now), 404, "not_found");
    await expectApiError(resumeCampaign(db, ann, id, now), 404, "not_found");
    await expectApiError(closeCampaign(db, ann, id, now), 404, "not_found");
    await expectApiError(pauseCampaign(db, joe, "not-a-uuid", now), 404, "not_found");
    expect(await stored(id)).toEqual({ status: "live", sale_state: "open" });
    expect(await jobsOf(id)).toEqual([]);
  });

  it("resume enqueues setPaused(false) once and leaves sale_state to the engine", async () => {
    const id = await campaign();
    await expectApiError(resumeCampaign(db, joe, id, now), 409, "conflict", /not paused/);
    await pauseCampaign(db, joe, id, now);
    const response = await resumeCampaign(db, joe, id, now);
    expect(campaignActionResponseSchema.parse(response)).toEqual({
      status: "live",
      saleState: "paused_manual",
    });
    // A second click while the resume waits in the queue adds nothing.
    await resumeCampaign(db, joe, id, now);
    const jobs = await jobsOf(id);
    expect(jobs.map((job) => (job.payload as { paused: boolean }).paused)).toEqual([true, false]);
    expect(await stored(id)).toEqual({ status: "live", sale_state: "paused_manual" });
  });

  it("resumes a campaign the engine projected as paused on-chain", async () => {
    const id = await campaign({ status: "paused", saleState: "paused_manual" });
    const response = await resumeCampaign(db, joe, id, now);
    expect(response).toEqual({ status: "paused", saleState: "paused_manual" });
    expect((await jobsOf(id)).length).toBe(1);
  });

  it("close sets sale_state closed and enqueues closeSales once", async () => {
    const id = await campaign({ status: "paused", saleState: "paused_manual" });
    const response = await closeCampaign(db, joe, id, now);
    expect(campaignActionResponseSchema.parse(response)).toEqual({
      status: "paused",
      saleState: "closed",
    });
    expect(await stored(id)).toEqual({ status: "paused", sale_state: "closed" });
    await expectApiError(closeCampaign(db, joe, id, now), 409, "conflict");
    await expectApiError(pauseCampaign(db, joe, id, now), 409, "conflict");
    const jobs = await jobsOf(id);
    expect(jobs).toEqual([{ kind: JOB_KINDS.closeSales, payload: { campaignId: id } }]);
  });

  it("refuses to close a campaign that is not live yet", async () => {
    const id = await campaign({ status: "funding", saleState: "closed" });
    await expectApiError(closeCampaign(db, joe, id, now), 409, "conflict");
  });
});
