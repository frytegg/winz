import type { CheckoutResponse, CheckoutStatusResponse } from "@winz/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { confirmIntent, type StripeLike } from "@/lib/stripe/payment";

import {
  WAIT_LIMIT_SECONDS,
  createCheckoutMemory,
  runCheckout,
  type Authorize,
  type CheckoutDeps,
  type CheckoutMemory,
  type CheckoutOutcome,
} from "./checkout-flow";

/**
 * Several attempts in the same sheet (review 1.2 and 1.3): one payment per purchase, however many
 * taps, and an authorized card never shown as a failure.
 */

const FIRST: CheckoutResponse = {
  paymentIntentId: "pi_1",
  clientSecret: "pi_1_secret",
  amount: "20000000",
};
const SECOND: CheckoutResponse = {
  paymentIntentId: "pi_2",
  clientSecret: "pi_2_secret",
  amount: "40000000",
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
const failed: CheckoutStatusResponse = {
  status: "failed",
  ticketToken: null,
  message: "Something went wrong, you were not charged",
};

function deps(overrides: Partial<CheckoutDeps> = {}): CheckoutDeps {
  return {
    create: vi.fn().mockResolvedValueOnce(FIRST).mockResolvedValueOnce(SECOND),
    confirm: vi.fn().mockResolvedValue(processing),
    status: vi.fn().mockResolvedValue(ticketed),
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function attempt(
  d: CheckoutDeps,
  memory: CheckoutMemory,
  authorize: Authorize,
  qty = 1,
): Promise<CheckoutOutcome> {
  return runCheckout({
    slug: "joes-texas",
    qty,
    authorize,
    memory,
    signal: new AbortController().signal,
    deps: d,
  });
}

/** Answers each call with the next result of the list. */
function authorizeInTurn(
  ...results: Awaited<ReturnType<Authorize>>[]
): Authorize & ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const result of results) fn.mockResolvedValueOnce(result);
  return fn as Authorize & ReturnType<typeof vi.fn>;
}

describe("runCheckout, one payment however many taps (review 1.2)", () => {
  it("reuses the payment of an attempt whose answer was lost: ONE POST /api/checkout", async () => {
    const d = deps();
    const memory = createCheckoutMemory();
    const authorize = authorizeInTurn(
      { ok: false, message: "We could not reach the server." },
      { ok: true },
    );
    expect(await attempt(d, memory, authorize)).toEqual({
      kind: "failed",
      message: "We could not reach the server.",
    });
    expect(await attempt(d, memory, authorize)).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(d.create).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize.mock.calls[1]?.[0]).toEqual(FIRST);
  });

  it("goes on to the ticket when Stripe answers an error after authorizing the card", async () => {
    // The real confirmation, against a Stripe that authorizes the card and loses the answer.
    let authorized = false;
    const stripe: StripeLike = {
      retrievePaymentIntent: () =>
        Promise.resolve({
          paymentIntent: { status: authorized ? "requires_capture" : "requires_payment_method" },
        }),
      confirmPayment: () => {
        authorized = true;
        return Promise.resolve({ error: { message: "We could not reach the server." } });
      },
    };
    const d = deps();
    const authorize: Authorize = (checkout) =>
      confirmIntent({
        stripe,
        elements: {},
        clientSecret: checkout.clientSecret,
        returnUrl: "https://winz.test/c/joes-texas",
      });
    expect(await attempt(d, createCheckoutMemory(), authorize)).toEqual({
      kind: "ticketed",
      token: "tkt_1",
    });
    expect(d.confirm).toHaveBeenCalledWith("pi_1", expect.anything());
  });

  it("keeps a real decline a decline, and the next attempt pays the same payment", async () => {
    const d = deps();
    const memory = createCheckoutMemory();
    const authorize = authorizeInTurn(
      { ok: false, message: "Your card was declined." },
      { ok: true },
    );
    expect(await attempt(d, memory, authorize)).toEqual({
      kind: "failed",
      message: "Your card was declined.",
    });
    expect(d.confirm).not.toHaveBeenCalled();
    expect(await attempt(d, memory, authorize)).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(d.create).toHaveBeenCalledTimes(1);
  });

  it("creates a new payment when the quantity changed", async () => {
    const d = deps();
    const memory = createCheckoutMemory();
    const authorize = authorizeInTurn({ ok: false, message: "Lost" }, { ok: true });
    await attempt(d, memory, authorize, 1);
    expect(await attempt(d, memory, authorize, 2)).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(d.create).toHaveBeenCalledTimes(2);
    expect(d.create).toHaveBeenLastCalledWith({ slug: "joes-texas", qty: 2 }, expect.anything());
    expect(authorize.mock.calls[1]?.[0]).toEqual(SECOND);
  });

  it("creates a new payment, once, when the kept one was cancelled meanwhile", async () => {
    const d = deps();
    const memory = createCheckoutMemory();
    const authorize = authorizeInTurn(
      { ok: false, message: "Lost" },
      { ok: false, message: "Your payment didn't go through.", ended: true },
      { ok: true },
    );
    await attempt(d, memory, authorize);
    expect(await attempt(d, memory, authorize)).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(d.create).toHaveBeenCalledTimes(2);
    expect(authorize.mock.calls.map((call) => call[0])).toEqual([FIRST, FIRST, SECOND]);
  });

  it("does not loop when the new payment is cancelled too: a failure, and nothing kept", async () => {
    const ended = {
      ok: false as const,
      message: "Your payment didn't go through.",
      ended: true as const,
    };
    const d = deps();
    const memory = createCheckoutMemory();
    const authorize = authorizeInTurn({ ok: false, message: "Lost" }, ended, ended);
    await attempt(d, memory, authorize);
    expect(await attempt(d, memory, authorize)).toEqual({
      kind: "failed",
      message: "Your payment didn't go through.",
    });
    expect(d.create).toHaveBeenCalledTimes(2);
    expect(memory.read("joes-texas", 1)).toBeNull();
  });

  it("starts a new payment after one that ended without a ticket", async () => {
    const d = deps({ status: vi.fn().mockResolvedValueOnce(failed).mockResolvedValue(ticketed) });
    const memory = createCheckoutMemory();
    const authorize = authorizeInTurn({ ok: true }, { ok: true });
    expect(await attempt(d, memory, authorize)).toEqual({
      kind: "failed",
      message: "Something went wrong, you were not charged",
    });
    expect(memory.read("joes-texas", 1)).toBeNull();
    expect(await attempt(d, memory, authorize)).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(d.create).toHaveBeenCalledTimes(2);
  });

  it("forgets the payment once the ticket exists", async () => {
    const memory = createCheckoutMemory();
    await attempt(deps(), memory, authorizeInTurn({ ok: true }));
    expect(memory.read("joes-texas", 1)).toBeNull();
  });

  it("keeps nothing when the promo refused the sale", async () => {
    const memory = createCheckoutMemory();
    const d = deps({
      create: vi.fn().mockRejectedValue(new ApiError(409, "sales_paused", "Paused")),
    });
    expect(await attempt(d, memory, authorizeInTurn({ ok: true }))).toEqual({
      kind: "refused",
      message: "Paused",
    });
    expect(memory.read("joes-texas", 1)).toBeNull();
  });

  it("tells the screen the payment each attempt pays: the one created, then the one kept", async () => {
    const onPayment = vi.fn();
    const d = deps();
    const memory = createCheckoutMemory();
    for (let tap = 0; tap < 2; tap += 1) {
      await runCheckout({
        slug: "joes-texas",
        qty: 1,
        authorize: () => Promise.resolve({ ok: false, message: "Declined" }),
        memory,
        onPayment,
        signal: new AbortController().signal,
        deps: d,
      });
    }
    expect(onPayment.mock.calls).toEqual([[FIRST], [FIRST]]);
    expect(d.create).toHaveBeenCalledTimes(1);
  });
});

