import type { CheckoutResponse, CheckoutStatusResponse } from "@winz/shared";

import { apiFetch, isAbortError, isApiError } from "@/lib/api/client";
import { copy } from "@/lib/copy";

/**
 * The purchase, from "Pay" to a ticket (SCREENS C2, apps/web/README.md "Le parcours d'achat, côté
 * front"):
 *
 *   validate()                                  the payment form is checked (Stripe `elements.submit()`)
 *   POST /api/checkout { slug, qty }            409 sales_paused | sales_closed: refused, nothing created
 *   authorize(checkout)                         the card is authorized, not charged (Stripe confirmPayment)
 *   POST /api/checkout/:pi/confirm              hands the purchase to the engine
 *   GET  /api/checkout/:pi, every second        until `ticketed`, `cancelled_paused` or `failed`,
 *                                               or WAIT_LIMIT_SECONDS (then `unresolved`)
 *
 * One payment per purchase, however many taps (review 1.2): the answer of `POST /api/checkout` is
 * kept in a `CheckoutMemory` (keyed by promo and quantity) and the next attempt pays that same
 * payment instead of creating another. It is dropped only when that payment is over:
 *
 *   - a ticket exists (`ticketed`);
 *   - it ended without one after it was handed over (`cancelled_paused` or `failed` from the
 *     status: the engine cancelled the authorization);
 *   - Stripe says it is `canceled` (`AuthorizeResult.ended`: cancelled by the engine, or its
 *     authorization expired). If that was the kept one, a new payment is created, once;
 *   - the quantity changed (another purchase).
 *
 * Everything else keeps it: a declined card (Stripe leaves the intent `requires_payment_method`,
 * payable with another card, and the back end takes it again once authorized), an error from Stripe
 * or the network, a form that is not valid, and a wait that reached its bound.
 *
 * It is written against `CheckoutDeps` so it can be tested without a network, and against a
 * `validate` and an `authorize` step so that Stripe (or a stand-in) plugs in without touching the rest.
 */

export const STATUS_POLL_MS = 1000;
/**
 * How long the screen follows a purchase whose card is authorized before it stops and says so
 * (review 2.5). The status read completes an authorized payment by itself after 5 s, so a purchase
 * still on its way after a minute is waiting on the engine: the fan is told the card is only
 * authorized, and that this page picks the purchase up again when it is reopened.
 */
export const WAIT_LIMIT_SECONDS = 60;
/**
 * When the page picks up a purchase whose authorization it never saw (the page was lost before
 * Stripe answered), how long it waits for the status read to find the card authorized (it asks
 * Stripe once every 5 s) before it lets the record go.
 */
export const RESUME_UNSEEN_LIMIT_SECONDS = 15;
/**
 * Past RESUME_UNSEEN_LIMIT_SECONDS, how often the pick-up asks the confirmation (which reads Stripe
 * on every call) whether an unseen card is really unpaid: about nine reads at most before the
 * minute's bound.
 */
export const RESUME_VERIFY_EVERY_SECONDS = 5;

/**
 * What the payment step answers: the card is authorized, or it is not (with a message to show).
 * `ended`: the payment itself is over (cancelled at Stripe), not just this attempt.
 */
export type AuthorizeResult = { ok: true } | { ok: false; message: string; ended?: true };
export type Authorize = (checkout: CheckoutResponse) => Promise<AuthorizeResult>;

export type CheckoutOutcome =
  /** The ticket exists: open `/t/<token>`. */
  | { kind: "ticketed"; token: string }
  /** The promo paused between the tap and the capture: the card was not charged. */
  | { kind: "cancelled"; message: string }
  /** The payment did not go through. Nothing was charged. */
  | { kind: "failed"; message: string }
  /** Refused before anything was created (409): the promo is paused or closed. */
  | { kind: "refused"; message: string }
  /**
   * The card is authorized and the purchase still on its way after WAIT_LIMIT_SECONDS: the screen
   * stops waiting. Nothing is charged until the ticket exists.
   */
  | { kind: "unresolved" };

export interface CheckoutDeps {
  create: (body: { slug: string; qty: number }, signal: AbortSignal) => Promise<CheckoutResponse>;
  confirm: (pi: string, signal: AbortSignal) => Promise<CheckoutStatusResponse>;
  status: (pi: string, signal: AbortSignal) => Promise<CheckoutStatusResponse>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The clock of the wait's bound; `Date.now` when left out. */
  now?: () => number;
}

/**
 * The answer of `POST /api/checkout` kept between the attempts of one sheet, for one promo and one
 * quantity (see the top of this file for when it is dropped).
 */
export interface CheckoutMemory {
  /** The payment kept for this promo and quantity. One kept for another purchase is dropped. */
  read: (slug: string, qty: number) => CheckoutResponse | null;
  keep: (slug: string, qty: number, checkout: CheckoutResponse) => void;
  drop: () => void;
  /** The payment kept, whatever its promo and quantity, without dropping it. */
  peek: () => CheckoutResponse | null;
}

