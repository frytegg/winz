import type { CheckoutResponse, CheckoutStatusResponse } from "@winz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  STATUS_POLL_MS,
  WAIT_LIMIT_SECONDS,
  apiCheckoutDeps,
  createCheckoutMemory,
  monotonicNow,
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

const failed: CheckoutStatusResponse = {
  status: "failed",
  ticketToken: null,
  message: "Your payment did not go through, you were not charged",
};
const declined: CheckoutOutcome = {
  kind: "failed",
  message: "Your payment did not go through, you were not charged",
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

  it("carries on when the confirmation answers 502: Stripe unreachable, or an intent it could not check", async () => {
    // The server answers 502 both when it cannot read Stripe and when Stripe's intent is unknown or
    // does not match its row: either way the purchase is followed, never failed for it.
    const d = deps({
      confirm: vi
        .fn()
        .mockRejectedValue(
          new ApiError(
            502,
            "internal",
            "The payment service is unavailable right now, please try again in a moment",
          ),
        ),
    });
    expect(await run(d)).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(d.status).toHaveBeenCalled();
    expect(d.create).toHaveBeenCalledTimes(1);
  });

  it("follows a purchase the confirmation finds pending at Stripe, and keeps it at the wait's bound", async () => {
    // The confirmation answers `processing` while Stripe says requires_action or processing; the
    // row (and so the status read) still says requires_payment until Stripe authorizes the card.
    let clock = 0;
    const memory = createCheckoutMemory();
    const d = deps({
      status: vi.fn().mockResolvedValue({ ...processing, status: "requires_payment" }),
      sleep: vi.fn().mockImplementation((ms: number) => {
        clock += ms;
        return Promise.resolve();
      }),
      now: () => clock,
    });
    const outcome = await runCheckout({
      slug: "joes-texas",
      qty: 2,
      authorize: authorized,
      signal: new AbortController().signal,
      memory,
      deps: d,
    });
    expect(outcome).toEqual({ kind: "unresolved" });
    expect(clock).toBe(WAIT_LIMIT_SECONDS * 1000);
    // Kept: the next tap follows this payment instead of paying again.
    expect(memory.peek()).toEqual(CHECKOUT);
    expect(d.confirm).toHaveBeenCalledTimes(1);
    expect(d.create).toHaveBeenCalledTimes(1);
  });

  it("asks again after a poll that failed on the network, and never fails the purchase for it", async () => {
    const status = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, "network", "offline"))
      .mockResolvedValueOnce(ticketed);
    expect(await run(deps({ status }))).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("stops on the confirmation's failed: its word was read at Stripe or is the engine's", async () => {
    const d = deps({ confirm: vi.fn().mockResolvedValue(failed) });
    expect(await run(d)).toEqual(declined);
    expect(d.status).not.toHaveBeenCalled();
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

describe("after a tap: a status read's failed is the end only once this attempt has had a word", () => {
  // A payment failed by an earlier declined card (the webhook, no purchase job) is taken again when
  // this tap's card authorizes the same intent. When the confirmation is lost, a status read that
  // has not asked Stripe yet may still say `failed`: it is not the end of this attempt.

  /** Deps whose clock moves with each sleep, whose status answers `answers` in turn. */
  function clocked(
    confirm: CheckoutDeps["confirm"],
    ...answers: CheckoutStatusResponse[]
  ): CheckoutDeps & { clock: () => number } {
    let clock = 0;
    let index = 0;
    return {
      create: vi.fn().mockResolvedValue(CHECKOUT),
      confirm: vi.fn().mockImplementation(confirm),
      status: vi.fn().mockImplementation(() => {
        const answer = answers[Math.min(index, answers.length - 1)];
        index += 1;
        return Promise.resolve(answer);
      }),
      sleep: vi.fn().mockImplementation((ms: number) => {
        clock += ms;
        return Promise.resolve();
      }),
      now: () => clock,
      clock: () => clock,
    };
  }

  const lost = (): Promise<never> => Promise.reject(new ApiError(0, "network", "offline"));

  function tap(d: CheckoutDeps, memory = createCheckoutMemory()): Promise<CheckoutOutcome> {
    return runCheckout({
      slug: "joes-texas",
      qty: 2,
      authorize: authorized,
      signal: new AbortController().signal,
      memory,
      deps: d,
    });
  }

  it("the confirmation lost, every read failed: followed to the bound, the payment kept", async () => {
    const memory = createCheckoutMemory();
    const d = clocked(lost, failed);
    expect(await tap(d, memory)).toEqual({ kind: "unresolved" });
    expect(d.clock()).toBe(WAIT_LIMIT_SECONDS * 1000);
    // Kept: the next tap follows this payment instead of paying again.
    expect(memory.peek()).toEqual(CHECKOUT);
    expect(d.create).toHaveBeenCalledTimes(1);
  });

  it("the confirmation lost, failed until a read asks Stripe: the purchase is followed to its ticket", async () => {
    const memory = createCheckoutMemory();
    const d = clocked(lost, failed, failed, processing, ticketed);
    expect(await tap(d, memory)).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(d.status).toHaveBeenCalledTimes(4);
  });

  it("the confirmation lost, failed after a read answered processing: the end (Stripe's or the engine's word)", async () => {
    const memory = createCheckoutMemory();
    const d = clocked(lost, failed, processing, failed);
    expect(await tap(d, memory)).toEqual(declined);
    expect(d.status).toHaveBeenCalledTimes(3);
    expect(memory.peek()).toBeNull();
  });

  it("the confirmation answered: a status read's failed is the end, as before", async () => {
    const memory = createCheckoutMemory();
    const d = clocked(() => Promise.resolve(processing), failed);
    expect(await tap(d, memory)).toEqual(declined);
    expect(d.status).toHaveBeenCalledTimes(1);
    expect(memory.peek()).toBeNull();
  });

  it("the confirmation lost, a promo paused between the tap and the capture: ends at once, as before", async () => {
    const memory = createCheckoutMemory();
    const d = clocked(lost, {
      status: "cancelled_paused",
      ticketToken: null,
      message: "Promo just paused, you were not charged",
    });
    expect(await tap(d, memory)).toEqual({
      kind: "cancelled",
      message: "Promo just paused, you were not charged",
    });
    expect(d.status).toHaveBeenCalledTimes(1);
    expect(memory.peek()).toBeNull();
  });

  it("a card declined at the tap ends at once, as before: nothing confirmed, nothing read", async () => {
    const memory = createCheckoutMemory();
    const d = clocked(lost, failed);
    const outcome = await runCheckout({
      slug: "joes-texas",
      qty: 2,
      authorize: () => Promise.resolve({ ok: false, message: "Card declined" }),
      signal: new AbortController().signal,
      memory,
      deps: d,
    });
    expect(outcome).toEqual({ kind: "failed", message: "Card declined" });
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.status).not.toHaveBeenCalled();
    // A declined card does not end the payment: the next tap pays it with another card.
    expect(memory.peek()).toEqual(CHECKOUT);
  });
});

describe("the wait after a tap ends on time whatever the network does", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const unpaid: CheckoutStatusResponse = { ...processing, status: "requires_payment" };

  /** Answers only when its signal aborts, as a fetch that hangs does. */
  function hanging(_pi: string, signal: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }

  /** The production sleep and clock (`performance.now`), both on vitest's fake timers. */
  function timedDeps(overrides: Partial<CheckoutDeps>): CheckoutDeps {
    return {
      create: vi.fn().mockResolvedValue(CHECKOUT),
      confirm: vi.fn().mockResolvedValue(processing),
      status: vi.fn().mockResolvedValue(processing),
      sleep: apiCheckoutDeps.sleep,
      ...overrides,
    };
  }

  function start(
    d: CheckoutDeps,
    controller: AbortController,
  ): { settled: () => CheckoutOutcome | unknown; memory: ReturnType<typeof createCheckoutMemory> } {
    let result: { value: CheckoutOutcome | unknown } | null = null;
    const memory = createCheckoutMemory();
    void runCheckout({
      slug: "joes-texas",
      qty: 2,
      authorize: authorized,
      signal: controller.signal,
      memory,
      deps: d,
    }).then(
      (value) => {
        result = { value };
      },
      (error: unknown) => {
        result = { value: error };
      },
    );
    return { settled: () => (result === null ? undefined : result.value), memory };
  }

  it("a status read that hangs is cut at the minute: unresolved, the payment kept", async () => {
    const controller = new AbortController();
    const status = vi.fn().mockImplementation(hanging);
    const d = timedDeps({ status });
    const { settled, memory } = start(d, controller);
    try {
      await vi.advanceTimersByTimeAsync(WAIT_LIMIT_SECONDS * 1000 - STATUS_POLL_MS);
      expect(settled()).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2 * STATUS_POLL_MS);
      expect(settled()).toEqual({ kind: "unresolved" });
      expect(memory.peek()).toEqual(CHECKOUT);
      // Cut by its own bound, not by the page.
      expect((status.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);
      expect(controller.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort();
    }
  });

  it("a confirmation that hangs is cut at the minute, and the wait ends right after", async () => {
    const controller = new AbortController();
    const confirm = vi.fn().mockImplementation(hanging);
    const d = timedDeps({ confirm, status: vi.fn().mockResolvedValue(unpaid) });
    const { settled, memory } = start(d, controller);
    try {
      await vi.advanceTimersByTimeAsync(WAIT_LIMIT_SECONDS * 1000 - STATUS_POLL_MS);
      expect(settled()).toBeUndefined();
      expect(d.status).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3 * STATUS_POLL_MS);
      expect(settled()).toEqual({ kind: "unresolved" });
      expect(memory.peek()).toEqual(CHECKOUT);
      expect(d.status).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort();
    }
  });

  it("the time the confirmation took counts toward the minute", async () => {
    const controller = new AbortController();
    const confirm = vi.fn().mockImplementation(
      () =>
        new Promise<CheckoutStatusResponse>((resolve) => {
          setTimeout(() => {
            resolve(processing);
          }, 30_000);
        }),
    );
    const d = timedDeps({ confirm, status: vi.fn().mockResolvedValue(processing) });
    const { settled } = start(d, controller);
    try {
      await vi.advanceTimersByTimeAsync(WAIT_LIMIT_SECONDS * 1000 - STATUS_POLL_MS);
      expect(settled()).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2 * STATUS_POLL_MS);
      expect(settled()).toEqual({ kind: "unresolved" });
    } finally {
      controller.abort();
    }
  });

  it("reads answer for 55 s, then one hangs: the wait still ends by about 62 s", async () => {
    // Each read runs within the time left before the minute, not a minute of its own: a read
    // that starts at 55 s and hangs is cut at 60 s, not at 115 s.
    const controller = new AbortController();
    const start0 = Date.now();
    const status = vi
      .fn()
      .mockImplementation((pi: string, signal: AbortSignal) =>
        Date.now() - start0 >= 55_000 ? hanging(pi, signal) : Promise.resolve(processing),
      );
    const d = timedDeps({ status });
    const { settled, memory } = start(d, controller);
    try {
      await vi.advanceTimersByTimeAsync(55_000);
      expect(settled()).toBeUndefined();
      await vi.advanceTimersByTimeAsync(7_000);
      expect(settled()).toEqual({ kind: "unresolved" });
      expect(memory.peek()).toEqual(CHECKOUT);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort();
    }
  });

  it("the device's clock set back an hour does not stretch the minute: the bound is monotonic", async () => {
    const controller = new AbortController();
    const d = timedDeps({ status: vi.fn().mockResolvedValue(processing) });
    const { settled } = start(d, controller);
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      vi.setSystemTime(Date.now() - 3_600_000);
      await vi.advanceTimersByTimeAsync(WAIT_LIMIT_SECONDS * 1000 - 30_000 + 2 * STATUS_POLL_MS);
      expect(settled()).toEqual({ kind: "unresolved" });
    } finally {
      controller.abort();
    }
  });

  it("the default clock is performance.now(), which vitest's fake timers drive", async () => {
    const before = monotonicNow();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(monotonicNow() - before).toBe(5_000);
    vi.setSystemTime(Date.now() - 3_600_000);
    expect(monotonicNow() - before).toBe(5_000);
  });

  it("the shopper leaving during a confirmation that hangs still rejects with the abort", async () => {
    const controller = new AbortController();
    const d = timedDeps({ confirm: vi.fn().mockImplementation(hanging) });
    const { settled } = start(d, controller);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled()).toBeUndefined();
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const error = settled();
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    expect(vi.getTimerCount()).toBe(0);
  });
});
