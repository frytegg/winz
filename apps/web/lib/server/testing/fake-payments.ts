import { randomBytes } from "node:crypto";

import { STRIPE_PAYMENT_KINDS } from "@winz/shared";
import Stripe from "stripe";

import {
  PaymentGatewayError,
  stripeAmount,
  verifyStripeWebhook,
  type BudgetPaymentInput,
  type BudgetTopUpPaymentInput,
  type CreatedPaymentIntent,
  type PaymentGateway,
  type PaymentIntentStatus,
  type PaymentIntentView,
  type PaymentWebhookEvent,
  type PurchaseAuthorizationInput,
  type TopUpPaymentGateway,
  type UnpaidCancellation,
} from "../payments-gateway";

/** The webhook secret the fake verifies with; tests sign their payloads with it. */
export const TEST_WEBHOOK_SECRET = "whsec_test_0123456789abcdef0123456789abcdef";

/** A created intent as the fake keeps it, with what Stripe would have been asked. */
export interface FakeIntent extends PaymentIntentView {
  clientSecret: string;
  captureMethod: "automatic" | "manual";
  idempotencyKey: string;
}

/**
 * Test-only stand-in for Stripe: intents live in memory, and the webhook signature is checked by
 * Stripe's REAL verification code (`verifyStripeWebhook`) against `TEST_WEBHOOK_SECRET`.
 */
export class FakePaymentGateway implements PaymentGateway, TopUpPaymentGateway {
  readonly intents = new Map<string, FakeIntent>();
  createCalls = 0;
  retrieveCalls = 0;
  /** Cancellations asked, with their idempotency keys (null: none sent), in order. */
  readonly cancelCalls: { id: string; idempotencyKey: string | null }[] = [];
  /** Thrown by the next create calls instead of answering, to simulate an outage. */
  failure: Error | null = null;
  /** Thrown by the next cancel and client-secret calls instead of answering (an outage). */
  topUpFailure: Error | null = null;
  /**
   * What Stripe saved for each idempotency key of a cancel: its raw answer, a success or the 400
   * `payment_intent_unexpected_state`. Stripe replays it for the same key, error included.
   */
  private readonly cancelAnswers = new Map<string, "ok" | "unexpected_state">();
  /** The top-up calls whose answers are held (a slow Stripe), and the gate holding them. */
  private held: { calls: ReadonlySet<TopUpCall>; gate: HeldAnswers } | null = null;

  private add(
    amount: bigint,
    captureMethod: "automatic" | "manual",
    metadata: Record<string, string>,
    idempotencyKey: string,
  ): CreatedPaymentIntent {
    this.createCalls += 1;
    if (this.failure) throw this.failure;
    // Same check as the real gateway: whole cents, within Stripe's range.
    stripeAmount(amount);
    const replay = [...this.intents.values()].find((i) => i.idempotencyKey === idempotencyKey);
    if (replay) return { id: replay.id, clientSecret: replay.clientSecret };
    const id = `pi_fake_${randomBytes(8).toString("hex")}`;
    const clientSecret = `${id}_secret_${randomBytes(8).toString("hex")}`;
    this.intents.set(id, {
      id,
      status: "requires_payment_method",
      amount,
      currency: "usd",
      metadata,
      payerEmail: null,
      clientSecret,
      captureMethod,
      idempotencyKey,
    });
    return { id, clientSecret };
  }

  async createBudgetPayment(input: BudgetPaymentInput): Promise<CreatedPaymentIntent> {
    return this.add(
      input.amount,
      "automatic",
      { kind: STRIPE_PAYMENT_KINDS.campaignBudget, campaignId: input.campaignId },
      `${STRIPE_PAYMENT_KINDS.campaignBudget}:${input.campaignId}`,
    );
  }

  async createPurchaseAuthorization(
    input: PurchaseAuthorizationInput,
  ): Promise<CreatedPaymentIntent> {
    return this.add(
      input.amount,
      "manual",
      {
        kind: STRIPE_PAYMENT_KINDS.purchase,
        campaignId: input.campaignId,
        qty: String(input.qty),
      },
      input.idempotencyKey,
    );
  }

  async createBudgetTopUpPayment(input: BudgetTopUpPaymentInput): Promise<CreatedPaymentIntent> {
    return this.answer("createBudgetTopUpPayment", () =>
      this.add(
        input.amount,
        "automatic",
        {
          kind: STRIPE_PAYMENT_KINDS.campaignBudgetTopUp,
          campaignId: input.campaignId,
          requestId: input.requestId,
        },
        `${STRIPE_PAYMENT_KINDS.campaignBudgetTopUp}:${input.requestId}`,
      ),
    );
  }

  async retrieveClientSecret(id: string): Promise<string | null> {
    return this.answer("retrieveClientSecret", () => {
      if (this.topUpFailure) throw this.topUpFailure;
      return this.intents.get(id)?.clientSecret ?? null;
    });
  }

