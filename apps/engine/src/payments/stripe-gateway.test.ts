/**
 * The Stripe implementation, over Stripe's own client with a fake network underneath: what is
 * sent (idempotency keys) and how Stripe's answers are read. Nothing leaves the process.
 */
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { PaymentGatewayConfigError, PaymentGatewayError } from "./gateway";
import { StripePaymentGateway } from "./stripe-gateway";

interface SentRequest {
  method: string;
  url: URL;
  headers: Headers;
}

type Answer = { status: number; body: unknown };

function stripeOverFakeHttp(respond: (request: SentRequest) => Answer): {
  gateway: StripePaymentGateway;
  sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request: SentRequest = {
      method: init?.method ?? "GET",
      url: new URL(input instanceof Request ? input.url : input.toString()),
      headers: new Headers(init?.headers),
    };
    sent.push(request);
    const answer = respond(request);
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const gateway = new StripePaymentGateway("sk_test_fake", {
    httpClient: Stripe.createFetchHttpClient(fakeFetch),
    maxNetworkRetries: 0,
  });
  return { gateway, sent };
}

function intent(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: "payment_intent",
    id: "pi_123",
    status,
    amount: 500,
    currency: "usd",
    metadata: { kind: "purchase", campaignId: "c1", qty: "1" },
    receipt_email: null,
    payment_method: { billing_details: { email: "Payer@Example.com" } },
    latest_charge: null,
    ...overrides,
  };
}

function stripeError(status: number, error: Record<string, unknown>): Answer {
  return { status, body: { error } };
}

describe("StripePaymentGateway", () => {
  it("refuses a key that is not a test key", () => {
    expect(() => new StripePaymentGateway("sk_live_abc")).toThrow(PaymentGatewayConfigError);
    expect(() => new StripePaymentGateway("rk_test_abc")).toThrow(PaymentGatewayConfigError);
  });

  it("reads a PaymentIntent in micro-USDC, with the payer's e-mail", async () => {
    const { gateway, sent } = stripeOverFakeHttp(() => ({
      status: 200,
      body: intent("requires_capture"),
    }));
    const view = await gateway.retrievePaymentIntent("pi_123");
    expect(view).toEqual({
      id: "pi_123",
      status: "requires_capture",
      amount: 5_000_000n,
      currency: "usd",
      metadata: { kind: "purchase", campaignId: "c1", qty: "1" },
      payerEmail: "Payer@Example.com",
    });
    expect(sent[0]?.url.pathname).toBe("/v1/payment_intents/pi_123");
  });

  it("answers null for an unknown PaymentIntent", async () => {
    const { gateway } = stripeOverFakeHttp(() =>
      stripeError(404, {
        type: "invalid_request_error",
        code: "resource_missing",
        message: "No such payment_intent",
      }),
    );
    expect(await gateway.retrievePaymentIntent("pi_missing")).toBeNull();
  });

  it("sends the idempotency key with every capture, cancel and refund", async () => {
    const { gateway, sent } = stripeOverFakeHttp((request) =>
      request.url.pathname.startsWith("/v1/refunds")
        ? { status: 200, body: { object: "refund", id: "re_1", status: "succeeded" } }
        : { status: 200, body: intent("succeeded") },
    );
    await gateway.capturePaymentIntent("pi_123", "capture:pi_123");
    await gateway.cancelPaymentIntent("pi_123", "cancel:pi_123");
    await gateway.refundPaymentIntent("pi_123", "refund:pi_123");
    expect(
      sent.map((request) => [
        request.method,
        request.url.pathname,
        request.headers.get("idempotency-key"),
      ]),
    ).toEqual([
      ["POST", "/v1/payment_intents/pi_123/capture", "capture:pi_123"],
      ["POST", "/v1/payment_intents/pi_123/cancel", "cancel:pi_123"],
      ["POST", "/v1/refunds", "refund:pi_123"],
    ]);
  });

  it("treats 'already captured', 'already canceled' and 'already refunded' as success", async () => {
    const { gateway } = stripeOverFakeHttp((request) => {
      if (request.url.pathname.endsWith("/capture")) {
        return stripeError(400, {
          type: "invalid_request_error",
          code: "payment_intent_unexpected_state",
          message: "This PaymentIntent has already been captured",
          payment_intent: intent("succeeded"),
        });
      }
      if (request.url.pathname.endsWith("/cancel")) {
        return stripeError(400, {
          type: "invalid_request_error",
          code: "payment_intent_unexpected_state",
          message: "This PaymentIntent has already been canceled",
          payment_intent: intent("canceled"),
        });
      }
      return stripeError(400, {
        type: "invalid_request_error",
        code: "charge_already_refunded",
        message: "Charge has already been refunded",
      });
    });
    await expect(gateway.capturePaymentIntent("pi_123", "k1")).resolves.toBeUndefined();
    await expect(gateway.cancelPaymentIntent("pi_123", "k2")).resolves.toBeUndefined();
    await expect(gateway.refundPaymentIntent("pi_123", "k3")).resolves.toBeUndefined();
  });

  it("reports a capture of a canceled authorization as permanent", async () => {
    const { gateway } = stripeOverFakeHttp(() =>
      stripeError(400, {
        type: "invalid_request_error",
        code: "payment_intent_unexpected_state",
        message: "This PaymentIntent could not be captured because it has a status of canceled",
        payment_intent: intent("canceled"),
      }),
    );
    const failure = await gateway
      .capturePaymentIntent("pi_123", "k")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PaymentGatewayError);
    expect((failure as PaymentGatewayError).retryable).toBe(false);
    expect((failure as PaymentGatewayError).code).toBe("payment_intent_unexpected_state");
  });

  it("reports a Stripe outage as retryable", async () => {
    const { gateway } = stripeOverFakeHttp(() =>
      stripeError(500, { type: "api_error", message: "Something went wrong on Stripe's end" }),
    );
    const failure = await gateway
      .capturePaymentIntent("pi_123", "k")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PaymentGatewayError);
    expect((failure as PaymentGatewayError).retryable).toBe(true);
  });
});
