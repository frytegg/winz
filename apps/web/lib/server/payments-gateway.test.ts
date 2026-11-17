import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import {
  BUDGET_REQUEST_MAX_RETRIES,
  PaymentGatewayError,
  StripePaymentGateway,
  WebhookSignatureError,
  paymentKindOf,
  stripeAmount,
  toPaymentIntentView,
  verifyStripeWebhook,
} from "./payments-gateway";
import { TEST_WEBHOOK_SECRET, signStripeBody, stripeEventBody } from "./testing/fake-payments";

const intent = {
  id: "pi_123",
  status: "requires_capture" as const,
  amount: 40_000_000n,
  metadata: { kind: "purchase", campaignId: "c1", qty: "2" },
};

describe("verifyStripeWebhook (Stripe's own verification code)", () => {
  it("accepts a payload signed with the secret and maps the PaymentIntent", () => {
    const body = stripeEventBody("payment_intent.amount_capturable_updated", intent, "evt_1");
    const event = verifyStripeWebhook(body, signStripeBody(body), TEST_WEBHOOK_SECRET);
    expect(event).toEqual({
      id: "evt_1",
      type: "payment_intent.amount_capturable_updated",
      paymentIntent: {
        id: "pi_123",
        status: "requires_capture",
        amount: 40_000_000n,
        currency: "usd",
        metadata: { kind: "purchase", campaignId: "c1", qty: "2" },
        payerEmail: null,
      },
      payloadError: null,
    });
  });

  it("refuses a tampered body", () => {
    const body = stripeEventBody("payment_intent.succeeded", intent);
    const signature = signStripeBody(body);
    const tampered = body.replace('"amount":4000', '"amount":1');
    expect(tampered).not.toBe(body);
    expect(() => verifyStripeWebhook(tampered, signature, TEST_WEBHOOK_SECRET)).toThrow(
      WebhookSignatureError,
    );
  });

  it("refuses another secret, a missing header and a garbage header", () => {
    const body = stripeEventBody("payment_intent.succeeded", intent);
    expect(() =>
      verifyStripeWebhook(body, signStripeBody(body, "whsec_other"), TEST_WEBHOOK_SECRET),
    ).toThrow(WebhookSignatureError);
    expect(() => verifyStripeWebhook(body, null, TEST_WEBHOOK_SECRET)).toThrow(
      WebhookSignatureError,
    );
    expect(() => verifyStripeWebhook(body, "t=1,v1=abc", TEST_WEBHOOK_SECRET)).toThrow(
      WebhookSignatureError,
    );
  });

  it("refuses a correctly signed but old payload (replay outside the tolerance)", () => {
    const body = stripeEventBody("payment_intent.succeeded", intent);
    const old = Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: TEST_WEBHOOK_SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(() => verifyStripeWebhook(body, old, TEST_WEBHOOK_SECRET)).toThrow(
      WebhookSignatureError,
    );
  });

  it("gives no PaymentIntent for other events", () => {
    const body = JSON.stringify({
      id: "evt_2",
      object: "event",
      type: "customer.created",
      data: { object: { id: "cus_1", object: "customer" } },
    });
    const event = verifyStripeWebhook(body, signStripeBody(body), TEST_WEBHOOK_SECRET);
    expect(event).toEqual({
      id: "evt_2",
      type: "customer.created",
      paymentIntent: null,
      payloadError: null,
    });
  });

  it("reports, instead of throwing, a signed PaymentIntent it cannot read", () => {
    const body = JSON.stringify({
      id: "evt_3",
      object: "event",
      type: "payment_intent.created",
      data: { object: { id: "pi_1", object: "payment_intent", status: "brand_new" } },
    });
    const event = verifyStripeWebhook(body, signStripeBody(body), TEST_WEBHOOK_SECRET);
    expect(event.paymentIntent).toBeNull();
    expect(event.payloadError).toMatch(/not a PaymentIntent object/);
  });
});

describe("toPaymentIntentView", () => {
  const base = {
    object: "payment_intent",
    id: "pi_1",
    status: "requires_capture",
    amount: 2000,
    currency: "USD",
    metadata: {},
  };

  it("converts cents to micro-USDC and reads the payer e-mail in order", () => {
    expect(toPaymentIntentView(base)).toMatchObject({
      amount: 20_000_000n,
      currency: "usd",
      payerEmail: null,
    });
    expect(toPaymentIntentView({ ...base, receipt_email: "r@x.com" }).payerEmail).toBe("r@x.com");
    expect(
      toPaymentIntentView({
        ...base,
        receipt_email: "r@x.com",
        latest_charge: { billing_details: { email: "c@x.com" } },
      }).payerEmail,
    ).toBe("c@x.com");
    expect(
      toPaymentIntentView({
        ...base,
        payment_method: { billing_details: { email: " Fan@X.com " } },
        latest_charge: { billing_details: { email: "c@x.com" } },
      }).payerEmail,
    ).toBe(" Fan@X.com ");
    expect(toPaymentIntentView({ ...base, payment_method: "pm_1" }).payerEmail).toBeNull();
  });

  it("refuses something that is not a PaymentIntent", () => {
    expect(() => toPaymentIntentView({ ...base, object: "charge" })).toThrow(PaymentGatewayError);
    expect(() => toPaymentIntentView({ ...base, status: "weird" })).toThrow(PaymentGatewayError);
  });

  it("knows our two payment kinds only", () => {
    const view = toPaymentIntentView(base);
    expect(paymentKindOf({ ...view, metadata: { kind: "purchase" } })).toBe("purchase");
    expect(paymentKindOf({ ...view, metadata: { kind: "campaign_budget" } })).toBe(
      "campaign_budget",
    );
    expect(paymentKindOf({ ...view, metadata: { kind: "other" } })).toBeNull();
    expect(paymentKindOf(view)).toBeNull();
  });
});

