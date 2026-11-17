/**
 * The card payments the engine settles (SPEC CA-2, CO-2, CO-3, CO-4). The web app creates the
 * PaymentIntents and enqueues a job; the engine reads them back, captures a purchase once its
 * ticket exists, cancels an authorization it cannot honour, and refunds a budget that can never
 * be used. Behind an interface so the job handlers are tested against a fake.
 *
 * Amounts cross this interface in micro-USDC (Stripe's cents converted back). Every mutating call
 * takes an idempotency key: a retried job sends the same key, so Stripe applies the call once.
 */

/** The statuses of a Stripe PaymentIntent. */
export const PAYMENT_INTENT_STATUSES = [
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
  "requires_capture",
  "canceled",
  "succeeded",
] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

/** A PaymentIntent as the engine needs it. */
export interface PaymentIntentView {
  id: string;
  status: PaymentIntentStatus;
  /** The amount of the intent, in micro-USDC. */
  amount: bigint;
  /** Lowercase ISO currency code; `usd` for every intent the web app creates. */
  currency: string;
  /** `kind` (`STRIPE_PAYMENT_KINDS`), `campaignId`, and `qty` for a purchase. */
  metadata: Record<string, string>;
  /**
   * The payer's e-mail as the payment sheet collected it, not normalised; null when Stripe has
   * none. Personal data: never logged.
   */
  payerEmail: string | null;
}

export interface PaymentGateway {
  /** The intent as the provider has it now; null when the provider does not know this id. */
  retrievePaymentIntent(id: string): Promise<PaymentIntentView | null>;
  /**
   * Captures an authorized intent. An intent that is already captured is a success: a retried
   * job may capture twice, the customer is charged once.
   */
  capturePaymentIntent(id: string, idempotencyKey: string): Promise<void>;
  /**
   * Cancels an intent and releases its authorization. An intent that is already canceled is a
   * success. An intent that was captured cannot be cancelled: `PaymentGatewayError`, permanent.
   */
  cancelPaymentIntent(id: string, idempotencyKey: string): Promise<void>;
  /** Refunds a captured intent in full. An intent already refunded in full is a success. */
  refundPaymentIntent(id: string, idempotencyKey: string): Promise<void>;
}

/**
 * The provider failed or refused a call. `retryable` says whether the same call may succeed
 * later (network, outage, rate limit) or never will (the authorization expired, the intent is in
 * a state that forbids the call, the request is invalid).
 */
export class PaymentGatewayError extends Error {
  public readonly retryable: boolean;
  /** The provider's error code when it gave one (for example `payment_intent_unexpected_state`). */
  public readonly code: string | undefined;

  constructor(
    message: string,
    options: { retryable: boolean; code?: string | undefined; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PaymentGatewayError";
    this.retryable = options.retryable;
    this.code = options.code;
  }
}

/** The gateway was configured with something it must refuse (a live key, an empty key). */
export class PaymentGatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentGatewayConfigError";
  }
}
