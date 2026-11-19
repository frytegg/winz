import { randomUUID } from "node:crypto";

import { STRIPE_PAYMENT_KINDS, type TopUpCampaignResponse } from "@winz/shared";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  TOP_UP_BUSY_MESSAGE,
  TOP_UP_MESSAGES,
  TOP_UP_OVER_MESSAGE,
  topUpCampaign,
} from "./budget-top-up";
import { MAX_PAYMENT_IN_PROGRESS_WAITS, PAYMENT_IN_PROGRESS_PAUSE_MS } from "./campaign-writes";
import type { Db } from "./db";
import {
  BUDGET_REQUEST_MAX_RETRIES,
  BUDGET_REQUEST_TIMEOUT_MS,
  PaymentGatewayError,
  PaymentRequestInProgressError,
  StripePaymentGateway,
  type BudgetTopUpPaymentInput,
  type CreatedPaymentIntent,
  type PaymentGateway,
} from "./payments-gateway";
import { ApiRouteError } from "./route";
import { FakePaymentGateway, HeldAnswers, TEST_WEBHOOK_SECRET } from "./testing/fake-payments";
import {
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  minutesFrom,
} from "./testing/fixtures";

/**
 * Two calls of ONE top-up request at the same moment (same campaign, same `requestId`: a double
 * tap, or the front's retry while the first call is still at the provider), SPEC CA-6, task A-08.
 * Stripe keys the top-up's PaymentIntent on the `requestId` and refuses a second request with that
 * key while the first is being processed (409 `idempotency_key_in_use`): the second call must then
 * wait for the first and answer what it obtained, never a 502 over a payment sheet that works.
 * A real Postgres with every migration, and either Stripe's own client over a fake HTTP layer that
 * keeps idempotency keys as Stripe does, or the fake gateway scripted call by call: nothing leaves
 * the process.
 */

const now = new Date();
const SYMBOL = "GEMI-NCAAF-TOPUP-TAP-S-TEX13";
const FIVE_HUNDRED = 500_000_000n;
const TOP_UP_KEY_PREFIX = `${STRIPE_PAYMENT_KINDS.campaignBudgetTopUp}:`;

let database: TestDatabase;
let db: Db;
let joe: string;
let nextOnchainId = 9_000n;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV-TOPUP-TAP", startsAt: minutesFrom(now, 600) });
  await insertInstrument(db, { symbol: SYMBOL, eventTicker: "EV-TOPUP-TAP", label: "Texas wins" });
  joe = (await insertMerchant(db, { email: "joe@example.com", privyId: "did:privy:joe" }))
    .merchantId;
});

afterAll(async () => {
  await database?.drop();
});

async function liveCampaign(): Promise<string> {
  nextOnchainId += 1n;
  return insertCampaign(db, {
    merchantId: joe,
    instrument: SYMBOL,
    eventTicker: "EV-TOPUP-TAP",
    salesClose: minutesFrom(now, 595),
    onchainId: nextOnchainId,
    slug: `joes-tap-${nextOnchainId.toString()}`,
  });
}

interface TopUpDbRow {
  request_id: string;
  stripe_pi: string;
  amount: bigint;
  status: string;
  message: string | null;
}

async function topUpRows(campaignId: string): Promise<TopUpDbRow[]> {
  return db<TopUpDbRow[]>`
    select request_id, stripe_pi, amount, status, message from budget_top_ups
    where campaign_id = ${campaignId}
    order by created_at
  `;
}

/** The outcome of a call: its answer, or the error it threw. */
async function settle<T>(promise: Promise<T>): Promise<{ ok: T } | { error: unknown }> {
  return promise.then(
    (ok) => ({ ok }),
    (error: unknown) => ({ error }),
  );
}

/** What a call answered, as the route would: the answer, or the status and message of a refusal. */
function shown(
  outcome: { ok: TopUpCampaignResponse } | { error: unknown },
): TopUpCampaignResponse | { status: number; code: string; message: string } {
  if ("ok" in outcome) return outcome.ok;
  if (outcome.error instanceof ApiRouteError) {
    const { status, code, message } = outcome.error;
    return { status, code, message };
  }
  throw outcome.error;
}