describe("createCheckoutMemory", () => {
  it("shows the payment it keeps without dropping it, whatever the quantity asked later", () => {
    const memory = createCheckoutMemory();
    expect(memory.peek()).toBeNull();
    memory.keep("joes-texas", 1, FIRST);
    expect(memory.peek()).toEqual(FIRST);
    expect(memory.peek()).toEqual(FIRST);
    expect(memory.read("joes-texas", 1)).toEqual(FIRST);
    expect(memory.read("joes-texas", 2)).toBeNull();
    expect(memory.peek()).toBeNull();
  });
});

describe("runCheckout, the wait has an end (review 2.5)", () => {
  it("stops polling at the bound, says so, and keeps the payment for the next attempt", async () => {
    let clock = 0;
    const d = deps({
      status: vi.fn().mockResolvedValue(processing),
      sleep: vi.fn().mockImplementation((ms: number) => {
        clock += ms;
        return Promise.resolve();
      }),
      now: () => clock,
    });
    const memory = createCheckoutMemory();
    const outcome = await attempt(d, memory, authorizeInTurn({ ok: true }));
    expect(outcome).toEqual({ kind: "unresolved" });
    const polls = (d.status as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(polls).toBeGreaterThanOrEqual(WAIT_LIMIT_SECONDS - 1);
    expect(polls).toBeLessThanOrEqual(WAIT_LIMIT_SECONDS + 1);
    expect(d.confirm).toHaveBeenCalledTimes(1);
    expect(memory.read("joes-texas", 1)).toEqual(FIRST);
  });
});
