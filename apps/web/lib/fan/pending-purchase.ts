/**
 * The purchase a fan started on a promo's page, kept in `localStorage` so that a page lost during
 * « Securing your promo… » (reloaded, closed, killed by the phone) finds its ticket when the promo's
 * page is opened again (review 2.1). Written as soon as `POST /api/checkout` answers, marked once the
 * card is authorized, forgotten when the payment ends (with a ticket or without). One record per
 * promo: a new purchase replaces the last one.
 *
 * Only the payment's id is kept, never its client secret. A storage that throws (private window,
 * blocked site data) is ignored: the purchase then simply cannot be picked up again.
 */

const PREFIX = "winz.purchase.";

export interface PendingPurchase {
  paymentIntentId: string;
  /** The card was seen authorized before the page was lost. */
  authorized: boolean;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): PendingPurchase | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { paymentIntentId, authorized } = value as Record<string, unknown>;
    if (typeof paymentIntentId !== "string" || paymentIntentId === "") return null;
    return { paymentIntentId, authorized: authorized === true };
  } catch {
    return null;
  }
}

export function rememberPurchase(
  slug: string,
  purchase: PendingPurchase,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(`${PREFIX}${slug}`, JSON.stringify(purchase));
  } catch {
    // Full or blocked storage: the purchase goes on, it just cannot be picked up after a reload.
  }
}

export function pendingPurchase(
  slug: string,
  storage: StorageLike | null = browserStorage(),
): PendingPurchase | null {
  try {
    return parse(storage?.getItem(`${PREFIX}${slug}`) ?? null);
  } catch {
    return null;
  }
}

/** Forgets the record of `slug`, only when it is still this payment's (a newer one stays). */
export function forgetPurchase(
  slug: string,
  paymentIntentId: string,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    if (pendingPurchase(slug, storage)?.paymentIntentId !== paymentIntentId) return;
    storage?.removeItem(`${PREFIX}${slug}`);
  } catch {
    // See rememberPurchase.
  }
}

/** The query parameters Stripe adds to the page it sends a payer back to after a redirect. */
export const STRIPE_RETURN_PARAMS = [
  "payment_intent",
  "payment_intent_client_secret",
  "redirect_status",
] as const;

/**
 * The purchase to pick up on a promo's page: the one a payment redirect (3-D Secure) brings back in
 * the address (`?payment_intent=pi_…&redirect_status=succeeded`), else the one this browser kept for
 * this promo. A redirect that says `failed` brings nothing back to follow (Stripe's own page told
 * the fan; the kept one, if any, is still picked up).
 */
export function purchaseToResume(
  search: string,
  kept: PendingPurchase | null,
): PendingPurchase | null {
  const params = new URLSearchParams(search);
  const fromRedirect = params.get("payment_intent");
  const status = params.get("redirect_status");
  if (fromRedirect !== null && fromRedirect.startsWith("pi_") && status !== "failed") {
    const authorized =
      status === "succeeded" || (kept?.paymentIntentId === fromRedirect && kept.authorized);
    return { paymentIntentId: fromRedirect, authorized };
  }
  return kept;
}

/**
 * What a tap on Pay does about the purchase this browser kept for the promo (review 1.2, across a
 * reload or a payment redirect): the sheet's own memory only lives as long as the page, the record
 * outlives it, and a payment that may be authorized must never be paid a second time.
 *
 *   - no record: `pay` (a new purchase);
 *   - a record whose payment the sheet holds and has not seen authorized (an answer lost, a card
 *     declined, in this same page): `pay`, and `runCheckout` pays that same payment again;
 *   - any other record (the card was seen authorized, or the page that started it was lost and
 *     its client secret with it): `follow` that payment to its end first. Only when it turns out
 *     over without a ticket (`gone`, the record forgotten) may the tap create a new one.
 */
export type BeforePaying = { kind: "pay" } | { kind: "follow"; purchase: PendingPurchase };

export function beforePaying(
  kept: PendingPurchase | null,
  heldPaymentIntentId: string | null,
): BeforePaying {
  if (kept === null) return { kind: "pay" };
  if (!kept.authorized && kept.paymentIntentId === heldPaymentIntentId) return { kind: "pay" };
  return { kind: "follow", purchase: kept };
}