async function answered(promise: Promise<TopUpCampaignResponse>): Promise<TopUpCampaignResponse> {
  const outcome = await settle(promise);
  if ("ok" in outcome) return outcome.ok;
  throw new Error(`expected an answer, got ${JSON.stringify(shown(outcome))}`);
}

async function refusal(promise: Promise<unknown>): Promise<ApiRouteError> {
  const outcome = await settle(promise);
  if ("ok" in outcome) throw new Error(`expected a refusal, got ${JSON.stringify(outcome.ok)}`);
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

function topUp(
  gateway: PaymentGateway,
  campaignId: string,
  requestId: string,
  pause?: (ms: number) => Promise<void>,
  amount: bigint = FIVE_HUNDRED,
): Promise<TopUpCampaignResponse> {
  return topUpCampaign(
    db,
    gateway,
    joe,
    campaignId,
    { amount: amount.toString(), requestId },
    now,
    pause === undefined ? {} : { pause },
  );
}

// ---------------------------------------------------------------------------------------------
// Stripe's real client over a fake HTTP layer that keeps idempotency keys as Stripe does
// ---------------------------------------------------------------------------------------------

type KeyState =
  { state: "in_progress" } | { state: "done"; status: number; body: Record<string, unknown> };

/**
 * The Stripe API as the gateway's client sees it, for top-up payments: an idempotency key whose
 * first request is still being processed answers 409 `idempotency_key_in_use` (Stripe's answer to
 * a concurrent request with the same key); once done, the key replays the first answer, whatever
 * became of the intent since. A create can be held in progress (`holdCreate`), as can the first
 * read of an intent (`holdFirstRead`). A cancel follows Stripe's rules (400
 * `payment_intent_unexpected_state` for an intent cancelled, paid or being paid). Every request
 * is logged; nothing leaves the process.
 */
class FakeStripeHttp {
  readonly intents = new Map<string, Record<string, unknown>>();
  readonly keys = new Map<string, KeyState>();
  /** Every request received, in order: `METHOD /path`. */
  readonly log: string[] = [];
  /** The idempotency key of every create received, in order. */
  readonly createKeys: string[] = [];
  conflicts = 0;
  readonly cancels: string[] = [];
  /** While set, the next create is held in progress (its key in use) until released. */
  holdCreate: HeldAnswers | null = null;
  /** While set, the first read of an intent answers only once released. */
  holdFirstRead: HeldAnswers | null = null;
  /** While true, every request answers 500, as in an outage. */
  down = false;
  private reads = 0;

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    this.log.push(`${method} ${url.pathname}`);
    if (this.down) return json(500, { error: { type: "api_error", message: "unavailable" } });
    if (method === "POST" && url.pathname === "/v1/payment_intents") {
      const key = headers.get("idempotency-key") ?? "";
      this.createKeys.push(key);
      return this.create(key, form);
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

  creates(): number {
    return this.log.filter((line) => line === "POST /v1/payment_intents").length;
  }

  private async create(key: string, form: URLSearchParams): Promise<Response> {
    const known = this.keys.get(key);
    if (known?.state === "in_progress") {
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
    if (
      intent.status === "canceled" ||
      intent.status === "succeeded" ||
      intent.status === "processing"
    ) {
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
// The fake gateway, its top-up creates scripted call by call
// ---------------------------------------------------------------------------------------------

/** What one `createBudgetTopUpPayment` call of the scripted fake does. */
interface CreateScript {
  /** Awaited before anything else. */
  before?: () => Promise<unknown>;
  /** Thrown instead of creating anything. */
  fail?: Error;
  /** The answer is held until released (the intent is created at once). */
  hold?: HeldAnswers;
}

class ScriptedTopUpGateway extends FakePaymentGateway {
  /** The scripts of the next calls, in order; then nothing special. */
  readonly next: CreateScript[] = [];

  override async createBudgetTopUpPayment(
    input: BudgetTopUpPaymentInput,
  ): Promise<CreatedPaymentIntent> {
    const script = this.next.shift() ?? {};
    if (script.before) await script.before();
    if (script.fail) {
      this.createCalls += 1;
      throw script.fail;
    }
    const created = await super.createBudgetTopUpPayment(input);
    if (script.hold) await script.hold.enter();
    return created;
  }
}

// ---------------------------------------------------------------------------------------------
// 1. Two taps at once, through Stripe's real client
// ---------------------------------------------------------------------------------------------

describe("two calls of one top-up request at once, through Stripe's real client", () => {
  it("the second call, refused while the first is at Stripe, answers the first one's top-up and payment", async () => {
    const http = new FakeStripeHttp();
    const gateway = stripeGateway(http);
    const created = new HeldAnswers();
    http.holdCreate = created;
    const campaignId = await liveCampaign();
    const requestId = randomUUID();

    const first = topUp(gateway, campaignId, requestId);
    // The first tap's create is at Stripe, in progress: its key is in use.
    await created.waiting(1);
    const pauses: number[] = [];
    const second = settle(
      topUp(gateway, campaignId, requestId, async (ms) => {
        pauses.push(ms);
        // Stripe finishes the first create meanwhile, and the first tap records it.
        created.release();
        await first;
      }),
    );
    const secondOutcome = await second;
    created.release();
    const firstAnswer = await first;

    // Both calls reached Stripe with the request's one key; the second was refused while the
    // first was in progress (and once more by the client's own retry), then paused once.
    expect(new Set(http.createKeys)).toEqual(new Set([`${TOP_UP_KEY_PREFIX}${requestId}`]));
    expect(http.conflicts).toBe(1 + BUDGET_REQUEST_MAX_RETRIES);
    expect(shown(secondOutcome)).toEqual(firstAnswer);
    expect(pauses).toEqual([PAYMENT_IN_PROGRESS_PAUSE_MS]);
    expect(firstAnswer).toMatchObject({ campaignId, requestId, status: "requires_payment" });
    expect(http.intents.size).toBe(1);
    expect(http.cancels).toEqual([]);
    expect(await topUpRows(campaignId)).toEqual([
      {
        request_id: requestId,
        stripe_pi: firstAnswer.budgetPayment.paymentIntentId,
        amount: FIVE_HUNDRED,
        status: "requires_payment",
        message: null,
      },
    ]);
    expect(http.intents.get(firstAnswer.budgetPayment.paymentIntentId)?.status).toBe(
      "requires_payment_method",
    );
  });

  it("answers it too when Stripe replays the first answer before the first call records it", async () => {
    const http = new FakeStripeHttp();
    const gateway = stripeGateway(http);
    const created = new HeldAnswers();
    const firstRead = new HeldAnswers();
    http.holdCreate = created;
    http.holdFirstRead = firstRead;
    const campaignId = await liveCampaign();
    const requestId = randomUUID();

    const first = settle(topUp(gateway, campaignId, requestId));
    await created.waiting(1);
    const second = settle(
      topUp(gateway, campaignId, requestId, async () => {
        // Stripe answers the first create; the first call is held reading the intent's status,
        // so nothing is recorded when the second call creates again and gets the replay.
        created.release();
        await firstRead.waiting(1);
      }),
    );
    const secondOutcome = await second;
    firstRead.release();
    created.release();
    const firstOutcome = await first;
    expect(shown(firstOutcome)).toEqual(shown(secondOutcome));
    expect(shown(firstOutcome)).toMatchObject({ requestId, status: "requires_payment" });
    expect(http.intents.size).toBe(1);
    expect(http.cancels).toEqual([]);
    expect(await topUpRows(campaignId)).toMatchObject([
      { request_id: requestId, status: "requires_payment" },
    ]);
  });

  it("answers 503 after the bound when the first call never finishes, the request left open and nothing cancelled; the same request later answers what was recorded", async () => {
    const http = new FakeStripeHttp();
    const gateway = stripeGateway(http);
    const created = new HeldAnswers();
    http.holdCreate = created;
    const campaignId = await liveCampaign();
    const requestId = randomUUID();

    const first = topUp(gateway, campaignId, requestId);
    await created.waiting(1);
    const { pauses, pause } = recordedPauses();
    const error = await refusal(topUp(gateway, campaignId, requestId, pause));
    expect({ status: error.status, code: error.code, message: error.message }).toEqual({
      status: 503,
      code: "internal",
      message: TOP_UP_BUSY_MESSAGE,
    });
    expect(pauses).toEqual(
      Array.from({ length: MAX_PAYMENT_IN_PROGRESS_WAITS }, () => PAYMENT_IN_PROGRESS_PAUSE_MS),
    );
    // The first call's create, then one create per round of the second, each tried twice by
    // Stripe's client: no read, no cancel, nothing else was sent.
    const rounds = MAX_PAYMENT_IN_PROGRESS_WAITS + 1;
    expect(http.log).toEqual(
      Array.from(
        { length: 1 + rounds * (1 + BUDGET_REQUEST_MAX_RETRIES) },
        () => "POST /v1/payment_intents",
      ),
    );
    expect(http.cancels).toEqual([]);
    // Nothing recorded, nothing ended: the request is left as it is.
    expect(await topUpRows(campaignId)).toEqual([]);

    // The first call's create comes back and is recorded; the same request sent again answers it.
    created.release();
    const firstAnswer = await first;
    const again = await answered(topUp(gateway, campaignId, requestId, pause));
    expect(again).toEqual(firstAnswer);
    expect(http.intents.size).toBe(1);
    expect(http.cancels).toEqual([]);
    expect(await topUpRows(campaignId)).toMatchObject([
      {
        request_id: requestId,
        stripe_pi: firstAnswer.budgetPayment.paymentIntentId,
        status: "requires_payment",
      },
    ]);
  }, 30_000);

  it("waits long enough to outlast one attempt of the first call's create", () => {
    // Each refused call lasts at least Stripe's initial retry delay (0.5 s) before the pause.
    const covered = MAX_PAYMENT_IN_PROGRESS_WAITS * (PAYMENT_IN_PROGRESS_PAUSE_MS + 500) + 500;
    expect(covered).toBeGreaterThan(BUDGET_REQUEST_TIMEOUT_MS);
  });

  it("the default pause is a real one of PAYMENT_IN_PROGRESS_PAUSE_MS", async () => {
    const gateway = new ScriptedTopUpGateway();
    gateway.next.push({ fail: new PaymentRequestInProgressError("key in use") });
    const campaignId = await liveCampaign();
    const started = performance.now();
    const answer = await answered(topUp(gateway, campaignId, randomUUID()));
    expect(performance.now() - started).toBeGreaterThanOrEqual(PAYMENT_IN_PROGRESS_PAUSE_MS - 5);
    expect(answer.status).toBe("requires_payment");
    expect(gateway.createCalls).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Any other provider failure
// ---------------------------------------------------------------------------------------------

describe("a provider failure on a call of a top-up request", () => {
  it("stays a 502 through Stripe's real client (an outage, not a key in use): no pause, nothing recorded or cancelled", async () => {
    const http = new FakeStripeHttp();
    http.down = true;
    const gateway = stripeGateway(http);
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const { pauses, pause } = recordedPauses();
    const error = await refusal(topUp(gateway, campaignId, requestId, pause));
    expect({ status: error.status, code: error.code }).toEqual({ status: 502, code: "internal" });
    expect(pauses).toEqual([]);
    // The create and the client's single retry: no cancel, no other call.
    expect(http.log).toEqual(
      Array.from({ length: 1 + BUDGET_REQUEST_MAX_RETRIES }, () => "POST /v1/payment_intents"),
    );
    expect(await topUpRows(campaignId)).toEqual([]);

    // Once Stripe is back, the same request goes through.
    http.down = false;
    const answer = await answered(topUp(gateway, campaignId, requestId, pause));
    expect(answer).toMatchObject({ requestId, status: "requires_payment" });
    expect(pauses).toEqual([]);
  }, 20_000);

  it("stays a 502 with the fake gateway: one create, no pause", async () => {
    const gateway = new ScriptedTopUpGateway();
    gateway.next.push({ fail: new PaymentGatewayError("Stripe is down") });
    const campaignId = await liveCampaign();
    const { pauses, pause } = recordedPauses();
    const error = await refusal(topUp(gateway, campaignId, randomUUID(), pause));
    expect(error.status).toBe(502);
    expect(pauses).toEqual([]);
    expect(gateway.createCalls).toBe(1);
    expect(gateway.cancelCalls).toEqual([]);
    expect(await topUpRows(campaignId)).toEqual([]);
  });

  it("answers the top-up a concurrent call of the request recorded meanwhile, instead of a 502", async () => {
    const gateway = new ScriptedTopUpGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    const created = new HeldAnswers();
    gateway.next.push({ hold: created });
    const first = topUp(gateway, campaignId, requestId);
    await created.waiting(1);
    // The second call's create fails (an outage, not a key in use) once the first has recorded.
    gateway.next.push({ before: () => first, fail: new PaymentGatewayError("Stripe hiccup") });
    const { pauses, pause } = recordedPauses();
    const second = settle(topUp(gateway, campaignId, requestId, pause));
    created.release();
    const firstAnswer = await first;
    expect(shown(await second)).toEqual(firstAnswer);
    expect(pauses).toEqual([]);
    expect(gateway.createCalls).toBe(2);
    expect(gateway.intents.size).toBe(1);
    expect(gateway.cancelCalls).toEqual([]);
    expect(await topUpRows(campaignId)).toMatchObject([
      { request_id: requestId, status: "requires_payment" },
    ]);
  });

  it("answers the concurrent call's top-up by its state: over, when that call's payment was withdrawn; and ends at once the unpaid top-up whose payment it cancelled", async () => {
    const gateway = new ScriptedTopUpGateway();
    const campaignId = await liveCampaign();
    const requestId = randomUUID();
    // The first call decides with the slot free, and is held at the provider.
    const created = new HeldAnswers();
    gateway.next.push({ hold: created });
    const first = settle(topUp(gateway, campaignId, requestId));
    await created.waiting(1);
    // Meanwhile another request records an unpaid top-up: it holds the slot.
    const holderRequest = randomUUID();
    const holder = await answered(
      topUp(gateway, campaignId, holderRequest, undefined, 100_000_000n),
    );
    const holderPi = holder.budgetPayment.paymentIntentId;
    // The second call of the request decides to replace it and cancels its payment; its create
    // then fails once the campaign closed and the first call, refused, withdrew its payment.
    gateway.next.push({
      before: async () => {
        await db`
          update campaigns set status = 'sales_closed', sale_state = 'closed' where id = ${campaignId}
        `;
        created.release();
        await first;
      },
      fail: new PaymentGatewayError("Stripe hiccup"),
    });
    const { pauses, pause } = recordedPauses();
    const second = await settle(topUp(gateway, campaignId, requestId, pause));

    // The first call was refused for the close, and its payment withdrawn.
    expect(shown(await first)).toMatchObject({ status: 409, code: "sales_closed" });
    // The second call answers the request's recorded state: over, as any repeat of it would.
    expect(shown(second)).toEqual({ status: 409, code: "conflict", message: TOP_UP_OVER_MESSAGE });
    expect(pauses).toEqual([]);
    expect(gateway.intents.get(holderPi)?.status).toBe("canceled");
    const rows = await topUpRows(campaignId);
    expect(rows.map((row) => [row.request_id, row.status, row.message])).toEqual([
      [holderRequest, "failed", TOP_UP_MESSAGES.cancelledForNewer],
      [requestId, "failed", TOP_UP_MESSAGES.withdrawn],
    ]);
    // No intent of the campaign can be paid any more, and no open top-up is left on a dead one.
    expect([...gateway.intents.values()].filter((i) => i.status !== "canceled")).toEqual([]);
    // The holder's repeat is told it is over, never answered its cancelled payment's secret.
    const repeat = await refusal(
      topUp(gateway, campaignId, holderRequest, undefined, 100_000_000n),
    );
    expect({ status: repeat.status, message: repeat.message }).toEqual({
      status: 409,
      message: TOP_UP_OVER_MESSAGE,
    });
  });
});
