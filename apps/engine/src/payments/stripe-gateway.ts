import Stripe from "stripe";
import { z } from "zod";

import { centsToMicroUsdc } from "@winz/shared";

import {
  PAYMENT_INTENT_STATUSES,
  PaymentGatewayConfigError,
  PaymentGatewayError,
  type PaymentGateway,
  type PaymentIntentView,
} from "./gateway";

/** Options of the Stripe implementation; tests inject an HTTP client so no request leaves. */
export interface StripePaymentGatewayOptions {
  /** The HTTP client the Stripe library sends its requests through (default: Node's). */
  httpClient?: Stripe.HttpClient;
  /** Retries of the Stripe library itself on network errors, with the same idempotency key. */
  maxNetworkRetries?: number;
  /** Timeout of one request, ms. Default 15 000. */
  timeoutMs?: number;
}

const billingEmailSchema = z
  .object({ billing_details: z.object({ email: z.string().nullish() }).nullish() })
  .loose();

/** The fields of a PaymentIntent object this module reads. */
const paymentIntentObjectSchema = z
  .object({
    object: z.literal("payment_intent"),
    id: z.string().min(1),
    status: z.enum(PAYMENT_INTENT_STATUSES),
    amount: z.number().int().min(0),
    currency: z.string(),
    metadata: z.record(z.string(), z.string()).nullish(),
    receipt_email: z.string().nullish(),
    // Ids unless expanded; only an expanded object carries billing details.
    payment_method: z.union([z.string(), billingEmailSchema]).nullish(),
    latest_charge: z.union([z.string(), billingEmailSchema]).nullish(),
  })
  .loose();

function billingEmail(
  value: string | z.infer<typeof billingEmailSchema> | null | undefined,
): string | null {
  if (value === null || value === undefined || typeof value === "string") return null;
  const email = value.billing_details?.email;
  return email && email.trim() !== "" ? email : null;
}

/** A PaymentIntent object, as Stripe returns it, as a `PaymentIntentView`. */
export function toPaymentIntentView(object: unknown): PaymentIntentView {
  const parsed = paymentIntentObjectSchema.safeParse(object);
  if (!parsed.success) {
    throw new PaymentGatewayError(
      `not a PaymentIntent object: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      { retryable: false },
    );
  }
  const intent = parsed.data;
  const receipt =
    intent.receipt_email && intent.receipt_email.trim() !== "" ? intent.receipt_email : null;
  return {
    id: intent.id,
    status: intent.status,
    amount: centsToMicroUsdc(BigInt(intent.amount)),
    currency: intent.currency.toLowerCase(),
    metadata: intent.metadata ?? {},
    payerEmail:
      billingEmail(intent.payment_method) ?? billingEmail(intent.latest_charge) ?? receipt,
  };
}

/** Status of the PaymentIntent Stripe attaches to an "unexpected state" error, if any. */
function intentStatusOf(error: Stripe.errors.StripeError): string | undefined {
  const intent: unknown = error.payment_intent;
  if (typeof intent !== "object" || intent === null) return undefined;
  const status = (intent as Record<string, unknown>).status;
  return typeof status === "string" ? status : undefined;
}

/**
 * Network failures, Stripe outages and rate limits may succeed later; everything else (an invalid
 * request, a card or state error, a reused idempotency key) never will.
 */
function isRetryable(error: unknown): boolean {
  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError
  ) {
    return true;
  }
  if (error instanceof Stripe.errors.StripeError) {
    return error.statusCode !== undefined && error.statusCode >= 500;
  }
  // Not a Stripe error at all (a socket error below the library): worth another try.
  return true;
}

function codeOf(error: unknown): string | undefined {
  return error instanceof Stripe.errors.StripeError ? error.code : undefined;
}

function gatewayError(what: string, error: unknown): PaymentGatewayError {
  const code = codeOf(error);
  const name = error instanceof Error ? error.name : "unknown error";
  return new PaymentGatewayError(`${what} failed (${name}${code ? `, ${code}` : ""})`, {
    retryable: isRetryable(error),
    code,
    cause: error,
  });
}

/**
 * The gateway on Stripe. The key is checked at construction (test keys only: a key that does not
 * start with `sk_test_` is refused) and the Stripe client is built at the first call. Every
 * mutating call carries the caller's idempotency key, so a retried job never captures, cancels
 * or refunds twice; Stripe's "already captured", "already canceled" and "already refunded"
 * answers are successes.
 */
export class StripePaymentGateway implements PaymentGateway {
  private client: Stripe | undefined;

  constructor(
    private readonly secretKey: string,
    private readonly options: StripePaymentGatewayOptions = {},
  ) {
    if (!secretKey.startsWith("sk_test_")) {
      throw new PaymentGatewayConfigError("only Stripe test keys (sk_test_) are allowed");
    }
  }

  private stripe(): Stripe {
    this.client ??= new Stripe(this.secretKey, {
      maxNetworkRetries: this.options.maxNetworkRetries ?? 2,
      timeout: this.options.timeoutMs ?? 15_000,
      ...(this.options.httpClient ? { httpClient: this.options.httpClient } : {}),
    });
    return this.client;
  }

  async retrievePaymentIntent(id: string): Promise<PaymentIntentView | null> {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe().paymentIntents.retrieve(id, {
        expand: ["payment_method", "latest_charge"],
      });
    } catch (error: unknown) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
        return null;
      }
      throw gatewayError(`retrieving PaymentIntent ${id}`, error);
    }
    return toPaymentIntentView(intent);
  }

  async capturePaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    try {
      await this.stripe().paymentIntents.capture(id, {}, { idempotencyKey });
    } catch (error: unknown) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === "payment_intent_unexpected_state" &&
        intentStatusOf(error) === "succeeded"
      ) {
        return; // Already captured.
      }
      throw gatewayError(`capturing PaymentIntent ${id}`, error);
    }
  }

  async cancelPaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    try {
      await this.stripe().paymentIntents.cancel(id, {}, { idempotencyKey });
    } catch (error: unknown) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === "payment_intent_unexpected_state" &&
        intentStatusOf(error) === "canceled"
      ) {
        return; // Already canceled.
      }
      throw gatewayError(`cancelling PaymentIntent ${id}`, error);
    }
  }

  async refundPaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    try {
      await this.stripe().refunds.create({ payment_intent: id }, { idempotencyKey });
    } catch (error: unknown) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === "charge_already_refunded"
      ) {
        return; // Already refunded in full.
      }
      throw gatewayError(`refunding PaymentIntent ${id}`, error);
    }
  }
}
