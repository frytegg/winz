import {
  STRIPE_PAYMENT_KINDS,
  centsToMicroUsdc,
  microUsdcToCents,
  type StripePaymentKind,
} from "@winz/shared";
import Stripe from "stripe";
import { z } from "zod";

/**
 * The card payments the web app takes (SPEC CO-2, CA-2), behind an interface so that the routes
 * are tested against a fake. Amounts cross this interface in micro-USDC and go to Stripe in whole
 * cents (`microUsdcToCents` refuses anything else). Every PaymentIntent carries `metadata.kind`
 * (`STRIPE_PAYMENT_KINDS`) and `metadata.campaignId`, and a purchase also `metadata.qty`: the
 * webhook and the engine read what was paid from there.
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

/** A PaymentIntent as the routes need it. */
export interface PaymentIntentView {
  id: string;
  status: PaymentIntentStatus;
  /** The amount of the intent, in micro-USDC (Stripe's cents converted back). */
  amount: bigint;
  /** Lowercase ISO currency code; always `usd` for intents created here. */
  currency: string;
  metadata: Record<string, string>;
  /**
   * The payer's e-mail as the payment sheet collected it (billing details of the payment method or
   * of the charge, else the receipt e-mail), not normalised; null when Stripe has none.
   */
  payerEmail: string | null;
}

/** What the browser needs to complete a payment with Stripe's Payment / Express Checkout Element. */
export interface CreatedPaymentIntent {
  id: string;
  clientSecret: string;
}

/**
 * A verified webhook event. For a `payment_intent.*` event, `paymentIntent` is its object, or null
 * with `payloadError` saying why when the object cannot be read (a status this code does not know,
 * a shape that drifted). The signature has verified either way, so the handler decides whether to
 * acknowledge it: answering an error would make Stripe retry an event that can never succeed.
 */
export interface PaymentWebhookEvent {
  id: string;
  type: string;
  paymentIntent: PaymentIntentView | null;
  payloadError: string | null;
}

export interface BudgetPaymentInput {
  campaignId: string;
  /** The budget, micro-USDC, whole cents. */
  amount: bigint;
}

export interface PurchaseAuthorizationInput {
  campaignId: string;
  qty: number;
  /** qty × unit price, micro-USDC, whole cents. */
  amount: bigint;
  /** Sent to Stripe as the request's idempotency key, so a retried call creates one intent. */
  idempotencyKey: string;
}

export interface BudgetTopUpPaymentInput {
  campaignId: string;
  /** The merchant's `requestId`: Stripe's idempotency key is built from it. */
  requestId: string;
  /** The top-up, micro-USDC, whole cents. */
  amount: bigint;
}

/** What `cancelUnpaidPaymentIntent` found. */
export type UnpaidCancellation =
  /** The intent is cancelled (by this call or before it): it can never be paid any more. */
  | "canceled"
  /** The intent is paid or being paid: it was left as it is. */
  | "not_cancelable";

/**
 * The calls of a budget top-up (SPEC CA-6, `budget-top-up.ts`), apart from `PaymentGateway` so
 * that the gateways written before top-ups existed keep compiling: `topUpGatewayOf` tells whether
 * a gateway has them.
 */
export interface TopUpPaymentGateway {
  /**
   * The merchant's top-up payment, captured automatically once the card is confirmed, like the
   * first budget. One intent per `requestId`, even if the call is retried: Stripe replays the
   * first answer to the key for about a day, whatever became of the intent since, so the answer
   * may name an intent cancelled meanwhile. The caller reads its status before recording it.
   */
  createBudgetTopUpPayment(input: BudgetTopUpPaymentInput): Promise<CreatedPaymentIntent>;
  /** The client secret of an intent, to answer a repeated request; null when Stripe has none. */
  retrieveClientSecret(id: string): Promise<string | null>;
  /**
   * Cancels an intent nobody has paid, so that it can never be: "canceled" also when it already
   * was, "not_cancelable" when it is paid or being paid (then nothing changed). Sent without an
   * idempotency key of ours: cancelling is idempotent by nature, and Stripe replays the first
   * answer to a key for a day, errors included, so a key reused after a refusal (the intent was
   * `processing`, then failed) could never cancel the intent again.
   */
  cancelUnpaidPaymentIntent(id: string): Promise<UnpaidCancellation>;
}

