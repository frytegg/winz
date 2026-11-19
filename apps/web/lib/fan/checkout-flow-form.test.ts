import type { CheckoutResponse, CheckoutStatusResponse } from "@winz/shared";
import { describe, expect, it, vi } from "vitest";

import { runCheckout, type CheckoutDeps } from "./checkout-flow";

const CHECKOUT: CheckoutResponse = {
  paymentIntentId: "pi_1",
  clientSecret: "secret",
  amount: "20000000",
};
const processing: CheckoutStatusResponse = {
  status: "processing",
  ticketToken: null,
  message: null,
};
const ticketed: CheckoutStatusResponse = {
  status: "ticketed",
  ticketToken: "tkt_1",
  message: null,
};

function deps(overrides: Partial<CheckoutDeps> = {}): CheckoutDeps {
  return {
    create: vi.fn().mockResolvedValue(CHECKOUT),
    confirm: vi.fn().mockResolvedValue(processing),
    status: vi.fn().mockResolvedValue(ticketed),
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runCheckout, the payment form", () => {
  it("validates the form first, before anything is created", async () => {
    const order: string[] = [];
    const d = deps({
      create: vi.fn().mockImplementation(() => {
        order.push("create");
        return Promise.resolve(CHECKOUT);
      }),
    });
    const outcome = await runCheckout({
      slug: "joes-texas",
      qty: 1,
      validate: () => {
        order.push("validate");
        return Promise.resolve({ ok: true });
      },
      authorize: () => {
        order.push("authorize");
        return Promise.resolve({ ok: true });
      },
      signal: new AbortController().signal,
      deps: d,
    });
    expect(outcome.kind).toBe("ticketed");
    expect(order).toEqual(["validate", "create", "authorize"]);
  });

  it("stops on a form that is not valid: Stripe's message, nothing created, nothing authorized", async () => {
    const d = deps();
    const authorize = vi.fn();
    const outcome = await runCheckout({
      slug: "joes-texas",
      qty: 1,
      validate: () => Promise.resolve({ ok: false, message: "Your card number is incomplete." }),
      authorize,
      signal: new AbortController().signal,
      deps: d,
    });
    expect(outcome).toEqual({ kind: "failed", message: "Your card number is incomplete." });
    expect(d.create).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("stops on a card that is declined: the purchase is never confirmed", async () => {
    const d = deps();
    const outcome = await runCheckout({
      slug: "joes-texas",
      qty: 1,
      authorize: () => Promise.resolve({ ok: false, message: "Your card was declined." }),
      signal: new AbortController().signal,
      deps: d,
    });
    expect(outcome).toEqual({ kind: "failed", message: "Your card was declined." });
    expect(d.confirm).not.toHaveBeenCalled();
  });
});
