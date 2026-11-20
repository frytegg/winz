import { randomUUID } from "node:crypto";

import {
  STRIPE_PAYMENT_KINDS,
  apiErrorSchema,
  campaignDetailSchema,
  type CreateCampaignRequest,
  type CreateCampaignResponse,
} from "@winz/shared";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getDetail } from "@/app/api/campaigns/[id]/route";
import { POST as postClose } from "@/app/api/campaigns/[id]/close/route";
import { POST as postPause } from "@/app/api/campaigns/[id]/pause/route";
import { POST as postResume } from "@/app/api/campaigns/[id]/resume/route";
import { POST as postTopUp } from "@/app/api/campaigns/[id]/top-up/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  CREATE_CAMPAIGN_CONFLICTS,
  MAX_PAYMENT_IN_PROGRESS_WAITS,
  PAYMENT_IN_PROGRESS_PAUSE_MS,
  createCampaign,
} from "./campaign-writes";
import type { Db } from "./db";
import { setServerDepsForTesting } from "./deps";
import {
  BUDGET_REQUEST_MAX_RETRIES,
  BUDGET_REQUEST_TIMEOUT_MS,
  PaymentGatewayError,
  PaymentRequestInProgressError,
  StripePaymentGateway,
  type BudgetPaymentInput,
  type CreatedPaymentIntent,
} from "./payments-gateway";
import { ApiRouteError } from "./route";
import {
  FakePaymentGateway,
  HeldAnswers,
  TEST_WEBHOOK_SECRET,
  type FakeIntent,
} from "./testing/fake-payments";
import {
  FakeIdentity,
  insertEvent,
  insertInstrument,
  insertMerchant,
  minutesFrom,
  randomWallet,
  serverDepsFor,
} from "./testing/fixtures";

/**
 * The edges of the idempotent campaign creation (POST /api/campaigns with a `requestId`, SPEC
 * section 10): a true double tap against Stripe's real client, whose second call Stripe refuses
 * while the first is in progress; the guards that keep a payment answered by one call from being
 * cancelled or overwritten by its twin; and the claim of a request whose payment was never
 * recorded, which no route taking a campaign id may find. A real Postgres with every migration,
 * and either the fake gateway or Stripe's own client over a fake HTTP layer: nothing leaves the
 * process.
 */

const now = new Date("2026-11-20T18:00:00.000Z");
const SYMBOL = "GEMI-NCAAF-EDGE-S-TEX13";
const startsAt = minutesFrom(now, 600);

let database: TestDatabase;
let db: Db;
let joe: string;

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
  requestId: string,
): Promise<{ id: string; budget_pi: string | null; status: string }[]> {
  return db<{ id: string; budget_pi: string | null; status: string }[]>`
    select id, budget_pi, status from campaigns
    where merchant_id = ${joe} and request_id = ${requestId}
  `;
}

/** The outcome of a call: its answer, or the error it threw. */
async function settle<T>(promise: Promise<T>): Promise<{ ok: T } | { error: unknown }> {
  return promise.then(
    (ok) => ({ ok }),
    (error: unknown) => ({ error }),
  );
}

async function refusal(promise: Promise<unknown>): Promise<ApiRouteError> {
  const outcome = await settle(promise);
  if ("ok" in outcome) throw new Error("expected a refusal");
  if (outcome.error instanceof ApiRouteError) return outcome.error;
  throw outcome.error;
}

/** Records each pause asked and returns at once. */
function recordedPauses(): { pauses: number[]; pause: (ms: number) => Promise<void> } {
  const pauses: number[] = [];
  return {
    pauses,
    pause: (ms: number) => {
      pauses.push(ms);
      return Promise.resolve();
    },
  };
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV-EDGE", title: "Arkansas vs Texas", startsAt });
  await insertInstrument(db, {
    symbol: SYMBOL,
    eventTicker: "EV-EDGE",
    label: "Texas wins by 14+",
    side: "home",
  });
  joe = (await insertMerchant(db, { email: "joe@example.com", privyId: "did:privy:joe" }))
    .merchantId;
});

