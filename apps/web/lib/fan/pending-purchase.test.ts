import type { CheckoutStatusResponse } from "@winz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  RESUME_UNSEEN_LIMIT_SECONDS,
  RESUME_VERIFY_EVERY_SECONDS,
  STATUS_POLL_MS,
  WAIT_LIMIT_SECONDS,
  apiCheckoutDeps,
  resumeCheckout,
  withinBound,
  type CheckoutDeps,
  type ResumeOutcome,
} from "./checkout-flow";
import {
  beforePaying,
  forgetPurchase,
  pendingPurchase,
  purchaseToResume,
  rememberPurchase,
  type PendingPurchase,
} from "./pending-purchase";

/** An in-memory `localStorage`. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const throwing: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
  removeItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
};

describe("the purchase kept for a promo's page (review 2.1)", () => {
  it("is kept per promo, and forgotten only for the same payment", () => {
    const storage = memoryStorage();
    rememberPurchase("joes-texas", { paymentIntentId: "pi_1", authorized: false }, storage);
    expect(pendingPurchase("joes-texas", storage)).toEqual({
      paymentIntentId: "pi_1",
      authorized: false,
    });
    expect(pendingPurchase("other-promo", storage)).toBeNull();
    rememberPurchase("joes-texas", { paymentIntentId: "pi_1", authorized: true }, storage);
    forgetPurchase("joes-texas", "pi_0", storage);
    expect(pendingPurchase("joes-texas", storage)?.authorized).toBe(true);
    forgetPurchase("joes-texas", "pi_1", storage);
    expect(pendingPurchase("joes-texas", storage)).toBeNull();
  });

  it("ignores a record it cannot read", () => {
    const storage = memoryStorage();
    storage.setItem("winz.purchase.joes-texas", "{not json");
    expect(pendingPurchase("joes-texas", storage)).toBeNull();
    storage.setItem("winz.purchase.joes-texas", JSON.stringify({ paymentIntentId: 4 }));
    expect(pendingPurchase("joes-texas", storage)).toBeNull();
  });

  it("falls back silently when the storage throws", () => {
    expect(() =>
      rememberPurchase("joes-texas", { paymentIntentId: "pi_1", authorized: false }, throwing),
    ).not.toThrow();
    expect(pendingPurchase("joes-texas", throwing)).toBeNull();
    expect(() => forgetPurchase("joes-texas", "pi_1", throwing)).not.toThrow();
    expect(pendingPurchase("joes-texas", null)).toBeNull();
  });

  it("picks up the payment a redirect brings back, before the one kept", () => {
    const kept = { paymentIntentId: "pi_kept", authorized: false };
    expect(
      purchaseToResume(
        "?payment_intent=pi_3ds&payment_intent_client_secret=s&redirect_status=succeeded",
        kept,
      ),
    ).toEqual({ paymentIntentId: "pi_3ds", authorized: true });
    expect(purchaseToResume("?payment_intent=pi_3ds&redirect_status=processing", null)).toEqual({
      paymentIntentId: "pi_3ds",
      authorized: false,
    });
    expect(purchaseToResume("?payment_intent=pi_3ds&redirect_status=failed", kept)).toEqual(kept);
    expect(purchaseToResume("?scenario=processing", kept)).toEqual(kept);
    expect(purchaseToResume("", null)).toBeNull();
  });
});

const processing: CheckoutStatusResponse = {
  status: "processing",
  ticketToken: null,
  message: null,
};
const unpaid: CheckoutStatusResponse = {
  status: "requires_payment",
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

/** Answers `answers` in turn, repeating the last one. */
function inTurn(
  answers: (CheckoutStatusResponse | Error)[],
): () => Promise<CheckoutStatusResponse> {
  let index = 0;
  return () => {
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer!);
  };
}

/** More sleeps than any pick-up takes (about one a second for a minute): the loop never ended. */
const RUNAWAY_SLEEPS = 500;

