import type { CheckoutStatusResponse } from "@winz/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  RESUME_UNSEEN_LIMIT_SECONDS,
  WAIT_LIMIT_SECONDS,
  resumeCheckout,
  type CheckoutDeps,
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

/** Deps whose clock moves with each sleep, and whose status answers `answers` in turn. */
function resumeDeps(...answers: (CheckoutStatusResponse | Error)[]): CheckoutDeps {
  let clock = 0;
  let index = 0;
  return {
    create: vi.fn(),
    confirm: vi.fn(),
    status: vi.fn().mockImplementation(() => {
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }),
    sleep: vi.fn().mockImplementation((ms: number) => {
      clock += ms;
      return Promise.resolve();
    }),
    now: () => clock,
  };
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
    // The verifier's sequence: the page is lost between the card's authorization and its answer,
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

  it("waits no longer than the purchase's own bound", () => {
    expect(RESUME_UNSEEN_LIMIT_SECONDS).toBeLessThan(WAIT_LIMIT_SECONDS);
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