export function createCheckoutMemory(): CheckoutMemory {
  let kept: { slug: string; qty: number; checkout: CheckoutResponse } | null = null;
  return {
    read: (slug, qty) => {
      if (kept === null) return null;
      if (kept.slug !== slug || kept.qty !== qty) {
        kept = null;
        return null;
      }
      return kept.checkout;
    },
    keep: (slug, qty, checkout) => {
      kept = { slug, qty, checkout };
    },
    drop: () => {
      kept = null;
    },
    peek: () => kept?.checkout ?? null,
  };
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
  /**
   * Runs first, before anything is created: Stripe wants the form validated before any request. A
   * form that is not valid ends the run as `failed` with Stripe's message, with nothing created.
   */
  validate?: () => Promise<AuthorizeResult>;
  signal: AbortSignal;
  /** Called once the card is authorized and the purchase is on its way: the screen can switch. */
  onSecuring?: () => void;
  /** Called after each poll that found the purchase still on its way, with the seconds waited. */
  onWaiting?: (seconds: number) => void;
  /** The payment kept from an earlier attempt of the same sheet. A run of its own when left out. */
  memory?: CheckoutMemory;
  /**
   * Called with the payment this attempt pays as soon as it is known: the kept one, or each one
   * `POST /api/checkout` creates, as soon as it answers (the screen records it, review 2.1).
   */
  onPayment?: (checkout: CheckoutResponse) => void;
  deps?: CheckoutDeps;
}

type Created = { ok: true; checkout: CheckoutResponse } | { ok: false; outcome: CheckoutOutcome };

async function createPayment(
  slug: string,
  qty: number,
  signal: AbortSignal,
  deps: CheckoutDeps,
): Promise<Created> {
  try {
    return { ok: true, checkout: await deps.create({ slug, qty }, signal) };
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    if (isApiError(error)) {
      if (error.code === "sales_paused" || error.code === "sales_closed") {
        return { ok: false, outcome: { kind: "refused", message: error.message } };
      }
      return { ok: false, outcome: { kind: "failed", message: error.message } };
    }
    return { ok: false, outcome: { kind: "failed", message: copy.common.genericError } };
  }
}

export interface FollowInput {
  signal: AbortSignal;
  /** Called after each poll that found the purchase still on its way, with the seconds waited. */
  onWaiting?: (seconds: number) => void;
  /** A first answer already in hand (the confirmation's): no poll when it is final. */
  first?: CheckoutStatusResponse | null;
  deps?: CheckoutDeps;
}

/**
 * Polls `GET /api/checkout/:pi` every second until the purchase ends, or until WAIT_LIMIT_SECONDS
 * (`unresolved`). A poll that fails on the network is tried again, never turned into a failure.
 */
export async function followCheckout(
  paymentIntentId: string,
  { signal, onWaiting, first = null, deps = apiCheckoutDeps }: FollowInput,
): Promise<CheckoutOutcome> {
  const now = deps.now ?? Date.now;
  let outcome = first === null ? null : outcomeOf(first);
  const startedAt = now();
  while (outcome === null) {
    await deps.sleep(STATUS_POLL_MS, signal);
    try {
      outcome = outcomeOf(await deps.status(paymentIntentId, signal));
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      // A dropped connection: ask again.
    }
    if (outcome !== null) break;
    const seconds = Math.round((now() - startedAt) / 1000);
    if (seconds >= WAIT_LIMIT_SECONDS) return { kind: "unresolved" };
    onWaiting?.(seconds);
  }
  return outcome;
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
  validate,
  signal,
  onSecuring,
  onWaiting,
  memory = createCheckoutMemory(),
  onPayment,
  deps = apiCheckoutDeps,
}: RunCheckoutInput): Promise<CheckoutOutcome> {
  if (validate !== undefined) {
    const valid = await validate();
    if (!valid.ok) return { kind: "failed", message: valid.message };
  }

  const create = async (): Promise<Created> => {
    const created = await createPayment(slug, qty, signal, deps);
    if (created.ok) {
      memory.keep(slug, qty, created.checkout);
      onPayment?.(created.checkout);
    }
    return created;
  };

  const kept = memory.read(slug, qty);
  let checkout: CheckoutResponse;
  if (kept === null) {
    const created = await create();
    if (!created.ok) return created.outcome;
    checkout = created.checkout;
  } else {
    checkout = kept;
    onPayment?.(kept);
  }

  let authorized = await authorize(checkout);
  if (!authorized.ok && authorized.ended === true) {
    memory.drop();
    if (kept === null) return { kind: "failed", message: authorized.message };
    // The kept payment was cancelled in the meantime: this attempt is a new purchase, once.
    const created = await create();
    if (!created.ok) return created.outcome;
    checkout = created.checkout;
    authorized = await authorize(checkout);
    if (!authorized.ok && authorized.ended === true) memory.drop();
  }
  if (!authorized.ok) return { kind: "failed", message: authorized.message };
  onSecuring?.();

  let latest: CheckoutStatusResponse | null = null;
  try {
    latest = await deps.confirm(checkout.paymentIntentId, signal);
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    // Not fatal: the Stripe webhook starts the same processing, and the status read below completes
    // an authorized payment by itself (it asks Stripe once the row has waited 5 s).
  }

  const outcome = await followCheckout(checkout.paymentIntentId, {
    signal,
    onWaiting,
    first: latest,
    deps,
  });
  // A purchase still on its way stays this sheet's: the next tap follows it instead of paying again.
  if (outcome.kind !== "unresolved") memory.drop();
  return outcome;
}