/** The gateway with its top-up calls, or null when it has none. */
export function topUpGatewayOf(
  payments: PaymentGateway,
): (PaymentGateway & TopUpPaymentGateway) | null {
  const candidate = payments as PaymentGateway & Partial<TopUpPaymentGateway>;
  if (
    typeof candidate.createBudgetTopUpPayment === "function" &&
    typeof candidate.retrieveClientSecret === "function" &&
    typeof candidate.cancelUnpaidPaymentIntent === "function"
  ) {
    return candidate as PaymentGateway & TopUpPaymentGateway;
  }
  return null;
}

export interface PaymentGateway {
  /** The merchant's budget payment, captured automatically once the card is confirmed. */
  createBudgetPayment(input: BudgetPaymentInput): Promise<CreatedPaymentIntent>;
  /** A customer's purchase: the card is only authorized (`capture_method: manual`). */
  createPurchaseAuthorization(input: PurchaseAuthorizationInput): Promise<CreatedPaymentIntent>;
  /** The intent as Stripe has it now; null when Stripe does not know this id. */
  retrievePaymentIntent(id: string): Promise<PaymentIntentView | null>;
  /**
   * Verifies the `stripe-signature` header over the raw body and parses the event. Throws
   * `WebhookSignatureError` when the signature is missing, wrong or too old.
   */
  parseWebhook(rawBody: string, signature: string | null): PaymentWebhookEvent;
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** The payment provider failed or refused a call (network, outage, invalid request). */
export class PaymentGatewayError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PaymentGatewayError";
  }
}

/** A webhook whose signature does not verify, or whose body is not a Stripe event. */
export class WebhookSignatureError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Webhook rejected: ${reason}`, options);
    this.name = "WebhookSignatureError";
  }
}

/** Stripe's ceiling for one payment in USD: $999,999.99. */
export const STRIPE_MAX_AMOUNT_CENTS = 99_999_999n;
/** Stripe's floor for one card payment in USD: $0.50. */
export const STRIPE_MIN_AMOUNT_CENTS = 50n;

// ---------------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------------

const billingEmailSchema = z
  .object({ billing_details: z.object({ email: z.string().nullish() }).nullish() })
  .loose();

/** The fields of a PaymentIntent object this module reads, from an event or from the API. */
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

/** A PaymentIntent object (as Stripe sends or returns it) as a `PaymentIntentView`. */
export function toPaymentIntentView(object: unknown): PaymentIntentView {
  const parsed = paymentIntentObjectSchema.safeParse(object);
  if (!parsed.success) {
    throw new PaymentGatewayError(
      `not a PaymentIntent object: ${parsed.error.issues[0]?.message ?? "invalid"}`,
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

/** The payment kind of an intent's metadata, or null when it is not one of ours. */
export function paymentKindOf(intent: PaymentIntentView): StripePaymentKind | null {
  const kind = intent.metadata.kind;
  return kind === STRIPE_PAYMENT_KINDS.campaignBudget ||
    kind === STRIPE_PAYMENT_KINDS.purchase ||
    kind === STRIPE_PAYMENT_KINDS.campaignBudgetTopUp
    ? kind
    : null;
}

/** Micro-USDC to the integer number of cents Stripe takes, within Stripe's ceiling. */
export function stripeAmount(amount: bigint): number {
  const cents = microUsdcToCents(amount);
  if (cents <= 0n || cents > STRIPE_MAX_AMOUNT_CENTS) {
    throw new PaymentGatewayError(`amount of ${cents.toString()} cents is out of Stripe's range`);
  }
  return Number(cents);
}

// ---------------------------------------------------------------------------------------------
// Webhook verification (Stripe's own code, used by the real gateway and by the test fake)
// ---------------------------------------------------------------------------------------------

/**
 * Verifies a Stripe webhook with Stripe's library (HMAC-SHA256 of `timestamp.body`, timestamp
 * within the default tolerance of 5 minutes) and maps the event.
 */
