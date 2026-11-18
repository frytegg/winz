import { randomBytes } from "node:crypto";

import { STRIPE_PAYMENT_KINDS } from "@winz/shared";

import {
  PaymentGatewayError as WebPaymentGatewayError,
  stripeAmount,
  verifyStripeWebhook,
  type BudgetPaymentInput,
  type CreatedPaymentIntent,
  type PaymentGateway as WebPaymentGateway,
  type PaymentIntentStatus,
  type PaymentIntentView,
  type PaymentWebhookEvent,
  type PurchaseAuthorizationInput,
  type BudgetTopUpPaymentInput,
  type TopUpPaymentGateway,
  type UnpaidCancellation,
} from "@/lib/server/payments-gateway";
import {
  TEST_WEBHOOK_SECRET,
  signStripeBody,
  stripeEventBody,
} from "@/lib/server/testing/fake-payments";

import {
  PaymentGatewayError as EnginePaymentGatewayError,
  type PaymentGateway as EnginePaymentGateway,
} from "../../../engine/src/payments";

/**
 * ONE simulated Stripe account that both sides of the product talk to, as in production: the web
 * app creates PaymentIntents and verifies webhooks through its `PaymentGateway`, the engine reads,
 * captures, cancels and refunds them through its own. An authorization created by the checkout
 * route is therefore exactly the one the engine captures or cancels.
 *
 * Semantics follow Stripe's: a manual-capture intent goes `requires_payment_method` →
 * `requires_capture` when the customer confirms the card, then `succeeded` on capture or
 * `canceled` on cancel; an automatic one goes straight to `succeeded`. A mutating call repeated
 * with an idempotency key already used replays the first answer and changes nothing. Webhooks are
 * signed and verified with Stripe's own code. Every call is recorded in `calls`.
 */

export type StripeSide = "web" | "engine";
export type StripeMethod =
  | "createBudgetPayment"
  | "createPurchaseAuthorization"
  | "retrieve"
  | "capture"
  | "cancel"
  | "refund";

/** One call the simulated Stripe received, in order. */
export interface StripeCall {
  side: StripeSide;
  method: StripeMethod;
  id: string;
  idempotencyKey: string | null;
}

/** An intent as the simulated account holds it, with what was actually applied to it. */
export interface SimulatedIntent extends PaymentIntentView {
  clientSecret: string;
  captureMethod: "automatic" | "manual";
  idempotencyKey: string;
  /** Times money was taken: the automatic charge of a budget, or a capture. */
  captures: number;
  /** Times an authorization was released. */
  cancels: number;
  refunds: number;
  /** The amount captured, micro-USDC (0 until captured). */
  capturedAmount: bigint;
}

/**
 * Runs before an engine call is applied. It may wait (to hold the engine at a precise point) or
 * throw an engine `PaymentGatewayError` (an outage); returning lets the call proceed.
 */
export type EngineInterceptor = (call: StripeCall) => Promise<void> | void;

/** A Stripe call failing for a while: the network dropped, the engine may try again. */
export function transientStripeError(what: string): EnginePaymentGatewayError {
  return new EnginePaymentGatewayError(`simulated Stripe outage during ${what}`, {
    retryable: true,
    code: "api_connection_error",
  });
}

function unexpectedState(message: string): EnginePaymentGatewayError {
  return new EnginePaymentGatewayError(message, {
    retryable: false,
    code: "payment_intent_unexpected_state",
  });
}

export class SimulatedStripe {
  readonly intents = new Map<string, SimulatedIntent>();
  readonly calls: StripeCall[] = [];
  /** Engine idempotency keys already used, with the error of their first call (null: success). */
  private readonly engineKeys = new Map<string, EnginePaymentGatewayError | null>();
  private readonly interceptors = new Map<StripeMethod, EngineInterceptor>();

  /** The web app's view of the account (`apps/web/lib/server/payments-gateway.ts`). */
  readonly web: WebPaymentGateway;
  /** The engine's view of the account (`apps/engine/src/payments/gateway.ts`). */
  readonly engine: EnginePaymentGateway;

