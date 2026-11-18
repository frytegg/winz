import type { CheckoutResponse, CheckoutStatusResponse } from "@winz/shared";

import { apiFetch, isAbortError, isApiError } from "@/lib/api/client";
import { copy } from "@/lib/copy";

/**
 * The purchase, from "Pay" to a ticket (SCREENS C2, apps/web/README.md "Le parcours d'achat, côté
 * front"):
 *
 *   POST /api/checkout { slug, qty }            409 sales_paused | sales_closed: refused, nothing created
 *   authorize(checkout)                         the card is authorized, not charged (Stripe, task U-04)
 *   POST /api/checkout/:pi/confirm              hands the purchase to the engine
 *   GET  /api/checkout/:pi, every second        until `ticketed`, `cancelled_paused` or `failed`
 *
 * It is written against `CheckoutDeps` so it can be tested without a network, and against an
 * `authorize` step so that Stripe can be plugged in without touching the rest.
 */

export const STATUS_POLL_MS = 1000;

/** What the payment step answers: the card is authorized, or it is not (with a message to show). */
export type AuthorizeResult = { ok: true } | { ok: false; message: string };
export type Authorize = (checkout: CheckoutResponse) => Promise<AuthorizeResult>;

export type CheckoutOutcome =
  /** The ticket exists: open `/t/<token>`. */
  | { kind: "ticketed"; token: string }
  /** The promo paused between the tap and the capture: the card was not charged. */
  | { kind: "cancelled"; message: string }
  /** The payment did not go through. Nothing was charged. */
  | { kind: "failed"; message: string }
  /** Refused before anything was created (409): the promo is paused or closed. */
  | { kind: "refused"; message: string };

export interface CheckoutDeps {
  create: (body: { slug: string; qty: number }, signal: AbortSignal) => Promise<CheckoutResponse>;
  confirm: (pi: string, signal: AbortSignal) => Promise<CheckoutStatusResponse>;
  status: (pi: string, signal: AbortSignal) => Promise<CheckoutStatusResponse>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const apiCheckoutDeps: CheckoutDeps = {
  create: (body, signal) => apiFetch("checkout", { body, signal }),
  confirm: (pi, signal) => apiFetch("confirmCheckout", { params: { pi }, signal }),
  status: (pi, signal) => apiFetch("checkoutStatus", { params: { pi }, signal }),
  sleep: abortableSleep,
};

/** A final status → its outcome; `null` while the purchase is still on its way. */
export function outcomeOf(response: CheckoutStatusResponse): CheckoutOutcome | null {
  switch (response.status) {
    case "ticketed":
      return response.ticketToken === null
        ? null
        : { kind: "ticketed", token: response.ticketToken };
    case "cancelled_paused":
      return { kind: "cancelled", message: response.message ?? copy.checkout.pausedNoCharge };
    case "failed":
      return { kind: "failed", message: response.message ?? copy.checkout.failed };
    case "requires_payment":
    case "processing":
      return null;
  }
}

export interface RunCheckoutInput {
  slug: string;
  qty: number;
  authorize: Authorize;
  signal: AbortSignal;
  /** Called once the card is authorized and the purchase is on its way: the screen can switch. */
  onSecuring?: () => void;
  /** Called after each poll that found the purchase still on its way, with the seconds waited. */
  onWaiting?: (seconds: number) => void;
  deps?: CheckoutDeps;
}

/**
 * Runs the whole purchase. Resolves with an outcome the screen can show; rejects only when
 * `signal` aborts (the shopper left). A poll that fails on the network is tried again, never
 * turned into a failure: the card may already have been authorized, and a second try would start
 * a second purchase.
 */
export async function runCheckout({
  slug,
  qty,
  authorize,
  signal,
  onSecuring,
  onWaiting,
  deps = apiCheckoutDeps,
}: RunCheckoutInput): Promise<CheckoutOutcome> {
  let checkout: CheckoutResponse;
  try {
    checkout = await deps.create({ slug, qty }, signal);
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    if (isApiError(error)) {
      if (error.code === "sales_paused" || error.code === "sales_closed") {
        return { kind: "refused", message: error.message };
      }
      return { kind: "failed", message: error.message };
    }
    return { kind: "failed", message: copy.common.genericError };
  }

  const authorized = await authorize(checkout);
  if (!authorized.ok) return { kind: "failed", message: authorized.message };
  onSecuring?.();

  let latest: CheckoutStatusResponse | null = null;
  try {
    latest = await deps.confirm(checkout.paymentIntentId, signal);
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    // Not fatal: the Stripe webhook starts the same processing, and the polling below finds it.
  }
  let outcome = latest === null ? null : outcomeOf(latest);

  const startedAt = Date.now();
  while (outcome === null) {
    await deps.sleep(STATUS_POLL_MS, signal);
    try {
      outcome = outcomeOf(await deps.status(checkout.paymentIntentId, signal));
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      // A dropped connection: ask again.
    }
    if (outcome === null) onWaiting?.(Math.round((Date.now() - startedAt) / 1000));
  }
  return outcome;
}