export function verifyStripeWebhook(
  rawBody: string,
  signature: string | null,
  secret: string,
): PaymentWebhookEvent {
  if (signature === null || signature.trim() === "") {
    throw new WebhookSignatureError("missing stripe-signature header");
  }
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (error: unknown) {
    throw new WebhookSignatureError("signature does not verify", { cause: error });
  }
  const object: unknown = event.data.object;
  if (!event.type.startsWith("payment_intent.")) {
    return { id: event.id, type: event.type, paymentIntent: null, payloadError: null };
  }
  try {
    return {
      id: event.id,
      type: event.type,
      paymentIntent: toPaymentIntentView(object),
      payloadError: null,
    };
  } catch (error: unknown) {
    if (!(error instanceof PaymentGatewayError)) throw error;
    return { id: event.id, type: event.type, paymentIntent: null, payloadError: error.message };
  }
}

// ---------------------------------------------------------------------------------------------
// Stripe implementation
// ---------------------------------------------------------------------------------------------

/** Options of the Stripe implementation; tests inject an HTTP client so no request leaves. */
export interface StripeGatewayOptions {
  /** The HTTP client the Stripe library sends its requests through (default: Node's). */
  httpClient?: Stripe.HttpClient;
}

/**
 * The budget payment is created inside the campaign insert transaction (so a failure leaves no
 * campaign), which holds a pooled connection while Stripe answers: this call gets a shorter
 * timeout and a single retry, about 20 s at worst instead of 45 s.
 */
export const BUDGET_REQUEST_TIMEOUT_MS = 10_000;
export const BUDGET_REQUEST_MAX_RETRIES = 1;

export interface StripeSettings {
  /** `STRIPE_SECRET_KEY`: a test key (`sk_test_`), never a live one. */
  secretKey: string;
  /** `STRIPE_WEBHOOK_SECRET`. */
  webhookSecret: string;
}

/**
 * The gateway on Stripe. The client is created at the first call, from settings read at that
 * moment (never at import time, so `next build` needs no secret). Live keys are refused.
 */
export class StripePaymentGateway implements PaymentGateway, TopUpPaymentGateway {
  private client: Stripe | undefined;
  private settingsCache: StripeSettings | undefined;

  constructor(
    private readonly loadSettings: () => StripeSettings,
    private readonly options: StripeGatewayOptions = {},
  ) {}

  private settings(): StripeSettings {
    if (!this.settingsCache) {
      const settings = this.loadSettings();
      if (!settings.secretKey.startsWith("sk_test_")) {
        throw new PaymentGatewayError("only Stripe test keys (sk_test_) are allowed");
      }
      if (settings.webhookSecret.trim() === "") {
        throw new PaymentGatewayError("the Stripe webhook secret is empty");
      }
      this.settingsCache = settings;
    }
    return this.settingsCache;
  }

  private stripe(): Stripe {
    this.client ??= new Stripe(this.settings().secretKey, {
      maxNetworkRetries: 2,
      timeout: 15_000,
      ...(this.options.httpClient ? { httpClient: this.options.httpClient } : {}),
    });
    return this.client;
  }