  constructor() {
    this.web = {
      createBudgetPayment: (input) => this.createBudgetPayment(input),
      createPurchaseAuthorization: (input) => this.createPurchaseAuthorization(input),
      retrievePaymentIntent: (id) => {
        this.record("web", "retrieve", id, null);
        return Promise.resolve(this.view(id));
      },
      parseWebhook: (rawBody: string, signature: string | null): PaymentWebhookEvent =>
        verifyStripeWebhook(rawBody, signature, TEST_WEBHOOK_SECRET),
      // The calls of a budget top-up (SPEC CA-6). `web` is typed with the calls every web gateway
      // has; the top-up route finds these at run time (`topUpGatewayOf`). A top-up is captured
      // automatically like the first budget, keyed on its request; its cancel releases an intent
      // nobody paid, and is refused (nothing changes) once the intent is paid or being paid.
      ...({
        createBudgetTopUpPayment: (
          input: BudgetTopUpPaymentInput,
        ): Promise<CreatedPaymentIntent> => {
          try {
            stripeAmount(input.amount);
          } catch (error: unknown) {
            return Promise.reject(
              new WebPaymentGatewayError("simulated Stripe refused the amount", { cause: error }),
            );
          }
          const idempotencyKey = `${STRIPE_PAYMENT_KINDS.campaignBudgetTopUp}:${input.requestId}`;
          const replay = [...this.intents.values()].find(
            (intent) => intent.idempotencyKey === idempotencyKey,
          );
          if (replay !== undefined) {
            return Promise.resolve({ id: replay.id, clientSecret: replay.clientSecret });
          }
          const id = `pi_sim_${randomBytes(10).toString("hex")}`;
          const clientSecret = `${id}_secret_${randomBytes(8).toString("hex")}`;
          this.intents.set(id, {
            id,
            status: "requires_payment_method",
            amount: input.amount,
            currency: "usd",
            metadata: {
              kind: STRIPE_PAYMENT_KINDS.campaignBudgetTopUp,
              campaignId: input.campaignId,
              requestId: input.requestId,
            },
            payerEmail: null,
            clientSecret,
            captureMethod: "automatic",
            idempotencyKey,
            captures: 0,
            cancels: 0,
            refunds: 0,
            capturedAmount: 0n,
          });
          return Promise.resolve({ id, clientSecret });
        },
        retrieveClientSecret: (id: string): Promise<string | null> =>
          Promise.resolve(this.intents.get(id)?.clientSecret ?? null),
        cancelUnpaidPaymentIntent: (id: string): Promise<UnpaidCancellation> => {
          const intent = this.intents.get(id);
          if (intent === undefined) {
            return Promise.reject(new WebPaymentGatewayError(`No such payment_intent: ${id}`));
          }
          if (intent.status === "canceled") return Promise.resolve("canceled");
          if (intent.status === "succeeded" || intent.status === "processing") {
            return Promise.resolve("not_cancelable");
          }
          intent.status = "canceled";
          intent.cancels += 1;
          return Promise.resolve("canceled");
        },
      } satisfies TopUpPaymentGateway),
    };
    this.engine = {
      retrievePaymentIntent: async (id) => {
        await this.intercept({ side: "engine", method: "retrieve", id, idempotencyKey: null });
        this.record("engine", "retrieve", id, null);
        return this.view(id);
      },
      capturePaymentIntent: (id, key) => this.engineMutation("capture", id, key),
      cancelPaymentIntent: (id, key) => this.engineMutation("cancel", id, key),
      refundPaymentIntent: (id, key) => this.engineMutation("refund", id, key),
    };
  }

  // -------------------------------------------------------------------------------------------
  // What the customer, the merchant and Stripe do outside the servers
  // -------------------------------------------------------------------------------------------

  /**
   * The payer confirms the payment sheet with a card: a purchase is authorized
   * (`requires_capture`), a budget payment is charged at once (`succeeded`).
   */
  confirmCard(id: string, payerEmail: string): SimulatedIntent {
    const intent = this.intent(id);
    if (intent.status !== "requires_payment_method") {
      throw new Error(`simulated Stripe: ${id} cannot be confirmed, it is ${intent.status}`);
    }
    intent.payerEmail = payerEmail;
    if (intent.captureMethod === "manual") {
      intent.status = "requires_capture";
    } else {
      intent.status = "succeeded";
      intent.captures += 1;
      intent.capturedAmount = intent.amount;
    }
    return intent;
  }

  /** A signed webhook delivery of `type` carrying the intent as it is now. */
  webhookDelivery(type: string, id: string): { body: string; signature: string } {
    const body = stripeEventBody(type, this.intent(id));
    return { body, signature: signStripeBody(body) };
  }

  // -------------------------------------------------------------------------------------------
  // Test controls and the ledger
  // -------------------------------------------------------------------------------------------

  /**
   * Every later engine call of `method` runs `interceptor` first, until `clearInterceptor`. Used
   * to hold the engine at a precise point or to simulate an outage of Stripe itself.
   */
  setInterceptor(method: StripeMethod, interceptor: EngineInterceptor): void {
    this.interceptors.set(method, interceptor);
  }

  clearInterceptor(method: StripeMethod): void {
    this.interceptors.delete(method);
  }

  intent(id: string): SimulatedIntent {
    const intent = this.intents.get(id);
    if (intent === undefined) throw new Error(`simulated Stripe: no intent ${id}`);
    return intent;
  }

  /** Calls of one side and method, optionally for one intent. */
  callsOf(side: StripeSide, method: StripeMethod, id?: string): StripeCall[] {
    return this.calls.filter(
      (call) =>
        call.side === side && call.method === method && (id === undefined || call.id === id),
    );
  }

