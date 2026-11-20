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
 * How long the screen follows a purchase before it stops and says so (review 2.5), after a tap or
 * when the page picks one up. The status read completes an authorized payment by itself after 5 s,
 * so a purchase still on its way after a minute is waiting on the engine, or on Stripe (a card the
 * page never saw authorized, a 3-D Secure approval still open): the fan is told nothing is charged
 * before the ticket exists, and that this page picks the purchase up again when it is reopened.
 */
export const WAIT_LIMIT_SECONDS = 60;
/**
 * When the page picks up a purchase whose authorization it never saw (the page was lost before
 * Stripe answered), how long it follows the status read quietly (whose heal takes a card it finds
 * authorized) before it asks the confirmation whether the card is unpaid. Only the confirmation's
 * `requires_payment`, Stripe's own word, lets the record go: never the status read's, which answers
 * the row when it cannot reach Stripe.
 */
export const RESUME_UNSEEN_LIMIT_SECONDS = 15;
/**
 * Past RESUME_UNSEEN_LIMIT_SECONDS, how often the pick-up asks the confirmation (which reads Stripe
 * on every call) whether an unseen card is really unpaid: nine calls at most, at 15, 20, … 55 s
 * (none is started at or past WAIT_LIMIT_SECONDS), fewer when a call or a read is slow.
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
   * The purchase is not settled after WAIT_LIMIT_SECONDS (on its way, or a card whose state could
   * not be checked): the screen stops waiting and the payment is kept. Nothing is charged until the
   * ticket exists.
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

/**
 * Runs `call` with a signal of its own that aborts when `signal` does, or once `ms` have passed.
 * Resolves with the call's answer, or `null` when the time ran out first (the call is aborted and
 * counts as « no answer », never as an abort). Rejects with the call's own error, and with an
 * `AbortError` as soon as `signal` aborts, even when the call ignores its signal: the bound holds
 * whatever the call does. The timer and the listener are removed when it settles.
 *
 * A timer and a listener rather than `AbortSignal.any` / `AbortSignal.timeout`, which older iOS
 * Safari lacks.
 */
export async function withinBound<T>(
  call: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  ms: number,
): Promise<T | null> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const child = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  type Ended = { kind: "answer"; value: T } | { kind: "error"; error: unknown };
  const answered: Promise<Ended> = call(child.signal).then(
    (value) => ({ kind: "answer", value }),
    (error: unknown) => ({ kind: "error", error }),
  );
  const bound = new Promise<{ kind: "expired" } | { kind: "aborted" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "expired" }), ms);
    onAbort = () => resolve({ kind: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const ended = await Promise.race([answered, bound]);
    // The page left: that wins over anything the call answered meanwhile.
    if (signal.aborted) {
      throw ended.kind === "error" && isAbortError(ended.error)
        ? ended.error
        : new DOMException("Aborted", "AbortError");
    }
    if (ended.kind === "answer") return ended.value;
    if (ended.kind === "error") throw ended.error;
    // The time ran out first: no answer.
    return null;
  } finally {
    clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
    // Whatever is still in flight (a call past its bound, or the page gone) is cancelled.
    child.abort();
  }
}

/** The API said it does not know this payment: a JSON 404 `not_found`, not any 404. */
function isUnknownPayment(error: unknown): boolean {
  return isApiError(error) && error.status === 404 && error.code === "not_found";
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
  /**
   * When the wait began on `deps.now`, so that the time the confirmation took counts toward the
   * minute; now when left out.
   */
  startedAt?: number;
  deps?: CheckoutDeps;
}

/**
 * Polls `GET /api/checkout/:pi` every second until the purchase ends, or until WAIT_LIMIT_SECONDS
 * (`unresolved`). A poll that fails on the network is tried again, never turned into a failure.
 * Each poll runs within the time left before that bound (`withinBound`): a read that hangs is cut
 * and counts as no answer, so the wait ends on time whatever the network does.
 */
