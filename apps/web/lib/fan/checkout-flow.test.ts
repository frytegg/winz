import type { CheckoutResponse, CheckoutStatusResponse } from "@winz/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  outcomeOf,
  runCheckout,
  type Authorize,
  type CheckoutDeps,
  type CheckoutOutcome,
} from "./checkout-flow";

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

const authorized: Authorize = () => Promise.resolve({ ok: true });

function deps(overrides: Partial<CheckoutDeps> = {}): CheckoutDeps {
  return {
    create: vi.fn().mockResolvedValue(CHECKOUT),
    confirm: vi.fn().mockResolvedValue(processing),
    status: vi.fn().mockResolvedValue(ticketed),
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function run(d: CheckoutDeps, authorize: Authorize = authorized): Promise<CheckoutOutcome> {
  return runCheckout({
    slug: "joes-texas",
    qty: 2,
    authorize,
    signal: new AbortController().signal,
    deps: d,
  });
}

describe("outcomeOf", () => {
  it("waits on a purchase that is still on its way", () => {
    expect(outcomeOf(processing)).toBeNull();
    expect(outcomeOf({ ...processing, status: "requires_payment" })).toBeNull();
  });

  it("waits on a ticketed purchase that has no ticket yet", () => {
    expect(outcomeOf({ status: "ticketed", ticketToken: null, message: null })).toBeNull();
  });

  it("opens the ticket", () => {
    expect(outcomeOf(ticketed)).toEqual({ kind: "ticketed", token: "tkt_1" });
  });

  it("shows the API's message as it comes, and a fallback when it has none", () => {
    expect(
      outcomeOf({ status: "cancelled_paused", ticketToken: null, message: "Paused, not charged" }),
    ).toEqual({ kind: "cancelled", message: "Paused, not charged" });
    expect(outcomeOf({ status: "failed", ticketToken: null, message: null })).toEqual({
      kind: "failed",
      message: "Your payment didn't go through.",
    });
  });
});

describe("runCheckout", () => {
  it("creates, authorizes, confirms, polls and opens the ticket", async () => {
    const d = deps();
    const onSecuring = vi.fn();
    const outcome = await runCheckout({
      slug: "joes-texas",
      qty: 2,
      authorize: authorized,
      signal: new AbortController().signal,
      onSecuring,
      deps: d,
    });
    expect(outcome).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(d.create).toHaveBeenCalledWith({ slug: "joes-texas", qty: 2 }, expect.anything());
    expect(d.confirm).toHaveBeenCalledWith("pi_1", expect.anything());
    expect(onSecuring).toHaveBeenCalledTimes(1);
    expect(d.sleep).toHaveBeenCalledTimes(1);
  });

  it("stops on the answer of the confirmation when it is already final", async () => {
    const d = deps({ confirm: vi.fn().mockResolvedValue(ticketed) });
    expect(await run(d)).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(d.status).not.toHaveBeenCalled();
  });

  it("keeps polling while the purchase is processing", async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(ticketed);
    const onWaiting = vi.fn();
    const outcome = await runCheckout({
      slug: "joes-texas",
      qty: 1,
      authorize: authorized,
      signal: new AbortController().signal,
      onWaiting,
      deps: deps({ status }),
    });
    expect(outcome.kind).toBe("ticketed");
    expect(status).toHaveBeenCalledTimes(3);
    expect(onWaiting).toHaveBeenCalledTimes(2);
  });

  it("refuses a promo that paused or closed, with the message as it comes, and creates nothing", async () => {
    for (const code of ["sales_paused", "sales_closed"] as const) {
      const message = `The back says: ${code}`;
      const d = deps({ create: vi.fn().mockRejectedValue(new ApiError(409, code, message)) });
      const authorize = vi.fn();
      expect(await run(d, authorize)).toEqual({ kind: "refused", message });
      expect(authorize).not.toHaveBeenCalled();
      expect(d.confirm).not.toHaveBeenCalled();
    }
  });

  it("reports another API error as a failure, with its message", async () => {
    const d = deps({ create: vi.fn().mockRejectedValue(new ApiError(500, "internal", "Boom")) });
    expect(await run(d)).toEqual({ kind: "failed", message: "Boom" });
  });

  it("does not confirm a card that was not authorized", async () => {
    const d = deps();
    const outcome = await run(d, () => Promise.resolve({ ok: false, message: "Card declined" }));
    expect(outcome).toEqual({ kind: "failed", message: "Card declined" });
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it("ends on a promo that paused after the tap", async () => {
    const d = deps({
      confirm: vi.fn().mockResolvedValue({
        status: "cancelled_paused",
        ticketToken: null,
        message: "Promo just paused, you were not charged",
      }),
    });
    expect(await run(d)).toEqual({
      kind: "cancelled",
      message: "Promo just paused, you were not charged",
    });
  });

  it("carries on when the confirmation fails on the network: the webhook starts the same work", async () => {
    const d = deps({ confirm: vi.fn().mockRejectedValue(new ApiError(0, "network", "offline")) });
    expect(await run(d)).toEqual({ kind: "ticketed", token: "tkt_1" });
  });

  it("asks again after a poll that failed on the network, and never fails the purchase for it", async () => {
    const status = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, "network", "offline"))
      .mockResolvedValueOnce(ticketed);
    expect(await run(deps({ status }))).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("rejects when the shopper leaves", async () => {
    const controller = new AbortController();
    const d = deps({
      sleep: vi.fn().mockImplementation(() => {
        controller.abort();
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }),
    });
    await expect(
      runCheckout({
        slug: "joes-texas",
        qty: 1,
        authorize: authorized,
        signal: controller.signal,
        deps: d,
      }),
    ).rejects.toThrow("Aborted");
  });
});