  /** Every intent of a kind (`campaign_budget` or `purchase`). */
  intentsOfKind(kind: string): SimulatedIntent[] {
    return [...this.intents.values()].filter((intent) => intent.metadata.kind === kind);
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  private record(
    side: StripeSide,
    method: StripeMethod,
    id: string,
    idempotencyKey: string | null,
  ): void {
    this.calls.push({ side, method, id, idempotencyKey });
  }

  private async intercept(call: StripeCall): Promise<void> {
    const interceptor = this.interceptors.get(call.method);
    if (interceptor !== undefined) await interceptor(call);
  }

  private view(id: string): PaymentIntentView | null {
    const intent = this.intents.get(id);
    if (intent === undefined) return null;
    return {
      id: intent.id,
      status: intent.status,
      amount: intent.amount,
      currency: intent.currency,
      metadata: { ...intent.metadata },
      payerEmail: intent.payerEmail,
    };
  }

  private create(
    method: StripeMethod,
    amount: bigint,
    captureMethod: "automatic" | "manual",
    metadata: Record<string, string>,
    idempotencyKey: string,
  ): CreatedPaymentIntent {
    // The real gateway refuses amounts Stripe cannot take: so does this one.
    try {
      stripeAmount(amount);
    } catch (error: unknown) {
      throw new WebPaymentGatewayError("simulated Stripe refused the amount", { cause: error });
    }
    const replay = [...this.intents.values()].find(
      (intent) => intent.idempotencyKey === idempotencyKey,
    );
    if (replay !== undefined) {
      this.record("web", method, replay.id, idempotencyKey);
      return { id: replay.id, clientSecret: replay.clientSecret };
    }
    const id = `pi_sim_${randomBytes(10).toString("hex")}`;
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
      captures: 0,
      cancels: 0,
      refunds: 0,
      capturedAmount: 0n,
    });
    this.record("web", method, id, idempotencyKey);
    return { id, clientSecret };
  }

  private createBudgetPayment(input: BudgetPaymentInput): Promise<CreatedPaymentIntent> {
    return Promise.resolve(
      this.create(
        "createBudgetPayment",
        input.amount,
        "automatic",
        { kind: STRIPE_PAYMENT_KINDS.campaignBudget, campaignId: input.campaignId },
        `${STRIPE_PAYMENT_KINDS.campaignBudget}:${input.campaignId}`,
      ),
    );
  }

  private createPurchaseAuthorization(
    input: PurchaseAuthorizationInput,
  ): Promise<CreatedPaymentIntent> {
    return Promise.resolve(
      this.create(
        "createPurchaseAuthorization",
        input.amount,
        "manual",
        {
          kind: STRIPE_PAYMENT_KINDS.purchase,
          campaignId: input.campaignId,
          qty: String(input.qty),
        },
        input.idempotencyKey,
      ),
    );
  }

  private async engineMutation(
    method: "capture" | "cancel" | "refund",
    id: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.intercept({ side: "engine", method, id, idempotencyKey });
    this.record("engine", method, id, idempotencyKey);
    if (this.engineKeys.has(idempotencyKey)) {
      const first = this.engineKeys.get(idempotencyKey);
      if (first) throw first;
      return;
    }
    const intent = this.intents.get(id);
    if (intent === undefined) {
      throw new EnginePaymentGatewayError(`No such payment_intent: ${id}`, {
        retryable: false,
        code: "resource_missing",
      });
    }
    try {
      this.apply(method, intent);
    } catch (error: unknown) {
      if (error instanceof EnginePaymentGatewayError) this.engineKeys.set(idempotencyKey, error);
      throw error;
    }
    this.engineKeys.set(idempotencyKey, null);
  }

  private apply(method: "capture" | "cancel" | "refund", intent: SimulatedIntent): void {
    const status: PaymentIntentStatus = intent.status;
    switch (method) {
      case "capture":
        if (status === "succeeded") return;
        if (status !== "requires_capture") {
          throw unexpectedState(`${intent.id} cannot be captured: it is ${status}`);
        }
        intent.status = "succeeded";
        intent.captures += 1;
        intent.capturedAmount = intent.amount;
        return;
      case "cancel":
        if (status === "canceled") return;
        if (status === "succeeded") {
          throw unexpectedState(`${intent.id} cannot be cancelled: it was captured`);
        }
        intent.status = "canceled";
        intent.cancels += 1;
        return;
      case "refund":
        if (intent.refunds > 0) return;
        if (status !== "succeeded") {
          throw new EnginePaymentGatewayError(`${intent.id} has no captured charge`, {
            retryable: false,
            code: "charge_not_refundable",
          });
        }
        intent.refunds += 1;
        return;
    }
  }
}