  /**
   * Stripe's rules: a paid intent (or one being paid) cannot be cancelled, nor can a cancelled one
   * (both answer 400 `payment_intent_unexpected_state`, after which the real gateway reads the
   * intent: "canceled" when it is cancelled, else "not_cancelable"); and a request repeated with
   * an idempotency key Stripe already saw replays the first raw answer, error included, whatever
   * the intent became since. The real gateway sends no key of its own: `idempotencyKey` is there
   * to model a caller that would.
   */
  async cancelUnpaidPaymentIntent(
    id: string,
    idempotencyKey?: string,
  ): Promise<UnpaidCancellation> {
    this.cancelCalls.push({ id, idempotencyKey: idempotencyKey ?? null });
    return this.answer("cancelUnpaidPaymentIntent", () => {
      if (this.topUpFailure) throw this.topUpFailure;
      const intent = this.intents.get(id);
      if (!intent) throw new PaymentGatewayError(`unknown fake intent ${id}`);
      const saved =
        idempotencyKey === undefined ? undefined : this.cancelAnswers.get(idempotencyKey);
      let raw: "ok" | "unexpected_state";
      if (saved !== undefined) {
        raw = saved;
      } else if (
        intent.status === "canceled" ||
        intent.status === "succeeded" ||
        intent.status === "processing"
      ) {
        raw = "unexpected_state";
      } else {
        intent.status = "canceled";
        raw = "ok";
      }
      if (idempotencyKey !== undefined && saved === undefined) {
        this.cancelAnswers.set(idempotencyKey, raw);
      }
      if (raw === "ok") return "canceled";
      return intent.status === "canceled" ? "canceled" : "not_cancelable";
    });
  }

  /**
   * Holds the answers of the top-up calls named (all three by default) until `release`: each call
   * does its work at once, as Stripe would, and answers only once released. Models a slow Stripe.
   */
  holdTopUpCalls(
    calls: readonly TopUpCall[] = [
      "createBudgetTopUpPayment",
      "retrieveClientSecret",
      "cancelUnpaidPaymentIntent",
    ],
  ): HeldAnswers {
    const gate = new HeldAnswers();
    this.held = { calls: new Set(calls), gate };
    return gate;
  }

  /** Runs `work` now, then answers its result or its error once the call is not held. */
  private async answer<T>(call: TopUpCall, work: () => T): Promise<T> {
    let result: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      result = { ok: true, value: work() };
    } catch (error: unknown) {
      result = { ok: false, error };
    }
    const held = this.held;
    if (held !== null && held.calls.has(call)) await held.gate.enter();
    if (!result.ok) throw result.error;
    return result.value;
  }

  async retrievePaymentIntent(id: string): Promise<PaymentIntentView | null> {
    this.retrieveCalls += 1;
    const intent = this.intents.get(id);
    if (!intent) return null;
    return {
      id: intent.id,
      status: intent.status,
      amount: intent.amount,
      currency: intent.currency,
      metadata: { ...intent.metadata },
      payerEmail: intent.payerEmail,
    };
  }

  parseWebhook(rawBody: string, signature: string | null): PaymentWebhookEvent {
    return verifyStripeWebhook(rawBody, signature, TEST_WEBHOOK_SECRET);
  }

  // -------------------------------------------------------------------------------------------
  // What the customer and Stripe do outside the server
  // -------------------------------------------------------------------------------------------

  /** The customer confirms the payment sheet: the intent moves to `status` with this e-mail. */
  pay(id: string, status: PaymentIntentStatus, payerEmail: string | null): FakeIntent {
    const intent = this.intents.get(id);
    if (!intent) throw new PaymentGatewayError(`unknown fake intent ${id}`);
    intent.status = status;
    intent.payerEmail = payerEmail;
    return intent;
  }

  /** An intent Stripe knows but this server never created (another account, a forged id). */
  addForeign(intent: Omit<FakeIntent, "clientSecret" | "idempotencyKey" | "captureMethod">): void {
    this.intents.set(intent.id, {
      ...intent,
      clientSecret: `${intent.id}_secret`,
      captureMethod: "manual",
      idempotencyKey: `foreign:${intent.id}`,
    });
  }
}

/** The top-up calls of the fake whose answers can be held. */
export type TopUpCall =
  "createBudgetTopUpPayment" | "retrieveClientSecret" | "cancelUnpaidPaymentIntent";

/** The answers of held calls: they wait until `release`, and a test can wait for them to arrive. */
export class HeldAnswers {
  private waitingNow = 0;
  private released = false;
  private readonly opens: (() => void)[] = [];
  private readonly watchers: { count: number; resolve: () => void }[] = [];

  /** Called by a held call: waits until released. */
  async enter(): Promise<void> {
    if (this.released) return;
    this.waitingNow += 1;
    for (const watcher of this.watchers.filter((w) => w.count <= this.waitingNow)) {
      watcher.resolve();
    }
    await new Promise<void>((resolve) => this.opens.push(resolve));
  }

  /** Resolves once `count` calls are waiting at the same time. */
  waiting(count: number): Promise<void> {
    if (this.waitingNow >= count) return Promise.resolve();
    return new Promise<void>((resolve) => this.watchers.push({ count, resolve }));
  }

  /** Lets every waiting call answer, and every later call answer at once. */
  release(): void {
    this.released = true;
    for (const open of this.opens.splice(0)) open();
  }
}

/** A Stripe event carrying this intent, as Stripe would POST it (JSON text). */
export function stripeEventBody(
  type: string,
  intent: {
    id: string;
    status: PaymentIntentStatus;
    amount: bigint;
    metadata: Record<string, string>;
  },
  eventId = `evt_${randomBytes(8).toString("hex")}`,
): string {
  return JSON.stringify({
    id: eventId,
    object: "event",
    type,
    api_version: "2026-10-28.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: intent.id,
        object: "payment_intent",
        status: intent.status,
        amount: Number(intent.amount / 10_000n),
        currency: "usd",
        metadata: intent.metadata,
        receipt_email: null,
        payment_method: "pm_card_visa",
        latest_charge: null,
      },
    },
  });
}

/** A valid `stripe-signature` header for this body, made by Stripe's own test helper. */
export function signStripeBody(body: string, secret: string = TEST_WEBHOOK_SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}