afterAll(async () => {
  await database.drop();
});

// ---------------------------------------------------------------------------------------------
// Stripe's real client over a fake HTTP layer that keeps idempotency keys as Stripe does
// ---------------------------------------------------------------------------------------------

type KeyState =
  { state: "in_progress" } | { state: "done"; status: number; body: Record<string, unknown> };

/**
 * The Stripe API as the gateway's client sees it, for budget payments: an idempotency key whose
 * first request is still being processed answers 409 `idempotency_key_in_use` (Stripe's answer
 * to a concurrent request with the same key); once done, the key replays the first answer. A
 * create can be held while in progress (`holdCreate`), as can the first read of an intent
 * (`holdFirstRead`). Nothing leaves the process.
 */
class FakeStripeHttp {
  readonly intents = new Map<string, Record<string, unknown>>();
  readonly keys = new Map<string, KeyState>();
  /** Every request received, in order: `METHOD /path`. */
  readonly log: string[] = [];
  conflicts = 0;
  readonly cancels: string[] = [];
  /** While set, the next create is held in progress (its key in use) until released. */
  holdCreate: HeldAnswers | null = null;
  /** While set, the first read of an intent answers only once released. */
  holdFirstRead: HeldAnswers | null = null;
  /** Every create answers that its key is in use, as if another request never finished. */
  stuck = false;
  private reads = 0;

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    this.log.push(`${method} ${url.pathname}`);
    if (method === "POST" && url.pathname === "/v1/payment_intents") {
      return this.create(headers.get("idempotency-key") ?? "", form);
    }
    const cancel = /^\/v1\/payment_intents\/([^/]+)\/cancel$/.exec(url.pathname);
    if (method === "POST" && cancel?.[1]) return this.cancel(cancel[1]);
    const read = /^\/v1\/payment_intents\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && read?.[1]) {
      this.reads += 1;
      if (this.reads === 1 && this.holdFirstRead !== null) await this.holdFirstRead.enter();
      const intent = this.intents.get(read[1]);
      return intent === undefined
        ? json(404, { error: { type: "invalid_request_error", code: "resource_missing" } })
        : json(200, intent);
    }
    return json(400, { error: { type: "invalid_request_error", message: "unexpected call" } });
  };

  createdIntents(): number {
    return this.intents.size;
  }

  private async create(key: string, form: URLSearchParams): Promise<Response> {
    const known = this.keys.get(key);
    if (this.stuck || known?.state === "in_progress") {
      this.conflicts += 1;
      return json(409, {
        error: {
          type: "idempotency_error",
          code: "idempotency_key_in_use",
          message:
            "There is currently another in-progress request using this Idempotent Key (that probably means you submitted twice, and the other request is still going through). Please try again later.",
        },
      });
    }
    if (known?.state === "done") return json(known.status, known.body);
    this.keys.set(key, { state: "in_progress" });
    const id = `pi_http_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const metadata: Record<string, string> = {};
    for (const [name, value] of form) {
      const match = /^metadata\[(.+)\]$/.exec(name);
      if (match?.[1]) metadata[match[1]] = value;
    }
    const intent: Record<string, unknown> = {
      id,
      object: "payment_intent",
      status: "requires_payment_method",
      amount: Number(form.get("amount") ?? 0),
      currency: form.get("currency") ?? "usd",
      client_secret: `${id}_secret_${randomUUID().slice(0, 8)}`,
      metadata,
    };
    this.intents.set(id, intent);
    const hold = this.holdCreate;
    if (hold !== null) {
      this.holdCreate = null;
      await hold.enter();
    }
    this.keys.set(key, { state: "done", status: 200, body: intent });
    return json(200, intent);
  }

  private cancel(id: string): Response {
    this.cancels.push(id);
    const intent = this.intents.get(id);
    if (intent === undefined) return json(404, { error: { type: "invalid_request_error" } });
    if (intent.status === "succeeded" || intent.status === "processing") {
      return json(400, {
        error: { type: "invalid_request_error", code: "payment_intent_unexpected_state" },
      });
    }
    intent.status = "canceled";
    return json(200, intent);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stripeGateway(http: FakeStripeHttp): StripePaymentGateway {
  return new StripePaymentGateway(
    () => ({ secretKey: "sk_test_fake", webhookSecret: TEST_WEBHOOK_SECRET }),
    { httpClient: Stripe.createFetchHttpClient(http.fetch) },
  );
}

// ---------------------------------------------------------------------------------------------
// The fake gateway, scripted call by call
// ---------------------------------------------------------------------------------------------

/** What one `createBudgetPayment` call of the scripted fake does. */
interface CreateScript {
  /** Awaited before anything else. */
  before?: () => Promise<unknown>;
  /** Thrown instead of creating anything. */
  fail?: Error;
  /** The intent is created, then this is thrown as if its answer was lost. */
  loseAnswer?: boolean;
  /** A fresh intent for every call, as when the provider no longer keeps the key. */
  fresh?: boolean;
  /** The answer is held until released (the intent is created at once). */
  hold?: HeldAnswers;
}

class ScriptedGateway extends FakePaymentGateway {
  /** The scripts of the next calls, in order; then `always`, then nothing special. */
  readonly next: CreateScript[] = [];
  always: CreateScript = {};

  override async createBudgetPayment(input: BudgetPaymentInput): Promise<CreatedPaymentIntent> {
    const script = this.next.shift() ?? this.always;
    if (script.before) await script.before();
    if (script.fail) {
      this.createCalls += 1;
      throw script.fail;
    }
    const created = await super.createBudgetPayment(input);
    const intent = this.intents.get(created.id);
    // Forget the key: the next call for this campaign gets another intent.
    if (script.fresh && intent) intent.idempotencyKey = `forgotten:${randomUUID()}`;
    if (script.loseAnswer) throw new PaymentGatewayError("the answer of Stripe was lost");
    if (script.hold) await script.hold.enter();
    return created;
  }

  budgetIntents(): FakeIntent[] {
    return [...this.intents.values()].filter(
      (intent) => intent.metadata.kind === STRIPE_PAYMENT_KINDS.campaignBudget,
    );
  }
}

let payments: ScriptedGateway;

beforeEach(() => {
  payments = new ScriptedGateway();
});

// ---------------------------------------------------------------------------------------------
// 1. A true double tap against the provider
// ---------------------------------------------------------------------------------------------

describe("a double tap that Stripe refuses while the first call is in progress", () => {
  it("answers the second tap the first one's campaign and payment (Stripe's real client)", async () => {
    const http = new FakeStripeHttp();
    const gateway = stripeGateway(http);
    const created = new HeldAnswers();
    http.holdCreate = created;
    const body = request();

    const first = createCampaign(db, gateway, joe, body, now);
    // The first tap's create is at Stripe, in progress: its key is in use.
    await created.waiting(1);
    const pauses: number[] = [];
    const second = settle(
      createCampaign(db, gateway, joe, body, now, {
        pause: async (ms) => {
          pauses.push(ms);
          // Stripe finishes the first create meanwhile, and the first tap records it.
          created.release();
          await first;
        },
      }),
    );
    const secondOutcome = await second;
    created.release();
    const firstAnswer = await first;

    expect(secondOutcome).toEqual({ ok: firstAnswer });
    // The second tap was refused once and retried once by Stripe's client, then paused once.
    expect(http.conflicts).toBe(1 + BUDGET_REQUEST_MAX_RETRIES);
    expect(pauses).toEqual([PAYMENT_IN_PROGRESS_PAUSE_MS]);
    expect(http.createdIntents()).toBe(1);
    expect(http.cancels).toEqual([]);
    expect(await campaignsOf(body.requestId)).toEqual([
      {
        id: firstAnswer.campaignId,
        budget_pi: firstAnswer.budgetPayment.paymentIntentId,
        status: "funding",
      },
    ]);
    expect(http.intents.get(firstAnswer.budgetPayment.paymentIntentId)?.status).toBe(
      "requires_payment_method",
    );
  }, 20_000);

  it("answers it too when Stripe replays the first answer before the first tap records it", async () => {
    const http = new FakeStripeHttp();
    const gateway = stripeGateway(http);
    const created = new HeldAnswers();
    const firstRead = new HeldAnswers();
    http.holdCreate = created;
    http.holdFirstRead = firstRead;
    const body = request();

    const first = settle(createCampaign(db, gateway, joe, body, now));
    await created.waiting(1);
    const second = settle(
      createCampaign(db, gateway, joe, body, now, {
        pause: async () => {
          // Stripe answers the first create; the first tap is held reading the intent's status,
          // so nothing is recorded when the second tap looks again.
          created.release();
          await firstRead.waiting(1);
        },
      }),
    );
    const secondOutcome = await second;
    firstRead.release();
    created.release();
    const firstOutcome = await first;
    if (!("ok" in firstOutcome) || !("ok" in secondOutcome)) {
      throw new Error(`a tap failed: ${String(JSON.stringify([firstOutcome, secondOutcome]))}`);
    }
    expect(secondOutcome.ok).toEqual(firstOutcome.ok);
    expect(http.createdIntents()).toBe(1);
    expect(http.cancels).toEqual([]);
    expect(await campaignsOf(body.requestId)).toEqual([
      {
        id: firstOutcome.ok.campaignId,
        budget_pi: firstOutcome.ok.budgetPayment.paymentIntentId,
        status: "funding",
      },
    ]);
  }, 20_000);

  it("answers busy after the bound when the key never clears, leaving the claim and cancelling nothing", async () => {
    const http = new FakeStripeHttp();
    http.stuck = true;
    const gateway = stripeGateway(http);
    const { pauses, pause } = recordedPauses();
    const body = request();

    const error = await refusal(createCampaign(db, gateway, joe, body, now, { pause }));
    expect({ status: error.status, code: error.code, message: error.message }).toEqual({
      status: 503,
      code: "internal",
      message: CREATE_CAMPAIGN_CONFLICTS.busy,
    });
    expect(pauses).toEqual(
      Array.from({ length: MAX_PAYMENT_IN_PROGRESS_WAITS }, () => PAYMENT_IN_PROGRESS_PAUSE_MS),
    );
    // One create per round, each tried twice by Stripe's client: nothing else was sent.
    const rounds = MAX_PAYMENT_IN_PROGRESS_WAITS + 1;
    expect(http.log).toEqual(
      Array.from(
        { length: rounds * (1 + BUDGET_REQUEST_MAX_RETRIES) },
        () => "POST /v1/payment_intents",
      ),
    );
    expect(http.cancels).toEqual([]);
    const [claim] = await campaignsOf(body.requestId);
    expect(claim).toMatchObject({ budget_pi: null, status: "funding" });

    // Once the key clears, the same request finds its claim and creates its payment.
    http.stuck = false;
    const retried = await createCampaign(db, gateway, joe, body, now, { pause });
    expect(retried.campaignId).toBe(claim?.id);
    expect(http.createdIntents()).toBe(1);
    expect(await campaignsOf(body.requestId)).toEqual([
      { id: claim?.id, budget_pi: retried.budgetPayment.paymentIntentId, status: "funding" },
    ]);
  }, 30_000);

  it("waits long enough to outlast one attempt of the twin's create", () => {
    // Each refused call lasts at least Stripe's initial retry delay (0.5 s) before the pause.
    const covered = MAX_PAYMENT_IN_PROGRESS_WAITS * (PAYMENT_IN_PROGRESS_PAUSE_MS + 500) + 500;
    expect(covered).toBeGreaterThan(BUDGET_REQUEST_TIMEOUT_MS);
  });

  it("the default pause is a real one of PAYMENT_IN_PROGRESS_PAUSE_MS", async () => {
    payments.next.push({ fail: new PaymentRequestInProgressError("key in use") });
    const started = performance.now();
    const answer = await createCampaign(db, payments, joe, request(), now);
    expect(performance.now() - started).toBeGreaterThanOrEqual(PAYMENT_IN_PROGRESS_PAUSE_MS - 5);
    expect(answer.status).toBe("funding");
    expect(payments.createCalls).toBe(2);
  });
});

describe("a provider failure on a call of a request", () => {
  it("stays a 502 when no payment is recorded: no pause, the claim kept, nothing cancelled", async () => {
    payments.always = { fail: new PaymentGatewayError("Stripe is down") };
    const { pauses, pause } = recordedPauses();
    const body = request();
    const error = await refusal(createCampaign(db, payments, joe, body, now, { pause }));
    expect(error.status).toBe(502);
    expect(pauses).toEqual([]);
    expect(payments.createCalls).toBe(1);
    expect(payments.cancelCalls).toEqual([]);
    expect(await campaignsOf(body.requestId)).toEqual([
      { id: expect.any(String) as string, budget_pi: null, status: "funding" },
    ]);
  });

  it("stays a 502 through Stripe's real client (an outage, not a key in use)", async () => {
    const sent: string[] = [];
    const down = new StripePaymentGateway(
      () => ({ secretKey: "sk_test_fake", webhookSecret: TEST_WEBHOOK_SECRET }),
      {
        httpClient: Stripe.createFetchHttpClient((input, init) => {
          const url = new URL(input instanceof Request ? input.url : input.toString());
          sent.push(`${init?.method ?? "GET"} ${url.pathname}`);
          return Promise.resolve(
            json(500, { error: { type: "api_error", message: "unavailable" } }),
          );
        }),
      },
    );
    const { pauses, pause } = recordedPauses();
    const body = request();
    const error = await refusal(createCampaign(db, down, joe, body, now, { pause }));
    expect(error.status).toBe(502);
    expect(pauses).toEqual([]);
    // The create and the client's single retry: no cancel, no other call.
    expect(sent).toEqual(
      Array.from({ length: 1 + BUDGET_REQUEST_MAX_RETRIES }, () => "POST /v1/payment_intents"),
    );
    expect(await campaignsOf(body.requestId)).toEqual([
      { id: expect.any(String) as string, budget_pi: null, status: "funding" },
    ]);
  }, 20_000);

  it("answers the payment a concurrent call recorded meanwhile, instead of a 502", async () => {
    const created = new HeldAnswers();
    const body = request();
    payments.next.push({ hold: created });
    const first = createCampaign(db, payments, joe, body, now);
    await created.waiting(1);
    // The second call's create fails (an outage, not a key in use) once the first has recorded.
    payments.next.push({ before: () => first, fail: new PaymentGatewayError("Stripe hiccup") });
    const { pauses, pause } = recordedPauses();
    const second = settle(createCampaign(db, payments, joe, body, now, { pause }));
    created.release();
    const firstAnswer = await first;
    expect(await second).toEqual({ ok: firstAnswer });
    expect(pauses).toEqual([]);
    expect(payments.budgetIntents()).toHaveLength(1);
    expect(payments.cancelCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. The guards of a payment two calls of one request share
// ---------------------------------------------------------------------------------------------

describe("a recording that fails while the twin records the same intent", () => {
  const PRODUCT = "Twin records";

  beforeAll(async () => {
    await db.unsafe(`create sequence test_twin_record_seq`);
    // The first recording of this product fails, but only once a twin is queued on the row's
    // lock behind it (bounded wait), so that the twin records the intent right after.
    await db.unsafe(`
      create or replace function test_fail_first_record() returns trigger
      language plpgsql as $$
      declare
        waited int := 0;
      begin
        if nextval('test_twin_record_seq') = 1 then
          while waited < 100 and not exists (
            select 1 from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid()
              and wait_event_type = 'Lock'
          ) loop
            perform pg_sleep(0.05);
            waited := waited + 1;
          end loop;
          raise exception 'first recording refused by the test';
        end if;
        return new;
      end;
      $$
    `);
    await db.unsafe(`
      create trigger test_fail_first_record before update of budget_pi on public.campaigns
      for each row when (new.product = '${PRODUCT}' and new.budget_pi is not null)
      execute function test_fail_first_record()
    `);
  });

  afterAll(async () => {
    await db.unsafe(`drop trigger if exists test_fail_first_record on public.campaigns`);
  });

  it("does not cancel the intent the twin recorded: both taps answer it", async () => {
    const gate = new HeldAnswers();
    payments.always = { hold: gate };
    const body = request({ product: PRODUCT });
    const taps = Promise.all([
      settle(createCampaign(db, payments, joe, body, now)),
      settle(createCampaign(db, payments, joe, body, now)),
    ]);
    // Both calls hold the same intent (keyed on the claimed campaign) before recording it.
    await gate.waiting(2);
    gate.release();
    const [first, second] = await taps;
    if (!("ok" in first) || !("ok" in second)) {
      throw new Error(`a tap failed: ${String([first, second].map((o) => JSON.stringify(o)))}`);
    }
    expect(second.ok).toEqual(first.ok);
    expect(payments.budgetIntents()).toHaveLength(1);
    expect(payments.cancelCalls).toEqual([]);
    expect(payments.intents.get(first.ok.budgetPayment.paymentIntentId)?.status).toBe(
      "requires_payment_method",
    );
    expect(await campaignsOf(body.requestId)).toEqual([
      {
        id: first.ok.campaignId,
        budget_pi: first.ok.budgetPayment.paymentIntentId,
        status: "funding",
      },
    ]);
    // The trigger did refuse one recording: the guard was exercised, not bypassed.
    const [seq] = await db<{ last_value: bigint }[]>`select last_value from test_twin_record_seq`;
    expect(seq?.last_value).toBe(2n);
  });
});

describe("other terms on a claim whose payment is not recorded yet", () => {
  it("answer 409, never the first intent with the new amount", async () => {
    const body = request();
    payments.next.push({ loseAnswer: true });
    expect((await refusal(createCampaign(db, payments, joe, body, now))).status).toBe(502);
    const [claim] = await campaignsOf(body.requestId);
    expect(claim).toMatchObject({ budget_pi: null, status: "funding" });

    const error = await refusal(
      createCampaign(db, payments, joe, { ...body, budget: "2000000000" }, now),
    );
    expect({ status: error.status, message: error.message }).toEqual({
      status: 409,
      message: CREATE_CAMPAIGN_CONFLICTS.usedElsewhere,
    });
    expect(payments.createCalls).toBe(1);
    expect(payments.cancelCalls).toEqual([]);
    expect(await campaignsOf(body.requestId)).toEqual([claim]);

    // Control: the same terms find the claim and the intent created before the lost answer.
    const [created] = payments.budgetIntents();
    const retried = await createCampaign(db, payments, joe, body, now);
    expect(retried.campaignId).toBe(claim?.id);
    expect(retried.budgetPayment).toEqual({
      paymentIntentId: created?.id,
      clientSecret: created?.clientSecret,
      amount: "1000000000",
    });
  });
});

describe("a provider that answers another intent to each call of the same campaign", () => {
  it("never overwrites the intent answered first, and cancels the unused one", async () => {
    const gate = new HeldAnswers();
    payments.always = { fresh: true, hold: gate };
    const body = request();
    const taps = Promise.all([
      settle(createCampaign(db, payments, joe, body, now)),
      settle(createCampaign(db, payments, joe, body, now)),
    ]);
    await gate.waiting(2);
    const intents = payments.budgetIntents().map((intent) => intent.id);
    expect(new Set(intents).size).toBe(2);
    gate.release();
    const [first, second] = await taps;
    if (!("ok" in first) || !("ok" in second)) {
      throw new Error(`a tap failed: ${String([first, second].map((o) => JSON.stringify(o)))}`);
    }
    const answered: CreateCampaignResponse = first.ok;
    expect(second.ok).toEqual(answered);
    const kept = answered.budgetPayment.paymentIntentId;
    const unused = intents.find((id) => id !== kept);
    expect(await campaignsOf(body.requestId)).toEqual([
      { id: answered.campaignId, budget_pi: kept, status: "funding" },
    ]);
    expect(payments.cancelCalls.map((call) => call.id)).toEqual([unused]);
    expect(payments.intents.get(kept)?.status).toBe("requires_payment_method");
    expect(payments.intents.get(unused ?? "")?.status).toBe("canceled");
  });
});

// ---------------------------------------------------------------------------------------------
// 4. A claim whose payment was never recorded is no campaign for any route
// ---------------------------------------------------------------------------------------------

describe("the claim of a request whose payment was never recorded, through the routes", () => {
  const identity = new FakeIdentity();
  const JOE = { authorization: "Bearer joe-token" };
  let claimId: string;
  let fundingId: string;

  function call(path: string, method: "GET" | "POST", body?: unknown): Request {
    return new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...JOE },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  type Route = (id: string) => Promise<Response>;
  const routes: [string, Route][] = [
    [
      "GET /api/campaigns/:id",
      (id) => getDetail(call(`/api/campaigns/${id}`, "GET"), { params: Promise.resolve({ id }) }),
    ],
    [
      "POST /api/campaigns/:id/pause",
      (id) =>
        postPause(call(`/api/campaigns/${id}/pause`, "POST"), { params: Promise.resolve({ id }) }),
    ],
    [
      "POST /api/campaigns/:id/resume",
      (id) =>
        postResume(call(`/api/campaigns/${id}/resume`, "POST"), {
          params: Promise.resolve({ id }),
        }),
    ],
    [
      "POST /api/campaigns/:id/close",
      (id) =>
        postClose(call(`/api/campaigns/${id}/close`, "POST"), { params: Promise.resolve({ id }) }),
    ],
    [
      "POST /api/campaigns/:id/top-up",
      (id) =>
        postTopUp(
          call(`/api/campaigns/${id}/top-up`, "POST", {
            amount: "500000000",
            requestId: randomUUID(),
          }),
          { params: Promise.resolve({ id }) },
        ),
    ],
  ];

  beforeAll(async () => {
    identity.addUser("joe-token", "did:privy:joe", {
      email: "joe@example.com",
      walletAddress: randomWallet(),
    });
    const gateway = new ScriptedGateway();
    // The provider failed and the client never retried: the claim stays.
    gateway.next.push({ loseAnswer: true });
    const lost = request({ product: "Never retried" });
    await refusal(createCampaign(db, gateway, joe, lost, now));
    const [claim] = await campaignsOf(lost.requestId);
    if (claim === undefined || claim.budget_pi !== null) throw new Error("no claim was left");
    claimId = claim.id;
    // Control: a campaign whose payment is recorded and not paid yet, still `funding`.
    fundingId = (await createCampaign(db, gateway, joe, request({ product: "Recorded" }), now))
      .campaignId;
  });

  beforeEach(() => {
    setServerDepsForTesting(serverDepsFor(db, identity, now, payments));
  });

  afterAll(() => {
    setServerDepsForTesting(undefined);
  });

  it.each(routes)("%s answers 404 for the claim and changes nothing", async (_name, route) => {
    const response = await route(claimId);
    const payload: unknown = await response.json();
    expect({ status: response.status, error: apiErrorSchema.parse(payload).error }).toEqual({
      status: 404,
      error: { code: "not_found", message: "Campaign not found" },
    });
    const [row] = await db<{ sale_state: string; status: string; budget_pi: string | null }[]>`
      select sale_state, status, budget_pi from campaigns where id = ${claimId}
    `;
    expect(row).toEqual({ sale_state: "closed", status: "funding", budget_pi: null });
    const jobs = await db`select id from jobs where payload ->> 'campaignId' = ${claimId}`;
    expect(jobs).toHaveLength(0);
    expect(payments.createCalls).toBe(0);
  });

  it.each(routes)(
    "%s still finds a funding campaign whose payment is recorded",
    async (name, route) => {
      const response = await route(fundingId);
      const payload: unknown = await response.json();
      if (name.startsWith("GET")) {
        expect(response.status).toBe(200);
        expect(campaignDetailSchema.parse(payload).status).toBe("funding");
      } else {
        expect({ status: response.status, error: apiErrorSchema.parse(payload).error }).toEqual({
          status: 409,
          error: { code: "conflict", message: "This promo is not live yet" },
        });
      }
    },
  );
});