describe("stripeAmount", () => {
  it("sends whole cents and refuses anything else", () => {
    expect(stripeAmount(20_000_000n)).toBe(2000);
    expect(() => stripeAmount(20_005_000n)).toThrow();
    expect(() => stripeAmount(0n)).toThrow(PaymentGatewayError);
    expect(() => stripeAmount(1_000_000_000_000n)).toThrow(PaymentGatewayError);
  });
});

describe("StripePaymentGateway", () => {
  it("reads its settings lazily: building it needs no secret", () => {
    let reads = 0;
    const gateway = new StripePaymentGateway(() => {
      reads += 1;
      throw new Error("no env");
    });
    expect(reads).toBe(0);
    expect(() => gateway.parseWebhook("{}", "t=1,v1=x")).toThrow("no env");
  });

  it("refuses a live key before any call", async () => {
    const gateway = new StripePaymentGateway(() => ({
      secretKey: "sk_live_123",
      webhookSecret: TEST_WEBHOOK_SECRET,
    }));
    expect(() => gateway.parseWebhook("{}", "t=1,v1=x")).toThrow(/test keys/);
    await expect(gateway.retrievePaymentIntent("pi_1")).rejects.toThrow(/test keys/);
  });

  it("verifies webhooks with the configured secret", () => {
    const gateway = new StripePaymentGateway(() => ({
      secretKey: "sk_test_123",
      webhookSecret: TEST_WEBHOOK_SECRET,
    }));
    const body = stripeEventBody("payment_intent.succeeded", { ...intent, status: "succeeded" });
    expect(gateway.parseWebhook(body, signStripeBody(body)).paymentIntent?.id).toBe("pi_123");
    expect(() => gateway.parseWebhook(body, signStripeBody(body, "whsec_other"))).toThrow(
      WebhookSignatureError,
    );
  });
});

/** One request the real gateway sent, as the Stripe API would receive it. */
interface SentRequest {
  method: string;
  url: URL;
  headers: Headers;
  form: URLSearchParams;
}

/**
 * A stand-in for the network under Stripe's own client: records each request and answers with
 * `respond`. Nothing leaves the process.
 */
function stripeOverFakeHttp(
  respond: (request: SentRequest) => { status: number; body: unknown; headers?: HeadersInit },
): { gateway: StripePaymentGateway; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = typeof init?.body === "string" ? init.body : "";
    const request: SentRequest = {
      method: init?.method ?? "GET",
      url: new URL(input instanceof Request ? input.url : input.toString()),
      headers: new Headers(init?.headers),
      form: new URLSearchParams(body),
    };
    sent.push(request);
    const answer = respond(request);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers },
    });
  };
  const gateway = new StripePaymentGateway(
    () => ({ secretKey: "sk_test_fake", webhookSecret: TEST_WEBHOOK_SECRET }),
    { httpClient: Stripe.createFetchHttpClient(fakeFetch) },
  );
  return { gateway, sent };
}

/** A PaymentIntent object as the API returns it, echoing what was sent in a create. */
function intentAnswer(request: SentRequest, overrides: Record<string, unknown> = {}): unknown {
  const metadata: Record<string, string> = {};
  for (const [key, value] of request.form) {
    const match = /^metadata\[(.+)\]$/.exec(key);
    if (match?.[1]) metadata[match[1]] = value;
  }
  return {
    id: "pi_real_1",
    object: "payment_intent",
    status: "requires_payment_method",
    amount: Number(request.form.get("amount") ?? 0),
    currency: request.form.get("currency") ?? "usd",
    capture_method: request.form.get("capture_method"),
    client_secret: "pi_real_1_secret_abc",
    metadata,
    ...overrides,
  };
}

