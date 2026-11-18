import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiCallError } from "./api";
import type { Purchase } from "./flows";
import { expectEachCapturedOnce, type SoldTicket } from "./ledger";
import { expectGuaranteesCapped, waitOpen } from "./steps";
import { SimulatedStripe } from "./stripe";
import { WaitTimeoutError, within } from "./wait";
import type { World } from "./world";

/**
 * The harness's own checks, without a chain or a database: a helper that hides a failure, or a
 * ledger check that cannot see a double charge, would let the scenarios pass on a broken loop.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("within", () => {
  it("leaves no timer running once the awaited promise settles", async () => {
    vi.useFakeTimers();
    await expect(within(Promise.resolve(7), 15_000, "a value")).resolves.toBe(7);
    await expect(within(Promise.reject(new Error("boom")), 15_000, "a failure")).rejects.toThrow(
      "boom",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with a WaitTimeoutError naming what was awaited", async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => undefined);
    const waiting = within(never, 1_000, "the engine to read the PaymentIntent");
    const settled = expect(waiting).rejects.toThrow(
      new WaitTimeoutError(
        "timed out after 1000 ms waiting for the engine to read the PaymentIntent",
      ),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitOpen", () => {
  const routeFailure = (): ApiCallError =>
    new ApiCallError("GET /api/public/campaigns/[slug]", 500, {
      error: { code: "internal", message: "boom" },
    });

  /** A world whose campaign page answers with `answers`, one per wait, and counts chain moves. */
  function fakeWorld(answers: Error[]): {
    world: Pick<World, "waitFor" | "advance">;
    advanced: () => number;
  } {
    let moves = 0;
    return {
      world: {
        waitFor: () => {
          const next = answers.shift();
          return Promise.reject(next ?? new Error("no answer left"));
        },
        advance: () => {
          moves += 1;
          return Promise.resolve();
        },
      },
      advanced: () => moves,
    };
  }

  it("rethrows a route failure of its first wait at once, without moving chain time", async () => {
    const failure = routeFailure();
    const { world, advanced } = fakeWorld([failure]);
    await expect(waitOpen(world, "promo")).rejects.toBe(failure);
    expect(advanced()).toBe(0);
  });

  it("moves chain time only while the page is still paused, and stops at a route failure", async () => {
    const failure = routeFailure();
    const { world, advanced } = fakeWorld([new WaitTimeoutError("still paused"), failure]);
    await expect(waitOpen(world, "promo")).rejects.toBe(failure);
    // One round of six two-second steps, then the failure surfaces instead of two more rounds.
    expect(advanced()).toBe(6);
  });
});

describe("expectEachCapturedOnce", () => {
  async function authorized(stripe: SimulatedStripe): Promise<Purchase> {
    const amount = 20_000_000n;
    const { id } = await stripe.web.createPurchaseAuthorization({
      campaignId: "campaign-1",
      qty: 1,
      amount,
      idempotencyKey: "checkout-1",
    });
    stripe.confirmCard(id, "ann@example.com");
    return { pi: id, qty: 1, email: "ann@example.com", amount, confirmedAtMs: 0 };
  }

  it("accepts one capture, retried under the same idempotency key", async () => {
    const stripe = new SimulatedStripe();
    const purchase = await authorized(stripe);
    await stripe.engine.capturePaymentIntent(purchase.pi, "capture:1");
    await stripe.engine.capturePaymentIntent(purchase.pi, "capture:1");
    expect(() => {
      expectEachCapturedOnce({ stripe }, [purchase]);
    }).not.toThrow();
  });

  it("sees a second capture made under a new idempotency key", async () => {
    const stripe = new SimulatedStripe();
    const purchase = await authorized(stripe);
    await stripe.engine.capturePaymentIntent(purchase.pi, "capture:1");
    // Stripe leaves a captured intent as it is: the intent alone cannot tell.
    await stripe.engine.capturePaymentIntent(purchase.pi, "capture:2");
    expect(stripe.intent(purchase.pi).captures).toBe(1);
    expect(() => {
      expectEachCapturedOnce({ stripe }, [purchase]);
    }).toThrow(/capture idempotency keys/);
  });
});

describe("expectGuaranteesCapped", () => {
  // The default promo: a usual margin of 65 %, a minimum of 45 %, so at most 20 % of what was paid.
  const campaign = {
    terms: {
      unitPrice: 20_000_000n,
      refundBps: 10_000,
      usualMarginBps: 6_500,
      minMarginBps: 4_500,
      budget: 200_000_000n,
    },
  };
  const ticket = (paid: bigint, maxHedgeCost: bigint): SoldTicket => ({
    ticketId: 1n,
    campaignOnchainId: 1n,
    buyer: "0x0000000000000000000000000000000000000001",
    qty: Number(paid / 20_000_000n),
    paid,
    refundable: paid,
    maxHedgeCost,
  });

  it("accepts a guarantee at the cap", () => {
    expect(() => {
      expectGuaranteesCapped(campaign, [ticket(20_000_000n, 4_000_000n), ticket(60_000_000n, 1n)]);
    }).not.toThrow();
  });

  it("refuses a guarantee one micro-USDC above floor(paid × maxCostBps / 10 000)", () => {
    expect(() => {
      expectGuaranteesCapped(campaign, [ticket(60_000_000n, 12_000_001n)]);
    }).toThrow(/guarantee of ticket 1/);
  });
});