/**
 * Deps whose clock moves with each sleep (and with `advance`, for a call that takes time), and
 * whose status answers `answers` in turn. The confirmation (which reads Stripe itself) answers
 * « still unpaid » unless a test says otherwise. A pick-up that never ends fails the test instead
 * of hanging the run: its every await resolves at once, so no timeout could stop it, and the
 * sleep throws past RUNAWAY_SLEEPS.
 */
function resumeDeps(
  ...answers: (CheckoutStatusResponse | Error)[]
): CheckoutDeps & { advance: (ms: number) => void } {
  let clock = 0;
  let index = 0;
  let sleeps = 0;
  return {
    create: vi.fn(),
    confirm: vi.fn().mockImplementation(() => Promise.resolve(unpaid)),
    status: vi.fn().mockImplementation(() => {
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }),
    sleep: vi.fn().mockImplementation((ms: number) => {
      sleeps += 1;
      if (sleeps > RUNAWAY_SLEEPS) {
        return Promise.reject(new Error(`runaway pick-up: still polling at ${clock / 1000} s`));
      }
      clock += ms;
      return Promise.resolve();
    }),
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
  };
}

function callsOf(fn: unknown): number {
  return (fn as ReturnType<typeof vi.fn>).mock.calls.length;
}

function resume(
  deps: CheckoutDeps,
  authorized = false,
): { run: ReturnType<typeof resumeCheckout>; onSecuring: ReturnType<typeof vi.fn> } {
  const onSecuring = vi.fn();
  const run = resumeCheckout({
    paymentIntentId: "pi_1",
    authorized,
    signal: new AbortController().signal,
    onSecuring,
    deps,
  });
  return { run, onSecuring };
}