describe("StripePaymentGateway over Stripe's real client (fake HTTP layer)", () => {
  it("creates a purchase as a manual-capture authorization, in cents, with its metadata", async () => {
    const { gateway, sent } = stripeOverFakeHttp((request) => ({
      status: 200,
      body: intentAnswer(request),
    }));
    const created = await gateway.createPurchaseAuthorization({
      campaignId: "11111111-1111-4111-8111-111111111111",
      qty: 3,
      amount: 20_000_000n,
      idempotencyKey: "checkout:abc",
    });
    expect(created).toEqual({ id: "pi_real_1", clientSecret: "pi_real_1_secret_abc" });
    expect(sent).toHaveLength(1);
    const [request] = sent as [SentRequest];
    expect(request.method).toBe("POST");
    expect(request.url.hostname).toBe("api.stripe.com");
    expect(request.url.pathname).toBe("/v1/payment_intents");
    expect(request.headers.get("authorization")).toBe("Bearer sk_test_fake");
    expect(request.headers.get("idempotency-key")).toBe("checkout:abc");
    expect(Object.fromEntries(request.form)).toEqual({
      amount: "2000",
      currency: "usd",
      capture_method: "manual",
      "automatic_payment_methods[enabled]": "true",
      "metadata[kind]": "purchase",
      "metadata[campaignId]": "11111111-1111-4111-8111-111111111111",
      "metadata[qty]": "3",
    });
  });

  it("creates the budget payment captured automatically, keyed on the campaign", async () => {
    const { gateway, sent } = stripeOverFakeHttp((request) => ({
      status: 200,
      body: intentAnswer(request),
    }));
    await gateway.createBudgetPayment({
      campaignId: "22222222-2222-4222-8222-222222222222",
      amount: 1_000_000_000n,
    });
    const [request] = sent as [SentRequest];
    expect(request.headers.get("idempotency-key")).toBe(
      "campaign_budget:22222222-2222-4222-8222-222222222222",
    );
    expect(Object.fromEntries(request.form)).toEqual({
      amount: "100000",
      currency: "usd",
      capture_method: "automatic",
      "automatic_payment_methods[enabled]": "true",
      description: "Promo budget",
      "metadata[kind]": "campaign_budget",
      "metadata[campaignId]": "22222222-2222-4222-8222-222222222222",
    });
  });

  it("never sends an amount that is not whole cents", async () => {
    const { gateway, sent } = stripeOverFakeHttp((request) => ({
      status: 200,
      body: intentAnswer(request),
    }));
    await expect(
      gateway.createPurchaseAuthorization({
        campaignId: "c",
        qty: 1,
        amount: 20_005_000n,
        idempotencyKey: "k",
      }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("retries the budget call once and a purchase twice, then reports a gateway error", async () => {
    const outage = (): { status: number; body: unknown; headers: HeadersInit } => ({
      status: 503,
      body: { error: { type: "api_error", message: "unavailable" } },
      headers: { "stripe-should-retry": "true" },
    });
    const budget = stripeOverFakeHttp(outage);
    await expect(
      budget.gateway.createBudgetPayment({ campaignId: "c", amount: 1_000_000_000n }),
    ).rejects.toThrow(PaymentGatewayError);
    expect(budget.sent).toHaveLength(1 + BUDGET_REQUEST_MAX_RETRIES);
    // Every attempt carries the same key: Stripe creates one intent at most.
    expect(new Set(budget.sent.map((r) => r.headers.get("idempotency-key")))).toEqual(
      new Set(["campaign_budget:c"]),
    );

    const purchase = stripeOverFakeHttp(outage);
    await expect(
      purchase.gateway.createPurchaseAuthorization({
        campaignId: "c",
        qty: 1,
        amount: 20_000_000n,
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(PaymentGatewayError);
    expect(purchase.sent).toHaveLength(3);
  }, 20_000);

  it("retrieves with the payment method and charge expanded, to read the payer e-mail", async () => {
    const { gateway, sent } = stripeOverFakeHttp(() => ({
      status: 200,
      body: {
        id: "pi_real_2",
        object: "payment_intent",
        status: "requires_capture",
        amount: 4000,
        currency: "usd",
        metadata: { kind: "purchase", campaignId: "c", qty: "2" },
        receipt_email: null,
        payment_method: { id: "pm_1", billing_details: { email: "Fan@Example.com" } },
        latest_charge: { id: "ch_1", billing_details: { email: null } },
      },
    }));
    expect(await gateway.retrievePaymentIntent("pi_real_2")).toEqual({
      id: "pi_real_2",
      status: "requires_capture",
      amount: 40_000_000n,
      currency: "usd",
      metadata: { kind: "purchase", campaignId: "c", qty: "2" },
      payerEmail: "Fan@Example.com",
    });
    const [request] = sent as [SentRequest];
    expect(request.method).toBe("GET");
    expect(request.url.pathname).toBe("/v1/payment_intents/pi_real_2");
    // Stripe's client sends arrays in the indexed form.
    expect([...request.url.searchParams.entries()]).toEqual([
      ["expand[0]", "payment_method"],
      ["expand[1]", "latest_charge"],
    ]);
  });

  it("maps Stripe's 404 to null and any other failure to a gateway error", async () => {
    const missing = stripeOverFakeHttp(() => ({
      status: 404,
      body: {
        error: {
          type: "invalid_request_error",
          code: "resource_missing",
          message: "No such payment_intent: 'pi_nope'",
        },
      },
    }));
    expect(await missing.gateway.retrievePaymentIntent("pi_nope")).toBeNull();

    const refused = stripeOverFakeHttp(() => ({
      status: 401,
      body: { error: { type: "invalid_request_error", message: "Invalid API Key" } },
    }));
    await expect(refused.gateway.retrievePaymentIntent("pi_1")).rejects.toThrow(
      PaymentGatewayError,
    );
  });
});