/** What picking a purchase up again ends on, beyond the outcomes of a purchase. */
export type ResumeOutcome =
  | CheckoutOutcome
  /**
   * Nothing to show, and the record can go: no such payment, a payment that ended before its card
   * was seen authorized, or one still unpaid after RESUME_UNSEEN_LIMIT_SECONDS.
   */
  | { kind: "gone" };

export interface ResumeInput {
  paymentIntentId: string;
  /** This page saw the card authorized before it was lost (or Stripe's redirect said so). */
  authorized: boolean;
  signal: AbortSignal;
  /** Called once, when the purchase is known to be on its way: the screen can show the wait. */
  onSecuring?: () => void;
  onWaiting?: (seconds: number) => void;
  deps?: CheckoutDeps;
}

/**
 * Picks up a purchase the page lost (review 2.1): reloaded, closed during « Securing your promo… »,
 * or back from a payment redirect. Polls `GET /api/checkout/:pi` from the first second:
 *
 *   - `ticketed`: the ticket opens;
 *   - `processing`, or `requires_payment` for a card this page saw authorized: the wait is shown
 *     (`onSecuring`) and followed as after a tap, up to WAIT_LIMIT_SECONDS (`unresolved`);
 *   - `requires_payment` for a card never seen authorized: followed quietly; past
 *     RESUME_UNSEEN_LIMIT_SECONDS the confirmation is asked, which reads Stripe itself, and only
 *     its `requires_payment` (Stripe said « not authorized ») lets the record go (`gone`). The
 *     status read's own `requires_payment` is not enough: it answers the row when it could not
 *     read Stripe. Reads that fail never let it go: without that answer by WAIT_LIMIT_SECONDS,
 *     `unresolved`, and the record stays;
 *   - `cancelled_paused` or `failed`: the ending, when the wait was shown or the card was seen
 *     authorized; otherwise `gone` (a card declined, then the page left);
 *   - a payment the API does not know (404): `gone`.
 */
export async function resumeCheckout({
  paymentIntentId,
  authorized,
  signal,
  onSecuring,
  onWaiting,
  deps = apiCheckoutDeps,
}: ResumeInput): Promise<ResumeOutcome> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let shown = false;
  const show = (): void => {
    if (shown) return;
    shown = true;
    onSecuring?.();
  };
  if (authorized) show();
  let nextVerifyAt = RESUME_UNSEEN_LIMIT_SECONDS;

  for (let first = true; ; first = false) {
    if (!first) await deps.sleep(STATUS_POLL_MS, signal);
    let response: CheckoutStatusResponse | null = null;
    try {
      response = await deps.status(paymentIntentId, signal);
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      if (isApiError(error) && error.status === 404) return { kind: "gone" };
      // A dropped connection: ask again.
    }
    if (response !== null) {
      const outcome = outcomeOf(response);
      if (outcome !== null) {
        if (outcome.kind === "ticketed" || shown) return outcome;
        return { kind: "gone" };
      }
      if (response.status === "processing" || response.status === "ticketed") show();
    }
    const seconds = Math.round((now() - startedAt) / 1000);
    if (shown) {
      if (seconds >= WAIT_LIMIT_SECONDS) return { kind: "unresolved" };
      onWaiting?.(seconds);
    } else if (
      response?.status === "requires_payment" &&
      seconds >= RESUME_UNSEEN_LIMIT_SECONDS &&
      seconds >= nextVerifyAt
    ) {
      // Only Stripe's own word lets an unseen card go. The status read cannot give it: when its
      // own read of Stripe fails, it answers the row, `requires_payment`, for a card that may be
      // authorized. The confirmation reads the payment at Stripe on every call and answers 502
      // when it cannot: its `requires_payment` means Stripe said « not authorized ». Asked at
      // most once per RESUME_VERIFY_EVERY_SECONDS; a failure proves nothing and the record stays.
      nextVerifyAt = seconds + RESUME_VERIFY_EVERY_SECONDS;
      let verified: CheckoutStatusResponse | null = null;
      try {
        verified = await deps.confirm(paymentIntentId, signal);
      } catch (error: unknown) {
        if (isAbortError(error)) throw error;
        if (isApiError(error) && error.status === 404) return { kind: "gone" };
      }
      if (verified !== null) {
        const outcome = outcomeOf(verified);
        if (outcome !== null) return outcome.kind === "ticketed" ? outcome : { kind: "gone" };
        if (verified.status === "requires_payment") return { kind: "gone" };
        show();
      }
    } else if (seconds >= WAIT_LIMIT_SECONDS) {
      // A minute without an answer that settles it: the record stays, and the next tap follows it
      // instead of paying again.
      return { kind: "unresolved" };
    }
  }
}