export async function followCheckout(
  paymentIntentId: string,
  { signal, onWaiting, first = null, startedAt: since, deps = apiCheckoutDeps }: FollowInput,
): Promise<CheckoutOutcome> {
  const now = deps.now ?? Date.now;
  let outcome = first === null ? null : outcomeOf(first);
  const startedAt = since ?? now();
  const deadline = startedAt + WAIT_LIMIT_SECONDS * 1000;
  while (outcome === null) {
    await deps.sleep(STATUS_POLL_MS, signal);
    try {
      // Within the time left before the minute: a read that hangs is no answer, not a wait
      // without end on « Securing your promo… ».
      const read = await withinBound(
        (bound) => deps.status(paymentIntentId, bound),
        signal,
        Math.max(STATUS_POLL_MS, deadline - now()),
      );
      if (read !== null) outcome = outcomeOf(read);
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

  // The minute of the wait starts here: a confirmation that hangs is cut at its end, and the time
  // it took counts toward it.
  const securingSince = (deps.now ?? Date.now)();
  let latest: CheckoutStatusResponse | null = null;
  try {
    latest = await withinBound(
      (bound) => deps.confirm(checkout.paymentIntentId, bound),
      signal,
      WAIT_LIMIT_SECONDS * 1000,
    );
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    // Not fatal: the Stripe webhook starts the same processing, and the status read below completes
    // an authorized payment by itself (it asks Stripe once the row has waited 5 s).
  }

  const outcome = await followCheckout(checkout.paymentIntentId, {
    signal,
    onWaiting,
    first: latest,
    startedAt: securingSince,
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
 *     RESUME_UNSEEN_LIMIT_SECONDS the confirmation is asked (`POST /api/checkout/:pi/confirm`, at
 *     most once per RESUME_VERIFY_EVERY_SECONDS), which reads Stripe itself. Only its
 *     `requires_payment` (Stripe said unpaid or over) lets the record go (`gone`), and so does any
 *     other end it answers before a ticket. Its `processing` (authorized, or pending at Stripe:
 *     a 3-D Secure approval still open) shows the wait. The status read's own `requires_payment`
 *     is never enough: it answers the row when it could not read Stripe. A failed call (a 502
 *     when Stripe cannot be read, the network) proves nothing and the record stays;
 *   - `cancelled_paused` or `failed`: the ending, when the wait was shown or the card was seen
 *     authorized; otherwise `gone` (a card declined, then the page left);
 *   - a payment the API does not know (a JSON 404 `not_found`, from the status read or the
 *     confirmation): `gone`. Any other 404 (a broken deployment) is a failed call.
 *
 * The pick-up never outlives WAIT_LIMIT_SECONDS by more than a read: the bound is checked after
 * every call in every branch, on the clock read after the call, and each call (status or
 * confirmation) runs within the time left before it (`withinBound`, never less than
 * STATUS_POLL_MS, so the last read still happens). A call cut by that bound is « no answer ». An
 * answer that settles the purchase wins when it comes in time; otherwise, at the bound,
 * `unresolved`, and the record stays: the next tap follows it instead of paying again. Rejects
 * only when `signal` aborts.
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
  const elapsedSeconds = (): number => Math.round((now() - startedAt) / 1000);
  const timeLeftMs = (): number =>
    Math.max(STATUS_POLL_MS, WAIT_LIMIT_SECONDS * 1000 - (now() - startedAt));
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
      response = await withinBound(
        (bounded) => deps.status(paymentIntentId, bounded),
        signal,
        timeLeftMs(),
      );
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      if (isUnknownPayment(error)) return { kind: "gone" };
      // A dropped connection, a 5xx: ask again.
    }
    if (response !== null) {
      const outcome = outcomeOf(response);
      if (outcome !== null) {
        if (outcome.kind === "ticketed" || shown) return outcome;
        return { kind: "gone" };
      }
      if (response.status === "processing" || response.status === "ticketed") show();
    }
    let seconds = elapsedSeconds();
    if (
      !shown &&
      response?.status === "requires_payment" &&
      seconds >= RESUME_UNSEEN_LIMIT_SECONDS &&
      seconds >= nextVerifyAt &&
      seconds < WAIT_LIMIT_SECONDS
    ) {
      // Only Stripe's own word lets an unseen card go. The status read cannot give it: when its
      // own read of Stripe fails, it answers the row, `requires_payment`, for a card that may be
      // authorized. The confirmation reads the payment at Stripe on every call and answers 502
      // when it cannot (or cannot match it to its row): its `requires_payment` means Stripe said
      // unpaid or over. Asked at most once per RESUME_VERIFY_EVERY_SECONDS; a failure proves
      // nothing and the record stays.
      nextVerifyAt = seconds + RESUME_VERIFY_EVERY_SECONDS;
      let verified: CheckoutStatusResponse | null = null;
      try {
        verified = await withinBound(
          (bounded) => deps.confirm(paymentIntentId, bounded),
          signal,
          timeLeftMs(),
        );
      } catch (error: unknown) {
        if (isAbortError(error)) throw error;
        if (isUnknownPayment(error)) return { kind: "gone" };
        // A 502 (Stripe unreachable, or an intent it could not check), the network: no answer.
      }
      if (verified !== null) {
        const outcome = outcomeOf(verified);
        // Over before any ticket, for a card never seen authorized: nothing to show.
        if (outcome !== null) return outcome.kind === "ticketed" ? outcome : { kind: "gone" };
        if (verified.status === "requires_payment") return { kind: "gone" };
        // `processing`: authorized and handed over, or still pending at Stripe. Followed, shown.
        show();
      }
      seconds = elapsedSeconds();
    }
    if (seconds >= WAIT_LIMIT_SECONDS) {
      // A minute without an answer that settles it: the record stays, and the next tap follows it
      // instead of paying again.
      return { kind: "unresolved" };
    }
    if (shown) onWaiting?.(seconds);
  }
}