describe("resumeCheckout: the page picks up a purchase it lost", () => {
  it("opens the ticket that exists, from the first read, with no confirmation", async () => {
    const deps = resumeDeps(ticketed);
    const { run } = resume(deps);
    expect(await run).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("shows the wait once the purchase is on its way, then opens the ticket", async () => {
    const { run, onSecuring } = resume(resumeDeps(unpaid, processing, processing, ticketed));
    expect(await run).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(onSecuring).toHaveBeenCalledTimes(1);
  });

  it("lets a card never seen authorized go quietly after the bound", async () => {
    const deps = resumeDeps(unpaid);
    const { run, onSecuring } = resume(deps);
    expect(await run).toEqual({ kind: "gone" });
    expect(onSecuring).not.toHaveBeenCalled();
    const polls = (deps.status as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(polls).toBe(RESUME_UNSEEN_LIMIT_SECONDS + 1);
  });

  it("shows the wait at once for a card seen authorized, and stops at the wait's bound", async () => {
    const { run, onSecuring } = resume(resumeDeps(unpaid), true);
    expect(onSecuring).toHaveBeenCalledTimes(1);
    expect(await run).toEqual({ kind: "unresolved" });
  });

  it("shows the ending of a purchase it saw on its way, and lets an unseen one go", async () => {
    expect(await resume(resumeDeps(processing, failed)).run).toEqual({
      kind: "failed",
      message: "Something went wrong, you were not charged",
    });
    expect(await resume(resumeDeps(failed), true).run).toEqual({
      kind: "failed",
      message: "Something went wrong, you were not charged",
    });
    expect(await resume(resumeDeps(failed)).run).toEqual({ kind: "gone" });
  });

  it("does not take the status read's failed for an unseen card's end: the confirmation decides", async () => {
    // A payment failed by a declined card A, then card B authorized on the same intent and the
    // page lost before it saw it: the status read can still say `failed` (its heal has not asked
    // Stripe yet, or could not). Followed as « unpaid » is, until the confirmation answers.
    const followed = resumeDeps(
      ...Array.from({ length: RESUME_UNSEEN_LIMIT_SECONDS + 1 }, () => failed),
      processing,
      ticketed,
    );
    followed.confirm = vi.fn().mockImplementation(inTurn([processing]));
    const shown = resume(followed);
    expect(await shown.run).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(shown.onSecuring).toHaveBeenCalledTimes(1);
    expect(callsOf(followed.confirm)).toBe(1);

    // The confirmation cannot read Stripe: no proof either way, the record stays.
    const unknown = resumeDeps(failed);
    unknown.confirm = vi
      .fn()
      .mockImplementation(inTurn([new ApiError(502, "internal", "Stripe is unreachable")]));
    expect(await resume(unknown).run).toEqual({ kind: "unresolved" });
    expect(callsOf(unknown.confirm)).toBeGreaterThan(1);

    // The confirmation says the payment is over: it goes, quietly.
    const over = resumeDeps(failed);
    over.confirm = vi.fn().mockImplementation(inTurn([failed]));
    const quiet = resume(over);
    expect(await quiet.run).toEqual({ kind: "gone" });
    expect(quiet.onSecuring).not.toHaveBeenCalled();
    expect(callsOf(over.confirm)).toBe(1);
    expect(callsOf(over.status)).toBe(RESUME_UNSEEN_LIMIT_SECONDS + 1);
  });

  it("still lets an unseen card go at once on cancelled_paused, and ends a seen one on failed", async () => {
    const paused = resumeDeps({
      status: "cancelled_paused",
      ticketToken: null,
      message: "Promo just paused, you were not charged",
    });
    expect(await resume(paused).run).toEqual({ kind: "gone" });
    expect(paused.confirm).not.toHaveBeenCalled();
    expect(paused.sleep).not.toHaveBeenCalled();
    const seen = resumeDeps(failed);
    expect(await resume(seen, true).run).toEqual({
      kind: "failed",
      message: "Something went wrong, you were not charged",
    });
    expect(seen.confirm).not.toHaveBeenCalled();
  });

  it("lets go a payment the API does not know, and asks again after a dropped connection", async () => {
    // At the first read, and even for a card seen authorized (which would otherwise be followed
    // for a minute and end « unresolved »).
    for (const authorized of [false, true]) {
      const deps = resumeDeps(new ApiError(404, "not_found", "Payment not found"));
      expect(await resume(deps, authorized).run).toEqual({ kind: "gone" });
      expect(deps.status).toHaveBeenCalledTimes(1);
      expect(deps.sleep).not.toHaveBeenCalled();
    }
    expect(await resume(resumeDeps(new ApiError(0, "network", "offline"), ticketed)).run).toEqual({
      kind: "ticketed",
      token: "tkt_1",
    });
  });

  it("never lets an unseen card go when the status cannot be read: the record stays", async () => {
    // A sequence found in review: the page is lost between the card's authorization and its answer,
    // then every status read fails (the network, a 5xx). Letting the record go would let the next
    // tap create a second payment while the first card may be authorized.
    for (const failure of [
      new ApiError(0, "network", "offline"),
      new ApiError(503, "internal", "Try again in a moment"),
    ]) {
      const deps = resumeDeps(failure);
      const { run, onSecuring } = resume(deps);
      expect(await run).toEqual({ kind: "unresolved" });
      expect(onSecuring).not.toHaveBeenCalled();
      expect(deps.create).not.toHaveBeenCalled();
    }
  });

  it("lets an unseen card go only on an answer past the bound, not on reads that failed before", async () => {
    // Reads fail through the bound, then the API answers « still unpaid »: that answer settles it.
    const failures = Array.from(
      { length: RESUME_UNSEEN_LIMIT_SECONDS + 3 },
      () => new ApiError(0, "network", "offline"),
    );
    expect(await resume(resumeDeps(...failures, unpaid)).run).toEqual({ kind: "gone" });
    // An answer before the bound, then failures: still not settled, so the record stays.
    expect(
      await resume(resumeDeps(unpaid, new ApiError(503, "internal", "Try again in a moment"))).run,
    ).toEqual({ kind: "unresolved" });
  });

  it("does not take the status read's « unpaid » for Stripe's: it asks the confirmation", async () => {
    // A case found in review: the server could not read Stripe, so its status read answers the row,
    // `requires_payment`, for a card that may be authorized. The confirmation reads Stripe itself
    // and answers 502 when it cannot: the record must stay.
    const deps = resumeDeps(unpaid);
    deps.confirm = vi
      .fn()
      .mockImplementation(inTurn([new ApiError(502, "internal", "Stripe is unreachable")]));
    const askedAt: number[] = [];
    const answer = deps.confirm;
    deps.confirm = vi.fn().mockImplementation((pi: string, signal: AbortSignal) => {
      askedAt.push(deps.now?.() ?? NaN);
      return answer(pi, signal);
    });
    const { run } = resume(deps);
    expect(await run).toEqual({ kind: "unresolved" });
    // Once per RESUME_VERIFY_EVERY_SECONDS from the unseen bound, and none at or past the minute:
    // 15, 20, … 55 s.
    const expected: number[] = [];
    for (
      let second = RESUME_UNSEEN_LIMIT_SECONDS;
      second < WAIT_LIMIT_SECONDS;
      second += RESUME_VERIFY_EVERY_SECONDS
    ) {
      expected.push(second * 1000);
    }
    expect(askedAt).toEqual(expected);
    expect(askedAt.every((at) => at < WAIT_LIMIT_SECONDS * 1000)).toBe(true);
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("follows the purchase when the confirmation finds the card authorized", async () => {
    const deps = resumeDeps(unpaid, unpaid, ticketed);
    // Stripe says authorized: the confirmation starts the purchase and answers `processing`.
    deps.confirm = vi.fn().mockImplementation(inTurn([processing]));
    const statuses = inTurn([
      ...Array.from({ length: RESUME_UNSEEN_LIMIT_SECONDS + 1 }, () => unpaid),
      processing,
      ticketed,
    ]);
    deps.status = vi.fn().mockImplementation(statuses);
    const { run, onSecuring } = resume(deps);
    expect(await run).toEqual({ kind: "ticketed", token: "tkt_1" });
    expect(onSecuring).toHaveBeenCalledTimes(1);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
  });

  it("lets go a payment the confirmation does not know", async () => {
    // The status read keeps answering « unpaid », which alone never lets the record go: it is the
    // confirmation's 404 `not_found`, at its first call past the bound, that does.
    const deps = resumeDeps(unpaid);
    deps.confirm = vi
      .fn()
      .mockImplementation(inTurn([new ApiError(404, "not_found", "Payment not found")]));
    const { run, onSecuring } = resume(deps);
    expect(await run).toEqual({ kind: "gone" });
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.status).toHaveBeenCalledTimes(RESUME_UNSEEN_LIMIT_SECONDS + 1);
    expect(onSecuring).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", failed],
    [
      "cancelled_paused",
      {
        status: "cancelled_paused",
        ticketToken: null,
        message: "Promo just paused, you were not charged",
      } satisfies CheckoutStatusResponse,
    ],
  ])(
    "lets an unseen card go quietly when the confirmation answers %s: no ending is shown",
    async (_name, ended) => {
      // A payment over before its card was seen authorized (declined, then the page left): there
      // is nothing to tell the fan, the record goes and the next tap is a new purchase.
      const deps = resumeDeps(unpaid);
      deps.confirm = vi.fn().mockImplementation(inTurn([ended]));
      const { run, onSecuring } = resume(deps);
      expect(await run).toEqual({ kind: "gone" });
      expect(deps.confirm).toHaveBeenCalledTimes(1);
      expect(onSecuring).not.toHaveBeenCalled();
    },
  );

  it("shows the wait and keeps the record when the confirmation answers processing", async () => {
    // Authorized and handed over, or pending at Stripe (a 3-D Secure approval left open in a bank
    // app): the status read still says « unpaid » (its row), but the purchase may still come.
    const deps = resumeDeps(unpaid);
    deps.confirm = vi.fn().mockImplementation(inTurn([processing]));
    const onWaiting = vi.fn();
    const onSecuring = vi.fn();
    const run = resumeCheckout({
      paymentIntentId: "pi_1",
      authorized: false,
      signal: new AbortController().signal,
      onSecuring,
      onWaiting,
      deps,
    });
    expect(await run).toEqual({ kind: "unresolved" });
    expect(onSecuring).toHaveBeenCalledTimes(1);
    expect(onWaiting).toHaveBeenCalled();
    // Once shown, the purchase is followed: the confirmation is not asked again.
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("does not let go a payment on a 404 that is not the API's « not found »", async () => {
    // A non-JSON 404 (a broken deployment, a proxy) says nothing about the payment: the client
    // reads it as `ApiError(404, "internal")`. Only the API's `not_found` lets the record go.
    const broken = new ApiError(404, "internal", "Something went wrong. Try again.");
    for (const authorized of [false, true]) {
      const deps = resumeDeps(broken);
      expect(await resume(deps, authorized).run).toEqual({ kind: "unresolved" });
      expect(callsOf(deps.status)).toBeGreaterThan(1);
    }
    const deps = resumeDeps(unpaid);
    deps.confirm = vi.fn().mockImplementation(inTurn([broken]));
    expect(await resume(deps).run).toEqual({ kind: "unresolved" });
    expect(callsOf(deps.confirm)).toBeGreaterThan(1);
  });

  it.each([4_000, 47_000])(
    "ends at the minute's bound when each confirmation takes %i ms to answer 502",
    async (ms) => {
      // Stripe unreachable: every server read takes up to ~47 s (15 s × 3 tries) before its 502.
      // A pass longer than RESUME_VERIFY_EVERY_SECONDS must not keep the pick-up from its bound.
      const deps = resumeDeps(unpaid);
      deps.confirm = vi.fn().mockImplementation(() => {
        deps.advance(ms);
        return Promise.reject(new ApiError(502, "internal", "Stripe is unreachable"));
      });
      const { run, onSecuring } = resume(deps);
      expect(await run).toEqual({ kind: "unresolved" });
      expect(onSecuring).not.toHaveBeenCalled();
      expect(deps.create).not.toHaveBeenCalled();
      expect(callsOf(deps.confirm)).toBeLessThanOrEqual(
        Math.ceil(
          (WAIT_LIMIT_SECONDS - RESUME_UNSEEN_LIMIT_SECONDS) / RESUME_VERIFY_EVERY_SECONDS,
        ) + 1,
      );
      expect(callsOf(deps.sleep)).toBeLessThanOrEqual(WAIT_LIMIT_SECONDS);
      if (ms >= (WAIT_LIMIT_SECONDS - RESUME_UNSEEN_LIMIT_SECONDS) * 1000) {
        // The clock is read again after the confirmation: it ends there, with no further read.
        expect(callsOf(deps.confirm)).toBe(1);
        expect(callsOf(deps.status)).toBe(RESUME_UNSEEN_LIMIT_SECONDS + 1);
      }
    },
  );

  it("ends at the minute's bound when each status read takes 10 s", async () => {
    const deps = resumeDeps();
    deps.status = vi.fn().mockImplementation(() => {
      deps.advance(10_000);
      return Promise.resolve(unpaid);
    });
    deps.confirm = vi
      .fn()
      .mockImplementation(inTurn([new ApiError(502, "internal", "Stripe is unreachable")]));
    const { run } = resume(deps);
    expect(await run).toEqual({ kind: "unresolved" });
    // About one read every 11 s: six or seven before the bound, never more.
    expect(callsOf(deps.status)).toBeLessThanOrEqual(7);
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("still lets the answer that settles it win when it comes late", async () => {
    // A slow confirmation whose answer is Stripe's « unpaid » lets the record go even past the
    // minute: only « no answer » turns into `unresolved`.
    const deps = resumeDeps(unpaid);
    deps.confirm = vi.fn().mockImplementation(() => {
      deps.advance(47_000);
      return Promise.resolve(unpaid);
    });
    expect(await resume(deps).run).toEqual({ kind: "gone" });
    const ticketing = resumeDeps(unpaid);
    ticketing.status = vi.fn().mockImplementation(() => {
      ticketing.advance(70_000);
      return Promise.resolve(ticketed);
    });
    expect(await resume(ticketing, true).run).toEqual({ kind: "ticketed", token: "tkt_1" });
  });

  it("waits no longer than the purchase's own bound", () => {
    expect(RESUME_UNSEEN_LIMIT_SECONDS).toBeLessThan(WAIT_LIMIT_SECONDS);
  });
});

/** A call that answers nothing until its signal aborts, then rejects as `fetch` does. */
function hanging(_pi: string, signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
      once: true,
    });
  });
}

/** A call that never settles, whatever its signal does. */
function deaf(): Promise<never> {
  return new Promise(() => undefined);
}

describe("resumeCheckout: the pick-up never outlives its bound (real clock and sleep, fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The production sleep and clock (`performance.now`), both on vitest's fake timers. */
  function timedDeps(overrides: Partial<CheckoutDeps>): CheckoutDeps {
    return {
      create: vi.fn(),
      confirm: vi.fn().mockResolvedValue(unpaid),
      status: vi.fn().mockResolvedValue(unpaid),
      sleep: apiCheckoutDeps.sleep,
      ...overrides,
    };
  }

  function start(
    deps: CheckoutDeps,
    controller: AbortController,
  ): { settled: () => ResumeOutcome | unknown; onSecuring: ReturnType<typeof vi.fn> } {
    let result: { value: ResumeOutcome | unknown } | null = null;
    const onSecuring = vi.fn();
    void resumeCheckout({
      paymentIntentId: "pi_1",
      authorized: false,
      signal: controller.signal,
      onSecuring,
      deps,
    }).then(
      (value) => {
        result = { value };
      },
      (error: unknown) => {
        result = { value: error };
      },
    );
    return { settled: () => (result === null ? undefined : result.value), onSecuring };
  }

  it.each([
    ["confirmation", "confirm"],
    ["status read", "status"],
  ] as const)(
    "a %s that never answers ends the pick-up unresolved at about 60 s",
    async (_name, which) => {
      const controller = new AbortController();
      const call = vi.fn().mockImplementation(hanging);
      const deps = timedDeps({ [which]: call });
      const { settled, onSecuring } = start(deps, controller);
      try {
        await vi.advanceTimersByTimeAsync(WAIT_LIMIT_SECONDS * 1000 - STATUS_POLL_MS);
        expect(settled()).toBeUndefined();
        await vi.advanceTimersByTimeAsync(2 * STATUS_POLL_MS);
        expect(settled()).toEqual({ kind: "unresolved" });
        expect(onSecuring).not.toHaveBeenCalled();
        expect(deps.create).not.toHaveBeenCalled();
        // The call was cut by its own bound, not by the page.
        const signal = call.mock.calls[0]?.[1] as AbortSignal;
        expect(signal.aborted).toBe(true);
        expect(controller.signal.aborted).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        controller.abort();
      }
    },
  );

  it("the device's clock set back an hour does not stretch the minute: the bound is monotonic", async () => {
    const controller = new AbortController();
    const deps = timedDeps({
      confirm: vi.fn().mockRejectedValue(new ApiError(502, "internal", "x")),
    });
    const { settled } = start(deps, controller);
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      vi.setSystemTime(Date.now() - 3_600_000);
      await vi.advanceTimersByTimeAsync(WAIT_LIMIT_SECONDS * 1000 - 30_000 + 2 * STATUS_POLL_MS);
      expect(settled()).toEqual({ kind: "unresolved" });
    } finally {
      controller.abort();
    }
  });

  it.each([
    ["answers only when its signal aborts", hanging],
    ["ignores its signal", deaf],
  ] as const)(
    "the page's own abort during a confirmation that %s still rejects with the abort",
    async (_name, confirm) => {
      const controller = new AbortController();
      const deps = timedDeps({ confirm: vi.fn().mockImplementation(confirm) });
      const { settled } = start(deps, controller);
      await vi.advanceTimersByTimeAsync((RESUME_UNSEEN_LIMIT_SECONDS + 5) * 1000);
      expect(deps.confirm).toHaveBeenCalledTimes(1);
      expect(settled()).toBeUndefined();
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      const error = settled();
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe("AbortError");
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("withinBound: one call of the pick-up, bounded in time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes the call's answer and its error through, and cleans up", async () => {
    const page = new AbortController();
    const removed = vi.spyOn(page.signal, "removeEventListener");
    expect(await withinBound(() => Promise.resolve(processing), page.signal, 5_000)).toBe(
      processing,
    );
    const failure = new ApiError(502, "internal", "Stripe is unreachable");
    await expect(withinBound(() => Promise.reject(failure), page.signal, 5_000)).rejects.toBe(
      failure,
    );
    expect(removed).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers null once the time is up, and aborts the call's own signal only", async () => {
    for (const call of [hanging, deaf]) {
      const page = new AbortController();
      let seen: AbortSignal | null = null;
      const bounded = withinBound(
        (signal) => {
          seen = signal;
          return call("pi_1", signal);
        },
        page.signal,
        5_000,
      );
      let result: unknown = "pending";
      void bounded.then((value) => {
        result = value;
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(result).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toBeNull();
      expect(seen!.aborted).toBe(true);
      expect(page.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("rejects with the abort when the page aborts, even for a call that ignores its signal", async () => {
    for (const call of [hanging, deaf]) {
      const page = new AbortController();
      let seen: AbortSignal | null = null;
      const bounded = withinBound(
        (signal) => {
          seen = signal;
          return call("pi_1", signal);
        },
        page.signal,
        5_000,
      );
      const outcome = bounded.then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      page.abort();
      const error = await outcome;
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe("AbortError");
      expect(seen!.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
    const gone = new AbortController();
    gone.abort();
    const call = vi.fn();
    await expect(withinBound(call, gone.signal, 5_000)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(call).not.toHaveBeenCalled();
  });
});

describe("beforePaying: a tap on Pay and the purchase kept for the promo (review 1.2 across a reload)", () => {
  const unseen: PendingPurchase = { paymentIntentId: "pi_1", authorized: false };
  const seen: PendingPurchase = { paymentIntentId: "pi_1", authorized: true };

  it("pays when nothing is kept", () => {
    expect(beforePaying(null, null)).toEqual({ kind: "pay" });
    expect(beforePaying(null, "pi_1")).toEqual({ kind: "pay" });
  });

  it("pays again the payment the sheet holds and has not seen authorized", () => {
    expect(beforePaying(unseen, "pi_1")).toEqual({ kind: "pay" });
  });

  it("follows a payment whose card was seen authorized, even one the sheet holds", () => {
    expect(beforePaying(seen, "pi_1")).toEqual({ kind: "follow", purchase: seen });
    expect(beforePaying(seen, null)).toEqual({ kind: "follow", purchase: seen });
  });

  it("follows a payment picked up after a reload, whose card may have been authorized", () => {
    expect(beforePaying(unseen, null)).toEqual({ kind: "follow", purchase: unseen });
    expect(beforePaying(unseen, "pi_2")).toEqual({ kind: "follow", purchase: unseen });
  });
});