  private async create(
    params: Stripe.PaymentIntentCreateParams,
    requestOptions: Stripe.RequestOptions & { idempotencyKey: string },
  ): Promise<CreatedPaymentIntent> {
    // Outside the try: a refused key is a configuration error, not a provider failure.
    const stripe = this.stripe();
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.create(params, requestOptions);
    } catch (error: unknown) {
      throw new PaymentGatewayError("Stripe refused to create the PaymentIntent", { cause: error });
    }
    if (!intent.client_secret) {
      throw new PaymentGatewayError(`PaymentIntent ${intent.id} came back without a client secret`);
    }
    return { id: intent.id, clientSecret: intent.client_secret };
  }

  async createBudgetPayment(input: BudgetPaymentInput): Promise<CreatedPaymentIntent> {
    // Async: an amount Stripe cannot take rejects the promise like any other failure.
    return this.create(
      {
        amount: stripeAmount(input.amount),
        currency: "usd",
        capture_method: "automatic",
        automatic_payment_methods: { enabled: true },
        description: "Promo budget",
        metadata: { kind: STRIPE_PAYMENT_KINDS.campaignBudget, campaignId: input.campaignId },
      },
      {
        // One budget payment per campaign, even if the call is retried.
        idempotencyKey: `${STRIPE_PAYMENT_KINDS.campaignBudget}:${input.campaignId}`,
        timeout: BUDGET_REQUEST_TIMEOUT_MS,
        maxNetworkRetries: BUDGET_REQUEST_MAX_RETRIES,
      },
    );
  }

  async createPurchaseAuthorization(
    input: PurchaseAuthorizationInput,
  ): Promise<CreatedPaymentIntent> {
    return this.create(
      {
        amount: stripeAmount(input.amount),
        currency: "usd",
        capture_method: "manual",
        automatic_payment_methods: { enabled: true },
        metadata: {
          kind: STRIPE_PAYMENT_KINDS.purchase,
          campaignId: input.campaignId,
          qty: String(input.qty),
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async createBudgetTopUpPayment(input: BudgetTopUpPaymentInput): Promise<CreatedPaymentIntent> {
    // A merchant waits on it, like the first budget's: the same short timeout and single retry.
    return this.create(
      {
        amount: stripeAmount(input.amount),
        currency: "usd",
        capture_method: "automatic",
        automatic_payment_methods: { enabled: true },
        description: "Promo budget top-up",
        metadata: {
          kind: STRIPE_PAYMENT_KINDS.campaignBudgetTopUp,
          campaignId: input.campaignId,
          requestId: input.requestId,
        },
      },
      {
        // One payment per request, even if the call is retried.
        idempotencyKey: `${STRIPE_PAYMENT_KINDS.campaignBudgetTopUp}:${input.requestId}`,
        timeout: BUDGET_REQUEST_TIMEOUT_MS,
        maxNetworkRetries: BUDGET_REQUEST_MAX_RETRIES,
      },
    );
  }

  async retrieveClientSecret(id: string): Promise<string | null> {
    const stripe = this.stripe();
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.retrieve(id, undefined, {
        timeout: BUDGET_REQUEST_TIMEOUT_MS,
        maxNetworkRetries: BUDGET_REQUEST_MAX_RETRIES,
      });
    } catch (error: unknown) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
        return null;
      }
      throw new PaymentGatewayError(`Stripe could not retrieve PaymentIntent ${id}`, {
        cause: error,
      });
    }
    return intent.client_secret ?? null;
  }

  async cancelUnpaidPaymentIntent(id: string): Promise<UnpaidCancellation> {
    const stripe = this.stripe();
    try {
      // No `idempotencyKey`: Stripe's client gives each call a fresh one (kept across its own
      // network retries of that call), which no later call can repeat.
      await stripe.paymentIntents.cancel(id, undefined, {
        timeout: BUDGET_REQUEST_TIMEOUT_MS,
        maxNetworkRetries: BUDGET_REQUEST_MAX_RETRIES,
      });
      return "canceled";
    } catch (error: unknown) {
      if (
        !(error instanceof Stripe.errors.StripeInvalidRequestError) ||
        error.code !== "payment_intent_unexpected_state"
      ) {
        throw new PaymentGatewayError(`Stripe could not cancel PaymentIntent ${id}`, {
          cause: error,
        });
      }
    }
    // Refused for its state: read it now.
    const current = await this.retrievePaymentIntent(id);
    return current?.status === "canceled" ? "canceled" : "not_cancelable";
  }

  async retrievePaymentIntent(id: string): Promise<PaymentIntentView | null> {
    const stripe = this.stripe();
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.retrieve(id, {
        expand: ["payment_method", "latest_charge"],
      });
    } catch (error: unknown) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
        return null;
      }
      throw new PaymentGatewayError(`Stripe could not retrieve PaymentIntent ${id}`, {
        cause: error,
      });
    }
    return toPaymentIntentView(intent);
  }

  parseWebhook(rawBody: string, signature: string | null): PaymentWebhookEvent {
    return verifyStripeWebhook(rawBody, signature, this.settings().webhookSecret);
  }
}
